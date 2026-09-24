
// Supabase Client Initialization
const supabaseClient = window.supabase.createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.anonKey);

// Global App State
let state = {
    expenses: [],
    freelancers: [],
    income: [],
    withdrawals: [],
    currentTab: 'dashboard',
    periodOffset: 0, // 0 = current month, -1 = previous, etc.
    pendingReceiptBase64: null,
    charts: {
        categoryDoughnut: null,
        cashflowBars: null
    },
    exchangeRates: {
        blue: { compra: 1540, venta: 1560 },
        cripto: { compra: 1608, venta: 1610 },
        bolsa: { compra: 1541, venta: 1544 },
        oficial: { compra: 1490, venta: 1540 },
        tarjeta: { venta: 2156 },
        lastUpdate: null
    },
    converterState: {
        activeRateType: 'blue',
        activeOpType: 'venta',
        usdValue: 100,
        arsValue: 156000,
        inlineTargetInputId: null
    }
};

// Initialize Application & PWA Service Worker
document.addEventListener('DOMContentLoaded', async () => {
    // Register Service Worker for PWA installation
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('./sw.js').catch(err => console.log('SW registration error:', err));
    }

    const today = new Date().toISOString().split('T')[0];
    document.querySelectorAll('input[type="date"]').forEach(input => input.value = today);

    setupNavigation();
    setupFilters();
    updatePeriodLabel();
    
    await Promise.all([
        refreshAllData(),
        fetchLiveQuotes(false)
    ]);

    // Auto-polling for live currency rates every 3.5 minutes
    setInterval(() => fetchLiveQuotes(false), 3.5 * 60 * 1000);
    
    lucide.createIcons();
});

// Navigation logic
function setupNavigation() {
    document.querySelectorAll('.tab').forEach(button => {
        button.addEventListener('click', () => {
            const tabName = button.getAttribute('data-tab');
            switchTab(tabName);
        });
    });
}

function switchTab(tabName) {
    document.querySelectorAll('.tab').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(tab => tab.classList.remove('active'));

    const targetBtn = document.querySelector(`.tab[data-tab="${tabName}"]`);
    const targetTab = document.getElementById(`tab-${tabName}`);

    if (targetBtn) targetBtn.classList.add('active');
    if (targetTab) targetTab.classList.add('active');

    state.currentTab = tabName;
    lucide.createIcons();
}

function shiftPeriod(delta) {
    state.periodOffset += delta;
    updatePeriodLabel();
    renderDashboard();
    renderSubscriptions();
}

function updatePeriodLabel() {
    const label = document.getElementById('period-display-label');
    if (!label) return;

    if (state.periodOffset === 0) {
        label.textContent = 'Mes Actual';
    } else if (state.periodOffset === -1) {
        label.textContent = 'Mes Anterior';
    } else {
        const d = new Date();
        d.setMonth(d.getMonth() + state.periodOffset);
        const monthName = d.toLocaleString('es-ES', { month: 'short', year: 'numeric' });
        label.textContent = monthName.charAt(0).toUpperCase() + monthName.slice(1);
    }
}

// Data Fetching from Supabase
async function refreshAllData() {
    try {
        const [expRes, freeRes, incRes, withRes] = await Promise.all([
            supabaseClient.from('expenses').select('*').order('date', { ascending: false }),
            supabaseClient.from('freelancers').select('*').order('name', { ascending: true }),
            supabaseClient.from('income').select('*').order('date', { ascending: false }),
            supabaseClient.from('partner_withdrawals').select('*').order('date', { ascending: false })
        ]);

        if (expRes.error) console.error('Error fetching expenses:', expRes.error);
        if (freeRes.error) console.error('Error fetching freelancers:', freeRes.error);
        if (incRes.error) console.error('Error fetching income:', incRes.error);
        if (withRes.error) console.error('Error fetching withdrawals:', withRes.error);

        state.expenses = expRes.data || [];
        state.freelancers = freeRes.data || [];
        state.income = incRes.data || [];
        state.withdrawals = withRes.data || [];

        populateFreelancersSelect();

        renderDashboard();
        renderExpensesList();
        renderSubscriptions();
        renderFreelancersList();
        renderPartnersView();
        renderIncomeList();

        const expBadge = document.getElementById('expenses-count');
        const freeBadge = document.getElementById('freelancers-count');
        const subsBadge = document.getElementById('subs-count');
        const incBadge = document.getElementById('income-count');
        
        const recurringList = state.expenses.filter(e => e.is_recurring);
        if (expBadge) expBadge.textContent = state.expenses.length;
        if (freeBadge) freeBadge.textContent = state.freelancers.length;
        if (subsBadge) subsBadge.textContent = recurringList.length;
        
        if (incBadge) {
            const pendingIncomeCount = state.income.filter(i => i.status === 'pendiente').length;
            incBadge.textContent = state.income.length;
            if (pendingIncomeCount > 0) {
                incBadge.classList.add('badge-has-pending');
                incBadge.title = `${pendingIncomeCount} facturas pendientes de cobro`;
            } else {
                incBadge.classList.remove('badge-has-pending');
                incBadge.title = 'Total de facturaciones';
            }
        }

        lucide.createIcons();
    } catch (err) {
        showToast('Error cargando datos: ' + err.message, 'error');
        console.error(err);
    }
}

// Filter by Period Offset
function filterByPeriod(items) {
    if (state.periodOffset === null) return items;

    const targetDate = new Date();
    targetDate.setMonth(targetDate.getMonth() + state.periodOffset);
    const targetYear = targetDate.getFullYear();
    const targetMonth = targetDate.getMonth();

    return items.filter(item => {
        const itemDate = new Date(item.date);
        return itemDate.getFullYear() === targetYear && itemDate.getMonth() === targetMonth;
    });
}

// DASHBOARD RENDERING
function renderDashboard() {
    const filteredExpenses = filterByPeriod(state.expenses);
    const filteredIncome = filterByPeriod(state.income);
    const filteredWithdrawals = filterByPeriod(state.withdrawals);

    const totalIncome = filteredIncome.reduce((sum, item) => sum + Number(item.amount), 0);
    const collectedIncome = filteredIncome.filter(i => i.status === 'cobrado' || !i.status).reduce((sum, item) => sum + Number(item.amount), 0);
    const pendingIncome = filteredIncome.filter(i => i.status === 'pendiente').reduce((sum, item) => sum + Number(item.amount), 0);
    const pendingIncomeCount = filteredIncome.filter(i => i.status === 'pendiente').length;

    const totalExpenses = filteredExpenses.reduce((sum, item) => sum + Number(item.amount), 0);
    const pendingExpenses = filteredExpenses.filter(e => e.status === 'pendiente').reduce((sum, item) => sum + Number(item.amount), 0);
    const netProfit = totalIncome - totalExpenses;
    const marginRate = totalIncome > 0 ? ((netProfit / totalIncome) * 100).toFixed(1) : 0;
    const totalWithdrawals = filteredWithdrawals.reduce((sum, item) => sum + Number(item.amount), 0);

    document.getElementById('dash-income').textContent = formatUSD(totalIncome);
    if (pendingIncome > 0) {
        document.getElementById('dash-income-count').innerHTML = `$${formatNumber(collectedIncome)} cobrado <span class="text-amber">• $${formatNumber(pendingIncome)} pendiente (${pendingIncomeCount})</span>`;
    } else {
        document.getElementById('dash-income-count').textContent = `${filteredIncome.length} facturaciones (100% cobrado)`;
    }
    
    document.getElementById('dash-expenses').textContent = formatUSD(totalExpenses);
    document.getElementById('dash-pending-expenses').textContent = `$${formatNumber(pendingExpenses)} pendiente`;
    
    document.getElementById('dash-net-profit').textContent = formatUSD(netProfit);
    document.getElementById('dash-margin-rate').textContent = `Margen: ${marginRate}%`;
    
    document.getElementById('dash-withdrawals').textContent = formatUSD(totalWithdrawals);

    const francoWith = filteredWithdrawals.filter(w => w.partner_name === 'Franco').reduce((s, w) => s + Number(w.amount), 0);
    const agustinWith = filteredWithdrawals.filter(w => w.partner_name === 'Agustin').reduce((s, w) => s + Number(w.amount), 0);

    document.getElementById('mini-franco-with').textContent = `$${formatNumber(francoWith)}`;
    document.getElementById('mini-agustin-with').textContent = `$${formatNumber(agustinWith)}`;
    
    document.getElementById('pb-franco-amount').textContent = formatUSD(francoWith);
    document.getElementById('pb-agustin-amount').textContent = formatUSD(agustinWith);

    const sumWith = francoWith + agustinWith;
    const francoPct = sumWith > 0 ? (francoWith / sumWith) * 100 : 50;
    const agustinPct = sumWith > 0 ? (agustinWith / sumWith) * 100 : 50;

    document.getElementById('pb-franco-bar').style.width = `${francoPct}%`;
    document.getElementById('pb-agustin-bar').style.width = `${agustinPct}%`;

    const balanceBadge = document.getElementById('balance-status-badge');
    const diff = Math.abs(francoWith - agustinWith);
    if (diff < 1) {
        balanceBadge.textContent = 'Retiros Equilibrados (50/50)';
        balanceBadge.style.color = 'var(--flowix-green)';
        balanceBadge.style.background = 'var(--flowix-green-soft)';
    } else {
        const higher = francoWith > agustinWith ? 'Franco' : 'Agustín';
        balanceBadge.textContent = `${higher} retiró +$${formatNumber(diff)}`;
        balanceBadge.style.color = 'var(--flowix-blue)';
        balanceBadge.style.background = 'var(--flowix-blue-soft)';
    }

    renderRecentTransactions(filteredExpenses);

    const infraTotal = filteredExpenses.filter(e => e.category === 'infraestructura').reduce((s, e) => s + Number(e.amount), 0);
    const adsTotal = filteredExpenses.filter(e => e.category === 'publicidad').reduce((s, e) => s + Number(e.amount), 0);
    const freeTotal = filteredExpenses.filter(e => e.category === 'freelancer').reduce((s, e) => s + Number(e.amount), 0);
    const otherTotal = filteredExpenses.filter(e => e.category === 'otro').reduce((s, e) => s + Number(e.amount), 0);

    renderCharts(infraTotal, adsTotal, freeTotal, otherTotal, totalIncome, totalExpenses);
}

