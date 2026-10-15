const path     = require('path');
const express  = require('express');
const cors     = require('cors');
const axios    = require('axios');
const multer   = require('multer');
const mongoose = require('mongoose');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const { Queue, QueueEvents, Worker } = require('bullmq');
const IORedis = require('ioredis');
const { THAI_FOODS } = require('./thai-foods');
const { recognizeFood, preprocessImage } = require('./services/foodRecognition');
const { timezoneOf, localDay, checkQuota, recordUse } = require('./services/usageLimits');
require('dotenv').config();

const User     = require('./models/User');
const DailyLog = require('./models/DailyLog');
const Food     = require('./models/Food');
const Analysis = require('./models/Analysis');
const Feedback = require('./models/Feedback');
const Admin    = require('./models/Admin');
const adminRoutes = require('./routes/adminRoutes');
const { loginLimiter, registerLimiter } = require('./middleware/rateLimiter');

const app    = express();
// nginx 在本機轉發，並在 X-Forwarded-For 帶上真實 IP；只信任來自 loopback 的轉發，
// 否則 req.ip 永遠是 127.0.0.1，所有人共用同一份登入限流額度
app.set('trust proxy', 'loopback');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

app.use(cors());
app.use(express.json());

/* ===== 後台管理系統（原 SP1 專案），掛在 /admin 底下 =====
   靜態頁面跟 API 用同一個 prefix 但不會撞在一起：
   /admin/dashboard.html 這類是靜態檔，/admin/users 這類是 API */
app.use('/admin', express.static(path.join(__dirname, 'public-admin')));
app.get('/admin', (_, res) => res.redirect('/admin/adminLogin.html'));
app.use('/admin', adminRoutes);

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
// AI 教練用的模型，依序嘗試（前一個失敗就立刻換下一個，不等退避）。
// 2026-10 實測：flash-latest / 3.5-flash 尖峰時一次要 13~22 秒還常回 503，教練幾乎都逾時；
// 3.5-flash-lite 關掉思考只要 1~2 秒，聊天品質足夠。可用 GEMINI_COACH_MODELS 環境變數覆寫
const COACH_MODELS = (process.env.GEMINI_COACH_MODELS || 'gemini-3.5-flash-lite,gemini-3.1-flash-lite')
  .split(',').map(m => m.trim()).filter(Boolean);
const JWT_SECRET = process.env.JWT_SECRET;

// Google 登入：三個平台各自的 Client ID 共用同一組驗證（Web 用來源自 web/expo-auth-session 的 id_token，iOS/Android 各自的原生 client）。
// 每個變數都可以用逗號放多個——Google 的 iOS Client 一個只綁一個 Bundle ID，
// Expo 版（com.taianan.calorieapp）跟原生 Swift 版（com.taian.calorietracker.app）要各自一組
const GOOGLE_CLIENT_IDS = [
  process.env.GOOGLE_WEB_CLIENT_ID,
  process.env.GOOGLE_IOS_CLIENT_ID,
  process.env.GOOGLE_ANDROID_CLIENT_ID,
].flatMap(v => (v ?? '').split(',')).map(v => v.trim()).filter(Boolean);
const googleClient = new OAuth2Client();

/* ===== MongoDB（與管理後台共用 calorieDB）===== */
mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/calorieDB')
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.error('MongoDB connect failed:', err.message));

// 啟動時一次性遷移：foods 空的話把泰式對照表種進去
async function seedFoods() {
  try {
    if (await Food.countDocuments() === 0) {
      await Food.insertMany(THAI_FOODS.map(f => ({ ...f, source: 'thai' })));
      console.log(`Seeded ${THAI_FOODS.length} thai foods into DB`);
    }
  } catch (err) {
    console.error('[seedFoods]', err.message);
  }
}

