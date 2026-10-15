const Analysis = require('../models/Analysis');
const UsageCounter = require('../models/UsageCounter');
const User = require('../models/User');

/* ===== AI 功能的每日額度 =====
   免費版：辨識、教練各 5 次 / 天；付費版不限，但仍有每天 50 次的防濫用上限——
   AI 每次呼叫都要付 Gemini 費用，任何帳號都不能無限制打（2026-10 定案）。
   「一天」以 Account 上存的時區為準（見 GLOSSARY「Time zone」、ADR 0002），在當地午夜重置。
   App 每個請求都帶 X-Timezone，但 24 小時內只接受一次變更——否則換個時區就能把額度歸零。
   辨識只算成功和進行中的，失敗（照片裡沒食物、逾時、伺服器錯）不扣額度。 */
const LIMITS = {
  free:    { analyze: 5,  coach: 5 },
  premium: { analyze: 50, coach: 50 },
};

const TIMEZONE_CHANGE_INTERVAL_MS = 24 * 60 * 60 * 1000;

// App 回報的時區；沒帶或無效時回傳 null
function requestedTimezone(req) {
  const tz = String(req.headers['x-timezone'] || '').trim();
  if (!tz) return null;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    return null;
  }
}

// 這個 Account 現在要用的時區。第一次直接記下；之後要換，距離上次換過 24 小時才接受。
// 用條件式 updateOne，同時進來的多個請求只會有一個換成功。
async function accountTimezone(user, req) {
  const requested = requestedTimezone(req);
  if (!user.timezone) {
    const tz = requested || 'UTC';
    await User.updateOne({ _id: user._id, timezone: { $exists: false } }, { $set: { timezone: tz } });
    return (await User.findById(user._id, 'timezone').lean())?.timezone ?? tz;
  }
  if (!requested || requested === user.timezone) return user.timezone;

  const now = new Date();
  const { modifiedCount } = await User.updateOne(
    {
      _id: user._id,
      timezone: user.timezone,
      $or: [
        { timezoneChangedAt: { $exists: false } },
        { timezoneChangedAt: { $lte: new Date(now.getTime() - TIMEZONE_CHANGE_INTERVAL_MS) } },
      ],
    },
    { $set: { timezone: requested, timezoneChangedAt: now } }
  );
  return modifiedCount ? requested : user.timezone;
}

// 某個時刻在時區 tz 的牆上時間，當成 UTC 解讀後跟實際時刻的差 = 該時區當下的 UTC 偏移（毫秒）
function offsetMs(tz, at) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(at).map(p => [p.type, p.value])
  );
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

// 今天在 tz 的日期，以及今天、明天的當地午夜對應的 UTC 時刻
function localDay(tz, now = new Date()) {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(now); // YYYY-MM-DD
  const start = new Date(Date.parse(`${day}T00:00:00Z`) - offsetMs(tz, now));
  const next = new Date(Date.parse(`${day}T00:00:00Z`) + 86400000);
  const resetAt = new Date(next.getTime() - offsetMs(tz, next));
  return { day, start, resetAt };
}

async function usedToday(user, kind, tz) {
  const { day, start } = localDay(tz);
  if (kind === 'analyze') {
    return Analysis.countDocuments({ userId: user._id, status: { $in: ['pending', 'done'] }, createdAt: { $gte: start } });
  }
  const counter = await UsageCounter.findOne({ userId: user._id, day, kind }).lean();
  return counter?.count ?? 0;
}

// 回傳這次能不能用、已用幾次、上限多少；超過時 route 回 429 + 這份資料，App 用來顯示「今天的免費次數用完了」
async function checkQuota(user, kind, tz) {
  const plan = user.premium ? 'premium' : 'free';
  const limit = LIMITS[plan][kind];
  const used = await usedToday(user, kind, tz);
  const { resetAt } = localDay(tz);
  return { allowed: used < limit, kind, plan, used, limit, resetAt: resetAt.toISOString() };
}

// 教練回覆成功後才記一次（失敗不扣，跟辨識一致）
async function recordUse(user, kind, tz) {
  const { day } = localDay(tz);
  await UsageCounter.updateOne({ userId: user._id, day, kind }, { $inc: { count: 1 } }, { upsert: true });
}

module.exports = { LIMITS, accountTimezone, localDay, checkQuota, recordUse };
