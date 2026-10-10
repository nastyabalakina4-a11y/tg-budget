// Суммы храним целым числом «копеек» (пара/центы) — без ошибок float.
const MAX_MINOR = 10 ** 14;

/** '1 250,5' / 1250.5 / '1250' -> 125050; null если сумма некорректна */
export function parseAmount(value) {
  const text = String(value ?? '').replace(/[\s ]/g, '').replace(',', '.');
  const m = /^(\d+)(?:\.(\d+))?$/.exec(text);
  if (!m) return null;
  const frac = (m[2] || '').padEnd(3, '0');
  let minor = Number(m[1]) * 100 + Number(frac.slice(0, 2));
  if (Number(frac[2]) >= 5) minor += 1; // округление до сотых
  if (!Number.isSafeInteger(minor) || minor <= 0 || minor >= MAX_MINOR) return null;
  return minor;
}

export const toMajor = (minor) => Math.round(minor) / 100;

/** 125050 -> '1 250,50 RSD', 50000 -> '500 RSD', -300 -> '-3 RSD' */
export function fmtMoney(minor, currency) {
  const sign = minor < 0 ? '-' : '';
  const abs = Math.abs(minor);
  const int = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const frac = abs % 100;
  return `${sign}${int}${frac ? ',' + String(frac).padStart(2, '0') : ''} ${currency}`;
}