// 沒有任何管理員時，用 ADMIN_INITIAL_PASSWORD 建立第一個 admin 帳號。
// 不給預設密碼：沒設這個環境變數就不建立，避免正式環境留著人人知道的密碼。
async function seedAdmin() {
  try {
    if (await Admin.countDocuments() > 0) return;
    const password = process.env.ADMIN_INITIAL_PASSWORD;
    if (!password || password.length < 12) {
      console.warn('[seedAdmin] No admin account exists. Set ADMIN_INITIAL_PASSWORD (12+ characters) and restart to create one.');
      return;
    }
    await Admin.create({ username: 'admin', passwordHash: await bcrypt.hash(password, 10) });
    console.log('[seedAdmin] Created the admin account from ADMIN_INITIAL_PASSWORD. Remove the variable from .env now.');
  } catch (err) {
    console.error('[seedAdmin]', err.message);
  }
}

mongoose.connection.once('open', () => {
  seedFoods();
  seedAdmin();
});

/* ===== 食物辨識任務佇列（BullMQ + Redis）=====
   /analyze 以前是收到照片後同步跑完 Gemini/Vision + USDA 才回應，最壞情況要等 8-9 秒。
   後來改成：收到照片就建一筆 status:'pending' 的 Analysis、把工作丟進佇列，實際辨識交給下面的 Worker。
   2026-09 再調整：/analyze 會在 request 裡等 Worker 最多 ANALYZE_WAIT_MS，做完就直接回結果，
   等不到才回 analysisId 讓前端輪詢 GET /analyses/:id（佇列的限流好處保留，一般情況又不用多等輪詢間隔）。 */
const redisConnection = new IORedis(process.env.REDIS_URL || 'redis://127.0.0.1:6379', {
  maxRetriesPerRequest: null, // BullMQ 要求：連線設定不能限制重試次數
});
redisConnection.on('error', err => console.error('[redis]', err.message));

const analysisQueue = new Queue('food-analysis', { connection: redisConnection });
// POST /analyze 用 QueueEvents 在同一個 request 裡等結果；QueueEvents 需要自己一條 Redis 連線（它會 block 讀事件串流）
const analysisQueueEvents = new QueueEvents('food-analysis', { connection: redisConnection.duplicate() });
// 辨識本身的死線是 7.5 秒（見 services/foodRecognition.js），這裡多留一點給排隊與寫 DB
const ANALYZE_WAIT_MS = Number(process.env.ANALYZE_WAIT_MS) || 8000;

/* ===== Auth ===== */
const PROFILE_FIELDS = ['name', 'avatarKey', 'gender', 'age', 'ageSetAt', 'height', 'weight', 'activity', 'goal', 'bmr', 'tdee', 'target'];

function publicProfile(user) {
  const out = { email: user.email, username: user.username };
  for (const f of PROFILE_FIELDS) if (user[f] != null) out[f] = user[f];
  return out;
}

function signToken(user) {
  return jwt.sign({ uid: user._id.toString() }, JWT_SECRET, { expiresIn: '90d' });
}

