const User = require('../models/User');
const DailyLog = require('../models/DailyLog');
const Analysis = require('../models/Analysis');
const UsageCounter = require('../models/UsageCounter');
const Feedback = require('../models/Feedback');

// Account deletion（見 GLOSSARY）：帳號和底下所有紀錄一起刪，使用者自己刪或後台刪都一樣。
// 意見回饋的內容保留給後台看，但拿掉 userId 和留的 email，追不回是誰寫的。
// 回傳是否真的有這個帳號。
async function deleteAccount(userId) {
  await Promise.all([
    DailyLog.deleteMany({ userId }),
    Analysis.deleteMany({ userId }),
    UsageCounter.deleteMany({ userId }),
    Feedback.updateMany({ userId }, { $set: { userId: null }, $unset: { email: '' } }),
  ]);
  const { deletedCount } = await User.deleteOne({ _id: userId });
  return deletedCount > 0;
}

module.exports = { deleteAccount };
