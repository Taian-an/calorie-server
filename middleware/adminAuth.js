const jwt = require('jsonwebtoken');

// 後台專用的驗證，token 裡帶 role:'admin' 跟 App 端使用者的 token 區隔開，
// 就算使用者的 token 外流也拿不到後台權限
function requireAdminAuth(req, res, next) {
  const token = (req.headers.authorization || '').replace(/^Bearer /, '');
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.role !== 'admin') throw new Error('not an admin token');
    req.adminId = decoded.aid;
    next();
  } catch {
    res.status(401).json({ success: false, error: 'Unauthorized' });
  }
}

module.exports = { requireAdminAuth };
