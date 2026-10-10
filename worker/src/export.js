// Экспорт операций в Excel и отправка файлом в чат с ботом
import { MONTHS } from './config.js';
import { listAll, listMonth, summary } from './db.js';
import { toMajor } from './money.js';
import { S, buildXlsx, colName, excelSerial } from './xlsx.js';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** 'all' | 'YYYY-MM' из текста команды; null если не распознано */
export function parsePeriod(arg, currentMonth) {
  const a = (arg || '').trim().toLowerCase();
  if (!a) return currentMonth;
  if (['all', 'все', 'всё', 'весь'].includes(a)) return 'all';
  if (MONTH_RE.test(a)) return a;
  return null;
}

export function periodTitle(period) {
  if (period === 'all') return 'за всё время';
  return `${MONTHS[Number(period.slice(5)) - 1]} ${period.slice(0, 4)}`;
}

/** ISO-время UTC → серийная дата Excel в нужном часовом поясе */
function localSerial(iso, timeZone) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(d).map((p) => [p.type, p.value]));
  return excelSerial(+parts.year, +parts.month, +parts.day, +parts.hour, +parts.minute);
}

const dateSerial = (ymd) => excelSerial(+ymd.slice(0, 4), +ymd.slice(5, 7), +ymd.slice(8, 10));

/** Собирает книгу Excel: лист «Операции» и лист «Итоги» */
export function buildWorkbook(txs, summ, { period, currency, timeZone }) {
  const sorted = [...txs].sort((a, b) => (a.op_date === b.op_date ? a.id - b.id : a.op_date < b.op_date ? -1 : 1));

  // ---- Лист 1: Операции ----
  const header = ['Дата', 'Тип', 'Категория', `Доход, ${currency}`, `Расход, ${currency}`, 'Кто добавил', 'Когда добавлено']
    .map((v) => ({ v, s: S.HEADER }));
  const rows = [header];
  for (const t of sorted) {
    const amount = toMajor(t.amount_minor);
    rows.push([
      { v: dateSerial(t.op_date), s: S.DATE },
      t.kind === 'income' ? 'Доход' : 'Расход',
      t.category,
      t.kind === 'income' ? { v: amount, s: S.MONEY } : null,
      t.kind === 'expense' ? { v: amount, s: S.MONEY } : null,
      t.user_name,
      { v: localSerial(t.created_at, timeZone), s: S.DATETIME },
    ]);
  }
  const last = rows.length; // номер последней строки с данными
  const sumIncome = toMajor(summ.income);
  const sumExpense = toMajor(summ.expense);
  rows.push([]);
  rows.push([
    { v: 'Итого', s: S.HEADER }, { v: '', s: S.HEADER }, { v: '', s: S.HEADER },
    { f: last > 1 ? `SUM(D2:D${last})` : '0', v: sumIncome, s: S.TOTAL },
    { f: last > 1 ? `SUM(E2:E${last})` : '0', v: sumExpense, s: S.TOTAL },
    { v: 'Баланс', s: S.HEADER },
    { f: `D${last + 2}-E${last + 2}`, v: toMajor(summ.balance), s: S.TOTAL },
  ]);

  // ---- Лист 2: Итоги ----
  const sr = [
    [{ v: `Бюджет на двоих — ${periodTitle(period)}`, s: S.TITLE }],
    [],
    [{ v: 'Показатель', s: S.HEADER }, { v: `Сумма, ${currency}`, s: S.HEADER }],
    ['Доходы', { v: sumIncome, s: S.MONEY }],
    ['Расходы', { v: sumExpense, s: S.MONEY }],
    ['Баланс', { v: toMajor(summ.balance), s: S.MONEY }],
    [],
    [{ v: 'Расходы по категориям', s: S.HEADER }, { v: `Сумма, ${currency}`, s: S.HEADER }, { v: 'Доля', s: S.HEADER }],
  ];
  for (const c of summ.by_category) {
    const amount = toMajor(c.amount_minor);
    sr.push([c.category, { v: amount, s: S.MONEY }, { v: summ.expense ? c.amount_minor / summ.expense : 0, s: S.PERCENT }]);
  }
  sr.push([]);
  sr.push([{ v: 'Кто', s: S.HEADER }, { v: `Доход, ${currency}`, s: S.HEADER }, { v: `Расход, ${currency}`, s: S.HEADER }]);
  for (const u of summ.by_user) {
    sr.push([u.name, { v: toMajor(u.income), s: S.MONEY }, { v: toMajor(u.expense), s: S.MONEY }]);
  }

  return buildXlsx([
    {
      name: 'Операции',
      rows,
      widths: [12, 9, 16, 15, 15, 16, 18],
      freezeHeader: true,
      autoFilter: `A1:${colName(6)}${Math.max(last, 1)}`,
    },
    { name: 'Итоги', rows: sr, widths: [26, 16, 12] },
  ]);
}

/** Собирает итоги по произвольному списку операций (для «за всё время») */
export function summarize(txs) {
  const s = { income: 0, expense: 0, by_category: new Map(), by_user: new Map() };
  for (const t of txs) {
    s[t.kind] += t.amount_minor;
    if (t.kind === 'expense') s.by_category.set(t.category, (s.by_category.get(t.category) || 0) + t.amount_minor);
    if (!s.by_user.has(t.user_id)) s.by_user.set(t.user_id, { user_id: t.user_id, name: t.user_name, income: 0, expense: 0 });
    s.by_user.get(t.user_id)[t.kind] += t.amount_minor;
  }
  return {
    income: s.income,
    expense: s.expense,
    balance: s.income - s.expense,
    by_category: [...s.by_category].map(([category, amount_minor]) => ({ category, amount_minor }))
      .sort((a, b) => b.amount_minor - a.amount_minor),
    by_user: [...s.by_user.values()],
  };
}

/** Строит файл и отправляет его в чат. Возвращает { ok, count, error? } */
export async function sendExport(env, chatId, period) {
  const txs = period === 'all' ? await listAll(env.DB) : await listMonth(env.DB, period);
  const summ = period === 'all' ? summarize(txs) : await summary(env.DB, period);
  const bytes = buildWorkbook(txs, summ, {
    period, currency: env.CURRENCY || 'RSD', timeZone: env.TIMEZONE || 'Europe/Belgrade',
  });

  const form = new FormData();
  form.append('chat_id', String(chatId));
  form.append('caption', `📊 Бюджет ${periodTitle(period)}: ${txs.length} операций`);
  form.append('document', new Blob([bytes], { type: XLSX_MIME }), `budget-${period}.xlsx`);

  let data;
  try {
    const res = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendDocument`, { method: 'POST', body: form });
    data = await res.json().catch(() => ({ ok: false, description: `HTTP ${res.status}` }));
  } catch (e) {
    data = { ok: false, description: e.message };
  }
  if (!data.ok) console.warn('sendDocument:', data.description);
  return { ok: !!data.ok, count: txs.length, error: data.description };
}
