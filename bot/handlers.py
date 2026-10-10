"""Команды бота и быстрый ввод операций прямо сообщением в чат."""
import re
from datetime import date

from aiogram import F, Router
from aiogram.filters import Command, CommandStart
from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup, Message, WebAppInfo

from .config import EXPENSE_CATEGORIES, INCOME_CATEGORIES, Config
from .db import Database
from .money import fmt_money, parse_amount
from .notify import describe, notify_added

router = Router()

MONTHS = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль",
          "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"]

# «500 кафе», «-1200 продукты лидл», «+80000 зарплата»
QUICK_RE = re.compile(r"^\s*([+-])?\s*(\d[\d\s]*(?:[.,]\d{1,2})?)\s*(.*)$", re.S)

HELP = (
    "Как пользоваться:\n"
    "• Кнопка «Открыть бюджет» — полное приложение.\n"
    "• Быстрый ввод сообщением:\n"
    "  <code>500 кафе</code> — расход\n"
    "  <code>-1200 продукты лидл</code> — расход с комментарием\n"
    "  <code>+80000 зарплата</code> — доход\n"
    "• /balance — итоги текущего месяца"
)


def open_app_keyboard(cfg: Config) -> InlineKeyboardMarkup | None:
    if not cfg.webapp_url:
        return None
    return InlineKeyboardMarkup(inline_keyboard=[[
        InlineKeyboardButton(text="📊 Открыть бюджет", web_app=WebAppInfo(url=cfg.webapp_url))
    ]])


def is_allowed(message: Message, cfg: Config) -> bool:
    return message.from_user is not None and message.from_user.id in cfg.allowed_user_ids


@router.message(CommandStart())
async def cmd_start(message: Message, cfg: Config):
    if not is_allowed(message, cfg):
        await message.answer(
            "Это приватный бюджет на двоих.\n"
            f"Ваш Telegram ID: <code>{message.from_user.id}</code>\n"
            "Если это вы — добавьте ID в ALLOWED_USER_IDS в .env и перезапустите бота."
        )
        return
    await message.answer(f"Привет, {message.from_user.first_name}! 👋\n\n{HELP}",
                         reply_markup=open_app_keyboard(cfg))


@router.message(Command("help"))
async def cmd_help(message: Message, cfg: Config):
    if is_allowed(message, cfg):
        await message.answer(HELP, reply_markup=open_app_keyboard(cfg))


@router.message(Command("balance"))
async def cmd_balance(message: Message, cfg: Config, db: Database):
    if not is_allowed(message, cfg):
        return
    today = date.today()
    month = today.strftime("%Y-%m")
    s = await db.summary(month)
    def money(minor: int) -> str:
        return ("-" if minor < 0 else "") + fmt_money(abs(minor), cfg.currency)

    lines = [
        f"<b>{MONTHS[today.month - 1]} {today.year}</b>",
        f"💰 Доходы: {money(s['income'])}",
        f"💸 Расходы: {money(s['expense'])}",
        f"⚖️ Баланс: {money(s['balance'])}",
    ]
    if s["by_category"]:
        lines.append("\n<b>Топ расходов:</b>")
        for c in s["by_category"][:5]:
            lines.append(f"• {c['category']}: {money(c['amount_minor'])}")
    if s["by_user"]:
        lines.append("\n<b>По людям (расход / доход):</b>")
        for u in s["by_user"]:
            lines.append(f"• {u['name']}: {money(u['expense'])} / {money(u['income'])}")
    await message.answer("\n".join(lines), reply_markup=open_app_keyboard(cfg))


def match_category(word: str, categories: list[str]) -> str | None:
    w = word.lower()
    for c in categories:
        if c.lower() == w or (len(w) >= 3 and c.lower().startswith(w)):
            return c
    return None


@router.message(F.text & ~F.text.startswith("/"))
async def quick_add(message: Message, cfg: Config, db: Database):
    if not is_allowed(message, cfg):
        return
    m = QUICK_RE.match(message.text)
    if not m:
        await message.answer("Не понял 🤔 Напишите, например: <code>500 кафе</code>\n/help — подсказка")
        return
    sign, raw_amount, rest = m.groups()
    amount_minor = parse_amount(raw_amount)
    if amount_minor is None:
        await message.answer("Некорректная сумма.")
        return

    kind = "income" if sign == "+" else "expense"
    categories = INCOME_CATEGORIES if kind == "income" else EXPENSE_CATEGORIES
    words = rest.strip().split(maxsplit=1)
    category = match_category(words[0], categories) if words else None
    if category:
        comment = words[1] if len(words) > 1 else ""
    else:
        category = "Другое"
        comment = rest.strip()

    tx = await db.add(
        user_id=message.from_user.id, user_name=message.from_user.first_name or "—",
        kind=kind, amount_minor=amount_minor, category=category,
        comment=comment[:200], op_date=date.today().isoformat(),
    )
    await message.answer(f"✅ Записал: {describe(tx, cfg.currency)}")
    await notify_added(message.bot, cfg, tx)
