const mongoose = require('mongoose');

// Entry 的照片：AI 辨識時把第一張照片縮成小圖（最長邊 480px）存一份，日誌的 Entry 用 photoId 指到這裡。
// 原圖不留；縮圖只在照片真的被記成 Entry 後才保留：還沒被任何 Entry 用到的會在 expiresAt 自動刪掉
// （辨識完沒存、取消的那些），PUT /logs 存進日誌時清掉 expiresAt，Entry 被刪掉時連照片一起刪
const entryPhotoSchema = new mongoose.Schema({
  _id:         String, // 隨機 32 字元 hex，當作網址的一部分（GET /photos/:id 不用登入，靠不可猜測的 id）
  userId:      { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  data:        Buffer,
  contentType: String,
  expiresAt:   Date,
}, { timestamps: true });
entryPhotoSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('EntryPhoto', entryPhotoSchema);