function renderRecentTransactions(expenses) {
    const list = document.getElementById('recent-transactions-list');
    const recent = expenses.slice(0, 5);

    if (recent.length === 0) {
        list.innerHTML = `<div class="empty-state">No hay gastos registrados en este periodo</div>`;
        return;
    }

    list.innerHTML = recent.map(exp => `
        <div class="row">
            <div class="row-icon-wrap icon-${getCatClass(exp.category)}">
                <i data-lucide="${getCategoryIcon(exp.category)}"></i>
            </div>
            <div class="row-main">
                <div class="row-title">
                    ${escapeHTML(exp.title)}
                    ${exp.is_recurring ? `<span class="badge-recurring">SaaS</span>` : ''}
                </div>
                <div class="row-sub">
                    <span>${exp.date}</span>
                    <span>•</span>
                    <span class="partner-tag ${exp.created_by === 'Franco' ? 'tag-f' : 'tag-a'}">${exp.created_by}</span>
                </div>
            </div>
            <div class="row-right">
                <div class="row-amount text-red">-$${formatNumber(exp.amount)}</div>
                ${exp.receipt_url ? `<button class="btn-icon btn-receipt-view" onclick="viewReceipt('${exp.id}')" title="Ver Comprobante"><i data-lucide="paperclip"></i></button>` : ''}
                <div class="row-actions">
                    <button class="btn-icon" onclick="editExpense('${exp.id}')" title="Editar"><i data-lucide="edit-2"></i></button>
                    <button class="btn-icon btn-icon-del" onclick="deleteExpense('${exp.id}')" title="Eliminar"><i data-lucide="trash-2"></i></button>
                </div>
            </div>
        </div>
    `).join('');

    lucide.createIcons();
}

// SAAS & SUBSCRIPTIONS TRACKER
function renderSubscriptions() {
    const container = document.getElementById('subscriptions-list-body');
    const recurring = state.expenses.filter(e => e.is_recurring);

    const monthlyTotal = recurring.reduce((s, e) => s + Number(e.amount), 0);
    const yearlyTotal = monthlyTotal * 12;

    const saasMonthEl = document.getElementById('saas-monthly-total');
    const saasYearEl = document.getElementById('saas-yearly-total');
    const saasCountEl = document.getElementById('saas-active-count');

    if (saasMonthEl) saasMonthEl.textContent = formatUSD(monthlyTotal);
    if (saasYearEl) saasYearEl.textContent = formatUSD(yearlyTotal);
    if (saasCountEl) saasCountEl.textContent = `${recurring.length} herramientas`;

    if (!container) return;

    if (recurring.length === 0) {
        container.innerHTML = `<div class="empty-state">No hay herramientas o suscripciones recurrentes registradas. Crea un gasto y activa '¿Es Suscripción?'</div>`;
        return;
    }

    container.innerHTML = recurring.map(sub => `
        <div class="row">
            <div class="row-icon-wrap icon-saas">
                <i data-lucide="refresh-cw"></i>
            </div>
            <div class="row-main">
                <div class="row-title">
                    ${escapeHTML(sub.title)}
                    <span class="badge-recurring">Recurrente</span>
                </div>
                <div class="row-sub">
                    <span>Último pago: ${sub.date}</span>
                    <span>•</span>
                    <span>${sub.payment_method || 'Tarjeta'}</span>
                    <span>•</span>
                    <span class="partner-tag ${sub.created_by === 'Franco' ? 'tag-f' : 'tag-a'}">${sub.created_by}</span>
                </div>
            </div>
            <div class="row-right">
                <div class="row-amount text-blue">$${formatNumber(sub.amount)} /mes</div>
                <div class="row-actions">
                    <button class="btn-icon" onclick="editExpense('${sub.id}')" title="Editar"><i data-lucide="edit-2"></i></button>
                    <button class="btn-icon btn-icon-del" onclick="deleteExpense('${sub.id}')" title="Eliminar"><i data-lucide="trash-2"></i></button>
                </div>
            </div>
        </div>
    `).join('');

    lucide.createIcons();
}

// CHARTS RENDERING
function renderCharts(infra, ads, free, other, income, expenses) {
    const ctxDoughnut = document.getElementById('chart-category-doughnut');
    if (ctxDoughnut) {
        if (state.charts.categoryDoughnut) state.charts.categoryDoughnut.destroy();

        state.charts.categoryDoughnut = new Chart(ctxDoughnut, {
            type: 'doughnut',
            data: {
                labels: ['Infraestructura', 'Publicidad (Ads)', 'Freelancers', 'Otros'],
                datasets: [{
                    data: [infra, ads, free, other],
                    backgroundColor: ['#60a5fa', '#f59e0b', '#a78bfa', '#606778'],
                    borderWidth: 0,
                    hoverOffset: 4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: { color: '#8e95a5', font: { family: 'Outfit', size: 11 }, padding: 12 }
                    }
                },
                cutout: '72%'
            }
        });
    }

    const ctxBars = document.getElementById('chart-cashflow-bars');
    if (ctxBars) {
        if (state.charts.cashflowBars) state.charts.cashflowBars.destroy();

        state.charts.cashflowBars = new Chart(ctxBars, {
            type: 'bar',
            data: {
                labels: ['Facturación', 'Gastos Totales'],
                datasets: [{
                    data: [income, expenses],
                    backgroundColor: ['#00CC6A', '#f43f5e'],
                    borderRadius: 8,
                    barThickness: 45
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false }
                },
                scales: {
                    y: {
                        ticks: { color: '#606778', font: { family: 'Outfit', size: 11 } },
                        grid: { color: 'rgba(255, 255, 255, 0.05)' }
                    },
                    x: {
                        ticks: { color: '#ffffff', font: { family: 'Outfit', weight: '600', size: 12 } },
                        grid: { display: false }
                    }
                }
            }
        });
    }
}

// EXPENSES & INCOME FILTERS
function setupFilters() {
    ['expense-search', 'filter-expense-cat', 'filter-expense-partner', 'filter-expense-status'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('input', renderExpensesList);
    });

    ['income-search', 'filter-income-status', 'filter-income-partner'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('input', renderIncomeList);
    });
}

