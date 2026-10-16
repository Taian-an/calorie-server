const mongoose = require('mongoose');

// 遞增序號（目前只有 'userId'）。用 $inc 原子地拿下一號，刪掉使用者也不會倒退，所以號碼不會重複發。
module.exports = mongoose.model('Counter', new mongoose.Schema({
  _id: String,
  seq: { type: Number, default: 0 },
}, { versionKey: false }));
