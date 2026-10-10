// Модульные тесты: подпись Telegram, суммы, разбор быстрого ввода.
// Запуск: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { validateInitData } from '../src/auth.js';
import { fmtMoney, parseAmount } from '../src/money.js';
import { parseQuick } from '../src/bot.js';
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
  assert.deepEqual(parseQuick('500 кафе'), { kind: 'expense', amountMinor: 50000, category: 'Кафе', comment: '' });
  assert.deepEqual(parseQuick('-1200 продукты лидл'),
    { kind: 'expense', amountMinor: 120000, category: 'Продукты', comment: 'лидл' });
  assert.deepEqual(parseQuick('+80000 зарплата'),
    { kind: 'income', amountMinor: 8000000, category: 'Зарплата', comment: '' });
  assert.deepEqual(parseQuick('300 такси до центра'),
    { kind: 'expense', amountMinor: 30000, category: 'Другое', comment: 'такси до центра' });
  assert.equal(parseQuick('привет'), null);
});