function renderExpensesList() {
    const search = (document.getElementById('expense-search')?.value || '').toLowerCase();
    const cat = document.getElementById('filter-expense-cat')?.value || 'all';
    const partner = document.getElementById('filter-expense-partner')?.value || 'all';
    const status = document.getElementById('filter-expense-status')?.value || 'all';

    const container = document.getElementById('expenses-table-body');
    const filtered = state.expenses.filter(item => {
        const matchSearch = item.title.toLowerCase().includes(search) || 
                            (item.notes && item.notes.toLowerCase().includes(search)) ||
                            (item.payment_method && item.payment_method.toLowerCase().includes(search));
        const matchCat = cat === 'all' || item.category === cat;
        const matchPartner = partner === 'all' || item.created_by === partner;
        const matchStatus = status === 'all' || item.status === status;
        return matchSearch && matchCat && matchPartner && matchStatus;
    });

    if (filtered.length === 0) {
        container.innerHTML = `<div class="empty-state">No se encontraron gastos registrados con los filtros aplicados.</div>`;
        return;
    }

    container.innerHTML = filtered.map(exp => {
        const freelancer = state.freelancers.find(f => f.id === exp.freelancer_id);
        const subInfo = freelancer ? `Colaborador: ${escapeHTML(freelancer.name)}` : (exp.payment_method || '');
        const isPending = exp.status === 'pendiente';
        return `
            <div class="row">
                <div class="row-icon-wrap icon-${getCatClass(exp.category)}">
                    <i data-lucide="${getCategoryIcon(exp.category)}"></i>
                </div>
                <div class="row-main">
                    <div class="row-title">
                        ${escapeHTML(exp.title)}
                        <span class="badge-status ${isPending ? 'badge-pending' : 'badge-paid'}">${isPending ? 'Pendiente' : 'Pagado'}</span>
                        ${exp.is_recurring ? `<span class="badge-recurring">SaaS</span>` : ''}
                    </div>
                    <div class="row-sub">
                        <span>${exp.date}</span>
                        <span>•</span>
                        <span>${getCategoryLabel(exp.category)}</span>
                        <span>•</span>
                        <span class="partner-tag ${exp.created_by === 'Franco' ? 'tag-f' : 'tag-a'}">${exp.created_by}</span>
                        ${subInfo ? `<span>• ${subInfo}</span>` : ''}
                    </div>
                </div>
                <div class="row-right">
                    <div class="row-amount ${isPending ? 'text-amber' : 'text-red'}">-$${formatNumber(exp.amount)}</div>
                    ${exp.receipt_url ? `<button class="btn-icon btn-receipt-view" onclick="viewReceipt('${exp.id}')" title="Ver Comprobante"><i data-lucide="paperclip"></i></button>` : ''}
                    <div class="row-actions">
                        ${isPending ? 
                            `<button class="btn-icon btn-icon-check" onclick="toggleExpenseStatus('${exp.id}', 'pagado')" title="Marcar como Pagado"><i data-lucide="check"></i></button>` : 
                            `<button class="btn-icon btn-icon-undo" onclick="toggleExpenseStatus('${exp.id}', 'pendiente')" title="Revertir a Pendiente"><i data-lucide="rotate-ccw"></i></button>`
                        }
                        <button class="btn-icon" onclick="editExpense('${exp.id}')" title="Editar"><i data-lucide="edit-2"></i></button>
                        <button class="btn-icon btn-icon-del" onclick="deleteExpense('${exp.id}')" title="Eliminar"><i data-lucide="trash-2"></i></button>
                    </div>
                </div>
            </div>
        `;
    }).join('');

    lucide.createIcons();
}

// FILE UPLOAD HANDLER
function handleFileSelected(e) {
    const file = e.target.files[0];
    const nameLabel = document.getElementById('file-selected-name');
    if (!file) {
        state.pendingReceiptBase64 = null;
        if (nameLabel) nameLabel.textContent = 'Ningún archivo seleccionado (opcional)';
        return;
    }

    if (nameLabel) nameLabel.textContent = `Archivo: ${file.name} (${(file.size / 1024).toFixed(1)} KB)`;

    const reader = new FileReader();
    reader.onload = (uploadEvent) => {
        state.pendingReceiptBase64 = uploadEvent.target.result;
    };
    reader.readAsDataURL(file);
}

function viewReceipt(id) {
    const exp = state.expenses.find(e => e.id === id);
    if (!exp || !exp.receipt_url) return;

    const content = document.getElementById('receipt-preview-content');
    if (exp.receipt_url.startsWith('data:image') || exp.receipt_url.match(/\.(jpeg|jpg|gif|png|webp)/i)) {
        content.innerHTML = `<img src="${exp.receipt_url}" style="max-width: 100%; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.5);">`;
    } else {
        content.innerHTML = `<div style="padding: 20px;"><p>Comprobante adjunto:</p><a href="${exp.receipt_url}" target="_blank" class="btn-flowix-cta" style="margin-top: 14px; text-decoration: none;">Abrir Comprobante</a></div>`;
    }
    openModal('modal-receipt-preview');
}

async function saveExpense(e) {
    e.preventDefault();
    const id = document.getElementById('expense-id').value;
    const payload = {
        title: document.getElementById('exp-title').value.trim(),
        amount: parseFloat(document.getElementById('exp-amount').value),
        date: document.getElementById('exp-date').value,
        category: document.getElementById('exp-category').value,
        freelancer_id: document.getElementById('exp-freelancer-id').value || null,
        created_by: document.getElementById('exp-partner').value,
        status: document.getElementById('exp-status').value,
        payment_method: document.getElementById('exp-payment-method').value,
        is_recurring: document.getElementById('exp-is-recurring').value === 'true',
        notes: document.getElementById('exp-notes').value.trim()
    };

    if (state.pendingReceiptBase64) {
        payload.receipt_url = state.pendingReceiptBase64;
    }

    try {
        let res;
        if (id) {
            res = await supabaseClient.from('expenses').update(payload).eq('id', id);
        } else {
            res = await supabaseClient.from('expenses').insert([payload]);
        }

        if (res.error) throw res.error;

        closeModal('modal-expense');
        state.pendingReceiptBase64 = null;
        showToast(id ? 'Gasto actualizado' : 'Gasto registrado con éxito', 'success');
        await refreshAllData();
    } catch (err) {
        showToast('Error al guardar el gasto: ' + err.message, 'error');
    }
}

function openExpenseModal(defaultCategory = 'infraestructura', isRecurring = false) {
    document.getElementById('form-expense').reset();
    document.getElementById('expense-id').value = '';
    document.getElementById('modal-expense-title').textContent = isRecurring ? 'Registrar Suscripción / SaaS' : 'Registrar Gasto';
    document.getElementById('exp-date').value = new Date().toISOString().split('T')[0];
    document.getElementById('exp-category').value = defaultCategory;
    document.getElementById('exp-is-recurring').value = isRecurring ? 'true' : 'false';
    
    state.pendingReceiptBase64 = null;
    const nameLabel = document.getElementById('file-selected-name');
    if (nameLabel) nameLabel.textContent = 'Ningún archivo seleccionado (opcional)';

    handleCategoryChange();
    openModal('modal-expense');
}

function editExpense(id) {
    const exp = state.expenses.find(e => e.id === id);
    if (!exp) return;

    document.getElementById('expense-id').value = exp.id;
    document.getElementById('exp-title').value = exp.title;
    document.getElementById('exp-amount').value = exp.amount;
    document.getElementById('exp-date').value = exp.date;
    document.getElementById('exp-category').value = exp.category;
    document.getElementById('exp-partner').value = exp.created_by;
    document.getElementById('exp-status').value = exp.status;
    document.getElementById('exp-payment-method').value = exp.payment_method || 'Tarjeta Corporativa';
    document.getElementById('exp-is-recurring').value = exp.is_recurring ? 'true' : 'false';
    document.getElementById('exp-notes').value = exp.notes || '';

    state.pendingReceiptBase64 = exp.receipt_url || null;
    const nameLabel = document.getElementById('file-selected-name');
    if (nameLabel) {
        nameLabel.textContent = exp.receipt_url ? 'Comprobante adjunto cargado' : 'Ningún archivo seleccionado';
    }

    handleCategoryChange();
    if (exp.freelancer_id) {
        document.getElementById('exp-freelancer-id').value = exp.freelancer_id;
    }

    document.getElementById('modal-expense-title').textContent = 'Editar Gasto';
    openModal('modal-expense');
}

async function deleteExpense(id) {
    if (!confirm('¿Seguro que deseas eliminar este gasto?')) return;
    try {
        const { error } = await supabaseClient.from('expenses').delete().eq('id', id);
        if (error) throw error;
        showToast('Gasto eliminado', 'success');
        await refreshAllData();
    } catch (err) {
        showToast('Error al eliminar: ' + err.message, 'error');
    }
}

function handleCategoryChange() {
    const cat = document.getElementById('exp-category').value;
    const freeGroup = document.getElementById('freelancer-select-group');
    if (cat === 'freelancer') {
        freeGroup.style.display = 'block';
    } else {
        freeGroup.style.display = 'none';
        document.getElementById('exp-freelancer-id').value = '';
    }
}

function populateFreelancersSelect() {
    const select = document.getElementById('exp-freelancer-id');
    if (!select) return;
    select.innerHTML = `<option value="">-- Seleccionar Freelancer --</option>` + 
        state.freelancers.map(f => `<option value="${f.id}">${escapeHTML(f.name)} (${escapeHTML(f.role)})</option>`).join('');
}

// ASISTENTE DE CIERRE DE MES & FONDO DE RESERVA
function openSettlementModal() {
    const filteredExpenses = filterByPeriod(state.expenses);
    const filteredIncome = filterByPeriod(state.income);

    const totalIncome = filteredIncome.reduce((sum, item) => sum + Number(item.amount), 0);
    const totalExpenses = filteredExpenses.reduce((sum, item) => sum + Number(item.amount), 0);
    const netProfit = Math.max(0, totalIncome - totalExpenses);

    document.getElementById('set-income').textContent = formatUSD(totalIncome);
    document.getElementById('set-expenses').textContent = formatUSD(totalExpenses);
    document.getElementById('set-net-profit').textContent = formatUSD(netProfit);

    updateSettlementPreview();
    openModal('modal-settlement');
}

