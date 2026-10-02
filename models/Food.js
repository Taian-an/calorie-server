const mongoose = require('mongoose');

// 食物資料庫：thai-foods 遷移進來 + USDA 查詢結果快取 + 後台手動新增
module.exports = mongoose.model('Food', new mongoose.Schema({
  name:    { type: String, required: true },
  aliases: [String], // 全小寫
  energy:  Number, protein: Number, carbs: Number, fat: Number,
  source:  { type: String, enum: ['thai', 'usda', 'admin'], default: 'admin' },
}, { timestamps: true }));
