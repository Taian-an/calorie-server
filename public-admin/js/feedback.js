requireAdminLogin();

const PAGE_SIZE = 20;
let currentPage = 1;
let currentStatus = '';
let currentTotal = 0;

function formatDate(iso) {
    return formatLocaleDateTime(iso);
}

async function loadFeedback() {
    const params = new URLSearchParams({ page: currentPage, limit: PAGE_SIZE });
    if (currentStatus) params.set('status', currentStatus);

    const response = await adminFetch('/admin/feedback?' + params.toString());
    const result = await response.json();

    const table = document.getElementById('feedbackTable');
    table.innerHTML = '';

    (result.data ?? []).forEach(item => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${escapeHtml(formatDate(item.createdAt))}</td>
            <td style="text-align:left; max-width: 320px;">${escapeHtml(item.message)}</td>
            <td>${escapeHtml(item.email ?? '—')}</td>
            <td><span class="status-tag ${escapeHtml(item.status)}">${escapeHtml(t(item.status))}</span></td>
            <td>
                <button class="edit-btn toggle-btn">${item.status === 'new' ? t('Mark Reviewed') : t('Mark New')}</button>
                <button class="delete-btn">${t('Delete')}</button>
            </td>
        `;
        row.querySelector('.toggle-btn').addEventListener('click', () =>
            toggleStatus(item._id, item.status === 'new' ? 'reviewed' : 'new'));
        row.querySelector('.delete-btn').addEventListener('click', () => deleteFeedback(item._id));
        table.appendChild(row);
    });

    currentTotal = result.total ?? 0;
    renderPagination();
}

function renderPagination() {
    const totalPages = Math.max(1, Math.ceil(currentTotal / PAGE_SIZE));
    document.getElementById('pageInfo').textContent = t('Page {page} / {pages} ({total} feedback)', { page: currentPage, pages: totalPages, total: currentTotal });
    document.getElementById('prevPageBtn').disabled = currentPage <= 1;
    document.getElementById('nextPageBtn').disabled = currentPage >= totalPages;
}

function changePage(delta) {
    currentPage += delta;
    loadFeedback();
}

async function toggleStatus(id, status) {
    const response = await adminFetch('/admin/feedback/' + id, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
    });
    const result = await response.json();
    if (!result.success) {
        alert(t(result.error || 'Failed to update feedback'));
        return;
    }
    loadFeedback();
}

async function deleteFeedback(id) {
    if (!confirm(t('Delete this feedback? This cannot be undone.'))) return;

    const response = await adminFetch('/admin/feedback/' + id, { method: 'DELETE' });
    const result = await response.json();
    if (!result.success) {
        alert(t(result.error || 'Failed to delete feedback'));
        return;
    }
    loadFeedback();
}

document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentStatus = btn.dataset.status;
        currentPage = 1;
        loadFeedback();
    });
});

loadFeedback();
