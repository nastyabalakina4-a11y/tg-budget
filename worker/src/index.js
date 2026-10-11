// Cloudflare Worker: API для Mini App + webhook бота.
// Интерфейс лежит на GitHub Pages и обращается сюда с другого домена (CORS).
import { validateInitData, webhookSecret } from './auth.js';
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES, METHODS, allowedIds, todayISO } from './config.js';
import { addTx, deleteTx, getTx, listMonth, summary } from './db.js';
import { handleUpdate, notifyAdded, notifyDeleted, setupBot } from './bot.js';
import { parseAmount, toMajor } from './money.js';
import { MONTH_RE, sendExport } from './export.js';

const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

function corsHeaders(env) {
  return {
    'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Telegram-Init-Data',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

const json = (body, status, env) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders(env) },
});
const error = (status, message, env) => json({ error: message }, status, env);

const userName = (u) => String(u.first_name || u.username || u.id).slice(0, 64);

const txOut = (t) => ({
  id: t.id, user_id: t.user_id, user_name: t.user_name, kind: t.kind,
  amount: toMajor(t.amount_minor), category: t.category, method: t.method || 'card',
  date: t.op_date, created_at: t.created_at,
});

async function api(request, env, ctx, url) {
  // 1. Проверяем, что запрос из Telegram и от одного из двух участников
  const user = await validateInitData(request.headers.get('X-Telegram-Init-Data'), env.BOT_TOKEN);
  if (!user) return error(401, 'Неверная подпись Telegram. Откройте приложение через бота.', env);
  if (!allowedIds(env).has(user.id)) return error(403, `Доступ закрыт. Ваш Telegram ID: ${user.id}`, env);

  const path = url.pathname;
  const method = request.method;

  if (method === 'GET' && path === '/api/meta') {
    return json({
      currency: env.CURRENCY,
      categories: { expense: EXPENSE_CATEGORIES, income: INCOME_CATEGORIES },
      me: { id: user.id, name: userName(user) },
    }, 200, env);
  }

  if (method === 'GET' && path === '/api/month') {
    const month = url.searchParams.get('month') || '';
    if (!MONTH_RE.test(month)) return error(400, 'Параметр month должен быть в формате ГГГГ-ММ', env);
    const [txs, s] = await Promise.all([listMonth(env.DB, month), summary(env.DB, month)]);
    return json({
      month,
      transactions: txs.map(txOut),
      summary: {
        income: toMajor(s.income),
        expense: toMajor(s.expense),
        balance: toMajor(s.balance),
        by_category: s.by_category.map((c) => ({ category: c.category, amount: toMajor(c.amount_minor) })),
        by_method: Object.fromEntries(Object.entries(s.by_method).map(([m, v]) => [m, {
          income: toMajor(v.income), expense: toMajor(v.expense),
        }])),
        by_user: s.by_user.map((u) => ({
          user_id: u.user_id, name: u.name, income: toMajor(u.income), expense: toMajor(u.expense),
        })),
      },
    }, 200, env);
  }

  if (method === 'POST' && path === '/api/transactions') {
    let body;
    try { body = await request.json(); } catch { return error(400, 'Ожидался JSON', env); }

    const { kind } = body;
    if (kind !== 'income' && kind !== 'expense') return error(400, 'kind должен быть income или expense', env);
    const amountMinor = parseAmount(body.amount);
    if (amountMinor === null) return error(400, 'Некорректная сумма', env);
    const allowed = kind === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
    const category = String(body.category || '').trim();
    if (!allowed.includes(category)) return error(400, 'Неизвестная категория', env);
    const method = body.method === undefined ? 'card' : body.method;
    if (!METHODS.includes(method)) return error(400, 'method должен быть card или cash', env);
    const opDate = String(body.date || todayISO(env));
    if (!DATE_RE.test(opDate) || Number.isNaN(Date.parse(opDate))) {
      return error(400, 'Дата должна быть в формате ГГГГ-ММ-ДД', env);
    }

    const tx = await addTx(env.DB, {
      userId: user.id, userName: userName(user), kind, amountMinor, category,
      comment: '', method, opDate,
    });
    ctx.waitUntil(notifyAdded(env, tx)); // уведомление уходит в фоне, ответ не ждёт
    return json(txOut(tx), 201, env);
  }

  // Экспорт: файл Excel уходит в личный чат пользователя с ботом
  if (method === 'POST' && path === '/api/export') {
    let body = {};
    try { body = await request.json(); } catch { /* пустое тело — текущий месяц */ }
    const period = body.period === 'all' ? 'all' : String(body.period || todayISO(env).slice(0, 7));
    if (period !== 'all' && !MONTH_RE.test(period)) return error(400, 'period: ГГГГ-ММ или all', env);
    const r = await sendExport(env, user.id, period);
    if (!r.ok) return error(502, 'Не удалось отправить файл. Откройте чат с ботом и нажмите /start.', env);
    return json({ ok: true, count: r.count }, 200, env);
  }

  const del = /^\/api\/transactions\/(\d+)$/.exec(path);
  if (method === 'DELETE' && del) {
    const tx = await getTx(env.DB, Number(del[1]));
    if (!tx) return error(404, 'Запись не найдена', env);
    await deleteTx(env.DB, tx.id);
    ctx.waitUntil(notifyDeleted(env, tx, user.id, userName(user)));
    return json({ ok: true }, 200, env);
  }

  return error(404, 'Не найдено', env);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(env) });

    try {
      if (url.pathname === '/health') return json({ ok: true }, 200, env);

      if (url.pathname.startsWith('/api/')) return await api(request, env, ctx, url);

      // Webhook: Telegram присылает сообщения боту сюда
      if (url.pathname === '/tg/webhook' && request.method === 'POST') {
        const secret = await webhookSecret(env.BOT_TOKEN);
        if (request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== secret) {
          return new Response('forbidden', { status: 403 });
        }
        const update = await request.json();
        await handleUpdate(update, env);
        return new Response('ok');
      }

      // Настройка бота после деплоя (вызывается из GitHub Actions)
      if (url.pathname === '/setup' && request.method === 'POST') {
        const secret = await webhookSecret(env.BOT_TOKEN);
        if (request.headers.get('X-Setup-Key') !== secret) return new Response('forbidden', { status: 403 });
        return Response.json(await setupBot(env, url.origin, secret));
      }

      return error(404, 'Не найдено', env);
    } catch (e) {
      console.error(e);
      return error(500, 'Внутренняя ошибка сервера', env);
    }
  },
};
