"""SQLite-хранилище. Одна общая база на двоих — в этом и есть синхронизация:
оба пользователя читают и пишут в одну и ту же таблицу на сервере."""
from datetime import datetime, timezone
from pathlib import Path

import aiosqlite

SCHEMA = """
CREATE TABLE IF NOT EXISTS transactions (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER NOT NULL,
    user_name    TEXT    NOT NULL,
    kind         TEXT    NOT NULL CHECK (kind IN ('income', 'expense')),
    amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
    category     TEXT    NOT NULL,
    comment      TEXT    NOT NULL DEFAULT '',
    op_date      TEXT    NOT NULL,            -- YYYY-MM-DD
    created_at   TEXT    NOT NULL             -- ISO-время в UTC
);
CREATE INDEX IF NOT EXISTS idx_tx_date ON transactions(op_date);
"""


class Database:
    def __init__(self, path: str):
        self.path = path
        self.conn: aiosqlite.Connection | None = None

    async def init(self) -> None:
        if self.path != ":memory:":
            Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        self.conn = await aiosqlite.connect(self.path)
        self.conn.row_factory = aiosqlite.Row
        await self.conn.execute("PRAGMA journal_mode=WAL")
        await self.conn.executescript(SCHEMA)
        await self.conn.commit()

    async def close(self) -> None:
        if self.conn:
            await self.conn.close()

    async def add(self, *, user_id: int, user_name: str, kind: str, amount_minor: int,
                  category: str, comment: str, op_date: str) -> dict:
        created_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
        cur = await self.conn.execute(
            """INSERT INTO transactions
               (user_id, user_name, kind, amount_minor, category, comment, op_date, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (user_id, user_name, kind, amount_minor, category, comment, op_date, created_at),
        )
        await self.conn.commit()
        return await self.get(cur.lastrowid)

    async def get(self, tx_id: int) -> dict | None:
        async with self.conn.execute("SELECT * FROM transactions WHERE id = ?", (tx_id,)) as cur:
            row = await cur.fetchone()
        return dict(row) if row else None

    async def delete(self, tx_id: int) -> bool:
        cur = await self.conn.execute("DELETE FROM transactions WHERE id = ?", (tx_id,))
        await self.conn.commit()
        return cur.rowcount > 0

    async def list_month(self, month: str) -> list[dict]:
        async with self.conn.execute(
            "SELECT * FROM transactions WHERE op_date LIKE ? ORDER BY op_date DESC, id DESC",
            (f"{month}-%",),
        ) as cur:
            return [dict(r) for r in await cur.fetchall()]

    async def summary(self, month: str) -> dict:
        like = (f"{month}-%",)
        totals = {"income": 0, "expense": 0}
        async with self.conn.execute(
            "SELECT kind, SUM(amount_minor) s FROM transactions WHERE op_date LIKE ? GROUP BY kind", like
        ) as cur:
            for r in await cur.fetchall():
                totals[r["kind"]] = r["s"]

        async with self.conn.execute(
            """SELECT category, SUM(amount_minor) s FROM transactions
               WHERE op_date LIKE ? AND kind = 'expense'
               GROUP BY category ORDER BY s DESC""", like
        ) as cur:
            by_category = [{"category": r["category"], "amount_minor": r["s"]} for r in await cur.fetchall()]

        users: dict[int, dict] = {}
        async with self.conn.execute(
            """SELECT user_id, MAX(user_name) name, kind, SUM(amount_minor) s FROM transactions
               WHERE op_date LIKE ? GROUP BY user_id, kind""", like
        ) as cur:
            for r in await cur.fetchall():
                u = users.setdefault(r["user_id"], {"user_id": r["user_id"], "name": r["name"],
                                                    "income": 0, "expense": 0})
                u[r["kind"]] = r["s"]

        return {
            "income": totals["income"],
            "expense": totals["expense"],
            "balance": totals["income"] - totals["expense"],
            "by_category": by_category,
            "by_user": list(users.values()),
        }
