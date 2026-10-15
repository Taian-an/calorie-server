requireAdminLogin();

async function loadDashboard() {
    const response = await adminFetch('/admin/dashboard');
    const result = await response.json();
    if (!result.success) return;

    const { totalUsers, todayUploads, totalFeedback, recentUsers, geminiStatus } = result.data;
    document.getElementById('statTotalUsers').textContent = totalUsers;
    document.getElementById('statTodayUploads').textContent = todayUploads;
    document.getElementById('statTotalFeedback').textContent = totalFeedback;

    const geminiEl = document.getElementById('statGeminiStatus');
    // 後端回的是語言中立的 code，這裡再翻成目前語言
    const GEMINI_LABELS = { ok: 'OK', noData: 'No data yet', quota: 'Quota problem' };
    geminiEl.textContent = t(GEMINI_LABELS[geminiStatus.code] ?? 'OK');
    geminiEl.classList.toggle('status-bad', !geminiStatus.ok);

    const table = document.getElementById('recentUsersTable');
    table.innerHTML = '';

    if (!recentUsers.length) {
        table.innerHTML = `<tr><td colspan="3" style="text-align:center; color:#999;">${t('No users yet')}</td></tr>`;
        return;
    }

    recentUsers.forEach(user => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${escapeHtml(user.userId)}</td>
            <td>${escapeHtml(user.email)}</td>
            <td>${planTag(user)}</td>
        `;
        table.appendChild(row);
    });
}

loadDashboard();
