requireAdminLogin();

const MEAL_LABELS = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snacks: 'Snacks' };

function getUserId() {
    return new URLSearchParams(window.location.search).get('id');
}

function renderSummary(user) {
    document.getElementById('pageTitle').textContent = t("{name}'s Food Log", { name: user.name || user.userId });
    document.getElementById('userSummary').innerHTML = `
        <p><strong>ID:</strong> ${user.userId ?? ''} &nbsp; <strong>Email:</strong> ${user.email ?? ''}</p>
    `;
}

function renderLogs(logs) {
    const container = document.getElementById('logsContainer');

    if (!logs.length) {
        container.innerHTML = `<div class="empty-state">${t("This user hasn't logged any meals yet")}</div>`;
        return;
    }

    container.innerHTML = logs.map(log => {
        const meals = log.meals ?? [];
        const dayTotal = meals.reduce((sum, m) => sum + (m.energy ?? 0), 0);
        const rows = meals.map(m => `
            <tr>
                <td>${MEAL_LABELS[m.mealType] ? t(MEAL_LABELS[m.mealType]) : (m.mealType ?? '')}</td>
                <td>${m.name ?? ''}</td>
                <td>${m.energy ?? 0}</td>
                <td>${m.protein ?? 0}</td>
                <td>${m.carbs ?? 0}</td>
                <td>${m.fat ?? 0}</td>
            </tr>
        `).join('');

        return `
            <div class="log-day">
                <h3>${log.date} — ${t('Total {kcal} kcal', { kcal: dayTotal })}${log.weight ? ` ｜ ${t('Weight {kg}kg', { kg: log.weight })}` : ''}</h3>
                ${meals.length ? `
                    <table>
                        <thead>
                            <tr><th>${t('Meal')}</th><th>${t('Food')}</th><th>${t('Calories (kcal)')}</th><th>${t('Protein (g)')}</th><th>${t('Carbs (g)')}</th><th>${t('Fat (g)')}</th></tr>
                        </thead>
                        <tbody>${rows}</tbody>
                    </table>
                ` : `<p>${t('No meals logged this day')}</p>`}
            </div>
        `;
    }).join('');
}

async function loadUserLogs() {
    const id = getUserId();
    if (!id) {
        document.getElementById('logsContainer').innerHTML = `<div class="empty-state">${t('Missing user ID')}</div>`;
        return;
    }

    const response = await adminFetch(`/admin/users/${id}/logs`);
    const result = await response.json();

    if (!result.success) {
        document.getElementById('logsContainer').innerHTML = `<div class="empty-state">${t(result.error || 'Failed to load')}</div>`;
        return;
    }

    renderSummary(result.data.user);
    renderLogs(result.data.logs);
}

loadUserLogs();