// 除了驗簽章，也確認這個帳號還存在：JWT 有效期 90 天，帳號刪除後舊 token 還是驗得過，
// 不擋的話 App 端殘留的 token 呼叫 PUT /logs（upsert）會默默替已刪除的帳號重新建出資料
async function requireAuth(req, res, next) {
  const token = (req.headers.authorization || '').replace(/^Bearer /, '');
  let uid;
  try {
    uid = jwt.verify(token, JWT_SECRET).uid;
  } catch {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (!(await User.exists({ _id: uid }).catch(() => null))) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  req.uid = uid;
  next();
}

// 有帶 token 就解析、沒帶也放行（/analyze 用：匿名可用，登入者記到個人歷史）
function optionalAuth(req, _res, next) {
  const token = (req.headers.authorization || '').replace(/^Bearer /, '');
  try { req.uid = jwt.verify(token, JWT_SECRET).uid; } catch { req.uid = null; }
  next();
}

// 註冊：可同時帶 profile（把本地資料一起上傳）
app.post('/auth/register', registerLimiter, async (req, res) => {
  try {
    const { email, username, password, profile } = req.body;
    if (!email?.trim() || !username?.trim() || !password || password.length < 4) {
      return res.status(400).json({ error: 'Invalid email, username or password (min 4 chars)' });
    }
    if (await User.findOne({ email: email.trim().toLowerCase() })) {
      return res.status(409).json({ error: 'Email already registered' });
    }
    if (await User.findOne({ username: username.trim() })) {
      return res.status(409).json({ error: 'Username already taken' });
    }
    // profile 是前端傳來的本地資料，只能拿白名單裡的欄位，不然亂塞的 key（例如 username/passwordHash）
    // 會透過 spread 蓋掉上面已經驗證過的值 —— 這裡曾經因為前端本地存了一份髒的 profile.username 導致 create 失敗
    const safeProfile = {};
    for (const f of PROFILE_FIELDS) if (profile?.[f] !== undefined) safeProfile[f] = profile[f];

    const count = await User.countDocuments();
    const user = await User.create({
      userId: 'u' + (1001 + count),
      email: email.trim().toLowerCase(),
      username: username.trim(),
      passwordHash: await bcrypt.hash(password, 10),
      name: username.trim(), // 註冊時輸入的 username 預設當顯示名稱，除非 profile 裡有帶自己填的 name
      ...safeProfile,
    });
    res.json({ token: signToken(user), profile: publicProfile(user) });
  } catch (err) {
    console.error('[register]', err.message);
    res.status(500).json({ error: 'Register failed' });
  }
});

app.post('/auth/login', loginLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email: (email ?? '').trim().toLowerCase() });
    if (!user?.passwordHash || !(await bcrypt.compare(password ?? '', user.passwordHash))) {
      return res.status(401).json({ error: 'Wrong email or password' });
    }
    res.json({ token: signToken(user), profile: publicProfile(user) });
  } catch (err) {
    console.error('[login]', err.message);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Google 登入／註冊二合一：前端拿到 Google 的 idToken 丟過來，這裡驗證後直接找到或建立帳號
app.post('/auth/google', async (req, res) => {
  try {
    const { idToken } = req.body;
    if (!idToken) return res.status(400).json({ error: 'Missing idToken' });
    if (!GOOGLE_CLIENT_IDS.length) return res.status(500).json({ error: 'Google login not configured' });

    const ticket = await googleClient.verifyIdToken({ idToken, audience: GOOGLE_CLIENT_IDS });
    const { sub: googleId, email, email_verified: emailVerified, name } = ticket.getPayload();
    // Account 以 email 識別：Google 沒驗證過的 email 不能拿來建立或接管帳號
    if (!email || emailVerified !== true) {
      return res.status(403).json({ error: 'Your Google account email is not verified' });
    }

    let user = await User.findOne({ googleId });
    if (!user) {
      // 沒有這個 googleId：先看看這個 email 是不是本來就用密碼註冊過，是的話直接把帳號綁上 googleId
      user = await User.findOne({ email: email.trim().toLowerCase() });
      if (user) {
        user.googleId = googleId;
        await user.save();
      } else {
        const count = await User.countDocuments();
        user = await User.create({
          userId: 'u' + (1001 + count),
          email: email.trim().toLowerCase(),
          googleId,
          name,
        });
      }
    }
    res.json({ token: signToken(user), profile: publicProfile(user) });
  } catch (err) {
    console.error('[google auth]', err.message);
    res.status(401).json({ error: 'Google 驗證失敗' });
  }
});

/* ===== Profile ===== */
app.get('/me', requireAuth, async (req, res) => {
  const user = await User.findById(req.uid);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(publicProfile(user));
});

app.put('/me', requireAuth, async (req, res) => {
  const patch = {};
  for (const f of PROFILE_FIELDS) if (req.body[f] !== undefined) patch[f] = req.body[f];
  const user = await User.findByIdAndUpdate(req.uid, patch, { new: true });
  res.json(publicProfile(user));
});

// DELETE /me — 刪除帳號（App Store 審核準則 5.1.1(v)：App 裡能註冊，就必須能在 App 裡刪除帳號）。
// 帳號、所有日誌、辨識歷史全部刪除；意見回饋的內容保留給後台看，但拿掉 userId 和留的 email，追不回是誰寫的
app.delete('/me', requireAuth, async (req, res) => {
  try {
    await Promise.all([
      DailyLog.deleteMany({ userId: req.uid }),
      Analysis.deleteMany({ userId: req.uid }),
      Feedback.updateMany({ userId: req.uid }, { $set: { userId: null }, $unset: { email: '' } }),
    ]);
    await User.deleteOne({ _id: req.uid });
    console.log('[delete account]', req.uid);
    res.json({ ok: true });
  } catch (err) {
    console.error('[delete account]', err.message);
    res.status(500).json({ error: 'Failed to delete account' });
  }
});

/* ===== Daily Logs 同步 ===== */
// 取回所有（或某區間的）日誌，回傳格式與 App 本地儲存一致：{ "YYYY-MM-DD": {...} }
app.get('/logs', requireAuth, async (req, res) => {
  const query = { userId: req.uid };
  if (req.query.from || req.query.to) {
    query.date = {};
    if (req.query.from) query.date.$gte = req.query.from;
    if (req.query.to)   query.date.$lte = req.query.to;
  }
  const logs = await DailyLog.find(query).lean();
  const out = {};
  for (const l of logs) {
    out[l.date] = {
      weight: l.weight, target: l.target,
      meals: (l.meals ?? []).map(({ name, energy, protein, carbs, fat, mealType, time }) =>
        ({ name, energy, protein, carbs, fat, mealType, time })),
    };
  }
  res.json(out);
});

// 整天覆寫（最後寫入者贏），App 每次記錄後呼叫
app.put('/logs/:date', requireAuth, async (req, res) => {
  const { date } = req.params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'Bad date' });
  const { weight, target, meals } = req.body ?? {};
  await DailyLog.updateOne(
    { userId: req.uid, date },
    { $set: { weight, target, meals: meals ?? [] } },
    { upsert: true }
  );
  res.json({ ok: true });
});

