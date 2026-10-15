requireAdminLogin();

// AI 辨識紀錄：伺服器分頁（紀錄會越來越多，不像使用者頁一次全載入）。點一列展開組成明細或失敗原因。
const PAGE_SIZE = 50;
let currentPage = 1;
let currentQuery = '';
let currentStatus = '';
let totalCount = 0;

function formatMs(ms) {
    return ms == null ? '—' : `${(ms / 1000).toFixed(1)} s`;
}

async function loadStats() {
    const response = await adminFetch('/admin/analyses/stats');
    const { data } = await response.json();
    const rate = data.last7d.successRate == null ? '—' : `${Math.round(data.last7d.successRate * 100)}%`;
    const topModel = data.models[0] ? `${data.models[0].model} (${data.models[0].count})` : '—';
    const cards = [
        [t('Last 24 hours'), data.last24h, t('analyses')],
        [t('Success rate (7 days)'), rate, t('{done} succeeded, {failed} failed', { done: data.last7d.done, failed: data.last7d.failed })],
        [t('Average AI time (7 days)'), formatMs(data.avgMs), t('Slowest: {ms}', { ms: formatMs(data.maxMs) })],
        [t('Most used model (7 days)'), escapeHtml(topModel), ''],
    ];
    document.getElementById('stats').innerHTML = cards.map(([label, value, sub]) => `
        <div class="stat">
            <div class="label">${label}</div>
            <div class="value">${value}</div>
            <div class="sub">${sub}</div>
        </div>`).join('');
}

function userCell(a) {
    if (a.user) {
        const label = escapeHtml(a.user.email || a.user.userId);
        const premium = a.user.premium ? `<span class="badge premium">${t('Premium')}</span>` : '';
        return `<a href="userLogs.html?id=${a.user._id}" onclick="event.stopPropagation()">${label}</a>${premium}`;
    }
    return `<span class="muted">${a.userDeleted ? t('Deleted account') : t('Anonymous')}</span>`;
}

function statusLabel(status) {
    return { done: t('Success'), failed: t('Failed'), pending: t('Pending') }[status] ?? status;
}

function detailHtml(a) {
    if (a.status === 'failed') return `${t('Reason')}: ${escapeHtml(a.error || '—')}`;
    const items = a.result?.items ?? [];
    if (!items.length) return `<span class="muted">${t('No item breakdown')}</span>`;
    return items.map(i => `• ${escapeHtml(i.name)} — ${i.grams} g, ${i.calories} kcal`).join('<br>');
}

function renderAnalyses(items) {
    const tbody = document.getElementById('analysisTable');
    if (!items.length) {
        tbody.innerHTML = `<tr><td colspan="9" class="muted">${t('No analyses found')}</td></tr>`;
        return;
    }
    tbody.innerHTML = items.map((a, idx) => {
        const r = a.result ?? {};
        const done = a.status === 'done';
        return `
        <tr class="row" onclick="toggleDetail(${idx})">
            <td>${formatLocaleDateTime(a.createdAt)}</td>
            <td>${userCell(a)}</td>
            <td>${done ? escapeHtml(r.name) : '<span class="muted">—</span>'}</td>
            <td>${done ? r.energy ?? '' : ''}</td>
            <td>${done ? `${r.protein ?? 0} / ${r.carbs ?? 0} / ${r.fat ?? 0}` : ''}</td>
            <td>${done && r.confidence != null ? `${Math.round(r.confidence * 100)}%` : ''}</td>
            <td>${escapeHtml(r.model ?? '')}</td>
            <td>${done ? formatMs(r.aiMs) : ''}</td>
            <td><span class="badge ${a.status}">${statusLabel(a.status)}</span></td>
        </tr>
        <tr class="detail" id="detail-${idx}" style="display:none"><td colspan="9">${detailHtml(a)}</td></tr>`;
    }).join('');
}

function toggleDetail(idx) {
    const row = document.getElementById(`detail-${idx}`);
    row.style.display = row.style.display === 'none' ? '' : 'none';
}

async function loadAnalyses() {
    const params = new URLSearchParams({ page: currentPage, limit: PAGE_SIZE });
    if (currentQuery) params.set('q', currentQuery);
    if (currentStatus) params.set('status', currentStatus);
    const response = await adminFetch('/admin/analyses?' + params.toString());
    const result = await response.json();
    totalCount = result.total ?? 0;
    renderAnalyses(result.data ?? []);

    const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
    document.getElementById('pageInfo').textContent = t('Page {page} of {pages} ({total} total)', { page: currentPage, pages: totalPages, total: totalCount });
    document.getElementById('prevPageBtn').disabled = currentPage <= 1;
    document.getElementById('nextPageBtn').disabled = currentPage >= totalPages;
}

function searchAnalyses() {
    currentQuery = document.getElementById('searchInput').value.trim();
    currentStatus = document.getElementById('statusFilter').value;
    currentPage = 1;
    loadAnalyses();
}

function changePage(delta) {
    currentPage = Math.max(1, currentPage + delta);
    loadAnalyses();
}

document.getElementById('searchInput').addEventListener('keydown', e => { if (e.key === 'Enter') searchAnalyses(); });
document.getElementById('statusFilter').addEventListener('change', searchAnalyses);

loadStats();
loadAnalyses();
