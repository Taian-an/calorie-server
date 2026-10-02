const mongoose = require('mongoose');

// 每個使用者每天用了幾次某項 AI 功能（目前只有 'coach'；辨識次數直接數 analyses collection，不用另外記）。
// day 是使用者「當地時區」的日期（YYYY-MM-DD），每日額度在當地午夜重置
const schema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, required: true },
  day:    { type: String, required: true },
  kind:   { type: String, required: true },
  count:  { type: Number, default: 0 },
}, { timestamps: true });
schema.index({ userId: 1, day: 1, kind: 1 }, { unique: true });

module.exports = mongoose.model('UsageCounter', schema);