function updateSettlementPreview() {
    const filteredExpenses = filterByPeriod(state.expenses);
    const filteredIncome = filterByPeriod(state.income);
    const totalIncome = filteredIncome.reduce((sum, item) => sum + Number(item.amount), 0);
    const totalExpenses = filteredExpenses.reduce((sum, item) => sum + Number(item.amount), 0);
    const netProfit = Math.max(0, totalIncome - totalExpenses);

    const reservePct = parseFloat(document.getElementById('set-reserve-pct').value) || 0;
    const reserveAmount = (netProfit * (reservePct / 100));
    const distributable = Math.max(0, netProfit - reserveAmount);
    const splitEach = distributable / 2;

    document.getElementById('set-reserve-amount').textContent = `Fondo Reserva Flowix: ${formatUSD(reserveAmount)}`;
    document.getElementById('set-split-franco').textContent = formatUSD(splitEach);
    document.getElementById('set-split-agustin').textContent = formatUSD(splitEach);
}

async function executeAutoSettlement() {
    const filteredExpenses = filterByPeriod(state.expenses);
    const filteredIncome = filterByPeriod(state.income);
    const totalIncome = filteredIncome.reduce((sum, item) => sum + Number(item.amount), 0);
    const totalExpenses = filteredExpenses.reduce((sum, item) => sum + Number(item.amount), 0);
    const netProfit = Math.max(0, totalIncome - totalExpenses);

    const reservePct = parseFloat(document.getElementById('set-reserve-pct').value) || 0;
    const reserveAmount = (netProfit * (reservePct / 100));
    const distributable = Math.max(0, netProfit - reserveAmount);
    const splitEach = Math.round((distributable / 2) * 100) / 100;

    if (splitEach <= 0) {
        showToast('No hay ganancia neta positiva para distribuir en este periodo', 'error');
        return;
    }

    const today = new Date().toISOString().split('T')[0];
    const periodName = document.getElementById('period-display-label').textContent;

    const payload = [
        {
            partner_name: 'Franco',
            amount: splitEach,
            date: today,
            notes: `Cierre 50/50 (${periodName}) • Reserva ${reservePct}% ($${formatNumber(reserveAmount)})`
        },
        {
            partner_name: 'Agustin',
            amount: splitEach,
            date: today,
            notes: `Cierre 50/50 (${periodName}) • Reserva ${reservePct}% ($${formatNumber(reserveAmount)})`
        }
    ];

    try {
        const { error } = await supabaseClient.from('partner_withdrawals').insert(payload);
        if (error) throw error;

        closeModal('modal-settlement');
        showToast(`¡Cierre de mes ejecutado! Se distribuyeron $${formatNumber(splitEach)} a cada socio`, 'success');
        await refreshAllData();
    } catch (err) {
        showToast('Error al ejecutar distribución: ' + err.message, 'error');
    }
}

// FREELANCERS CRUD
function renderFreelancersList() {
    const container = document.getElementById('freelancers-cards-grid');
    if (state.freelancers.length === 0) {
        container.innerHTML = `<div class="empty-state">No hay freelancers registrados. Agrega uno con el botón superior.</div>`;
        return;
    }

    container.innerHTML = state.freelancers.map(free => {
        const payments = state.expenses.filter(e => e.freelancer_id === free.id);
        const totalPaid = payments.filter(e => e.status === 'pagado').reduce((s, e) => s + Number(e.amount), 0);
        const pending = payments.filter(e => e.status === 'pendiente').reduce((s, e) => s + Number(e.amount), 0);

        return `
            <div class="free-row">
                <div class="free-row-top">
                    <div class="free-identity">
                        <div class="free-circle">${escapeHTML(free.name.charAt(0).toUpperCase())}</div>
                        <div>
                            <div class="free-name">${escapeHTML(free.name)}</div>
                            <div class="free-role">${escapeHTML(free.role)}</div>
                        </div>
                    </div>
                    <div class="row-actions">
                        <button class="btn-icon" onclick="editFreelancer('${free.id}')"><i data-lucide="edit-2"></i></button>
                        <button class="btn-icon btn-icon-del" onclick="deleteFreelancer('${free.id}')"><i data-lucide="trash-2"></i></button>
                    </div>
                </div>

                <div class="free-data-box">
                    <div><strong>Contacto:</strong> ${free.contact_info ? escapeHTML(free.contact_info) : 'No especificado'}</div>
                    <div><strong>Datos de Pago:</strong> ${free.payment_details ? escapeHTML(free.payment_details) : 'No especificado'}</div>
                </div>

                <div class="free-actions-row">
                    <div class="free-stats-text">
                        Total Abonado: <strong>$${formatNumber(totalPaid)}</strong>
                        ${pending > 0 ? `• <span class="text-amber">Pendiente: $${formatNumber(pending)}</span>` : ''}
                    </div>
                    <button class="btn-ghost" style="color: var(--flowix-green); font-weight: 600;" onclick="payFreelancerQuick('${free.id}', '${escapeHTML(free.name)}')">
                        + Asignar Pago
                    </button>
                </div>
            </div>
        `;
    }).join('');

    lucide.createIcons();
}

function openFreelancerModal() {
    document.getElementById('form-freelancer').reset();
    document.getElementById('freelancer-id').value = '';
    document.getElementById('modal-freelancer-title').textContent = 'Agregar Freelancer';
    openModal('modal-freelancer');
}

function editFreelancer(id) {
    const free = state.freelancers.find(f => f.id === id);
    if (!free) return;
    document.getElementById('freelancer-id').value = free.id;
    document.getElementById('free-name').value = free.name;
    document.getElementById('free-role').value = free.role;
    document.getElementById('free-contact').value = free.contact_info || '';
    document.getElementById('free-payment-details').value = free.payment_details || '';
    document.getElementById('modal-freelancer-title').textContent = 'Editar Freelancer';
    openModal('modal-freelancer');
}

async function saveFreelancer(e) {
    e.preventDefault();
    const id = document.getElementById('freelancer-id').value;
    const payload = {
        name: document.getElementById('free-name').value.trim(),
        role: document.getElementById('free-role').value.trim(),
        contact_info: document.getElementById('free-contact').value.trim(),
        payment_details: document.getElementById('free-payment-details').value.trim()
    };

    try {
        let res;
        if (id) {
            res = await supabaseClient.from('freelancers').update(payload).eq('id', id);
        } else {
            res = await supabaseClient.from('freelancers').insert([payload]);
        }
        if (res.error) throw res.error;

        closeModal('modal-freelancer');
        showToast(id ? 'Freelancer actualizado' : 'Freelancer agregado', 'success');
        await refreshAllData();
    } catch (err) {
        showToast('Error al guardar: ' + err.message, 'error');
    }
}

async function deleteFreelancer(id) {
    if (!confirm('¿Eliminar este colaborador?')) return;
    try {
        const { error } = await supabaseClient.from('freelancers').delete().eq('id', id);
        if (error) throw error;
        showToast('Colaborador eliminado', 'success');
        await refreshAllData();
    } catch (err) {
        showToast('Error: ' + err.message, 'error');
    }
}

function payFreelancerQuick(freelancerId, name) {
    openExpenseModal('freelancer');
    document.getElementById('exp-title').value = `Pago a ${name}`;
    document.getElementById('exp-freelancer-id').value = freelancerId;
}

// PARTNERS & WITHDRAWALS
function renderPartnersView() {
    const francoList = state.withdrawals.filter(w => w.partner_name === 'Franco');
    const agustinList = state.withdrawals.filter(w => w.partner_name === 'Agustin');

    const francoTotal = francoList.reduce((s, w) => s + Number(w.amount), 0);
    const agustinTotal = agustinList.reduce((s, w) => s + Number(w.amount), 0);

    document.getElementById('partner-franco-total').textContent = formatUSD(francoTotal);
    document.getElementById('partner-franco-count').textContent = francoList.length;

    document.getElementById('partner-agustin-total').textContent = formatUSD(agustinTotal);
    document.getElementById('partner-agustin-count').textContent = agustinList.length;

    const container = document.getElementById('withdrawals-table-body');
    if (state.withdrawals.length === 0) {
        container.innerHTML = `<div class="empty-state">No hay retiros registrados aún.</div>`;
        return;
    }

    container.innerHTML = state.withdrawals.map(w => `
        <div class="row">
            <div class="row-icon-wrap icon-${w.partner_name === 'Franco' ? 'infra' : 'free'}">
                <i data-lucide="user"></i>
            </div>
            <div class="row-main">
                <div class="row-title">Retiro ${escapeHTML(w.partner_name)}</div>
                <div class="row-sub">
                    <span>${w.date}</span>
                    ${w.notes ? `<span>• ${escapeHTML(w.notes)}</span>` : ''}
                </div>
            </div>
            <div class="row-right">
                <div class="row-amount text-green">+$${formatNumber(w.amount)}</div>
                <div class="row-actions">
                    <button class="btn-icon" onclick="editWithdrawal('${w.id}')" title="Editar"><i data-lucide="edit-2"></i></button>
                    <button class="btn-icon btn-icon-del" onclick="deleteWithdrawal('${w.id}')" title="Eliminar"><i data-lucide="trash-2"></i></button>
                </div>
            </div>
        </div>
    `).join('');

    lucide.createIcons();
}

