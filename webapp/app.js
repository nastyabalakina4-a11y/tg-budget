// Mini App «Бюджет на двоих». Чистый JS без сборки.
'use strict';

const tg = window.Telegram && window.Telegram.WebApp;
const $ = (sel) => document.querySelector(sel);

const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль',
  'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const AVATAR_COLORS = ['#e17076', '#7bc862', '#65aadd', '#a695e7', '#ee7aae', '#6ec9cb', '#faa774'];
const REFRESH_MS = 15000; // как часто подтягивать изменения партнёра
const API_URL = ((window.APP_CONFIG && window.APP_CONFIG.apiUrl) || '').replace(/\/$/, '');

const state = {
  meta: null,
  month: monthKey(new Date()),
  data: null,
  tab: 'list',
  kind: 'expense',
  category: null,
  saving: false,
};

// ---------- утилиты ----------
function pad(n) { return String(n).padStart(2, '0'); }
function monthKey(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; }
function todayISO() { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function shiftMonth(key, delta) {
  const [y, m] = key.split('-').map(Number);
  return monthKey(new Date(y, m - 1 + delta, 1));
}
function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const numberFmt = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });
function money(v) { return `${numberFmt.format(v)} ${state.meta ? state.meta.currency : ''}`.trim(); }
function signed(tx) { return (tx.kind === 'income' ? '+' : '−') + money(tx.amount); }
function avatarColor(id) { return AVATAR_COLORS[Math.abs(id) % AVATAR_COLORS.length]; }
function dayTitle(iso) {
  const d = new Date(iso + 'T00:00:00');
  const today = todayISO();
  const y = new Date(); y.setDate(y.getDate() - 1);
  if (iso === today) return 'Сегодня';
  if (iso === `${y.getFullYear()}-${pad(y.getMonth() + 1)}-${pad(y.getDate())}`) return 'Вчера';
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', weekday: 'short' });
}

// Когда и во сколько добавлена запись (в часовом поясе телефона).
// Если запись внесли задним числом — показываем и дату добавления.
function addedAt(tx) {
  const d = new Date(tx.created_at);
  if (Number.isNaN(d.getTime())) return '';
  const time = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  const localDay = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  if (localDay === tx.date) return time;
  return `${d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })} в ${time}`;
}

function haptic(type) {
  try { tg.HapticFeedback.notificationOccurred(type); } catch (_) { /* старый клиент */ }
}
function toast(text) {
  const el = $('#toast');
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { el.hidden = true; }, 2500);
}
function confirmDialog(text) {
  return new Promise((resolve) => {
    if (tg && tg.showConfirm && tg.isVersionAtLeast && tg.isVersionAtLeast('6.2')) tg.showConfirm(text, resolve);
    else resolve(window.confirm(text));
  });
}

