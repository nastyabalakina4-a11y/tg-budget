"""HTTP API для Mini App + раздача статики (index.html, app.js, style.css)."""
import logging
import re
from datetime import date

from aiohttp import web
from aiogram import Bot

from .auth import validate_init_data
from .config import EXPENSE_CATEGORIES, INCOME_CATEGORIES, Config
from .db import Database
from .money import parse_amount, to_major
from .notify import notify_added, notify_deleted

log = logging.getLogger(__name__)

CFG = web.AppKey("cfg", Config)
DB = web.AppKey("db", Database)
BOT = web.AppKey("bot", object)  # Bot или None (в тестах)

MONTH_RE = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def json_error(status: int, message: str) -> web.Response:
    return web.json_response({"error": message}, status=status)


def user_name(user: dict) -> str:
    return (user.get("first_name") or user.get("username") or str(user["id"]))[:64]


def tx_out(tx: dict) -> dict:
    return {
        "id": tx["id"], "user_id": tx["user_id"], "user_name": tx["user_name"],
        "kind": tx["kind"], "amount": to_major(tx["amount_minor"]),
        "category": tx["category"], "comment": tx["comment"],
        "date": tx["op_date"], "created_at": tx["created_at"],
    }


@web.middleware
async def auth_middleware(request: web.Request, handler):
    """Каждый запрос к /api/ должен нести подписанный initData в заголовке."""
    if not request.path.startswith("/api/"):
        return await handler(request)
    cfg = request.app[CFG]
    user = validate_init_data(request.headers.get("X-Telegram-Init-Data", ""), cfg.bot_token)
    if not user:
        return json_error(401, "Неверная подпись Telegram. Откройте приложение через бота.")
    if user["id"] not in cfg.allowed_user_ids:
        return json_error(403, f"Доступ закрыт. Ваш Telegram ID: {user['id']}")
    request["user"] = user
    return await handler(request)


async def index(request: web.Request) -> web.FileResponse:
    resp = web.FileResponse(request.app[CFG].webapp_dir / "index.html")
    resp.headers["Cache-Control"] = "no-cache"
    return resp


async def health(request: web.Request) -> web.Response:
    return web.json_response({"ok": True})


async def meta(request: web.Request) -> web.Response:
    cfg = request.app[CFG]
    user = request["user"]
    return web.json_response({
        "currency": cfg.currency,
        "categories": {"expense": EXPENSE_CATEGORIES, "income": INCOME_CATEGORIES},
        "me": {"id": user["id"], "name": user_name(user)},
    })


async def month_data(request: web.Request) -> web.Response:
    month = request.query.get("month", "")
    if not MONTH_RE.match(month):
        return json_error(400, "Параметр month должен быть в формате ГГГГ-ММ")
    db = request.app[DB]
    txs = await db.list_month(month)
    s = await db.summary(month)
    summary = {
        "income": to_major(s["income"]),
        "expense": to_major(s["expense"]),
        "balance": to_major(s["balance"]),
        "by_category": [{"category": c["category"], "amount": to_major(c["amount_minor"])}
                        for c in s["by_category"]],
        "by_user": [{"user_id": u["user_id"], "name": u["name"],
                     "income": to_major(u["income"]), "expense": to_major(u["expense"])}
                    for u in s["by_user"]],
    }
    return web.json_response({"month": month, "transactions": [tx_out(t) for t in txs],
                              "summary": summary})


async def create_tx(request: web.Request) -> web.Response:
    try:
        body = await request.json()
    except Exception:
        return json_error(400, "Ожидался JSON")

    kind = body.get("kind")
    if kind not in ("income", "expense"):
        return json_error(400, "kind должен быть income или expense")

    amount_minor = parse_amount(body.get("amount"))
    if amount_minor is None:
        return json_error(400, "Некорректная сумма")

    allowed = INCOME_CATEGORIES if kind == "income" else EXPENSE_CATEGORIES
    category = str(body.get("category", "")).strip()
    if category not in allowed:
        return json_error(400, "Неизвестная категория")

    comment = str(body.get("comment", "")).strip()[:200]

    op_date = str(body.get("date") or date.today().isoformat())
    try:
        if not DATE_RE.match(op_date):
            raise ValueError
        date.fromisoformat(op_date)
    except ValueError:
        return json_error(400, "Дата должна быть в формате ГГГГ-ММ-ДД")

    user = request["user"]
    tx = await request.app[DB].add(
        user_id=user["id"], user_name=user_name(user), kind=kind, amount_minor=amount_minor,
        category=category, comment=comment, op_date=op_date,
    )
    bot = request.app[BOT]
    if bot:
        await notify_added(bot, request.app[CFG], tx)
    return web.json_response(tx_out(tx), status=201)


async def delete_tx(request: web.Request) -> web.Response:
    try:
        tx_id = int(request.match_info["tx_id"])
    except ValueError:
        return json_error(400, "Некорректный id")
    db = request.app[DB]
    tx = await db.get(tx_id)
    if not tx:
        return json_error(404, "Запись не найдена")
    await db.delete(tx_id)
    user = request["user"]
    bot = request.app[BOT]
    if bot:
        await notify_deleted(bot, request.app[CFG], tx, user["id"], user_name(user))
    return web.json_response({"ok": True})


def build_web_app(cfg: Config, db: Database, bot: Bot | None) -> web.Application:
    app = web.Application(middlewares=[auth_middleware], client_max_size=64 * 1024)
    app[CFG] = cfg
    app[DB] = db
    app[BOT] = bot
    app.router.add_get("/health", health)
    app.router.add_get("/api/meta", meta)
    app.router.add_get("/api/month", month_data)
    app.router.add_post("/api/transactions", create_tx)
    app.router.add_delete("/api/transactions/{tx_id}", delete_tx)
    app.router.add_get("/", index)
    app.router.add_static("/static/", cfg.webapp_dir)
    return app