function openWithdrawalModal() {
    document.getElementById('form-withdrawal').reset();
    document.getElementById('withdrawal-id').value = '';
    document.getElementById('modal-withdrawal-title').textContent = 'Registrar Retiro de Utilidades';
    document.getElementById('with-date').value = new Date().toISOString().split('T')[0];
    openModal('modal-withdrawal');
}

function editWithdrawal(id) {
    const w = state.withdrawals.find(item => item.id === id);
    if (!w) return;

    document.getElementById('withdrawal-id').value = w.id;
    document.getElementById('with-partner').value = w.partner_name;
    document.getElementById('with-amount').value = w.amount;
    document.getElementById('with-date').value = w.date;
    document.getElementById('with-notes').value = w.notes || '';
    document.getElementById('modal-withdrawal-title').textContent = 'Editar Retiro de Utilidades';
    openModal('modal-withdrawal');
}

async function saveWithdrawal(e) {
    e.preventDefault();
    const id = document.getElementById('withdrawal-id').value;
    const payload = {
        partner_name: document.getElementById('with-partner').value,
        amount: parseFloat(document.getElementById('with-amount').value),
        date: document.getElementById('with-date').value,
        notes: document.getElementById('with-notes').value.trim()
    };

    try {
        let res;
        if (id) {
            res = await supabaseClient.from('partner_withdrawals').update(payload).eq('id', id);
        } else {
            res = await supabaseClient.from('partner_withdrawals').insert([payload]);
        }

        if (res.error) throw res.error;

        closeModal('modal-withdrawal');
        showToast(id ? 'Retiro actualizado' : 'Retiro registrado con éxito', 'success');
        await refreshAllData();
    } catch (err) {
        showToast('Error al guardar retiro: ' + err.message, 'error');
    }
}

async function deleteWithdrawal(id) {
    if (!confirm('¿Eliminar este retiro?')) return;
    try {
        const { error } = await supabaseClient.from('partner_withdrawals').delete().eq('id', id);
        if (error) throw error;
        showToast('Retiro eliminado', 'success');
        await refreshAllData();
    } catch (err) {
        showToast('Error: ' + err.message, 'error');
    }
}

// INCOME CRUD
function renderIncomeList() {
    const search = (document.getElementById('income-search')?.value || '').toLowerCase();
    const status = document.getElementById('filter-income-status')?.value || 'all';
    const partner = document.getElementById('filter-income-partner')?.value || 'all';

    const periodIncome = filterByPeriod(state.income);
    const totalCollected = periodIncome.filter(i => i.status === 'cobrado' || !i.status).reduce((s, i) => s + Number(i.amount), 0);
    const totalPending = periodIncome.filter(i => i.status === 'pendiente').reduce((s, i) => s + Number(i.amount), 0);
    const pendingCount = periodIncome.filter(i => i.status === 'pendiente').length;
    const totalGross = totalCollected + totalPending;

    const elCol = document.getElementById('inc-summary-collected');
    const elColCount = document.getElementById('inc-summary-collected-count');
    const elPend = document.getElementById('inc-summary-pending');
    const elPendCount = document.getElementById('inc-summary-pending-count');
    const elGross = document.getElementById('inc-summary-gross');
    const elGrossCount = document.getElementById('inc-summary-gross-count');

    if (elCol) elCol.textContent = formatUSD(totalCollected);
    if (elColCount) elColCount.textContent = `${periodIncome.filter(i => i.status === 'cobrado' || !i.status).length} cobros realizados`;
    if (elPend) elPend.textContent = formatUSD(totalPending);
    if (elPendCount) elPendCount.textContent = `${pendingCount} facturas pendientes`;
    if (elGross) elGross.textContent = formatUSD(totalGross);
    if (elGrossCount) elGrossCount.textContent = `${periodIncome.length} facturaciones en total`;

    const container = document.getElementById('income-table-body');
    if (!container) return;

    const filtered = state.income.filter(item => {
        const matchSearch = item.client_name.toLowerCase().includes(search) ||
                            (item.description && item.description.toLowerCase().includes(search));
        const matchStatus = status === 'all' || (item.status || 'cobrado') === status;
        const matchPartner = partner === 'all' || item.created_by === partner;
        return matchSearch && matchStatus && matchPartner;
    });

    if (filtered.length === 0) {
        container.innerHTML = `<div class="empty-state">No se encontraron cobros registrados con los filtros aplicados.</div>`;
        return;
    }

    container.innerHTML = filtered.map(inc => {
        const isPending = inc.status === 'pendiente';
        return `
        <div class="row">
            <div class="row-icon-wrap icon-inc">
                <i data-lucide="${isPending ? 'clock' : 'dollar-sign'}"></i>
            </div>
            <div class="row-main">
                <div class="row-title">
                    ${escapeHTML(inc.client_name)}
                    <span class="badge-status ${isPending ? 'badge-pending' : 'badge-paid'}">${isPending ? 'Pendiente' : 'Cobrado'}</span>
                </div>
                <div class="row-sub">
                    <span>${inc.date}</span>
                    <span>•</span>
                    <span class="partner-tag ${inc.created_by === 'Franco' ? 'tag-f' : 'tag-a'}">${inc.created_by || 'Flowix'}</span>
                    ${inc.description ? `<span>• ${escapeHTML(inc.description)}</span>` : ''}
                </div>
            </div>
            <div class="row-right">
                <div class="row-amount ${isPending ? 'text-amber' : 'text-green'}">+$${formatNumber(inc.amount)}</div>
                <div class="row-actions">
                    ${isPending ? 
                        `<button class="btn-icon btn-icon-check" onclick="toggleIncomeStatus('${inc.id}', 'cobrado')" title="Marcar como Cobrado"><i data-lucide="check-circle-2"></i></button>` : 
                        `<button class="btn-icon btn-icon-undo" onclick="toggleIncomeStatus('${inc.id}', 'pendiente')" title="Revertir a Pendiente"><i data-lucide="rotate-ccw"></i></button>`
                    }
                    <button class="btn-icon" onclick="editIncome('${inc.id}')" title="Editar"><i data-lucide="edit-2"></i></button>
                    <button class="btn-icon btn-icon-del" onclick="deleteIncome('${inc.id}')" title="Eliminar"><i data-lucide="trash-2"></i></button>
                </div>
            </div>
        </div>
        `;
    }).join('');

    lucide.createIcons();
}

async function toggleIncomeStatus(id, newStatus) {
    try {
        const inc = state.income.find(i => i.id === id);
        if (!inc) return;

        const { error } = await supabaseClient.from('income').update({ status: newStatus }).eq('id', id);
        if (error) throw error;

        showToast(`Facturación de ${escapeHTML(inc.client_name)} marcada como ${newStatus === 'cobrado' ? 'COBRADA' : 'PENDIENTE'}`, 'success');
        await refreshAllData();
    } catch (err) {
        showToast('Error al actualizar estado: ' + err.message, 'error');
    }
}

async function toggleExpenseStatus(id, newStatus) {
    try {
        const exp = state.expenses.find(e => e.id === id);
        if (!exp) return;

        const { error } = await supabaseClient.from('expenses').update({ status: newStatus }).eq('id', id);
        if (error) throw error;

        showToast(`Gasto "${escapeHTML(exp.title)}" marcado como ${newStatus === 'pagado' ? 'PAGADO' : 'PENDIENTE'}`, 'success');
        await refreshAllData();
    } catch (err) {
        showToast('Error al actualizar estado: ' + err.message, 'error');
    }
}

function openIncomeModal() {
    document.getElementById('form-income').reset();
    document.getElementById('income-id').value = '';
    document.getElementById('modal-income-title').textContent = 'Registrar Cobro / Facturación';
    document.getElementById('inc-date').value = new Date().toISOString().split('T')[0];
    openModal('modal-income');
}

