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
  assert.deepEqual(parseQuick('500 кафе'), { kind: 'expense', amountMinor: 50000, category: 'Кафе' });
  assert.deepEqual(parseQuick('-350 сигареты'), { kind: 'expense', amountMinor: 35000, category: 'Сигареты' });
  assert.deepEqual(parseQuick('350 сиги'), { kind: 'expense', amountMinor: 35000, category: 'Сигареты' });
  assert.deepEqual(parseQuick('+80000 зарплата'), { kind: 'income', amountMinor: 8000000, category: 'Зарплата' });
  assert.deepEqual(parseQuick('300 такси до центра'), { kind: 'expense', amountMinor: 30000, category: 'Другое' });
  assert.equal(parseQuick('привет'), null);
});

test('экспорт в xlsx', () => {
  const txs = [
    { id: 1, user_id: 1, user_name: 'Настя', kind: 'expense', amount_minor: 120050, category: 'Продукты',
      op_date: '2026-10-10', created_at: '2026-10-10T12:32:00Z' },
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
  assert.match(sheet1, /SUM\(E2:E3\)/);
  assert.equal(parsePeriod('', '2026-10'), '2026-10');
  assert.equal(parsePeriod('all', '2026-10'), 'all');
  assert.equal(parsePeriod('2026-09', '2026-10'), '2026-09');
  assert.equal(parsePeriod('вчера', '2026-10'), null);
});
