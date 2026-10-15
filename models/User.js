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
  gender:       String, // 'male' | 'female' | 'other'（其他 / 不透露）
  age:          Number,
  ageSetAt:     String, // 填寫年齡那天（YYYY-MM-DD），App 每滿一年自動把 age +1
  height:       Number,
  weight:       Number,
  activity:     String,
  goal:         String,
  bmr:          Number,
  tdee:         Number,
  target:       Number,
  // Account 的時區（GLOSSARY「Time zone」）：決定一天從哪裡開始，24 小時內只能換一次
  timezone:          String,
  timezoneChangedAt: Date,
  // 付費會員：免費版每天辨識 / 教練各 5 次，付費版不限（仍有防濫用上限，見 services/usageLimits.js）。
  // 目前由後台手動開關（demo 帳號、送朋友試用）；之後接 RevenueCat 時，訂閱狀態也寫到這裡
  premium:      { type: Boolean, default: false },
}, { timestamps: true }));
