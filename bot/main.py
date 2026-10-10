"""Точка входа: запускает в одном процессе и веб-сервер (Mini App + API), и бота."""
import asyncio
import logging

from aiogram import Bot, Dispatcher
from aiogram.client.default import DefaultBotProperties
from aiogram.types import BotCommand, MenuButtonWebApp, WebAppInfo
from aiohttp import web

from .api import build_web_app
from .config import load_config
from .db import Database
from .handlers import router


async def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    log = logging.getLogger("budget")

    cfg = load_config()
    if not cfg.allowed_user_ids:
        log.warning("ALLOWED_USER_IDS пуст: бот только подскажет пользователям их ID")

    db = Database(cfg.db_path)
    await db.init()

    bot = Bot(cfg.bot_token, default=DefaultBotProperties(parse_mode="HTML"))
    dp = Dispatcher()
    dp.include_router(router)

    runner = web.AppRunner(build_web_app(cfg, db, bot))
    await runner.setup()
    await web.TCPSite(runner, cfg.host, cfg.port).start()
    log.info("Веб-сервер слушает %s:%s", cfg.host, cfg.port)

    await bot.set_my_commands([
        BotCommand(command="start", description="Открыть бюджет"),
        BotCommand(command="balance", description="Итоги месяца"),
        BotCommand(command="help", description="Как пользоваться"),
    ])
    if cfg.webapp_url:
        # Кнопка «Бюджет» слева от поля ввода в чате с ботом
        await bot.set_chat_menu_button(
            menu_button=MenuButtonWebApp(text="Бюджет", web_app=WebAppInfo(url=cfg.webapp_url))
        )

    try:
        # cfg и db автоматически передаются в хендлеры как аргументы
        await dp.start_polling(bot, cfg=cfg, db=db)
    finally:
        await runner.cleanup()
        await db.close()
        await bot.session.close()


if __name__ == "__main__":
    asyncio.run(main())
