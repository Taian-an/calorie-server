// 後台中英文切換。所有頁面最先載入這支（在 adminAuth.js 之前）。
//
// 做法：頁面上的文字一律用英文寫（英文就是翻譯的 key），選中文時把對得上字典的文字換掉——
//   - HTML 裡寫死的文字、placeholder、<title>：載入時由 applyI18n() 自動替換，HTML 不用加任何屬性
//   - JS 動態產生的文字（表格、alert、confirm）：用 t('English text', { 變數 }) 取得目前語言的字串
// 使用者的資料本身（名字、食物名稱、意見內容）是使用者輸入的，原樣顯示、不翻譯。
// 語言存在 localStorage，預設英文（跟 App 一致）；切換後重新整理頁面，動態內容才會一起換掉。

const ADMIN_LANG_KEY = 'calorie_admin_lang';

const ZH = {
  // 共用：側邊欄、按鈕、欄位
  'Dashboard': '儀表板',
  'Users': '使用者',
  'Feedback': '意見回饋',
  'Settings': '設定',
  'Logout': '登出',
  'ID': 'ID',
  'Name': '名字',
  'Email': 'Email',
  'Status': '狀態',
  'Action': '操作',
  'Active': '啟用',
  'Inactive': '停用',
  'Edit': '編輯',
  'Delete': '刪除',
  'Records': '紀錄',
  'Cancel': '取消',
  'Search': '搜尋',
  'Language': '語言',

  // 登入頁
  'Admin Login': '後台登入',
  'Admin': '管理後台',
  'Login': '登入',
  'Username': '帳號',
  'Password': '密碼',
  'Login failed': '登入失敗',

  // 儀表板
  'Welcome, Admin': '歡迎，管理員',
  'Total Users': '使用者總數',
  "Today's Upload": '今日辨識',
  'Gemini API': 'Gemini API',
  'Recent Users': '最新註冊',
  'No users yet': '還沒有使用者',
  'OK': '正常',
  'No data yet': '尚無資料',
  'Quota problem': '額度異常',

  // 使用者列表
  'User Management': '使用者管理',
  'All Users': '所有使用者',
  '+ Add User': '+ 新增使用者',
  'Search user...': '搜尋使用者…',
  'Joined': '註冊日期',
  'Delete user "{name}"? This cannot be undone.': '確定刪除使用者「{name}」？刪除後無法復原。',
  'Failed to delete user': '刪除使用者失敗',

  // 新增 / 編輯使用者
  'Add User': '新增使用者',
  'Add New User': '新增使用者',
  'Edit User': '編輯使用者',
  'Update User': '更新使用者',
  'Enter name': '輸入名字',
  'Enter email': '輸入 Email',
  'User not found': '找不到這位使用者',
  'Failed to update user': '更新使用者失敗',
  'User updated successfully!': '使用者已更新！',
  'Failed to add user': '新增使用者失敗',
  'User added. Temporary password: {password}\n\nGive this password to the user separately — it won\'t be shown again after you close this.':
    '已新增使用者。臨時密碼：{password}\n\n請把這組密碼另外轉交給使用者，關掉後就看不到了。',

  // 飲食紀錄
  'User Records': '飲食紀錄',
  '← Back to Users': '← 回到使用者列表',
  "{name}'s Food Log": '{name} 的飲食紀錄',
  'Total {kcal} kcal': '共 {kcal} kcal',
  'Weight {kg}kg': '體重 {kg}kg',
  'Meal': '餐別',
  'Food': '食物',
  'Calories (kcal)': '熱量(kcal)',
  'Protein (g)': '蛋白質(g)',
  'Carbs (g)': '碳水(g)',
  'Fat (g)': '脂肪(g)',
  'Breakfast': '早餐',
  'Lunch': '午餐',
  'Dinner': '晚餐',
  'Snacks': '點心',
  'No meals logged this day': '當天沒有記錄餐點',
  "This user hasn't logged any meals yet": '這位使用者還沒有任何飲食紀錄',
  'Missing user ID': '缺少使用者 ID',
  'Failed to load': '讀取失敗',

  // 意見回饋
  'User Feedback': '使用者意見回饋',
  'All': '全部',
  'New': '新的',
  'Reviewed': '已處理',
  'new': '新的',
  'reviewed': '已處理',
  'Date': '日期',
  'Message': '內容',
  '← Prev': '← 上一頁',
  'Next →': '下一頁 →',
  'Mark Reviewed': '標記已處理',
  'Mark New': '標記為新的',
  'Page {page} / {pages} ({total} feedback)': '第 {page} / {pages} 頁（共 {total} 則）',
  'Delete this feedback? This cannot be undone.': '確定刪除這則意見？刪除後無法復原。',
  'Failed to update feedback': '更新意見失敗',
  'Failed to delete feedback': '刪除意見失敗',

  // 設定
  'Change Password': '修改密碼',
  'Current Password': '目前密碼',
  'New Password': '新密碼',
  'Confirm New Password': '確認新密碼',
  'Update Password': '更新密碼',
  'At least 6 characters': '至少 6 個字元',
  'Logged in as: {username}': '目前登入：{username}',
  'New password and confirmation do not match': '新密碼和確認密碼不一致',
  'Password updated successfully.': '密碼已更新。',
  'Failed to update password': '更新密碼失敗',

  // 後端 API 回傳的錯誤（result.error），畫面上用 t(result.error) 顯示
  'Admin not found': '找不到管理員帳號',
  'Current password is incorrect': '目前密碼不正確',
  'Email already registered': '這個 Email 已經註冊過了',
  'Email is required': '請輸入 Email',
  'Feedback not found': '找不到這則意見',
  'Invalid status': '狀態不正確',
  'New password must be at least 6 characters': '新密碼至少要 6 個字元',
  'Unauthorized': '未登入或登入已過期',
  'Wrong username or password': '帳號或密碼錯誤',
};

