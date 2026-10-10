"""Работа с суммами. Храним деньги целым числом в «копейках» (пара/центы),
чтобы не было ошибок округления float (0.1 + 0.2 != 0.3)."""
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP

MAX_MINOR = 10**14  # защита от абсурдных сумм


def parse_amount(value) -> int | None:
    """'1 250,5' / 1250.5 / '1250' -> 125050. None, если сумма некорректна."""
    try:
        text = str(value).replace(" ", "").replace(" ", "").replace(",", ".")
        dec = Decimal(text).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    except (InvalidOperation, ValueError):
        return None
    minor = int(dec * 100)
    if minor <= 0 or minor >= MAX_MINOR:
        return None
    return minor


def to_major(minor: int) -> float:
    return round(minor / 100, 2)


def fmt_money(minor: int, currency: str) -> str:
    """125050 -> '1 250,50 RSD', 50000 -> '500 RSD'."""
    text = f"{minor / 100:,.2f}".replace(",", " ")
    if text.endswith(".00"):
        text = text[:-3]
    return f"{text.replace('.', ',')} {currency}"