// 教練要知道使用者過去的飲食與體重紀錄（不只今天），才能看長期趨勢給建議。
// 最近 14 天逐日列出，再加上 28 天的平均與體重變化；只算有記錄食物的天數
const COACH_HISTORY_DAYS = 28;
const COACH_DAILY_LINES = 14;
async function coachHistory(userId, today, currentTarget) {
  const from = new Date(Date.parse(`${today}T00:00:00Z`) - COACH_HISTORY_DAYS * 86400000).toISOString().slice(0, 10);
  const logs = await DailyLog.find({ userId, date: { $gte: from, $lt: today } }).sort({ date: 1 }).lean();
  const days = logs
    .filter(l => l.meals?.length)
    .map(l => {
      const sum = k => l.meals.reduce((acc, m) => acc + (m[k] || 0), 0);
      return { date: l.date, energy: sum('energy'), protein: sum('protein'), target: l.target ?? currentTarget };
    });
  const weights = logs.filter(l => l.weight != null).map(l => ({ date: l.date, weight: l.weight }));
  if (!days.length && !weights.length) return ['（還沒有今天以前的紀錄）'];

  const lines = days.slice(-COACH_DAILY_LINES).map(d => {
    const diff = d.target != null ? Math.round(d.energy - d.target) : null;
    const vs = diff == null ? '' : diff > 0 ? `，超出目標 ${diff}` : `，低於目標 ${-diff}`;
    return `${d.date}：${Math.round(d.energy)} kcal${vs}（蛋白質 ${Math.round(d.protein)}g）`;
  });
  if (days.length) {
    const avg = Math.round(days.reduce((a, d) => a + d.energy, 0) / days.length);
    const withTarget = days.filter(d => d.target != null);
    const net = Math.round(withTarget.reduce((a, d) => a + d.energy - d.target, 0));
    lines.push(`過去 ${COACH_HISTORY_DAYS} 天有記錄的 ${days.length} 天，平均每天 ${avg} kcal` +
      (withTarget.length ? `，相對目標累計 ${net >= 0 ? '+' : ''}${net} kcal` : ''));
  }
  if (weights.length >= 2) {
    const first = weights[0], last = weights[weights.length - 1];
    lines.push(`體重紀錄：${first.date} ${first.weight} kg → ${last.date} ${last.weight} kg`);
  } else if (weights.length === 1) {
    lines.push(`體重紀錄：${weights[0].date} ${weights[0].weight} kg`);
  }
  return lines;
}

