"""Проверка подписи данных, которые Telegram передаёт в Mini App (initData).

Telegram подписывает initData токеном бота. Мы пересчитываем подпись и
сравниваем: если совпала — запрос точно пришёл из Telegram от этого
пользователя, подделать его без токена бота нельзя.
Документация: https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
"""
import hashlib
import hmac
import json
import time
from urllib.parse import parse_qsl

MAX_AGE_SECONDS = 24 * 60 * 60  # initData старше суток не принимаем


def validate_init_data(init_data: str, bot_token: str, max_age: int = MAX_AGE_SECONDS) -> dict | None:
    """Возвращает словарь пользователя Telegram или None, если подпись неверна."""
    if not init_data:
        return None
    try:
        pairs = dict(parse_qsl(init_data, strict_parsing=True))
    except ValueError:
        return None

    received_hash = pairs.pop("hash", None)
    if not received_hash:
        return None

    data_check_string = "\n".join(f"{k}={v}" for k, v in sorted(pairs.items()))
    secret_key = hmac.new(b"WebAppData", bot_token.encode(), hashlib.sha256).digest()
    calculated = hmac.new(secret_key, data_check_string.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(calculated, received_hash):
        return None

    try:
        auth_date = int(pairs.get("auth_date", "0"))
        user = json.loads(pairs.get("user", "null"))
    except (ValueError, json.JSONDecodeError):
        return None
    if not user or "id" not in user:
        return None
    if max_age and time.time() - auth_date > max_age:
        return None
    return user


def make_init_data(user: dict, bot_token: str, auth_date: int | None = None) -> str:
    """Собирает корректно подписанный initData. Нужно для тестов и локальной отладки."""
    from urllib.parse import urlencode

    fields = {
        "auth_date": str(auth_date or int(time.time())),
        "query_id": "test",
        "user": json.dumps(user, ensure_ascii=False, separators=(",", ":")),
    }
    dcs = "\n".join(f"{k}={v}" for k, v in sorted(fields.items()))
    secret_key = hmac.new(b"WebAppData", bot_token.encode(), hashlib.sha256).digest()
    fields["hash"] = hmac.new(secret_key, dcs.encode(), hashlib.sha256).hexdigest()
    return urlencode(fields)