function adminLang() {
  try {
    return localStorage.getItem(ADMIN_LANG_KEY) === 'zh' ? 'zh' : 'en';
  } catch {
    return 'en';
  }
}

// t('Hello {name}', { name: 'Suki' })：目前語言的字串，{變數} 換成實際值；字典沒有的就原樣回傳英文
function t(text, vars = {}) {
  const template = adminLang() === 'zh' ? (ZH[text] ?? text) : text;
  return template.replace(/\{(\w+)\}/g, (_, key) => (vars[key] ?? `{${key}}`));
}

// 日期時間跟著語言格式化（中文：2026/9/25 下午1:43；英文：9/25/2026, 1:43 PM）
function formatLocaleDateTime(value) {
  return new Date(value).toLocaleString(adminLang() === 'zh' ? 'zh-TW' : 'en-US');
}

function setAdminLang(lang) {
  try { localStorage.setItem(ADMIN_LANG_KEY, lang); } catch { /* 私密模式存不了就算了，這次仍會切換 */ }
  location.reload();
}

// 把頁面上寫死的英文（文字節點、placeholder、title）換成目前語言
function applyI18n() {
  document.documentElement.lang = adminLang() === 'zh' ? 'zh-Hant' : 'en';
  if (adminLang() !== 'zh') return;

  document.title = t(document.title.trim());

  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const tag = node.parentElement?.tagName;
      if (tag === 'SCRIPT' || tag === 'STYLE') return NodeFilter.FILTER_REJECT;
      return ZH[node.nodeValue.trim()] ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
    },
  });
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  nodes.forEach(node => {
    const original = node.nodeValue;
    node.nodeValue = original.replace(original.trim(), ZH[original.trim()]);
  });

  document.querySelectorAll('[placeholder]').forEach(el => {
    el.placeholder = t(el.placeholder);
  });
}

// 語言切換按鈕：有側邊欄的頁面放在選單最下面，登入頁放右上角
function mountLanguageSwitch() {
  const lang = adminLang();
  const wrap = document.createElement('div');
  wrap.className = 'lang-switch';
  wrap.innerHTML = `
    <span class="lang-switch-label">${t('Language')}</span>
    <button type="button" data-lang="zh" class="${lang === 'zh' ? 'active' : ''}">中文</button>
    <button type="button" data-lang="en" class="${lang === 'en' ? 'active' : ''}">English</button>
  `;
  wrap.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', () => { if (btn.dataset.lang !== adminLang()) setAdminLang(btn.dataset.lang); });
  });

  const style = document.createElement('style');
  style.textContent = `
    .lang-switch { display:flex; flex-wrap:wrap; align-items:center; gap:6px; margin-top:24px; font-size:13px; }
    .lang-switch-label { flex-basis:100%; }
    .lang-switch-label { opacity:.75; margin-right:2px; }
    .lang-switch button { border:1px solid #C8E6C9; background:#fff; color:#2E7D32; border-radius:14px;
      padding:4px 10px; cursor:pointer; font-size:12px; white-space:nowrap; flex:0 0 auto;
      width:auto; margin:0; height:auto; line-height:1.4; }
    .lang-switch-label { white-space:nowrap; }
    .lang-switch button.active { background:#2E7D32; color:#fff; border-color:#2E7D32; }
    .lang-switch.floating .lang-switch-label { flex-basis:auto; }
    .lang-switch.floating { position:fixed; top:16px; right:16px; margin:0; background:#fff; flex-wrap:nowrap;
      padding:6px 10px; border-radius:18px; box-shadow:0 2px 8px rgba(0,0,0,.08); }
  `;
  document.head.appendChild(style);

  const sidebar = document.querySelector('.sidebar');
  if (sidebar) {
    sidebar.appendChild(wrap);
  } else {
    wrap.classList.add('floating');
    document.body.appendChild(wrap);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  applyI18n();
  mountLanguageSwitch();
});