function editIncome(id) {
    const inc = state.income.find(item => item.id === id);
    if (!inc) return;

    document.getElementById('income-id').value = inc.id;
    document.getElementById('inc-client').value = inc.client_name;
    document.getElementById('inc-amount').value = inc.amount;
    document.getElementById('inc-date').value = inc.date;
    document.getElementById('inc-status').value = inc.status || 'cobrado';
    document.getElementById('inc-partner').value = inc.created_by || 'Franco';
    document.getElementById('inc-desc').value = inc.description || '';
    document.getElementById('modal-income-title').textContent = 'Editar Cobro / Facturación';
    openModal('modal-income');
}

async function saveIncome(e) {
    e.preventDefault();
    const id = document.getElementById('income-id').value;
    const payload = {
        client_name: document.getElementById('inc-client').value.trim(),
        amount: parseFloat(document.getElementById('inc-amount').value),
        date: document.getElementById('inc-date').value,
        status: document.getElementById('inc-status').value,
        created_by: document.getElementById('inc-partner').value,
        description: document.getElementById('inc-desc').value.trim()
    };

    try {
        let res;
        if (id) {
            res = await supabaseClient.from('income').update(payload).eq('id', id);
        } else {
            res = await supabaseClient.from('income').insert([payload]);
        }

        if (res.error) throw res.error;

        closeModal('modal-income');
        showToast(id ? 'Ingreso actualizado con éxito' : 'Ingreso registrado con éxito', 'success');
        await refreshAllData();
    } catch (err) {
        showToast('Error al guardar ingreso: ' + err.message, 'error');
    }
}

async function deleteIncome(id) {
    if (!confirm('¿Eliminar este cobro?')) return;
    try {
        const { error } = await supabaseClient.from('income').delete().eq('id', id);
        if (error) throw error;
        showToast('Ingreso eliminado', 'success');
        await refreshAllData();
    } catch (err) {
        showToast('Error: ' + err.message, 'error');
    }
}

// GENERADOR DE REPORTE PDF EJECUTIVO
function generateExecutivePDF() {
    try {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

        const periodName = document.getElementById('period-display-label').textContent;
        const filteredExpenses = filterByPeriod(state.expenses);
        const filteredIncome = filterByPeriod(state.income);
        const filteredWithdrawals = filterByPeriod(state.withdrawals);

        const totalIncome = filteredIncome.reduce((s, i) => s + Number(i.amount), 0);
        const totalExpenses = filteredExpenses.reduce((s, e) => s + Number(e.amount), 0);
        const netProfit = totalIncome - totalExpenses;
        const marginPct = totalIncome > 0 ? ((netProfit / totalIncome) * 100).toFixed(1) : 0;

        // Background & Header
        doc.setFillColor(5, 5, 8);
        doc.rect(0, 0, 210, 38, 'F');

        doc.setTextColor(0, 204, 106);
        doc.setFontSize(22);
        doc.setFont('helvetica', 'bold');
        doc.text('FLOWIX AGENCY', 16, 18);

        doc.setTextColor(255, 255, 255);
        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');
        doc.text('Informe Financiero Ejecutivo', 16, 26);
        doc.text(`Periodo: ${periodName}`, 145, 18);
        doc.text(`Emitido: ${new Date().toLocaleDateString('es-ES')}`, 145, 26);

        // Executive KPI Boxes
        let startY = 48;
        doc.setTextColor(40, 40, 40);
        doc.setFontSize(12);
        doc.setFont('helvetica', 'bold');
        doc.text('1. Resumen Ejecutivo del Periodo', 16, startY);

        const kpiData = [
            ['Facturación Bruta (Ingresos)', `$${formatNumber(totalIncome)} USD`],
            ['Gastos Operativos Totales', `$${formatNumber(totalExpenses)} USD`],
            ['Ganancia Neta Disponible', `$${formatNumber(netProfit)} USD (Margen: ${marginPct}%)`],
            ['Retiros Franco', `$${formatNumber(filteredWithdrawals.filter(w => w.partner_name === 'Franco').reduce((s, w) => s + Number(w.amount), 0))} USD`],
            ['Retiros Agustín', `$${formatNumber(filteredWithdrawals.filter(w => w.partner_name === 'Agustin').reduce((s, w) => s + Number(w.amount), 0))} USD`]
        ];

        doc.autoTable({
            startY: startY + 4,
            head: [['Indicador Clave', 'Monto en USD']],
            body: kpiData,
            theme: 'striped',
            headStyles: { fillColor: [0, 204, 106], textColor: [0, 0, 0], fontStyle: 'bold' },
            styles: { font: 'helvetica', fontSize: 10, cellPadding: 4 }
        });

        // Detailed Expenses Table
        const expensesTableData = filteredExpenses.map(e => [
            e.date,
            e.title,
            getCategoryLabel(e.category),
            e.created_by,
            `$${formatNumber(e.amount)}`
        ]);

        doc.text('2. Desglose Detallado de Gastos', 16, doc.lastAutoTable.finalY + 14);

        doc.autoTable({
            startY: doc.lastAutoTable.finalY + 18,
            head: [['Fecha', 'Concepto', 'Pilar / Categoría', 'Responsable', 'Monto USD']],
            body: expensesTableData.length > 0 ? expensesTableData : [['-', 'Sin gastos registrados', '-', '-', '$0.00']],
            theme: 'grid',
            headStyles: { fillColor: [26, 29, 40], textColor: [255, 255, 255] },
            styles: { font: 'helvetica', fontSize: 9, cellPadding: 3.5 }
        });

        doc.save(`Flowix_Finanzas_${periodName.replace(/\s+/g, '_')}.pdf`);
        showToast('Reporte PDF descargado con éxito', 'success');
    } catch (err) {
        showToast('Error generando PDF: ' + err.message, 'error');
    }
}

// EXPORT TO CSV
function exportDataToCSV(type) {
    let headers = [];
    let rows = [];
    let filename = `flowix_${type}_${new Date().toISOString().split('T')[0]}.csv`;

    if (type === 'expenses') {
        headers = ['ID', 'Fecha', 'Titulo', 'Categoria', 'Monto_USD', 'Estado', 'Responsable', 'Metodo', 'Notas'];
        rows = state.expenses.map(e => [e.id, e.date, `"${e.title}"`, e.category, e.amount, e.status, e.created_by, `"${e.payment_method || ''}"`, `"${e.notes || ''}"`]);
    } else if (type === 'freelancers') {
        headers = ['ID', 'Nombre', 'Rol', 'Contacto', 'Datos_Pago', 'Fecha_Alta'];
        rows = state.freelancers.map(f => [f.id, `"${f.name}"`, `"${f.role}"`, `"${f.contact_info || ''}"`, `"${f.payment_details || ''}"`, f.created_at]);
    } else if (type === 'withdrawals') {
        headers = ['ID', 'Fecha', 'Socio', 'Monto_USD', 'Notas'];
        rows = state.withdrawals.map(w => [w.id, w.date, w.partner_name, w.amount, `"${w.notes || ''}"`]);
    } else if (type === 'income') {
        headers = ['ID', 'Fecha', 'Cliente', 'Monto_USD', 'Estado', 'Responsable', 'Descripcion'];
        rows = state.income.map(i => [i.id, i.date, `"${i.client_name}"`, i.amount, i.status, i.created_by, `"${i.description || ''}"`]);
    }

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast(`Archivo CSV descargado`, 'success');
}

// UI Helpers
function openModal(id) {
    const modal = document.getElementById(id);
    if (modal) modal.classList.add('active');
}

function closeModal(id) {
    const modal = document.getElementById(id);
    if (modal) modal.classList.remove('active');
}

function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `<i data-lucide="${type === 'success' ? 'check-circle' : 'alert-circle'}"></i> <span>${escapeHTML(message)}</span>`;
    container.appendChild(toast);
    lucide.createIcons();

    setTimeout(() => {
        toast.remove();
    }, 3500);
}

