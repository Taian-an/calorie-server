const mongoose = require('mongoose');

// 後台管理員帳號，密碼一律 bcrypt 雜湊儲存（沿用 SP1 後台的 Admin collection，改掉明碼密碼的做法）
module.exports = mongoose.model('Admin', new mongoose.Schema({
  username:     { type: String, required: true, unique: true },
  passwordHash: String,
}, { timestamps: true }));
