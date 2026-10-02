const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Admin = require('../models/Admin');
const User = require('../models/User');
const DailyLog = require('../models/DailyLog');

const USER_FIELDS = ['name', 'email', 'status', 'gender', 'age', 'height', 'weight', 'activity', 'goal', 'bmr', 'tdee', 'target'];

// 白名單過濾，跟 App 端的 publicProfile() 同一個原則：passwordHash 永遠不可以吐給前端
function publicUser(user) {
  // createdAt 只讀、不在 USER_FIELDS 裡（USER_FIELDS 也用來決定哪些欄位可以被編輯），後台列表排序用
  const out = { _id: user._id, userId: user.userId, createdAt: user.createdAt };
  for (const f of USER_FIELDS) if (user[f] != null) out[f] = user[f];
  return out;
}

async function login(req, res) {
  try {
    const { username, password } = req.body;
    const admin = await Admin.findOne({ username: (username ?? '').trim() });
    if (!admin?.passwordHash || !(await bcrypt.compare(password ?? '', admin.passwordHash))) {
      return res.status(401).json({ success: false, error: 'Wrong username or password' });
    }
    const token = jwt.sign({ aid: admin._id.toString(), role: 'admin' }, process.env.JWT_SECRET, { expiresIn: '8h' });
    res.json({ success: true, token, username: admin.username });
  } catch (err) {
    console.error('[admin login]', err.message);
    res.status(500).json({ success: false, error: 'Login failed' });
  }
}

// 依關鍵字比對 name/email/userId，跟 App 端 /foods/search 用同一套 regex 寫法
async function listUsers(req, res) {
  const q = (req.query.q ?? '').trim();
  const filter = {};
  if (q) {
    const regex = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ name: regex }, { email: regex }, { userId: regex }];
  }

  const users = await User.find(filter).sort({ createdAt: -1 }).lean();
  res.json({ success: true, data: users.map(publicUser) });
}

async function getUser(req, res) {
  const user = await User.findById(req.params.id).lean();
  if (!user) return res.status(404).json({ success: false, error: 'User not found' });
  res.json({ success: true, data: publicUser(user) });
}

// 該使用者的所有飲食日誌，依日期新到舊排序，後台「查看紀錄」頁用
async function getUserLogs(req, res) {
  const user = await User.findById(req.params.id).lean();
  if (!user) return res.status(404).json({ success: false, error: 'User not found' });

  const logs = await DailyLog.find({ userId: user._id }).sort({ date: -1 }).lean();
  res.json({ success: true, data: { user: publicUser(user), logs } });
}

// 後台目前的新增表單沒有收密碼欄位，所以先產生一組隨機臨時密碼、雜湊後存起來，
// 一次性回傳給管理員自行轉交給使用者（沒有寄信系統，先用這個做法頂著）
async function addUser(req, res) {
  try {
    const { name, email, status } = req.body;
    const trimmedEmail = (email ?? '').trim().toLowerCase();
    if (!trimmedEmail) return res.status(400).json({ success: false, error: 'Email is required' });
    if (await User.findOne({ email: trimmedEmail })) {
      return res.status(409).json({ success: false, error: 'Email already registered' });
    }

    const count = await User.countDocuments();
    const tempPassword = crypto.randomBytes(6).toString('base64url');
    const user = await User.create({
      userId: 'u' + (1001 + count),
      email: trimmedEmail,
      name,
      status: status || 'Active',
      passwordHash: await bcrypt.hash(tempPassword, 10),
    });

    res.status(201).json({ success: true, data: publicUser(user), tempPassword });
  } catch (err) {
    console.error('[admin addUser]', err.message);
    res.status(500).json({ success: false, error: 'Failed to add user' });
  }
}

async function updateUser(req, res) {
  try {
    const patch = {};
    for (const f of USER_FIELDS) if (req.body[f] !== undefined) patch[f] = req.body[f];
    const user = await User.findByIdAndUpdate(req.params.id, patch, { new: true });
    if (!user) return res.status(404).json({ success: false, error: 'User not found' });
    res.json({ success: true, data: publicUser(user) });
  } catch (err) {
    console.error('[admin updateUser]', err.message);
    res.status(500).json({ success: false, error: 'Failed to update user' });
  }
}

async function deleteUser(req, res) {
  const user = await User.findByIdAndDelete(req.params.id);
  if (!user) return res.status(404).json({ success: false, error: 'User not found' });
  res.json({ success: true, message: 'User deleted' });
}

async function getMe(req, res) {
  const admin = await Admin.findById(req.adminId).lean();
  if (!admin) return res.status(404).json({ success: false, error: 'Admin not found' });
  res.json({ success: true, data: { username: admin.username } });
}

// 改密碼一定要先驗證目前密碼，不能因為已經帶著有效 token 就直接放行改密碼——
// 避免使用者離開電腦沒登出時，旁人直接把密碼換掉鎖死本人
async function changePassword(req, res) {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ success: false, error: 'New password must be at least 6 characters' });
    }

    const admin = await Admin.findById(req.adminId);
    if (!admin?.passwordHash || !(await bcrypt.compare(currentPassword ?? '', admin.passwordHash))) {
      // 故意用 400 不是 401：401 在 adminFetch() 裡會被當成 token 失效直接踢回登入頁，
      // 這裡是密碼答錯（業務邏輯錯誤），要讓表單顯示錯誤訊息、不能把使用者登出
      return res.status(400).json({ success: false, error: 'Current password is incorrect' });
    }

    admin.passwordHash = await bcrypt.hash(newPassword, 10);
    await admin.save();
    res.json({ success: true, message: 'Password updated' });
  } catch (err) {
    console.error('[admin changePassword]', err.message);
    res.status(500).json({ success: false, error: 'Failed to update password' });
  }
}

module.exports = { login, listUsers, getUser, getUserLogs, addUser, updateUser, deleteUser, getMe, changePassword };
