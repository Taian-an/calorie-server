const mongoose = require('mongoose');

// App 端意見回饋，匿名也能送出（userId 允許 null），後台用來收集問題/建議
module.exports = mongoose.model('Feedback', new mongoose.Schema({
  message: { type: String, required: true },
  email:   String, // 選填，讓管理員知道要回覆給誰，不做驗證
  userId:  { type: mongoose.Schema.Types.ObjectId, default: null },
  status:  { type: String, enum: ['new', 'reviewed'], default: 'new' },
}, { timestamps: true }));
