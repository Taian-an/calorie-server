const sharp = require('sharp');

/* ===== 食物辨識（Gemini 看圖估營養）=====
   從 server.js 抽出來的獨立模組，好處是可以單獨拿來跑基準測試（不用起 Redis/Mongo）。

   速度目標：使用者按下「分析」到拿到結果 ≤ 9 秒。實測拖慢的三個主因跟對應做法：
   1. 照片原圖直接送：手機原圖 3~5MB，上傳、base64 塞進 Redis、再轉送 Gemini 都慢
      → preprocessImage() 先縮到長邊 1024px、JPEG q80（約 100~200KB），辨識準確度幾乎不受影響
   2. gemini-flash-latest 預設會「思考」，遇到壅塞時同一張圖要 8~15 秒
      → 改用 flash-lite 系列（見下方 FOOD_MODELS）並把 thinking 關到 minimal，食物辨識這種看圖估數字的任務不需要長推理
   3. 失敗重試用 1s/2s/4s 退避，最壞情況光等待就 7 秒，一定超過 9 秒
      → 改成「整體死線 + 對沖請求（hedged request）」：主模型 HEDGE_MS 內沒回來就同時對備援模型再發一次，
        誰先回來用誰、其他的直接 abort；某個模型報錯就立刻換下一個，不再睡覺等退避

   準確度參考 fud-ai（開源食物辨識 App）的 prompt 做法再加強：
   - 包裝上有營養標示就以標示為準（fud-ai 的多圖分析也是這樣）
   - 可數的食物（披薩片、水餃、壽司）要數出實際個數，不要預設一份
   - 逐項拆解成分（items），總量 = 各項加總——強迫模型逐一估算白飯、肉、蛋、青菜，比直接猜一個總數準，
     也順便給使用者看得懂的明細
   - 提醒隱藏熱量：炒菜油、滷汁、醬料、勾芡，台式/泰式料理最常低估的就是這塊
   - 用 responseSchema 限定輸出格式，不會再遇到 JSON 解析失敗 */

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

// 依序嘗試的模型，第一個是主模型，後面是對沖/備援。可用環境變數覆寫，不用改程式碼就能換模型。
// 2026-09 實測（1024px 滷肉飯照片）：3.5-flash 約 2.7~3.1 秒、明細最細（會抓到半顆蛋、分出青江菜）；
// 3.5-flash-lite / 3.1-flash-lite 約 2.3~2.5 秒；原本的 flash-latest + 原圖約 5.3~6 秒。
// 2026-10 改成 flash-lite 優先：3.5-flash 尖峰時常回 503 或 13~22 秒才回，每次都要等 HEDGE_MS 才切到 lite，
// 實測整段 6~6.7 秒；lite 優先後 2.1~2.5 秒。代價是組成明細偶爾沒那麼細。3.5-flash 留在最後當備援
// 2.5-flash-lite 已對新使用者下架（404），不要再放進清單
const FOOD_MODELS = (process.env.GEMINI_FOOD_MODELS || 'gemini-3.5-flash-lite,gemini-3.1-flash-lite,gemini-3.5-flash')
  .split(',').map(s => s.trim()).filter(Boolean);
// 整段辨識最多花多久（毫秒）。留 ~1.5 秒給上傳與回傳，讓使用者端總時間壓在 9 秒內
const DEADLINE_MS = Number(process.env.FOOD_AI_DEADLINE_MS) || 7500;
// 主模型超過這個時間還沒回應，就同時對下一個模型發請求
const HEDGE_MS = Number(process.env.FOOD_AI_HEDGE_MS) || 4000;

const MAX_IMAGE_EDGE = 1024;

// 縮圖 + 轉正（手機照片的方向存在 EXIF 裡，rotate() 會照 EXIF 轉正後把 EXIF 拿掉）。
// 也順便把 HEIC/PNG/WebP 統一轉成 JPEG。轉檔失敗（例如不是圖片）就原樣送，讓 Gemini 自己判斷
async function preprocessImage(buffer, mimeType) {
  try {
    const out = await sharp(buffer, { failOn: 'none' })
      .rotate()
      .resize({ width: MAX_IMAGE_EDGE, height: MAX_IMAGE_EDGE, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 80, mozjpeg: true })
      .toBuffer();
    return { buffer: out, mimeType: 'image/jpeg' };
  } catch (err) {
    console.warn('[preprocessImage] 縮圖失敗，改送原圖：', err.message);
    return { buffer, mimeType: mimeType || 'image/jpeg' };
  }
}

