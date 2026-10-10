"""Настройки приложения. Всё читается из переменных окружения (файл .env)."""
import os
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv

EXPENSE_CATEGORIES = [
    "Продукты", "Кафе", "Транспорт", "Жильё", "Коммуналка", "Связь",
    "Здоровье", "Одежда", "Дом", "Развлечения", "Подарки", "Другое",
]
INCOME_CATEGORIES = ["Зарплата", "Подработка", "Подарок", "Возврат", "Другое"]


@dataclass
class Config:
    bot_token: str
    webapp_url: str
    allowed_user_ids: set[int] = field(default_factory=set)
    currency: str = "RSD"
    db_path: str = "data/budget.db"
    host: str = "0.0.0.0"
    port: int = 8080
    webapp_dir: Path = Path(__file__).resolve().parent.parent / "webapp"


def _parse_ids(raw: str) -> set[int]:
    ids = set()
    for part in raw.replace(" ", "").split(","):
        if part:
            ids.add(int(part))
    return ids


def load_config() -> Config:
    load_dotenv()
    token = os.getenv("BOT_TOKEN", "").strip()
    if not token:
        raise SystemExit("Не задан BOT_TOKEN в .env")
    return Config(
        bot_token=token,
        webapp_url=os.getenv("WEBAPP_URL", "").strip(),
        allowed_user_ids=_parse_ids(os.getenv("ALLOWED_USER_IDS", "")),
        currency=os.getenv("CURRENCY", "RSD").strip() or "RSD",
        db_path=os.getenv("DB_PATH", "data/budget.db"),
        host=os.getenv("HOST", "0.0.0.0"),
        port=int(os.getenv("PORT", "8080")),
    )
