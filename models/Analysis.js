const mongoose = require('mongoose');

// 每次 AI 辨識的歷史（登入者附 userId），供除錯、成本追蹤與之後的個人歷史
module.exports = mongoose.model('Analysis', new mongoose.Schema({
  userId:      { type: mongoose.Schema.Types.ObjectId, default: null },
  status:      { type: String, enum: ['pending', 'done', 'failed'], default: 'pending' },
  error:       String, // status 'failed' 時的錯誤訊息
  photoId:     String, // 第一張照片的縮圖（EntryPhoto），記成 Entry 時會帶著
  candidates:  [String],
  matchedName: String,
  source:      String, // 'db' | 'usda' | 'gemini'
  result:      {
    name: String, energy: Number, protein: Number, carbs: Number, fat: Number, grams: Number, confidence: Number,
    // 微量營養素：估算值，單位見欄位註解，讓進度頁可以算區間平均
    fiber: Number, sugar: Number,                       // g
    sodium: Number, potassium: Number, calcium: Number,  // mg
    iron: Number, vitaminC: Number,                      // mg
    vitaminA: Number,                                    // mcg
    saturatedFat: Number, cholesterol: Number,           // g, mg
    // 餐點拆解明細（白飯 200g/260kcal、滷肉 80g/280kcal…），讓使用者看得到總熱量是怎麼算出來的
    items: [{ _id: false, name: String, grams: Number, calories: Number }],
    model: String, aiMs: Number,                         // 哪個 Gemini 模型回的、花了幾毫秒，追蹤速度用
  },
}, { timestamps: true }));