/* ===== AI 教練：一般文字對話，帶使用者的身體數據 + 今天的飲食進度當背景資訊 =====
   跟 /analyze 不一樣，這裡不用 BullMQ 排隊——純文字對話本來就是「問了就等一下」的體驗，
   使用者本來就有心理預期要等 AI 回覆，不像拍照上傳需要立刻有反應，直接同步呼叫就好。 */
app.post('/coach/chat', requireAuth, async (req, res) => {
  try {
    if (!GEMINI_API_KEY) return res.status(500).json({ error: 'AI 教練尚未設定' });

    const { messages } = req.body ?? {};
    const lang = req.body?.lang === 'en' ? 'en' : 'zh'; // 跟著 App 的語言設定回答
    if (!Array.isArray(messages) || !messages.length) {
      return res.status(400).json({ error: 'Missing messages' });
    }

    const user = await User.findById(req.uid).lean();
    if (!user) return res.status(404).json({ error: 'User not found' });

    const tz = timezoneOf(req);
    const quota = await checkQuota(user, 'coach', tz);
    if (!quota.allowed) return res.status(429).json({ error: 'daily_limit', ...quota });

    // 「今天」用使用者當地的日期，跟 App 記錄飲食用的日期一致（以前用 UTC，台灣早上 8 點前會讀到前一天）
    const today = localDay(tz).day;
    const todayLog = await DailyLog.findOne({ userId: req.uid, date: today }).lean();
    const totals = (todayLog?.meals ?? []).reduce(
      (acc, m) => ({
        energy:  acc.energy  + (m.energy  || 0),
        protein: acc.protein + (m.protein || 0),
        carbs:   acc.carbs   + (m.carbs   || 0),
        fat:     acc.fat     + (m.fat     || 0),
      }),
      { energy: 0, protein: 0, carbs: 0, fat: 0 }
    );
    const remaining = user.target != null ? Math.round(user.target - totals.energy) : null;
    const history = await coachHistory(req.uid, today, user.target);

    const systemPrompt = [
      '你是「AI 卡路里追蹤」App 裡的個人營養與健身教練，個性親切、有耐心、講重點，語氣自然口語化。',
      lang === 'en'
        ? 'Always reply in English, even if the user writes in another language.'
        : '用繁體中文回答。',
      '每次回覆盡量控制在 3-5 句話以內，除非使用者明確要求詳細說明；可以直接引用下面的數字給具體建議，不用每次都重複背景資料。',
      '不是醫生，不做疾病診斷；遇到明顯的健康/醫療問題，建議使用者去看醫生或營養師，不要自己給診斷或處方。',
      '',
      '=== 使用者資料 ===',
      user.gender != null   ? `性別：${{ male: '男', female: '女' }[user.gender] ?? '其他 / 不透露（BMR 用男女公式平均估算）'}` : null,
      user.age != null      ? `年齡：${user.age} 歲` : null,
      user.height != null   ? `身高：${user.height} cm` : null,
      user.weight != null   ? `體重：${user.weight} kg` : null,
      user.activity != null ? `活動程度：${user.activity}` : null,
      user.goal != null     ? `目標：${user.goal}` : null,
      user.bmr != null      ? `基礎代謝 BMR：${Math.round(user.bmr)} kcal` : null,
      user.tdee != null     ? `每日總消耗 TDEE：${Math.round(user.tdee)} kcal` : null,
      user.target != null   ? `每日熱量目標：${Math.round(user.target)} kcal` : null,
      `今天已攝取：${Math.round(totals.energy)} kcal（蛋白質 ${totals.protein.toFixed(1)}g / 碳水 ${totals.carbs.toFixed(1)}g / 脂肪 ${totals.fat.toFixed(1)}g）`,
      remaining != null ? `今天還剩：${remaining} kcal` : null,
      '',
      '=== 過去的紀錄（今天之前）===',
      '飲食是一個長期的過程：回答時要結合下面這些過去的紀錄看整體趨勢，不要只看今天。',
      '例如前一天吃超過目標，就看最近幾天的總和，建議接下來幾天每天少吃一點慢慢補回來（每天最多少 300~500 kcal，不要低於基礎代謝），而不是叫使用者隔天不吃。',
      ...history,
    ].filter(Boolean).join('\n');

    // messages 是前端存在本地的對話紀錄（不落地存 DB），每則是 { role: 'user' | 'model', text }——
    // 整段陣列每次都送過去，讓 Gemini 有上下文，簡單但對一般聊天長度來說夠用
    const contents = messages
      .filter(m => m?.text?.trim())
      .map(m => ({ role: m.role === 'model' ? 'model' : 'user', parts: [{ text: m.text.trim() }] }));

    let reply, lastErr;
    for (const model of COACH_MODELS) {
      try {
        const geminiRes = await axios.post(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
          {
            systemInstruction: { parts: [{ text: systemPrompt }] },
            contents,
            generationConfig: { thinkingConfig: { thinkingLevel: 'minimal' } },
          },
          { timeout: 12000, headers: { 'X-goog-api-key': GEMINI_API_KEY } } // key 放 header，不放網址（才不會出現在 log）
        );
        reply = geminiRes.data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
        if (reply) break;
      } catch (err) {
        lastErr = err;
        console.warn(`[coach/chat] ${model} failed:`, err.response?.status ?? err.message);
      }
    }
    if (!reply && lastErr) throw lastErr;
    if (!reply) return res.status(502).json({ error: 'AI 沒有回應，請再試一次' });

    await recordUse(user, 'coach', tz);
    res.json({ reply });
  } catch (err) {
    console.error('[coach/chat] failed:', err.response?.data ? JSON.stringify(err.response.data) : err.message);
    res.status(500).json({ error: 'AI 教練暫時無法回應，請稍後再試' });
  }
});