// ---------- API ----------
async function api(path, options = {}) {
  const res = await fetch(API_URL + path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-Telegram-Init-Data': tg.initData, // сервер проверит подпись Telegram
      ...(options.headers || {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body.error || `Ошибка ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return body;
}

async function load(silent = false) {
  const month = state.month;
  try {
    const data = await api(`/api/month?month=${month}`);
    if (month !== state.month) return; // пока грузили, пользователь переключил месяц
    state.data = data;
    render();
  } catch (e) {
    if (!silent) toast(e.message);
  }
}

// ---------- отрисовка ----------
function render() {
  const [y, m] = state.month.split('-').map(Number);
  $('#monthTitle').textContent = `${MONTHS[m - 1]} ${y}`;
  $('#nextMonth').disabled = state.month >= monthKey(new Date());
  $('#nextMonth').style.visibility = $('#nextMonth').disabled ? 'hidden' : 'visible';

  if (!state.data) return;
  const s = state.data.summary;
  $('#sumIncome').textContent = money(s.income);
  $('#sumExpense').textContent = money(s.expense);
  const bal = $('#sumBalance');
  bal.textContent = (s.balance > 0 ? '+' : s.balance < 0 ? '−' : '') + money(Math.abs(s.balance));
  bal.className = s.balance > 0 ? 'income' : s.balance < 0 ? 'expense' : '';

  renderList();
  renderStats();
}

function renderList() {
  const txs = state.data.transactions;
  const root = $('#tab-list');
  if (!txs.length) {
    root.innerHTML = '<div class="empty">В этом месяце пока пусто.<br>Нажмите «+», чтобы добавить операцию.</div>';
    return;
  }
  const groups = new Map();
  for (const tx of txs) {
    if (!groups.has(tx.date)) groups.set(tx.date, []);
    groups.get(tx.date).push(tx);
  }
  let html = '';
  for (const [day, items] of groups) {
    html += `<div class="day"><h3>${esc(dayTitle(day))}</h3><div class="list">`;
    for (const tx of items) {
      const sub = [tx.user_name, addedAt(tx)].filter(Boolean).map(esc).join(' · ');
      html += `
        <button class="tx" data-id="${tx.id}">
          <span class="avatar" style="background:${avatarColor(tx.user_id)}">${esc((tx.user_name || '?')[0].toUpperCase())}</span>
          <span class="info"><div class="cat">${esc(tx.category)}</div><div class="sub">${sub}</div></span>
          <span class="sum ${tx.kind}">${esc(signed(tx))}</span>
        </button>`;
    }
    html += '</div></div>';
  }
  root.innerHTML = html;
}

function renderStats() {
  const s = state.data.summary;
  const root = $('#tab-stats');
  let html = `
    <div class="block export">
      <h2>Экспорт в Excel</h2>
      <p class="hint">Бот пришлёт файл .xlsx в чат</p>
      <div class="export-actions">
        <button class="btn primary" data-export="month">📄 ${esc(MONTHS[Number(state.month.slice(5)) - 1])}</button>
        <button class="btn secondary" data-export="all">🗂 За всё время</button>
      </div>
    </div>
    <div class="block"><h2>Расходы по категориям</h2>`;
  if (!s.by_category.length) {
    html += '<div class="empty" style="padding:16px">Расходов пока нет</div>';
  } else {
    const max = s.by_category[0].amount;
    for (const c of s.by_category) {
      const pct = s.expense ? Math.round((c.amount / s.expense) * 100) : 0;
      html += `
        <div class="bar-row">
          <div class="top"><span>${esc(c.category)}</span><span>${esc(money(c.amount))} · ${pct}%</span></div>
          <div class="bar"><i style="width:${(c.amount / max) * 100}%"></i></div>
        </div>`;
    }
  }
  html += '</div><div class="block"><h2>Кто сколько</h2>';
  if (!s.by_user.length) {
    html += '<div class="empty" style="padding:16px">Нет данных</div>';
  } else {
    for (const u of s.by_user) {
      html += `
        <div class="user-row">
          <span style="display:flex;align-items:center;gap:8px">
            <span class="avatar" style="background:${avatarColor(u.user_id)}">${esc((u.name || '?')[0].toUpperCase())}</span>
            ${esc(u.name)}
          </span>
          <span class="nums"><div class="expense">−${esc(money(u.expense))}</div><div class="income">+${esc(money(u.income))}</div></span>
        </div>`;
    }
  }
  html += '</div>';
  root.innerHTML = html;
}

// ---------- форма добавления ----------
function renderCategories() {
  const cats = state.meta.categories[state.kind];
  if (!cats.includes(state.category)) state.category = cats[0];
  $('#categories').innerHTML = cats
    .map((c) => `<button type="button" class="chip${c === state.category ? ' active' : ''}" data-cat="${esc(c)}">${esc(c)}</button>`)
    .join('');
}

function setKind(kind) {
  state.kind = kind;
  document.querySelectorAll('#kindSwitch button').forEach((b) => b.classList.toggle('active', b.dataset.kind === kind));
  renderCategories();
}

function openSheet() {
  $('#txForm').reset();
  setKind('expense');
  $('#date').value = todayISO();
  $('#sheet').hidden = false;
  if (tg.BackButton) tg.BackButton.show();
  setTimeout(() => $('#amount').focus(), 50);
}

function closeSheet() {
  $('#sheet').hidden = true;
  if (tg.BackButton) tg.BackButton.hide();
}

async function submitForm(e) {
  e.preventDefault();
  if (state.saving) return;
  const amount = $('#amount').value.replace(/\s/g, '').replace(',', '.');
  if (!amount || !(Number(amount) > 0)) {
    haptic('error');
    toast('Введите сумму больше нуля');
    $('#amount').focus();
    return;
  }
  state.saving = true;
  $('#saveBtn').disabled = true;
  try {
    const tx = await api('/api/transactions', {
      method: 'POST',
      body: JSON.stringify({
        kind: state.kind,
        amount,
        category: state.category,
        date: $('#date').value || todayISO(),
      }),
    });
    haptic('success');
    closeSheet();
    state.month = tx.date.slice(0, 7); // показываем месяц, куда попала запись
    await load();
  } catch (err) {
    haptic('error');
    toast(err.message);
  } finally {
    state.saving = false;
    $('#saveBtn').disabled = false;
  }
}

async function onTxClick(id) {
  const tx = state.data.transactions.find((t) => t.id === id);
  if (!tx) return;
  const when = addedAt(tx);
  const ok = await confirmDialog(`Удалить «${tx.category}» ${signed(tx)}?\nДобавил(а): ${tx.user_name}${when ? ', ' + when : ''}`);
  if (!ok) return;
  try {
    await api(`/api/transactions/${id}`, { method: 'DELETE' });
    haptic('success');
    await load();
  } catch (err) {
    toast(err.message);
  }
}

// ---------- экспорт ----------
async function exportToBot(btn) {
  if (btn.disabled) return;
  const period = btn.dataset.export === 'all' ? 'all' : state.month;
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Отправляю…';
  try {
    const r = await api('/api/export', { method: 'POST', body: JSON.stringify({ period }) });
    haptic('success');
    toast(r.count ? '📄 Таблица отправлена в чат с ботом' : 'Операций нет — отправил пустую таблицу');
  } catch (err) {
    haptic('error');
    toast(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
}

// ---------- запуск ----------
function bindEvents() {
  $('#prevMonth').addEventListener('click', () => { state.month = shiftMonth(state.month, -1); state.data = null; render(); load(); });
  $('#nextMonth').addEventListener('click', () => { state.month = shiftMonth(state.month, 1); state.data = null; render(); load(); });

  document.querySelectorAll('.tab').forEach((btn) => btn.addEventListener('click', () => {
    state.tab = btn.dataset.tab;
    document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b === btn));
    $('#tab-list').hidden = state.tab !== 'list';
    $('#tab-stats').hidden = state.tab !== 'stats';
  }));

  $('#addBtn').addEventListener('click', openSheet);
  document.querySelectorAll('[data-close]').forEach((el) => el.addEventListener('click', closeSheet));
  if (tg.BackButton) tg.BackButton.onClick(closeSheet);

  $('#kindSwitch').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-kind]');
    if (b) setKind(b.dataset.kind);
  });
  $('#categories').addEventListener('click', (e) => {
    const b = e.target.closest('.chip');
    if (!b) return;
    state.category = b.dataset.cat;
    renderCategories();
  });
  $('#txForm').addEventListener('submit', submitForm);

  $('#tab-stats').addEventListener('click', (e) => {
    const b = e.target.closest('[data-export]');
    if (b) exportToBot(b);
  });
  $('#tab-list').addEventListener('click', (e) => {
    const b = e.target.closest('.tx');
    if (b) onTxClick(Number(b.dataset.id));
  });

  // Синхронизация: подтягиваем изменения партнёра периодически и при возврате в приложение
  setInterval(() => { if (!document.hidden && $('#sheet').hidden) load(true); }, REFRESH_MS);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) load(true); });
}

function showMessage(text) {
  $('#app').hidden = true;
  const m = $('#message');
  m.innerHTML = text;
  m.hidden = false;
}

async function init() {
  if (!tg || !tg.initData) {
    showMessage('Откройте это приложение через бота в Telegram 🙂');
    return;
  }
  tg.ready();
  tg.expand();
  if (!API_URL) {
    showMessage('Не задан адрес API в config.js');
    return;
  }
  try {
    state.meta = await api('/api/meta');
  } catch (e) {
    showMessage(esc(e instanceof TypeError ? 'Нет связи с сервером. Попробуйте позже.' : e.message));
    return;
  }
  $('#app').hidden = false;
  bindEvents();
  render();
  await load();
}

init();