// Gemini 3 系列用 thinkingLevel，2.5 系列用 thinkingBudget；*-latest 這種別名不確定背後是哪一代，就不指定
function thinkingConfigFor(model) {
  if (/^gemini-3/.test(model)) return { thinkingLevel: 'minimal' };
  if (/^gemini-2\.5/.test(model)) return { thinkingBudget: 0 };
  return undefined;
}

const NUM = { type: 'NUMBER' };
const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    name: { type: 'STRING' },
    items: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { name: { type: 'STRING' }, grams: NUM, calories: NUM },
        required: ['name', 'grams', 'calories'],
      },
    },
    estimatedGrams: NUM,
    calories: NUM,
    protein: NUM, carbs: NUM, fat: NUM,
    fiber: NUM, sugar: NUM, saturatedFat: NUM,
    sodium: NUM, potassium: NUM, calcium: NUM, cholesterol: NUM,
    iron: NUM, vitaminC: NUM, vitaminA: NUM,
    confidence: NUM,
  },
  required: ['name', 'items', 'estimatedGrams', 'calories', 'protein', 'carbs', 'fat', 'confidence'],
  propertyOrdering: [
    'name', 'items', 'estimatedGrams', 'calories', 'protein', 'carbs', 'fat',
    'fiber', 'sugar', 'saturatedFat', 'sodium', 'potassium', 'calcium', 'cholesterol',
    'iron', 'vitaminC', 'vitaminA', 'confidence',
  ],
};

// lang: 'en' 讓食物名稱、明細用英文輸出；其他值（預設）用繁體中文。只影響輸出文字，估算規則不變
function buildPrompt(imageCount, description, lang = 'zh') {
  const hasImage = imageCount > 0;
  return [
    hasImage
      ? (imageCount > 1
          ? `你是營養師等級的食物辨識助手。以下 ${imageCount} 張照片是「同一份食物」的不同角度或包裝標籤，請綜合判斷，不要當成好幾份食物。`
          : '你是營養師等級的食物辨識助手，請分析照片中的食物並估算營養成分。')
      : '你是營養師等級的食物辨識助手，使用者沒有照片，只用文字描述吃了什麼，請據此估算營養成分。',
    description
      ? `使用者說明：「${description}」。說明裡的份量、重量、品牌一律以使用者為準，不要憑照片重新猜；有品牌就用該品牌公開的營養數據。`
      : '',
    '估算步驟：',
    '1. 若看得到營養標示，直接用標示數值換算成實際份量，標示優先於目測。',
    hasImage
      ? '2. 把餐點拆成各個組成（例如白飯、滷肉、滷蛋、青菜），用碗盤、筷子、湯匙當比例尺估每項的公克數；可數的食物（披薩片、水餃、壽司、雞塊）要數出實際個數；只算照片裡實際有的量（半顆蛋就算半顆、吃剩的就算剩下的）。'
      : '2. 把描述拆成各個組成，沒講份量就用台灣一般家常/店家常見份量。',
    '3. 算進隱藏熱量：炒菜油、滷汁、醬料、勾芡、美乃滋、含糖飲料的糖。',
    '4. 總量 = 各項加總，calories 要跟 items 的熱量加總一致。',
    '',
    (lang === 'en'
      ? '欄位說明：name 和 items[].name 一律用英文（English）輸出，就算使用者用中文描述也一樣；name 是整份餐點的簡短名稱。items 是步驟 2 的組成明細。'
      : '欄位說明：name 和 items[].name 用繁體中文；name 是整份餐點的簡短名稱。items 是步驟 2 的組成明細。')
      + '全部數值都是「這一份」的總量（不是每 100g）：calories 整數 kcal；protein/carbs/fat/fiber/sugar/saturatedFat 公克；'
      + 'sodium/potassium/calcium/cholesterol/iron/vitaminC 毫克；vitaminA 微克 RAE。不確定的微量營養素用常見營養資料庫數值估，不要給 0。'
      + 'confidence 0~1，抓不準時給低一點。如果照片明顯不是食物，name 回傳空字串、items 回傳空陣列。',
  ].filter(Boolean).join('\n');
}