// Gemini 直接「看圖辨認 + 估營養素」，不再只給候選名稱交給 USDA 查（USDA 是英文資料庫，在地小吃常配錯）。
// 辨識本身（prompt、縮圖、模型對沖與死線）搬到 services/foodRecognition.js，那邊有速度與準確度調整的完整說明。
// images 是 [{ buffer, mimeType }, ...]，可以是空陣列——首頁「文字輸入」選項不會有照片，純靠使用者打的文字說明辨識。
// 超過一張時視為「同一份食物」的多角度照片（例如正面+側面+標籤），合併送給 Gemini 讓辨識更準，
// 不是多份不同食物——多份食物要分開各拍各送，才會各自產生一筆紀錄。
async function runFoodAnalysis(images, description, lang) {
  if (!GEMINI_API_KEY) { const e = new Error('AI 辨識尚未設定'); e.status = 500; throw e; }

  const result = await recognizeFood(images, description, { lang });
  if (!result) { const e = new Error('No food data found'); e.status = 502; throw e; }

  console.log('[Recognize]', result.name, `${result.grams}g`, `${result.energy}kcal`,
    `confidence=${result.confidence}`, `${result.model} ${result.aiMs}ms`);
  return result;
}

// Worker：實際消化佇列裡的辨識任務。Gemini 呼叫幾乎都在等網路，不太吃這台機器的 CPU，
// concurrency 從 3 拉到 8：尖峰時 3 個名額會讓後面的人先排隊好幾秒，9 秒內出結果就做不到了
new Worker('food-analysis', async (job) => {
  const { images, description, analysisId, lang } = job.data;
  const imageBuffers = (images ?? []).map(img => ({ buffer: Buffer.from(img.data, 'base64'), mimeType: img.mimeType }));
  try {
    const result = await runFoodAnalysis(imageBuffers, description, lang);
    await Analysis.findByIdAndUpdate(analysisId, {
      status: 'done',
      matchedName: result.name,
      source: 'gemini',
      result,
    });
    return result; // /analyze 的 waitUntilFinished 會直接拿到這個回傳值
  } catch (err) {
    console.error('[analyze worker] failed:', err.response?.data ? JSON.stringify(err.response.data) : err.message);
    await Analysis.findByIdAndUpdate(analysisId, { status: 'failed', error: err.message ?? 'Analysis failed' });
    throw err; // 讓 BullMQ 照樣記錄成失敗任務，方便之後看失敗率
  }
}, { connection: redisConnection, concurrency: Number(process.env.ANALYZE_CONCURRENCY) || 8 });

