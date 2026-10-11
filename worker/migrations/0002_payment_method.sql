-- Способ оплаты: card (карта) или cash (наличные).
-- Записи, сделанные до этого обновления, считаются оплаченными картой.
ALTER TABLE transactions ADD COLUMN method TEXT NOT NULL DEFAULT 'card' CHECK (method IN ('card', 'cash'));
