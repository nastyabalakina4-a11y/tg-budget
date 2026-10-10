-- Одна общая таблица операций на двоих
CREATE TABLE IF NOT EXISTS transactions (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER NOT NULL,
    user_name    TEXT    NOT NULL,
    kind         TEXT    NOT NULL CHECK (kind IN ('income', 'expense')),
    amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),  -- сумма в «копейках»
    category     TEXT    NOT NULL,
    comment      TEXT    NOT NULL DEFAULT '',
    op_date      TEXT    NOT NULL,                           -- YYYY-MM-DD
    created_at   TEXT    NOT NULL                            -- ISO-время UTC
);
CREATE INDEX IF NOT EXISTS idx_tx_date ON transactions(op_date);
