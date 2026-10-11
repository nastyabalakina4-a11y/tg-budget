// Модульные тесты: подпись Telegram, суммы, разбор быстрого ввода.
// Запуск: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { validateInitData } from '../src/auth.js';
import { fmtMoney, parseAmount } from '../src/money.js';
import { parseQuick } from '../src/bot.js';
import { buildWorkbook, parsePeriod, summarize } from '../src/export.js';
import { strFromU8, unzipSync } from 'fflate';
import { TEST_TOKEN as TOKEN, makeInitData } from './helpers.js';

test('подпись initData', async () => {
  const data = await makeInitData({ id: 111, first_name: 'Настя' });
  assert.equal((await validateInitData(data, TOKEN)).id, 111);
  assert.equal(await validateInitData(data, '999:OTHER'), null, 'чужой токен');
  assert.equal(await validateInitData(data.replace('111', '112'), TOKEN), null, 'подмена данных');
  const old = await makeInitData({ id: 111 }, TOKEN, Math.floor(Date.now() / 1000) - 3 * 86400);
  assert.equal(await validateInitData(old, TOKEN), null, 'устаревшие данные');
  assert.equal(await validateInitData('', TOKEN), null);
});

test('суммы', () => {
  assert.equal(parseAmount('1 250,5'), 125050);
  assert.equal(parseAmount(1250.5), 125050);
  assert.equal(parseAmount('10.005'), 1001);
  assert.equal(parseAmount(0), null);
  assert.equal(parseAmount('-5'), null);
  assert.equal(parseAmount('abc'), null);
  assert.equal(fmtMoney(125050, 'RSD'), '1 250,50 RSD');
  assert.equal(fmtMoney(50000, 'RSD'), '500 RSD');
  assert.equal(fmtMoney(-7880000, 'RSD'), '-78 800 RSD');
});

test('быстрый ввод', () => {
  const q = (kind, amountMinor, category, method = 'card') => ({ kind, amountMinor, category, method });
  assert.deepEqual(parseQuick('500 кафе'), q('expense', 50000, 'Кафе'));
  assert.deepEqual(parseQuick('-350 сигареты'), q('expense', 35000, 'Сигареты'));
  assert.deepEqual(parseQuick('350 сиги'), q('expense', 35000, 'Сигареты'));
  assert.deepEqual(parseQuick('+80000 зарплата'), q('income', 8000000, 'Зарплата'));
  assert.deepEqual(parseQuick('300 такси до центра'), q('expense', 30000, 'Другое'));
  assert.deepEqual(parseQuick('500 кафе нал'), q('expense', 50000, 'Кафе', 'cash'));
  assert.deepEqual(parseQuick('500 нал кафе'), q('expense', 50000, 'Кафе', 'cash'));
  assert.deepEqual(parseQuick('350 Сиги Наличными'), q('expense', 35000, 'Сигареты', 'cash'));
  assert.deepEqual(parseQuick('+20000 подработка кэш'), q('income', 2000000, 'Подработка', 'cash'));
  assert.deepEqual(parseQuick('500 кафе картой'), q('expense', 50000, 'Кафе'));
  assert.deepEqual(parseQuick('200 нал'), q('expense', 20000, 'Другое', 'cash'));
  assert.equal(parseQuick('привет'), null);
});

test('экспорт в xlsx', () => {
  const txs = [
    { id: 1, user_id: 1, user_name: 'Настя', kind: 'expense', amount_minor: 120050, category: 'Продукты',
      method: 'cash', op_date: '2026-10-10', created_at: '2026-10-10T12:32:00Z' },
    { id: 2, user_id: 2, user_name: 'Янка', kind: 'income', amount_minor: 8000000, category: 'Зарплата',
      op_date: '2026-10-05', created_at: '2026-10-05T08:00:00Z' },
  ];
  const bytes = buildWorkbook(txs, summarize(txs), { period: '2026-10', currency: 'RSD', timeZone: 'Europe/Belgrade' });
  const files = unzipSync(bytes);
  for (const f of ['[Content_Types].xml', 'xl/workbook.xml', 'xl/styles.xml', 'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml']) {
    assert.ok(files[f], f);
  }
  const sheet1 = strFromU8(files['xl/worksheets/sheet1.xml']);
  assert.match(sheet1, /Янка/);
  assert.match(sheet1, /Наличные/);
  const summ = summarize(txs);
  assert.deepEqual(summ.by_method, { card: { income: 8000000, expense: 0 }, cash: { income: 0, expense: 120050 } });
  assert.match(sheet1, /SUM\(F2:F3\)/);
  assert.equal(parsePeriod('', '2026-10'), '2026-10');
  assert.equal(parsePeriod('all', '2026-10'), 'all');
  assert.equal(parsePeriod('2026-09', '2026-10'), '2026-09');
  assert.equal(parsePeriod('вчера', '2026-10'), null);
});

test('что изменилось при редактировании', async () => {
  const { diffTx } = await import('../src/bot.js');
  const before = { kind: 'expense', amount_minor: 35000, category: 'Сигареты', method: 'card', op_date: '2026-10-10' };
  assert.deepEqual(diffTx(before, { ...before, method: 'cash' }, 'RSD'), ['Оплата: Карта → <b>Наличные</b>']);
  assert.deepEqual(diffTx(before, { ...before, amount_minor: 40000, op_date: '2026-10-09' }, 'RSD'),
    ['Сумма: 350 RSD → <b>400 RSD</b>', 'Дата: 10.10 → <b>09.10</b>']);
  assert.deepEqual(diffTx(before, { ...before }, 'RSD'), []);
});
