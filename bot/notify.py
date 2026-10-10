"""Уведомления второму участнику через бота: «Настя: расход 500 RSD — Кафе»."""
import logging

from aiogram import Bot

from .config import Config
from .money import fmt_money

log = logging.getLogger(__name__)

KIND_LABEL = {"income": "доход", "expense": "расход"}
KIND_ICON = {"income": "💰", "expense": "💸"}


def describe(tx: dict, currency: str) -> str:
    text = (f"{KIND_LABEL[tx['kind']]} <b>{fmt_money(tx['amount_minor'], currency)}</b>"
            f" — {_esc(tx['category'])}")
    if tx.get("comment"):
        text += f" ({_esc(tx['comment'])})"
    return text


def _esc(s: str) -> str:
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


async def notify_partners(bot: Bot, cfg: Config, author_id: int, text: str) -> None:
    for uid in cfg.allowed_user_ids:
        if uid == author_id:
            continue
        try:
            await bot.send_message(uid, text)
        except Exception as e:  # партнёр ещё не нажал /start или заблокировал бота
            log.warning("Не удалось уведомить %s: %s", uid, e)


async def notify_added(bot: Bot, cfg: Config, tx: dict) -> None:
    text = f"{KIND_ICON[tx['kind']]} {_esc(tx['user_name'])}: {describe(tx, cfg.currency)}"
    await notify_partners(bot, cfg, tx["user_id"], text)


async def notify_deleted(bot: Bot, cfg: Config, tx: dict, by_id: int, by_name: str) -> None:
    text = f"🗑 {_esc(by_name)} удалил(а) запись: {describe(tx, cfg.currency)}"
    await notify_partners(bot, cfg, by_id, text)
