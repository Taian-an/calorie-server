const Analysis = require('../models/Analysis');
const UsageCounter = require('../models/UsageCounter');

/* ===== AI 功能的每日額度 =====
   免費版：辨識、教練各 5 次 / 天；付費版不限，但仍有每天 50 次的防濫用上限——
   AI 每次呼叫都要付 Gemini 費用，任何帳號都不能無限制打（2026-10 定案）。
   「一天」以使用者手機的時區為準（App 每個請求都帶 X-Timezone），在當地午夜重置；沒帶或無效時用 UTC。
   辨識只算成功和進行中的，失敗（照片裡沒食物、逾時、伺服器錯）不扣額度。 */
const LIMITS = {
  free:    { analyze: 5,  coach: 5 },
  premium: { analyze: 50, coach: 50 },
};

function timezoneOf(req) {
  const tz = String(req.headers['x-timezone'] || '').trim();
  if (!tz) return 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    return 'UTC';
  }
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

module.exports = { LIMITS, timezoneOf, localDay, checkQuota, recordUse };