function formatUSD(num) {
    return '$' + Number(num || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatNumber(num) {
    return Number(num || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function getCategoryIcon(cat) {
    switch(cat) {
        case 'infraestructura': return 'server';
        case 'publicidad': return 'trending-up';
        case 'freelancer': return 'users';
        default: return 'tag';
    }
}

function getCatClass(cat) {
    switch(cat) {
        case 'infraestructura': return 'infra';
        case 'publicidad': return 'ads';
        case 'freelancer': return 'free';
        default: return 'other';
    }
}

function getCategoryLabel(cat) {
    switch(cat) {
        case 'infraestructura': return 'Infraestructura & SaaS';
        case 'publicidad': return 'Publicidad (Ads)';
        case 'freelancer': return 'Freelancer';
        default: return 'Otros Gastos';
    }
}

function escapeHTML(str) {
    if (!str) return '';
    return String(str).replace(/[&<>'"]/g, tag => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        "'": '&#39;',
        '"': '&quot;'
    }[tag] || tag));
}

// Expose globals for HTML inline events
window.openExpenseModal = openExpenseModal;
window.editExpense = editExpense;
window.deleteExpense = deleteExpense;
window.saveExpense = saveExpense;
window.handleCategoryChange = handleCategoryChange;
window.handleFileSelected = handleFileSelected;
window.viewReceipt = viewReceipt;

window.openSettlementModal = openSettlementModal;
window.updateSettlementPreview = updateSettlementPreview;
window.executeAutoSettlement = executeAutoSettlement;

window.openFreelancerModal = openFreelancerModal;
window.editFreelancer = editFreelancer;
window.deleteFreelancer = deleteFreelancer;
window.saveFreelancer = saveFreelancer;
window.payFreelancerQuick = payFreelancerQuick;

window.openWithdrawalModal = openWithdrawalModal;
window.editWithdrawal = editWithdrawal;
window.saveWithdrawal = saveWithdrawal;
window.deleteWithdrawal = deleteWithdrawal;

window.openIncomeModal = openIncomeModal;
window.editIncome = editIncome;
window.saveIncome = saveIncome;
window.deleteIncome = deleteIncome;

window.shiftPeriod = shiftPeriod;
window.refreshAllData = refreshAllData;
window.generateExecutivePDF = generateExecutivePDF;
window.exportDataToCSV = exportDataToCSV;
window.switchTab = switchTab;
window.openModal = openModal;
window.closeModal = closeModal;

// =========================================================
// LIVE QUOTES & FINTECH CONVERTER LOGIC
// =========================================================

async function fetchLiveQuotes(showFeedback = false) {
    const refreshBtn = document.querySelector('.btn-mq-refresh');
    if (refreshBtn) refreshBtn.classList.add('spinning');

    try {
        const response = await fetch('https://dolarapi.com/v1/dolares');
        if (!response.ok) throw new Error('HTTP ' + response.status);
        const data = await response.json();

        // Process rates from DolarApi
        data.forEach(item => {
            const key = item.casa ? item.casa.toLowerCase() : '';
            if (key === 'blue') {
                state.exchangeRates.blue = {
                    compra: Number(item.compra) || state.exchangeRates.blue.compra,
                    venta: Number(item.venta) || state.exchangeRates.blue.venta
                };
            } else if (key === 'cripto') {
                state.exchangeRates.cripto = {
                    compra: Number(item.compra) || state.exchangeRates.cripto.compra,
                    venta: Number(item.venta) || state.exchangeRates.cripto.venta
                };
            } else if (key === 'bolsa') {
                state.exchangeRates.bolsa = {
                    compra: Number(item.compra) || state.exchangeRates.bolsa.compra,
                    venta: Number(item.venta) || state.exchangeRates.bolsa.venta
                };
            } else if (key === 'oficial') {
                state.exchangeRates.oficial = {
                    compra: Number(item.compra) || state.exchangeRates.oficial.compra,
                    venta: Number(item.venta) || state.exchangeRates.oficial.venta
                };
            } else if (key === 'tarjeta') {
                state.exchangeRates.tarjeta = {
                    compra: Number(item.compra) || 0,
                    venta: Number(item.venta) || state.exchangeRates.tarjeta.venta
                };
            }
        });

        state.exchangeRates.lastUpdate = new Date();
        renderMarketQuotes();
        updateConverterPills();
        updateConverterCalculations();

        if (showFeedback) {
            showToast('Cotizaciones actualizadas en vivo', 'success');
        }
    } catch (err) {
        console.warn('Error fetching DolarAPI, falling back to local cached rates:', err);
        renderMarketQuotes();
        if (showFeedback) {
            showToast('Cotizaciones cargadas en modo local', 'success');
        }
    } finally {
        if (refreshBtn) {
            setTimeout(() => refreshBtn.classList.remove('spinning'), 600);
        }
    }
}

function renderMarketQuotes() {
    const rates = state.exchangeRates;
    
    // Header ticker badge
    const headerTxt = document.getElementById('header-rate-txt');
    if (headerTxt) {
        headerTxt.textContent = `Blue $${formatNumber(rates.blue.venta)}`;
    }

    // Dashboard market ribbon
    const qbVenta = document.getElementById('quote-blue-venta');
    const qbCompra = document.getElementById('quote-blue-compra');
    if (qbVenta) qbVenta.textContent = `$${formatNumber(rates.blue.venta)}`;
    if (qbCompra) qbCompra.textContent = `$${formatNumber(rates.blue.compra)}`;

    const qcVenta = document.getElementById('quote-cripto-venta');
    const qcCompra = document.getElementById('quote-cripto-compra');
    if (qcVenta) qcVenta.textContent = `$${formatNumber(rates.cripto.venta)}`;
    if (qcCompra) qcCompra.textContent = `$${formatNumber(rates.cripto.compra)}`;

    const qmVenta = document.getElementById('quote-mep-venta');
    const qmCompra = document.getElementById('quote-mep-compra');
    if (qmVenta) qmVenta.textContent = `$${formatNumber(rates.bolsa.venta)}`;
    if (qmCompra) qmCompra.textContent = `$${formatNumber(rates.bolsa.compra)}`;

    const qoVenta = document.getElementById('quote-oficial-venta');
    const qtVenta = document.getElementById('quote-tarjeta-venta');
    if (qoVenta) qoVenta.textContent = `$${formatNumber(rates.oficial.venta)}`;
    if (qtVenta) qtVenta.textContent = `$${formatNumber(rates.tarjeta.venta)}`;

    const updatedLbl = document.getElementById('quotes-updated-lbl');
    if (updatedLbl && rates.lastUpdate) {
        const timeStr = rates.lastUpdate.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
        updatedLbl.textContent = `Actualizado ${timeStr}`;
    }
}

function updateConverterPills() {
    const rates = state.exchangeRates;
    const op = state.converterState.activeOpType;

    const pBlue = document.getElementById('pill-rate-blue');
    const pCripto = document.getElementById('pill-rate-cripto');
    const pBolsa = document.getElementById('pill-rate-bolsa');
    const pTarjeta = document.getElementById('pill-rate-tarjeta');
    const pOficial = document.getElementById('pill-rate-oficial');

    if (pBlue) pBlue.textContent = `$${formatNumber(rates.blue[op] || rates.blue.venta)}`;
    if (pCripto) pCripto.textContent = `$${formatNumber(rates.cripto[op] || rates.cripto.venta)}`;
    if (pBolsa) pBolsa.textContent = `$${formatNumber(rates.bolsa[op] || rates.bolsa.venta)}`;
    if (pTarjeta) pTarjeta.textContent = `$${formatNumber(rates.tarjeta.venta)}`;
    if (pOficial) pOficial.textContent = `$${formatNumber(rates.oficial[op] || rates.oficial.venta)}`;
}

function getActiveExchangeRate() {
    const rateType = state.converterState.activeRateType;
    const op = state.converterState.activeOpType;
    const rates = state.exchangeRates;

    if (rateType === 'tarjeta') return rates.tarjeta.venta || 2156;
    if (rates[rateType] && rates[rateType][op]) {
        return rates[rateType][op];
    }
    return rates.blue.venta || 1560;
}

function setConverterRateType(rateType) {
    state.converterState.activeRateType = rateType;
    document.querySelectorAll('.rate-pill').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-rate-type') === rateType);
    });
    updateConverterCalculations();
}

function setConverterOpType(opType) {
    state.converterState.activeOpType = opType;
    const btnVenta = document.getElementById('op-btn-venta');
    const btnCompra = document.getElementById('op-btn-compra');
    if (btnVenta) btnVenta.classList.toggle('active', opType === 'venta');
    if (btnCompra) btnCompra.classList.toggle('active', opType === 'compra');

    updateConverterPills();
    updateConverterCalculations();
}

function openConverterModal(initialUSD = 100, targetRate = 'blue') {
    if (targetRate) {
        state.converterState.activeRateType = targetRate;
        document.querySelectorAll('.rate-pill').forEach(btn => {
            btn.classList.toggle('active', btn.getAttribute('data-rate-type') === targetRate);
        });
    }

    const usd = Number(initialUSD) || 100;
    state.converterState.usdValue = usd;
    const usdInput = document.getElementById('conv-usd-input');
    if (usdInput) usdInput.value = usd;

    updateConverterCalculations();
    openModal('modal-converter');
    lucide.createIcons();
}

function handleUSDInput(val) {
    const num = parseFloat(val);
    if (isNaN(num) || num < 0) {
        state.converterState.usdValue = 0;
        state.converterState.arsValue = 0;
        const arsInput = document.getElementById('conv-ars-input');
        if (arsInput) arsInput.value = '';
        renderComparisonCards(0);
        return;
    }

    state.converterState.usdValue = num;
    const rate = getActiveExchangeRate();
    const ars = num * rate;
    state.converterState.arsValue = ars;

    const arsInput = document.getElementById('conv-ars-input');
    if (arsInput) arsInput.value = Math.round(ars * 100) / 100;

    renderComparisonCards(num);
}

function handleARSInput(val) {
    const num = parseFloat(val);
    if (isNaN(num) || num < 0) {
        state.converterState.arsValue = 0;
        state.converterState.usdValue = 0;
        const usdInput = document.getElementById('conv-usd-input');
        if (usdInput) usdInput.value = '';
        renderComparisonCards(0);
        return;
    }

    state.converterState.arsValue = num;
    const rate = getActiveExchangeRate();
    const usd = rate > 0 ? num / rate : 0;
    state.converterState.usdValue = usd;

    const usdInput = document.getElementById('conv-usd-input');
    if (usdInput) usdInput.value = Math.round(usd * 100) / 100;

    renderComparisonCards(usd);
}

function updateConverterCalculations() {
    const rate = getActiveExchangeRate();
    const rateDisplay = document.getElementById('active-rate-value');
    if (rateDisplay) {
        rateDisplay.textContent = `$${formatNumber(rate)} ARS`;
    }

    const usd = state.converterState.usdValue;
    const ars = usd * rate;
    state.converterState.arsValue = ars;

    const usdInput = document.getElementById('conv-usd-input');
    const arsInput = document.getElementById('conv-ars-input');

    if (usdInput) usdInput.value = usd || '';
    if (arsInput) arsInput.value = ars ? (Math.round(ars * 100) / 100) : '';

    renderComparisonCards(usd);
}

function renderComparisonCards(usd) {
    const rates = state.exchangeRates;
    const op = state.converterState.activeOpType;

    const rateBlue = rates.blue[op] || rates.blue.venta;
    const rateCripto = rates.cripto[op] || rates.cripto.venta;
    const rateBolsa = rates.bolsa[op] || rates.bolsa.venta;
    const rateOficial = rates.oficial[op] || rates.oficial.venta;

    const elBlue = document.getElementById('comp-ars-blue');
    const elCripto = document.getElementById('comp-ars-cripto');
    const elBolsa = document.getElementById('comp-ars-bolsa');
    const elOficial = document.getElementById('comp-ars-oficial');

    const rateBlueLbl = document.getElementById('comp-rate-blue');
    const rateCriptoLbl = document.getElementById('comp-rate-cripto');
    const rateBolsaLbl = document.getElementById('comp-rate-bolsa');
    const rateOficialLbl = document.getElementById('comp-rate-oficial');

    if (elBlue) elBlue.textContent = `$${formatNumber(usd * rateBlue)} ARS`;
    if (elCripto) elCripto.textContent = `$${formatNumber(usd * rateCripto)} ARS`;
    if (elBolsa) elBolsa.textContent = `$${formatNumber(usd * rateBolsa)} ARS`;
    if (elOficial) elOficial.textContent = `$${formatNumber(usd * rateOficial)} ARS`;

    if (rateBlueLbl) rateBlueLbl.textContent = `@ $${formatNumber(rateBlue)}`;
    if (rateCriptoLbl) rateCriptoLbl.textContent = `@ $${formatNumber(rateCripto)}`;
    if (rateBolsaLbl) rateBolsaLbl.textContent = `@ $${formatNumber(rateBolsa)}`;
    if (rateOficialLbl) rateOficialLbl.textContent = `@ $${formatNumber(rateOficial)}`;
}

function quickAddUSD(amount) {
    const current = Number(state.converterState.usdValue) || 0;
    const next = current + amount;
    const input = document.getElementById('conv-usd-input');
    if (input) input.value = next;
    handleUSDInput(next);
}

function quickAddARS(amount) {
    const current = Number(state.converterState.arsValue) || 0;
    const next = current + amount;
    const input = document.getElementById('conv-ars-input');
    if (input) input.value = next;
    handleARSInput(next);
}

function clearConverterInputs() {
    state.converterState.usdValue = 0;
    state.converterState.arsValue = 0;
    const usdInput = document.getElementById('conv-usd-input');
    const arsInput = document.getElementById('conv-ars-input');
    if (usdInput) usdInput.value = '';
    if (arsInput) arsInput.value = '';
    renderComparisonCards(0);
}

function toggleConverterDirection() {
    const arsInput = document.getElementById('conv-ars-input');
    if (arsInput) arsInput.focus();
}

function copyConverterUSD() {
    const val = Number(state.converterState.usdValue) || 0;
    navigator.clipboard.writeText(val.toFixed(2)).then(() => {
        showToast(`Copiado: $${val.toFixed(2)} USD`, 'success');
    }).catch(() => {
        showToast('No se pudo copiar al portapapeles', 'error');
    });
}

function copyConverterARS() {
    const val = Number(state.converterState.arsValue) || 0;
    navigator.clipboard.writeText(Math.round(val).toLocaleString('es-AR')).then(() => {
        showToast(`Copiado: $${Math.round(val).toLocaleString('es-AR')} ARS`, 'success');
    }).catch(() => {
        showToast('No se pudo copiar al portapapeles', 'error');
    });
}

function applyConverterToExpense() {
    const usd = Number(state.converterState.usdValue) || 0;
    closeModal('modal-converter');
    openExpenseModal();
    if (usd > 0) {
        document.getElementById('exp-amount').value = usd.toFixed(2);
        showToast(`Monto $${usd.toFixed(2)} USD aplicado al gasto`, 'success');
    }
}

function applyConverterToIncome() {
    const usd = Number(state.converterState.usdValue) || 0;
    closeModal('modal-converter');
    openIncomeModal();
    if (usd > 0) {
        document.getElementById('inc-amount').value = usd.toFixed(2);
        showToast(`Monto $${usd.toFixed(2)} USD aplicado a la facturación`, 'success');
    }
}

// INLINE ARS CONVERTER FOR FORMS
function openInlineConverter(targetInputId) {
    state.converterState.inlineTargetInputId = targetInputId;
    const input = document.getElementById('inline-ars-input');
    if (input) input.value = '';
    updateInlineArsCalculation();
    openModal('modal-inline-ars');
}

function updateInlineArsCalculation() {
    const ars = parseFloat(document.getElementById('inline-ars-input')?.value) || 0;
    const rateType = document.getElementById('inline-ars-rate-select')?.value || 'blue';
    const rates = state.exchangeRates;
    
    let rate = 1560;
    if (rateType === 'tarjeta') rate = rates.tarjeta.venta || 2156;
    else if (rates[rateType]) rate = rates[rateType].venta || 1560;

    const usd = rate > 0 ? (ars / rate) : 0;

    const resEl = document.getElementById('inline-calc-usd-result');
    const infoEl = document.getElementById('inline-calc-rate-info');

    if (resEl) resEl.textContent = `$${usd.toFixed(2)} USD`;
    if (infoEl) infoEl.textContent = `Tipo de cambio: 1 USD = $${formatNumber(rate)} ARS (${rateType.toUpperCase()})`;
}

function confirmInlineArsConversion() {
    const ars = parseFloat(document.getElementById('inline-ars-input')?.value) || 0;
    const rateType = document.getElementById('inline-ars-rate-select')?.value || 'blue';
    const rates = state.exchangeRates;
    
    let rate = 1560;
    if (rateType === 'tarjeta') rate = rates.tarjeta.venta || 2156;
    else if (rates[rateType]) rate = rates[rateType].venta || 1560;

    const usd = rate > 0 ? (ars / rate) : 0;
    const targetId = state.converterState.inlineTargetInputId;

    if (targetId && document.getElementById(targetId)) {
        document.getElementById(targetId).value = usd.toFixed(2);
        showToast(`Calculado: $${usd.toFixed(2)} USD ($${formatNumber(ars)} ARS @ $${formatNumber(rate)})`, 'success');
    }

    closeModal('modal-inline-ars');
}

// Expose Converter Functions Globally
window.fetchLiveQuotes = fetchLiveQuotes;
window.openConverterModal = openConverterModal;
window.setConverterRateType = setConverterRateType;
window.setConverterOpType = setConverterOpType;
window.handleUSDInput = handleUSDInput;
window.handleARSInput = handleARSInput;
window.quickAddUSD = quickAddUSD;
window.quickAddARS = quickAddARS;
window.clearConverterInputs = clearConverterInputs;
window.toggleConverterDirection = toggleConverterDirection;
window.copyConverterUSD = copyConverterUSD;
window.copyConverterARS = copyConverterARS;
window.applyConverterToExpense = applyConverterToExpense;
window.applyConverterToIncome = applyConverterToIncome;
window.openInlineConverter = openInlineConverter;
window.updateInlineArsCalculation = updateInlineArsCalculation;
window.confirmInlineArsConversion = confirmInlineArsConversion;

window.toggleIncomeStatus = toggleIncomeStatus;
window.toggleExpenseStatus = toggleExpenseStatus;
