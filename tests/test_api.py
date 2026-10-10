"""Проверки без Telegram: подпись initData, доступ, добавление/удаление, сводка.
Запуск: python -m pytest -q
"""
import time

import pytest
from aiohttp.test_utils import TestClient, TestServer

from bot.api import build_web_app
from bot.auth import make_init_data, validate_init_data
from bot.config import Config
from bot.db import Database
from bot.money import fmt_money, parse_amount

TOKEN = "123456:TEST-TOKEN"
NASTYA = {"id": 111, "first_name": "Настя"}
PARTNER = {"id": 222, "first_name": "Дима"}
STRANGER = {"id": 999, "first_name": "Чужой"}


def headers(user, token=TOKEN):
    return {"X-Telegram-Init-Data": make_init_data(user, token)}


@pytest.fixture
async def client():
    cfg = Config(bot_token=TOKEN, webapp_url="", allowed_user_ids={111, 222}, db_path=":memory:")
    db = Database(":memory:")
    await db.init()
    async with TestClient(TestServer(build_web_app(cfg, db, bot=None))) as c:
        yield c
    await db.close()


def test_money():
    assert parse_amount("1 250,5") == 125050
    assert parse_amount(0) is None
    assert parse_amount("abc") is None
    assert fmt_money(125050, "RSD") == "1 250,50 RSD"
    assert fmt_money(50000, "RSD") == "500 RSD"


def test_auth_signature():
    data = make_init_data(NASTYA, TOKEN)
    assert validate_init_data(data, TOKEN)["id"] == 111
    assert validate_init_data(data, "999:OTHER") is None          # чужой токен
    assert validate_init_data(data.replace("111", "112"), TOKEN) is None  # подмена данных
    old = make_init_data(NASTYA, TOKEN, auth_date=int(time.time()) - 3 * 86400)
    assert validate_init_data(old, TOKEN) is None                 # устаревшие данные


async def test_access(client):
    assert (await client.get("/api/meta")).status == 401
    assert (await client.get("/api/meta", headers=headers(STRANGER))).status == 403
    r = await client.get("/api/meta", headers=headers(NASTYA))
    assert r.status == 200
    assert (await r.json())["me"]["name"] == "Настя"


async def test_shared_ledger(client):
    r = await client.post("/api/transactions", headers=headers(NASTYA), json={
        "kind": "expense", "amount": "1200,50", "category": "Продукты",
        "comment": "Лидл", "date": "2026-10-10"})
    assert r.status == 201, await r.text()
    tx = await r.json()
    await client.post("/api/transactions", headers=headers(PARTNER), json={
        "kind": "income", "amount": 80000, "category": "Зарплата", "date": "2026-10-05"})

    # партнёр видит запись Насти — это и есть синхронизация
    data = await (await client.get("/api/month?month=2026-10", headers=headers(PARTNER))).json()
    assert len(data["transactions"]) == 2
    s = data["summary"]
    assert s["income"] == 80000 and s["expense"] == 1200.5 and s["balance"] == 78799.5
    assert {u["name"] for u in s["by_user"]} == {"Настя", "Дима"}

    r = await client.delete(f"/api/transactions/{tx['id']}", headers=headers(PARTNER))
    assert r.status == 200
    data = await (await client.get("/api/month?month=2026-10", headers=headers(NASTYA))).json()
    assert len(data["transactions"]) == 1


async def test_validation(client):
    bad = [
        {"kind": "x", "amount": 1, "category": "Кафе"},
        {"kind": "expense", "amount": -5, "category": "Кафе"},
        {"kind": "expense", "amount": 5, "category": "Зарплата"},
        {"kind": "expense", "amount": 5, "category": "Кафе", "date": "2026-13-40"},
    ]
    for body in bad:
        r = await client.post("/api/transactions", headers=headers(NASTYA), json=body)
        assert r.status == 400, body
    assert (await client.get("/api/month?month=2026-1", headers=headers(NASTYA))).status == 400


async def test_static(client):
    r = await client.get("/")
    assert r.status == 200 and "Бюджет" in await r.text()
    assert (await client.get("/static/app.js")).status == 200
