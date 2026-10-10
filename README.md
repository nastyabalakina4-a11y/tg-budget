# 💸 Бюджет на двоих — Telegram Mini App

Мини-приложение внутри Telegram для совместного учёта доходов и расходов двух человек.
Оба видят одну и ту же базу, а бот сразу пишет второму участнику, когда первый что-то добавил.

| Операции | Статистика | Добавление |
|---|---|---|
| ![](docs/list.png) | ![](docs/stats.png) | ![](docs/add.png) |

## Возможности

- **Mini App** в Telegram: доходы/расходы по месяцам, баланс, список с группировкой по дням, статистика по категориям и по людям.
- **Синхронизация на двоих**: общая база на сервере + автообновление экрана каждые 15 секунд и при возврате в приложение.
- **Уведомления партнёру** через бота: «💸 Настя: расход 1 200 RSD — Продукты (Лидл)».
- **Быстрый ввод прямо в чат с ботом**, без открытия приложения:
  - `500 кафе` — расход в категории «Кафе»
  - `-1200 продукты лидл` — расход с комментарием
  - `+80000 зарплата` — доход
- `/balance` — итоги месяца текстом.
- Подстраивается под светлую/тёмную тему Telegram.
- **Безопасность**: каждый запрос проверяется по подписи Telegram (`initData` + HMAC токеном бота), доступ только у двух ID из белого списка.

## Как это устроено

```
Telegram (Настя) ─┐                       ┌─ SQLite (data/budget.db)
                  ├─ HTTPS ─ Caddy ─ Python (aiohttp API + aiogram бот) ─┤
Telegram (Дима)  ─┘                       └─ Bot API → уведомление партнёру
```

> **Почему нужен сервер.** У Telegram нет общего хранилища на двоих: `CloudStorage` в Mini App у каждого пользователя свой и чужие данные не видны. Поэтому синхронизация = одна база на вашем сервере, а Telegram даёт вход без паролей и уведомления.

Стек: Python 3.12, [aiogram 3](https://docs.aiogram.dev/), aiohttp, SQLite (aiosqlite), чистые HTML/CSS/JS без сборки, Docker + Caddy.

```
bot/
  main.py      — точка входа: запускает веб-сервер и бота в одном процессе
  api.py       — HTTP API для Mini App + раздача статики
  auth.py      — проверка подписи initData от Telegram
  db.py        — SQLite: операции и сводка за месяц
  handlers.py  — команды бота и быстрый ввод сообщением
  notify.py    — уведомления второму участнику
  money.py     — суммы храним целыми «копейками», без ошибок float
  config.py    — настройки из .env и списки категорий
webapp/        — index.html, app.js, style.css (сам Mini App)
tests/         — тесты API и подписи
```

## Запуск на VPS (Ubuntu/Debian)

Нужно: VPS с публичным IP, домен (поддомен) и Docker. Mini App открывается **только по HTTPS** — это требование Telegram.

### 1. Создать бота

1. Напишите [@BotFather](https://t.me/BotFather) → `/newbot` → придумайте имя и username.
2. Скопируйте токен вида `1234567890:AAAA...` — это `BOT_TOKEN`. Никому его не показывайте и не коммитьте.

### 2. Направить поддомен на сервер

У регистратора домена создайте **A-запись**: `money` → IP вашего VPS. Проверить, что запись применилась:

```bash
dig +short money.example.com   # должен вернуть IP сервера
```

### 3. Поставить Docker и забрать код

```bash
curl -fsSL https://get.docker.com | sh          # официальный скрипт установки Docker
git clone https://github.com/<ваш-логин>/tg-budget.git
cd tg-budget
cp .env.example .env                            # создаём свой файл настроек из шаблона
nano .env                                       # вписываем BOT_TOKEN и WEBAPP_URL
mkdir -p data && sudo chown 1000:1000 data      # папка для базы; 1000 — UID пользователя в контейнере
```

`ALLOWED_USER_IDS` пока можно оставить пустым — узнаем ID на следующем шаге.

### 4. Запустить

```bash
docker compose up -d --build    # собрать образ и запустить в фоне (-d)
docker compose logs -f          # смотреть логи в реальном времени (выход — Ctrl+C)
```

Теперь **оба** участника пишут боту `/start` — он ответит каждому его Telegram ID. Впишите оба ID в `.env` через запятую и перезапустите:

```bash
nano .env                       # ALLOWED_USER_IDS=111111111,222222222
docker compose up -d            # пересоздаст контейнер с новыми настройками
```

> Важно, чтобы второй участник хотя бы раз нажал `/start`: бот не может первым написать человеку, который его не запускал, и уведомления не дойдут.

### 5. HTTPS через Caddy

Caddy — веб-сервер, который сам выпускает и продлевает сертификаты Let's Encrypt.

```bash
sudo apt install -y caddy                          # в Ubuntu 24.04+ есть в стандартных репозиториях
sudo cp Caddyfile /etc/caddy/Caddyfile             # кладём конфиг
sudo nano /etc/caddy/Caddyfile                     # меняем money.example.com на свой поддомен
sudo systemctl reload caddy                        # применяем без остановки
sudo ufw allow 80,443/tcp                          # открываем порты для HTTP/HTTPS (если включён ufw)
curl https://money.example.com/health              # должно вернуть {"ok": true}
```

Порт 8080 в `docker-compose.yml` привязан к `127.0.0.1`, поэтому приложение доступно снаружи только через Caddy по HTTPS.

После этого в чате с ботом появится кнопка **«Бюджет»** слева от поля ввода, и кнопка «📊 Открыть бюджет» в ответ на `/start`.

### Обновление

```bash
git pull && docker compose up -d --build
```

### Резервная копия базы

```bash
# копия в момент работы, без остановки (sqlite3 делает согласованный снимок)
sudo apt install -y sqlite3
sqlite3 data/budget.db ".backup 'data/backup-$(date +%F).db'"
```

Можно поставить в cron раз в сутки: `crontab -e` →
`0 3 * * * cd /home/<user>/tg-budget && sqlite3 data/budget.db ".backup 'data/backup-$(date +\%F).db'"`

## Локальная разработка и тесты

```bash
python3 -m venv .venv && source .venv/bin/activate   # отдельное окружение для зависимостей
pip install -r requirements-dev.txt
python -m pytest -q                                  # тесты подписи, доступа, API и сводки
python -m bot.main                                   # запуск с настройками из .env
```

Чтобы открыть Mini App с локального компьютера, нужен HTTPS-туннель, например `cloudflared tunnel --url http://localhost:8080` — полученный адрес вписать в `WEBAPP_URL`.

## API

Все запросы `/api/*` требуют заголовок `X-Telegram-Init-Data` (его подставляет Mini App).

| Метод | Путь | Что делает |
|---|---|---|
| GET | `/api/meta` | валюта, категории, текущий пользователь |
| GET | `/api/month?month=2026-10` | операции и сводка за месяц |
| POST | `/api/transactions` | добавить `{kind, amount, category, comment, date}` |
| DELETE | `/api/transactions/{id}` | удалить операцию |
| GET | `/health` | проверка, что сервер жив |

## Идеи для развития

- Редактирование операций, а не только удаление.
- Лимиты по категориям на месяц с предупреждением в боте.
- Экспорт в CSV / Google Sheets.
- Несколько валют с курсом (RSD/EUR).
