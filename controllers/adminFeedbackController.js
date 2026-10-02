const Feedback = require('../models/Feedback');

// 列表支援用 status 篩選（all/new/reviewed）+ 分頁，最新的排前面
async function listFeedback(req, res) {
  const status = req.query.status;
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));

  const filter = {};
  if (status === 'new' || status === 'reviewed') filter.status = status;

  const [items, total] = await Promise.all([
    Feedback.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    Feedback.countDocuments(filter),
  ]);

  res.json({ success: true, data: items, page, limit, total });
}

// 目前只用來切換 new/reviewed，之後如果要做「回覆」功能可以在這裡擴充
async function updateFeedback(req, res) {
  const { status } = req.body;
  if (!['new', 'reviewed'].includes(status)) {
    return res.status(400).json({ success: false, error: 'Invalid status' });
  }
  const feedback = await Feedback.findByIdAndUpdate(req.params.id, { status }, { new: true });
  if (!feedback) return res.status(404).json({ success: false, error: 'Feedback not found' });
  res.json({ success: true, data: feedback });
}

async function deleteFeedback(req, res) {
  const feedback = await Feedback.findByIdAndDelete(req.params.id);
  if (!feedback) return res.status(404).json({ success: false, error: 'Feedback not found' });
  res.json({ success: true, message: 'Feedback deleted' });
}

module.exports = { listFeedback, updateFeedback, deleteFeedback };
