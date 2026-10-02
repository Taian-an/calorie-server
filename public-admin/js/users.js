requireAdminLogin();

let currentQuery = '';
let allUsers = [];
// 預設跟後端一樣：最新註冊的在最上面
let sortKey = 'createdAt';
let sortDir = -1; // 1 = 小到大 / A→Z，-1 = 大到小 / Z→A

// ID 是 u1001、u1002…，用 numeric 比較才會 u1002 < u1010（純字串比較會排錯）；
// 空值一律排最後，不管升冪降冪
function compareUsers(a, b) {
    const va = a[sortKey], vb = b[sortKey];
    const emptyA = va == null || va === '', emptyB = vb == null || vb === '';
    if (emptyA || emptyB) return emptyA === emptyB ? 0 : emptyA ? 1 : -1;
    const result = sortKey === 'createdAt'
        ? new Date(va) - new Date(vb)
        : String(va).localeCompare(String(vb), undefined, { numeric: true, sensitivity: 'base' });
    return result * sortDir;
}

function formatDate(value) {
    if (!value) return '';
    const d = new Date(value);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function updateSortArrows() {
    document.querySelectorAll('th.sortable').forEach(th => {
        th.querySelector('.sort-arrow').textContent = th.dataset.sort === sortKey ? (sortDir === 1 ? '▲' : '▼') : '';
    });
}

document.querySelectorAll('th.sortable').forEach(th => {
    th.addEventListener('click', () => {
        const key = th.dataset.sort;
        if (key === sortKey) {
            sortDir = -sortDir;
        } else {
            sortKey = key;
            sortDir = key === 'createdAt' ? -1 : 1; // 日期預設新到舊，文字預設 A→Z
        }
        renderUsers();
    });
});

async function loadUsers() {
    const params = new URLSearchParams();
    if (currentQuery) params.set('q', currentQuery);

    const response = await adminFetch('/admin/users?' + params.toString());
    const result = await response.json();
    const users = result.data ?? [];
    allUsers = users;

    // 搜尋字串是完整帳號（含 @）且剛好只比對到一位使用者時，直接跳去他的紀錄頁，
    // 不用還要多按一次 Records——這是輸入帳號查紀錄最常見的用法
    if (currentQuery.includes('@') && users.length === 1 && users[0].email?.toLowerCase() === currentQuery.toLowerCase()) {
        window.location.href = `userLogs.html?id=${users[0]._id}`;
        return;
    }

    renderUsers();
}

function renderUsers() {
    updateSortArrows();
    const table = document.getElementById('userTable');
    table.innerHTML = '';

    [...allUsers].sort(compareUsers).forEach(user => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${user.userId ?? ''}</td>
            <td>${user.name ?? ''}</td>
            <td>${user.email ?? ''}</td>
            <td>${user.status ? t(user.status) : ''}</td>
            <td>${formatDate(user.createdAt)}</td>
            <td>
                <button class="edit-btn">${t('Edit')}</button>
                <button class="records-btn">${t('Records')}</button>
                <button class="delete-btn">${t('Delete')}</button>
            </td>
        `;
        row.querySelector('.edit-btn').addEventListener('click', () => {
            window.location.href = `editUser.html?id=${user._id}`;
        });
        row.querySelector('.records-btn').addEventListener('click', () => {
            window.location.href = `userLogs.html?id=${user._id}`;
        });
        row.querySelector('.delete-btn').addEventListener('click', () => deleteUser(user._id, user.name));
        table.appendChild(row);
    });
}

function searchUsers() {
    currentQuery = document.getElementById('searchInput').value.trim();
    loadUsers();
}

document.getElementById('searchInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') searchUsers();
});

async function deleteUser(id, name) {
    if (!confirm(t('Delete user "{name}"? This cannot be undone.', { name: name ?? id }))) return;

    const response = await adminFetch('/admin/users/' + id, { method: 'DELETE' });
    const result = await response.json();
    if (!result.success) {
        alert(t(result.error || 'Failed to delete user'));
        return;
    }
    loadUsers();
}

loadUsers();
