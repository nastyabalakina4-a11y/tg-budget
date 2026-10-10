// Работа с базой Cloudflare D1 (это SQLite в облаке)

export async function addTx(db, t) {
  return db.prepare(
    `INSERT INTO transactions (user_id, user_name, kind, amount_minor, category, comment, op_date, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
  ).bind(t.userId, t.userName, t.kind, t.amountMinor, t.category, t.comment, t.opDate,
    new Date().toISOString().slice(0, 19) + 'Z').first();
}

export const getTx = (db, id) => db.prepare('SELECT * FROM transactions WHERE id = ?').bind(id).first();

export async function deleteTx(db, id) {
  const r = await db.prepare('DELETE FROM transactions WHERE id = ?').bind(id).run();
  return r.meta.changes > 0;
}

export async function listMonth(db, month) {
  const { results } = await db.prepare(
    'SELECT * FROM transactions WHERE op_date LIKE ? ORDER BY op_date DESC, id DESC',
  ).bind(`${month}-%`).all();
  return results;
}

export async function summary(db, month) {
  const like = `${month}-%`;
  const [totals, byCat, byUser] = await db.batch([
    db.prepare('SELECT kind, SUM(amount_minor) s FROM transactions WHERE op_date LIKE ? GROUP BY kind').bind(like),
    db.prepare(`SELECT category, SUM(amount_minor) s FROM transactions
                WHERE op_date LIKE ? AND kind = 'expense' GROUP BY category ORDER BY s DESC`).bind(like),
    db.prepare(`SELECT user_id, MAX(user_name) name, kind, SUM(amount_minor) s FROM transactions
                WHERE op_date LIKE ? GROUP BY user_id, kind`).bind(like),
  ]);

  const t = { income: 0, expense: 0 };
  for (const r of totals.results) t[r.kind] = r.s;

  const users = new Map();
  for (const r of byUser.results) {
    if (!users.has(r.user_id)) users.set(r.user_id, { user_id: r.user_id, name: r.name, income: 0, expense: 0 });
    users.get(r.user_id)[r.kind] = r.s;
  }

  return {
    income: t.income,
    expense: t.expense,
    balance: t.income - t.expense,
    by_category: byCat.results.map((r) => ({ category: r.category, amount_minor: r.s })),
    by_user: [...users.values()],
  };
}
