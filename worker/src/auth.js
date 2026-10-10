// Проверка подписи initData, которую Telegram передаёт в Mini App.
// Telegram подписывает данные токеном бота (HMAC-SHA256). Мы пересчитываем
// подпись: если совпала — запрос точно от этого пользователя Telegram.
// https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app

const enc = new TextEncoder();
const MAX_AGE_SECONDS = 24 * 60 * 60;

async function hmac(keyBytes, data) {
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
}

export const toHex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function dataCheckString(params) {
  return [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
}

export async function signInitData(params, botToken) {
  const secret = await hmac(enc.encode('WebAppData'), botToken);
  return toHex(await hmac(secret, dataCheckString(params)));
}

/** Возвращает объект пользователя Telegram или null */
export async function validateInitData(initData, botToken, maxAge = MAX_AGE_SECONDS) {
  if (!initData || !botToken) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');

  if (!safeEqual(await signInitData(params, botToken), hash)) return null;

  const authDate = Number(params.get('auth_date') || 0);
  if (maxAge && Date.now() / 1000 - authDate > maxAge) return null;
  try {
    const user = JSON.parse(params.get('user') || 'null');
    return user && user.id ? user : null;
  } catch {
    return null;
  }
}

/** Секрет для вебхука и /setup, выводится из токена — отдельно хранить не нужно */
export async function webhookSecret(botToken) {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(botToken));
  return toHex(new Uint8Array(digest)).slice(0, 32);
}