async function callModel(model, body, signal) {
  const res = await fetch(`${GEMINI_BASE}/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-goog-api-key': process.env.GEMINI_API_KEY },
    body: JSON.stringify(body),
    signal,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new Error(`Gemini ${model} HTTP ${res.status}: ${json.error?.message ?? ''}`);
    e.status = res.status;
    throw e;
  }
  const text = json.candidates?.[0]?.content?.parts?.find(p => typeof p.text === 'string')?.text;
  if (!text) throw new Error(`Gemini ${model} 沒有回傳內容（finishReason=${json.candidates?.[0]?.finishReason}）`);
  return JSON.parse(text);
}

// 對沖請求：先打 models[0]，HEDGE_MS 還沒回來就加打下一個；任何一個報錯就立刻補打下一個。
// 第一個成功的結果勝出，其他還在跑的請求全部 abort。超過 DEADLINE_MS 直接放棄。
// 模型清單用完但時間還夠（例如兩個都 503），就從頭再輪一次，最多 2 輪。
function generateWithDeadline(buildBody, { models = FOOD_MODELS, deadlineMs = DEADLINE_MS, hedgeMs = HEDGE_MS } = {}) {
  return new Promise((resolve, reject) => {
    const controllers = [];
    const maxAttempts = models.length * 2;
    let attempts = 0, inFlight = 0, settled = false, lastError = null;
    const startedAt = Date.now();

    const finish = (err, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadlineTimer);
      clearTimeout(hedgeTimer);
      controllers.forEach(c => c.abort());
      err ? reject(err) : resolve(value);
    };

    const launch = () => {
      if (settled || attempts >= maxAttempts) return false;
      const model = models[attempts++ % models.length];
      const ac = new AbortController();
      controllers.push(ac);
      inFlight++;
      callModel(model, buildBody(model), ac.signal)
        .then(data => finish(null, { data, model, ms: Date.now() - startedAt }))
        .catch(err => {
          inFlight--;
          if (settled) return;
          lastError = err;
          console.warn('[food AI]', err.message);
          if (!launch() && inFlight === 0) finish(err);
        });
      return true;
    };

    const deadlineTimer = setTimeout(() => {
      const e = new Error(`AI 辨識超過 ${deadlineMs}ms${lastError ? `（最後錯誤：${lastError.message}）` : ''}`);
      e.status = 504;
      finish(e);
    }, deadlineMs);
    const hedgeTimer = setTimeout(launch, hedgeMs);
    launch();
  });
}

const num = (v, digits = 1) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 10 ** digits) / 10 ** digits : 0;
};

// images 是 [{ buffer, mimeType }, ...]（已經過 preprocessImage），可以是空陣列（純文字輸入）
async function recognizeFood(images, description, options = {}) {
  const prompt = buildPrompt(images.length, description, options.lang);
  const parts = [
    ...images.map(img => ({ inline_data: { mime_type: img.mimeType || 'image/jpeg', data: img.buffer.toString('base64') } })),
    { text: prompt },
  ];
  const buildBody = model => ({
    contents: [{ parts }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: RESPONSE_SCHEMA,
      temperature: 0.2, // 同一張照片每次估出來的數字不要飄太多
      ...(thinkingConfigFor(model) && { thinkingConfig: thinkingConfigFor(model) }),
    },
  });

  const { data: parsed, model, ms } = await generateWithDeadline(buildBody, options);
  if (!parsed.name?.trim()) return null; // 辨識不到食物

  const items = (Array.isArray(parsed.items) ? parsed.items : [])
    .filter(it => it?.name?.trim())
    .map(it => ({ name: it.name.trim(), grams: Math.round(num(it.grams, 0)), calories: Math.round(num(it.calories, 0)) }));

  // 模型偶爾會讓總熱量跟明細加總對不起來，差超過 10% 時以明細加總為準（明細是逐項估的，比較可信）
  let calories = Math.round(num(parsed.calories, 0));
  const itemSum = items.reduce((s, it) => s + it.calories, 0);
  if (itemSum > 0 && Math.abs(itemSum - calories) / Math.max(itemSum, 1) > 0.1) calories = itemSum;

  const gramsFromItems = items.reduce((s, it) => s + it.grams, 0);

  return {
    name: parsed.name.trim(),
    grams: Math.round(num(parsed.estimatedGrams, 0)) || gramsFromItems || 100,
    energy: calories,
    protein: num(parsed.protein),
    carbs: num(parsed.carbs),
    fat: num(parsed.fat),
    fiber: num(parsed.fiber),
    sugar: num(parsed.sugar),
    saturatedFat: num(parsed.saturatedFat),
    sodium: Math.round(num(parsed.sodium, 0)),
    potassium: Math.round(num(parsed.potassium, 0)),
    calcium: Math.round(num(parsed.calcium, 0)),
    cholesterol: Math.round(num(parsed.cholesterol, 0)),
    iron: num(parsed.iron),
    vitaminC: num(parsed.vitaminC),
    vitaminA: Math.round(num(parsed.vitaminA, 0)),
    confidence: Math.min(1, Math.max(0, Number(parsed.confidence) || 0.5)),
    items,
    model,
    aiMs: ms,
  };
}

module.exports = { recognizeFood, preprocessImage, buildPrompt, FOOD_MODELS, DEADLINE_MS, HEDGE_MS };
