const mongoose = require('mongoose');
const Analysis = require('../models/Analysis');
const User = require('../models/User');

const escapeRegex = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// GET /admin/analyses — AI 辨識紀錄（後台「AI Analyses」頁）。
// 照片不會存（只活在佇列裡，辨識完就刪），所以這裡只有辨識結果；未登入時代的舊紀錄沒有 userId，顯示為匿名。
// 查詢參數：q（食物名稱，或含 @ 時當作使用者 Email）、status（done / failed / pending）、page、limit
async function listAnalyses(req, res) {
  const q = String(req.query.q ?? '').trim();
  const status = ['done', 'failed', 'pending'].includes(req.query.status) ? req.query.status : null;
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));

  const filter = {};
  if (status) filter.status = status;
  if (q) {
    const regex = new RegExp(escapeRegex(q), 'i');
    const users = await User.find({ $or: [{ email: regex }, { userId: regex }, { name: regex }] }).select('_id').limit(200).lean();
    filter.$or = [{ 'result.name': regex }, { userId: { $in: users.map(u => u._id) } }];
  }

  const [items, total] = await Promise.all([
    Analysis.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    Analysis.countDocuments(filter),
  ]);

  // 一次查回這頁用到的使用者，避免每筆各查一次
  const userIds = [...new Set(items.map(a => a.userId).filter(Boolean).map(String))];
  const users = await User.find({ _id: { $in: userIds.map(id => new mongoose.Types.ObjectId(id)) } })
    .select('userId email name premium').lean();
  const byId = Object.fromEntries(users.map(u => [String(u._id), u]));

  res.json({
    success: true,
    page, limit, total,
    data: items.map(a => {
      const u = a.userId ? byId[String(a.userId)] : null;
      return {
        _id: a._id,
        createdAt: a.createdAt,
        status: a.status,
        error: a.error,
        user: u ? { _id: u._id, userId: u.userId, email: u.email, name: u.name, premium: !!u.premium } : null,
        userDeleted: !!a.userId && !u, // 有 userId 但找不到使用者 = 帳號已刪除
        result: a.result ?? null,
      };
    }),
  });
}

// GET /admin/analyses/stats — 頁面上方的統計：今天的辨識次數、近 7 天成功率與平均 AI 耗時、哪個模型在回應
async function getAnalysisStats(req, res) {
  const now = Date.now();
  const since7d = new Date(now - 7 * 86400000);
  const since24h = new Date(now - 86400000);

  const [last24h, byStatus, perf, byModel] = await Promise.all([
    Analysis.countDocuments({ createdAt: { $gte: since24h } }),
    Analysis.aggregate([{ $match: { createdAt: { $gte: since7d } } }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
    Analysis.aggregate([
      { $match: { createdAt: { $gte: since7d }, status: 'done', 'result.aiMs': { $gt: 0 } } },
      { $group: { _id: null, avgMs: { $avg: '$result.aiMs' }, maxMs: { $max: '$result.aiMs' } } },
    ]),
    Analysis.aggregate([
      { $match: { createdAt: { $gte: since7d }, status: 'done', 'result.model': { $exists: true } } },
      { $group: { _id: '$result.model', n: { $sum: 1 } } }, { $sort: { n: -1 } },
    ]),
  ]);

  const counts = Object.fromEntries(byStatus.map(s => [s._id, s.n]));
  const finished = (counts.done ?? 0) + (counts.failed ?? 0);
  res.json({
    success: true,
    data: {
      last24h,
      last7d: { done: counts.done ?? 0, failed: counts.failed ?? 0, successRate: finished ? (counts.done ?? 0) / finished : null },
      avgMs: perf[0] ? Math.round(perf[0].avgMs) : null,
      maxMs: perf[0]?.maxMs ?? null,
      models: byModel.map(m => ({ model: m._id, count: m.n })),
    },
  });
}

module.exports = { listAnalyses, getAnalysisStats };