function publicAnalysisResult(r) {
  return {
    status: 'done',
    name: r.name, energy: r.energy, protein: r.protein, carbs: r.carbs, fat: r.fat,
    grams: r.grams, confidence: r.confidence,
    fiber: r.fiber, sugar: r.sugar, sodium: r.sodium, potassium: r.potassium,
    calcium: r.calcium, iron: r.iron, vitaminC: r.vitaminC, vitaminA: r.vitaminA,
    saturatedFat: r.saturatedFat, cholesterol: r.cholesterol,
    items: r.items ?? [],
  };
}

// POST /analyze — 收到圖片和/或文字說明（至少要有一樣，純文字輸入時沒有圖片也可以）。
// 流程：先把照片縮到 1024px（原圖 3~5MB → 約 150KB，塞 Redis、送 Gemini 都快很多）→ 建 pending 紀錄丟進佇列 →
// 在同一個 request 裡等 Worker 做完，最多等 ANALYZE_WAIT_MS：
//   - 做完了（絕大多數情況，實測 3~4 秒）→ 直接 200 回傳結果，前端不用再輪詢，省掉最多一整個輪詢間隔
//   - 還沒好（佇列塞車等極端情況）→ 退回原本的 202 + analysisId，前端照舊輪詢 GET /analyses/:id
// 必須登入（2026-10 起）：AI 是付費 API，匿名可用的話任何人都能無限制打、費用算在我們頭上。
// 每日額度見 services/usageLimits.js，超過回 429 { error: 'daily_limit', used, limit, plan, resetAt }
app.post('/analyze', requireAuth, upload.array('images', 5), async (req, res) => {
  const description = (req.body.description ?? '').trim();
  // App 的語言設定（'en' | 'zh'），決定 AI 回傳的食物名稱用哪種語言；舊版 App 不會帶，預設中文
  // 同名欄位送兩次時 multer 會給陣列（['en','en']），直接比對 === 'en' 會失敗而退回中文——取第一個值
  const langField = Array.isArray(req.body.lang) ? req.body.lang[0] : req.body.lang;
  const lang = langField === 'en' ? 'en' : 'zh';
  const files = req.files ?? [];
  if (!files.length && !description) return res.status(400).json({ error: 'Please provide an image or a description' });

  const user = await User.findById(req.uid).lean();
  const quota = await checkQuota(user, 'analyze', timezoneOf(req));
  if (!quota.allowed) return res.status(429).json({ error: 'daily_limit', ...quota });

  let analysis, job;
  try {
    const images = await Promise.all(files.map(f => preprocessImage(f.buffer, f.mimetype)));
    analysis = await Analysis.create({ userId: req.uid, status: 'pending' });
    job = await analysisQueue.add('analyze', {
      analysisId: analysis._id.toString(),
      images: images.map(img => ({ data: img.buffer.toString('base64'), mimeType: img.mimeType })),
      description,
      lang,
    }, {
      removeOnComplete: true, // 圖片資料只活在佇列裡，任務一結束（成功或失敗）就從 Redis 清掉，不留底
      removeOnFail: true,
    });
  } catch (err) {
    console.error('[analyze] enqueue failed:', err.message);
    return res.status(500).json({ error: 'Analysis failed' });
  }

  try {
    const result = await job.waitUntilFinished(analysisQueueEvents, ANALYZE_WAIT_MS);
    return res.json({ analysisId: analysis._id, ...publicAnalysisResult(result) });
  } catch (err) {
    // 兩種情況會到這：Worker 辨識失敗（status 已經寫成 failed），或是等超過 ANALYZE_WAIT_MS 還在跑
    const latest = await Analysis.findById(analysis._id).lean().catch(() => null);
    if (latest?.status === 'failed') return res.status(502).json({ error: latest.error ?? 'Analysis failed' });
    return res.status(202).json({ analysisId: analysis._id, status: 'pending' });
  }
});

