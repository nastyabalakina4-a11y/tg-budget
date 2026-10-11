-- Кто и когда последний раз редактировал запись (NULL — запись не менялась)
ALTER TABLE transactions ADD COLUMN updated_at TEXT;
ALTER TABLE transactions ADD COLUMN updated_by_name TEXT;
