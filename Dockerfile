FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY bot ./bot
COPY webapp ./webapp

# Запускаем не от root — так безопаснее
RUN useradd --create-home --uid 1000 app && mkdir -p /app/data && chown app:app /app/data
USER app

EXPOSE 8080
CMD ["python", "-m", "bot.main"]
