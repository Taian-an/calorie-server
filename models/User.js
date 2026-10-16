const mongoose = require('mongoose');

// users collection 與後台管理系統共用，後台的使用者管理頁會直接看到 App 註冊的帳號。
// Account 只以 email 識別；顯示名稱和頭像只存在 App 本機，不進資料庫
module.exports = mongoose.model('User', new mongoose.Schema({
  userId:       { type: String, unique: true, sparse: true }, // 後台顯示用編號 u1001 起，由 services/userIds.js 發號
  email:        { type: String, unique: true, sparse: true },
  googleId:     { type: String, unique: true, sparse: true },
  passwordHash: String,
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
  birthday:     String, // YYYY-MM-DD，有填的話 age 由生日算出
  targetWeight: Number, // 目標體重（kg），App 依目前體重比較決定 goal
  goalDate:     String, // Goal plan 的目標日期（YYYY-MM-DD），通過 services/goalPlan.js 的驗證才會存
  goalMonths:   Number, // 舊版的目標時程（月），App 下次開啟時換成 goalDate；新資料不再寫入
  // Adaptive adjustment（見 GLOSSARY）：依 7 日平均體重趨勢對目標熱量做的累計微調（kcal）
  targetAdjustment: Number,
  targetAdjustedAt: String, // 最近一次調整的 Day（YYYY-MM-DD）
  lastAdjustment:   Number, // 最近一次調整了多少 kcal
  // Account 的時區（GLOSSARY「Time zone」）：決定一天從哪裡開始，24 小時內只能換一次
  timezone:          String,
  timezoneChangedAt: Date,
  // 付費會員：免費版每天辨識 / 教練各 5 次，付費版不限（仍有防濫用上限，見 services/usageLimits.js）。
  // 目前由後台手動開關（demo 帳號、送朋友試用）；之後接 RevenueCat 時，訂閱狀態也寫到這裡
  premium:      { type: Boolean, default: false },
}, { timestamps: true }));
