// 共用的後台認證小工具：存 token、附加 Authorization header、沒登入就導回登入頁
const ADMIN_TOKEN_KEY = 'calorie_admin_token';

// 名稱、email、留言、食物名稱等都可能來自使用者或 AI，插進 HTML 前一律跳脫
function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function getAdminToken() {
  return localStorage.getItem(ADMIN_TOKEN_KEY);
}

function setAdminToken(token) {
  localStorage.setItem(ADMIN_TOKEN_KEY, token);
}

// 放在每個需要登入才能看的頁面最上面
function requireAdminLogin() {
  if (!getAdminToken()) {
    window.location.href = 'adminLogin.html';
  }
}

function adminLogout() {
  localStorage.removeItem(ADMIN_TOKEN_KEY);
  window.location.href = 'adminLogin.html';
}

// 包一層 fetch，自動帶 token；401 代表 token 過期或沒登入，直接踢回登入頁
async function adminFetch(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      ...(options.headers ?? {}),
      Authorization: `Bearer ${getAdminToken()}`,
    },
  });
  if (res.status === 401) {
    adminLogout();
    throw new Error('Unauthorized');
  }
  return res;
}
