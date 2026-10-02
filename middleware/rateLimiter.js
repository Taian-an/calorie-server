const rateLimit = require('express-rate-limit');

// 15 分鐘內同一個 IP 最多 10 次嘗試，超過就先擋著，避免密碼被暴力破解或帳號被灌爆。
// login/register 各自獨立一份 instance——express-rate-limit 預設只用 IP 當 key，
// 如果兩個路由共用同一個 instance，計數會混在一起，一直打錯密碼登入會連帶把註冊也鎖住
function makeLimiter(message) {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message,
  });
}

// App 端錯誤格式是 { error }，後台是 { success:false, error }，兩邊各自維持原本的慣例
const loginLimiter = makeLimiter({ error: 'Too many attempts, please try again later.' });
const registerLimiter = makeLimiter({ error: 'Too many attempts, please try again later.' });
const adminLoginLimiter = makeLimiter({ success: false, error: 'Too many attempts, please try again later.' });

module.exports = { loginLimiter, registerLimiter, adminLoginLimiter };
