// Бот: команды, быстрый ввод сообщением и уведомления партнёру
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES, MONTHS, allowedIds, todayISO } from './config.js';
import { addTx, summary } from './db.js';
import { fmtMoney, parseAmount } from './money.js';

const KIND_LABEL = { income: 'доход', expense: 'расход' };
const KIND_ICON = { income: '💰', expense: '💸' };

// «500 кафе», «-1200 продукты лидл», «+80000 зарплата»
export const QUICK_RE = /^\s*([+-])?\s*(\d[\d\s]*(?:[.,]\d{1,2})?)\s*([\s\S]*)$/;

const HELP = [
  'Как пользоваться:',
  '• Кнопка «Бюджет» внизу слева — полное приложение.',
  '• Быстрый ввод сообщением:',
  '  <code>500 кафе</code> — расход',
  '  <code>-1200 продукты лидл</code> — расход с комментарием',
  '  <code>+80000 зарплата</code> — доход',
  '• /balance — итоги текущего месяца',
].join('\n');

export const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export async function tg(env, method, payload) {
  try {
    const r = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await r.json();
    if (!data.ok) console.warn(`Telegram ${method}:`, data.description);
    return data;
  } catch (e) {
    console.warn(`Telegram ${method} failed:`, e.message);
    return { ok: false };
  }
}

const send = (env, chatId, text, extra = {}) =>
  tg(env, 'sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', ...extra });

const appButton = (env) => (env.WEBAPP_URL
  ? { reply_markup: { inline_keyboard: [[{ text: '📊 Открыть бюджет', web_app: { url: env.WEBAPP_URL } }]] } }
  : {});

export function describe(tx, currency) {
  let text = `${KIND_LABEL[tx.kind]} <b>${fmtMoney(tx.amount_minor, currency)}</b> — ${esc(tx.category)}`;
  if (tx.comment) text += ` (${esc(tx.comment)})`;
  return text;
}

async function notifyPartners(env, authorId, text) {
  const jobs = [...allowedIds(env)].filter((id) => id !== authorId).map((id) => send(env, id, text));
  await Promise.all(jobs);
}

export const notifyAdded = (env, tx) =>
  notifyPartners(env, tx.user_id, `${KIND_ICON[tx.kind]} ${esc(tx.user_name)}: ${describe(tx, env.CURRENCY)}`);

export const notifyDeleted = (env, tx, byId, byName) =>
  notifyPartners(env, byId, `🗑 ${esc(byName)} удалил(а) запись: ${describe(tx, env.CURRENCY)}`);

export function matchCategory(word, categories) {
  const w = (word || '').toLowerCase();
  if (!w) return null;
  return categories.find((c) => c.toLowerCase() === w || (w.length >= 3 && c.toLowerCase().startsWith(w))) || null;
}

/** Разбор быстрого ввода. Возвращает данные операции или null */
export function parseQuick(text) {
  const m = QUICK_RE.exec(text);
  if (!m) return null;
  const [, sign, rawAmount, rest] = m;
  const amountMinor = parseAmount(rawAmount);
  if (amountMinor === null) return null;
  const kind = sign === '+' ? 'income' : 'expense';
  const cats = kind === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
  const trimmed = rest.trim();
  const [first, ...others] = trimmed.split(/\s+/);
  const category = matchCategory(first, cats);
  return category
    ? { kind, amountMinor, category, comment: others.join(' ') }
    : { kind, amountMinor, category: 'Другое', comment: trimmed };
}

async function balanceText(env) {
  const today = todayISO(env);
  const month = today.slice(0, 7);
  const s = await summary(env.DB, month);
  const money = (v) => fmtMoney(v, env.CURRENCY);
  const lines = [
    `<b>${MONTHS[Number(month.slice(5)) - 1]} ${month.slice(0, 4)}</b>`,
    `💰 Доходы: ${money(s.income)}`,
    `💸 Расходы: ${money(s.expense)}`,
    `⚖️ Баланс: ${money(s.balance)}`,
  ];
  if (s.by_category.length) {
    lines.push('', '<b>Топ расходов:</b>');
    for (const c of s.by_category.slice(0, 5)) lines.push(`• ${esc(c.category)}: ${money(c.amount_minor)}`);
  }
  if (s.by_user.length) {
    lines.push('', '<b>По людям (расход / доход):</b>');
    for (const u of s.by_user) lines.push(`• ${esc(u.name)}: ${money(u.expense)} / ${money(u.income)}`);
  }
  return lines.join('\n');
}

/** Обработка входящего обновления от Telegram (webhook) */
export async function handleUpdate(update, env) {
  const msg = update.message;
  if (!msg || !msg.from || typeof msg.text !== 'string' || msg.chat.type !== 'private') return;
  const chatId = msg.chat.id;
  const text = msg.text.trim();
  const isAllowed = allowedIds(env).has(msg.from.id);

  if (text.startsWith('/start')) {
    if (!isAllowed) {
      await send(env, chatId, 'Это приватный бюджет на двоих.\n'
        + `Ваш Telegram ID: <code>${msg.from.id}</code>\n`
        + 'Если это вы — добавьте ID в секрет ALLOWED_USER_IDS на GitHub и перезапустите деплой.');
      return;
    }
    await send(env, chatId, `Привет, ${esc(msg.from.first_name || '')}! 👋\n\n${HELP}`, appButton(env));
    return;
  }
  if (!isAllowed) return;

  if (text.startsWith('/help')) return void await send(env, chatId, HELP, appButton(env));
  if (text.startsWith('/balance')) return void await send(env, chatId, await balanceText(env), appButton(env));
  if (text.startsWith('/')) return;

  const q = parseQuick(text);
  if (!q) {
    await send(env, chatId, 'Не понял 🤔 Напишите, например: <code>500 кафе</code>\n/help — подсказка');
    return;
  }
  const tx = await addTx(env.DB, {
    userId: msg.from.id,
    userName: (msg.from.first_name || msg.from.username || String(msg.from.id)).slice(0, 64),
    kind: q.kind,
    amountMinor: q.amountMinor,
    category: q.category,
    comment: q.comment.slice(0, 200),
    opDate: todayISO(env),
  });
  await send(env, chatId, `✅ Записал: ${describe(tx, env.CURRENCY)}`);
  await notifyAdded(env, tx);
}

/** Настройка бота: вебхук, команды, кнопка меню. Вызывается из деплоя */
export async function setupBot(env, workerOrigin, secret) {
  const results = {};
  results.webhook = await tg(env, 'setWebhook', {
    url: `${workerOrigin}/tg/webhook`,
    secret_token: secret,
    allowed_updates: ['message'],
    drop_pending_updates: true,
  });
  results.commands = await tg(env, 'setMyCommands', {
    commands: [
      { command: 'start', description: 'Открыть бюджет' },
      { command: 'balance', description: 'Итоги месяца' },
      { command: 'help', description: 'Как пользоваться' },
    ],
  });
  if (env.WEBAPP_URL) {
    results.menu = await tg(env, 'setChatMenuButton', {
      menu_button: { type: 'web_app', text: 'Бюджет', web_app: { url: env.WEBAPP_URL } },
    });
  }
  return results;
}