// GET /usage — 今天各項 AI 功能用了幾次、上限多少，App 用來顯示「今天還剩 3 次」
app.get('/usage', requireAuth, async (req, res) => {
  const user = await User.findById(req.uid).lean();
  const tz = timezoneOf(req);
  const [analyze, coach] = await Promise.all([checkQuota(user, 'analyze', tz), checkQuota(user, 'coach', tz)]);
  res.json({
    plan: analyze.plan,
    resetAt: analyze.resetAt,
    analyze: { used: analyze.used, limit: analyze.limit },
    coach: { used: coach.used, limit: coach.limit },
  });
});

// GET /analyses/:id — 前端輪詢用：查某一筆辨識任務目前的狀態，done 的話一併回傳結果
app.get('/analyses/:id', optionalAuth, async (req, res) => {
  const analysis = await Analysis.findById(req.params.id).catch(() => null);
  // 找不到，或這筆是別人登入時建立的（userId 對不上），一律當作 404，不洩漏是否存在
  if (!analysis || (analysis.userId && String(analysis.userId) !== req.uid)) {
    return res.status(404).json({ error: 'Not found' });
  }
  if (analysis.status === 'pending') return res.json({ status: 'pending' });
  if (analysis.status === 'failed') return res.json({ status: 'failed', error: analysis.error });
  res.json(publicAnalysisResult(analysis.result));
});

/* ===== 食物搜尋與辨識歷史 ===== */
app.get('/foods/search', async (req, res) => {
  const q = (req.query.q ?? '').trim();
  if (q.length < 2) return res.json([]);
  const regex = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  const foods = await Food.find({ $or: [{ name: regex }, { aliases: regex }] })
    .limit(20)
    .select('name energy protein carbs fat source')
    .lean();
  res.json(foods);
});

app.get('/analyses', requireAuth, async (req, res) => {
  const items = await Analysis.find({ userId: req.uid, status: 'done' })
    .sort({ createdAt: -1 })
    .limit(50)
    .select('matchedName source result createdAt')
    .lean();
  res.json(items);
});

// POST /feedback — 匿名也能送出，登入的話附上 userId 方便之後追蹤
app.post('/feedback', optionalAuth, async (req, res) => {
  try {
    const { message, email } = req.body ?? {};
    if (!message?.trim()) return res.status(400).json({ error: 'Message is required' });

    await Feedback.create({
      message: message.trim(),
      email: email?.trim() || undefined,
      userId: req.uid,
    });
    res.status(201).json({ success: true });
  } catch (err) {
    console.error('[feedback]', err.message);
    res.status(500).json({ error: 'Failed to submit feedback' });
  }
});

// Health check
app.get('/health', (_, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
