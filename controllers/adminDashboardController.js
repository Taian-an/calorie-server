const User = require('../models/User');
const Analysis = require('../models/Analysis');
const Feedback = require('../models/Feedback');

// 不主動打 Gemini 測試（會白白多耗一次額度），改看最近幾筆真實的辨識紀錄推斷現在額度是不是有問題——
// 最近 5 筆裡至少 2 筆是額度相關的失敗（429 / RESOURCE_EXHAUSTED / quota），就當作額度異常，
// 單一一筆失敗可能只是暫時壅塞，不代表真的沒額度了
async function getGeminiStatus() {
  const recent = await Analysis.find({ status: { $in: ['done', 'failed'] } })
    .sort({ createdAt: -1 })
    .limit(5)
    .select('status error')
    .lean();

  // code 給後台前端依語言翻譯（js/dashboard.js），label 留著相容
  if (!recent.length) return { ok: true, code: 'noData', label: '尚無資料' };

  const quotaFailures = recent.filter(
    a => a.status === 'failed' && /429|RESOURCE_EXHAUSTED|quota/i.test(a.error ?? '')
  );
  if (quotaFailures.length >= 2) return { ok: false, code: 'quota', label: '額度異常' };
  return { ok: true, code: 'ok', label: '正常' };
}

async function getStats(req, res) {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const [totalUsers, todayUploads, totalFeedback, recentUsers, geminiStatus] = await Promise.all([
    User.countDocuments(),
    Analysis.countDocuments({ createdAt: { $gte: startOfToday }, status: 'done' }),
    Feedback.countDocuments(),
    User.find().sort({ createdAt: -1 }).limit(5).select('userId email premium').lean(),
    getGeminiStatus(),
  ]);

  res.json({
    success: true,
    data: { totalUsers, todayUploads, totalFeedback, recentUsers, geminiStatus },
  });
}

module.exports = { getStats };
