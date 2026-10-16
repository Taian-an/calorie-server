// 後台顯示用的使用者編號 u1001、u1002…
// 以前是 'u' + (1001 + 使用者總數)：刪過使用者後總數變小，下一個新帳號就拿到已經存在的編號。
// 現在改用 counters collection 的原子 $inc，序號只增不減；User.userId 另有 unique index 擋重複。
const COUNTER_ID = 'userId';
const FIRST = 1001;

const formatUserId = n => 'u' + n;

// 'u1021' → 1021；不是這個格式的回 null
function parseUserId(userId) {
  const m = /^u(\d+)$/.exec(userId ?? '');
  return m ? Number(m[1]) : null;
}

// 目前 users 裡最大的編號數字（沒有就回 FIRST - 1）。用數字比，不用字串排序（字串排序 'u999' > 'u1000'）
async function maxExistingUserIdNumber(users) {
  const [row] = await users.aggregate([
    { $match: { userId: { $regex: /^u\d+$/ } } },
    { $group: { _id: null, max: { $max: { $toLong: { $substrCP: ['$userId', 1, 30] } } } } },
  ]).toArray();
  return Math.max(Number(row?.max ?? 0), FIRST - 1);
}

// 讓計數器至少跟現有最大編號一樣大。可重複呼叫；server 啟動時跑一次，計數器不存在時 nextUserId 也會補跑
async function syncUserIdCounter(counters, users) {
  const max = await maxExistingUserIdNumber(users);
  try {
    await counters.updateOne({ _id: COUNTER_ID }, { $max: { seq: max } }, { upsert: true });
  } catch (err) {
    // 兩個請求同時 upsert 時其中一個會撞 _id 重複，這時文件已經存在，再跑一次 $max 就好
    if (err?.code !== 11000) throw err;
    await counters.updateOne({ _id: COUNTER_ID }, { $max: { seq: max } });
  }
}

// 拿下一個編號。counters / users 是原生 MongoDB collection（mongoose.connection.db.collection(...) 或 Model.collection）
async function nextUserId(counters, users) {
  const inc = () => counters.findOneAndUpdate({ _id: COUNTER_ID }, { $inc: { seq: 1 } }, { returnDocument: 'after' });
  let doc = await inc();
  if (!doc) {
    await syncUserIdCounter(counters, users);
    doc = await inc();
  }
  return formatUserId(doc.seq);
}

module.exports = { nextUserId, syncUserIdCounter, maxExistingUserIdNumber, parseUserId, formatUserId, COUNTER_ID, FIRST };
