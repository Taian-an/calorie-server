const mongoose = require('mongoose');

// users collection 與後台管理系統共用，後台的使用者管理頁會直接看到 App 註冊的帳號
module.exports = mongoose.model('User', new mongoose.Schema({
  userId:       String, // 後台顯示用編號 u1001 起
  email:        { type: String, unique: true, sparse: true },
  username:     { type: String, unique: true, sparse: true },
  googleId:     { type: String, unique: true, sparse: true },
  passwordHash: String,
  name:         String,
  avatarKey:    { type: String, default: 'default' }, // 新帳號一律用標準無頭像圖框，不提供內建卡通頭像可選
  gender:       String,
  age:          Number,
  height:       Number,
  weight:       Number,
  activity:     String,
  goal:         String,
  bmr:          Number,
  tdee:         Number,
  target:       Number,
  status:       { type: String, default: 'Active' },
}, { timestamps: true }));
