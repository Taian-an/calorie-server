const mongoose = require('mongoose');

const dailyLogSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, required: true },
  date:   { type: String, required: true }, // YYYY-MM-DD
  weight: Number,
  target: Number,
  meals:  [{
    name: String, energy: Number, protein: Number, carbs: Number, fat: Number,
    mealType: String, time: Number, grams: Number,
    // 微量營養素：估算值（g/mg/mcg，見 Analysis model 欄位註解），舊紀錄沒有這些欄位、視為 0
    fiber: Number, sugar: Number,
    sodium: Number, potassium: Number, calcium: Number,
    iron: Number, vitaminC: Number,
    vitaminA: Number,
    photoId:  String, // AI 辨識的照片縮圖（EntryPhoto）
    photoUrl: String, // 外部圖片（條碼商品在 Open Food Facts 的圖）
    servings: Number, // 沒有克數的 Entry 用「幾份」表示份量，預設 1
  }],
}, { timestamps: true });
dailyLogSchema.index({ userId: 1, date: 1 }, { unique: true });

module.exports = mongoose.model('DailyLog', dailyLogSchema);
