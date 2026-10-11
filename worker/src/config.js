// Категории и общие настройки
export const EXPENSE_CATEGORIES = [
  'Продукты', 'Кафе', 'Транспорт', 'Жильё', 'Коммуналка', 'Связь',
  'Сигареты', 'Здоровье', 'Одежда', 'Дом', 'Развлечения', 'Подарки', 'Другое',
];
export const INCOME_CATEGORIES = ['Зарплата', 'Подработка', 'Подарок', 'Возврат', 'Другое'];

// Способы оплаты
export const METHODS = ['card', 'cash'];
export const METHOD_LABEL = { card: 'Карта', cash: 'Наличные' };
export const METHOD_ICON = { card: '💳', cash: '💵' };

export const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль',
  'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];

/** ID участников из секрета ALLOWED_USER_IDS="111,222" */
export function allowedIds(env) {
  return new Set(String(env.ALLOWED_USER_IDS || '')
    .split(',').map((s) => s.trim()).filter(Boolean).map(Number));
}

/** Сегодняшняя дата в часовом поясе пары (Workers живут в UTC) */
export function todayISO(env) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: env.TIMEZONE || 'Europe/Belgrade' }).format(new Date());
}
