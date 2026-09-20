from datetime import date, datetime, timezone
from uuid import uuid4

from fastapi import HTTPException


CATEGORIES = {
    "groceries", "restaurants", "transport", "home", "electronics", "health",
    "entertainment", "services", "fees", "other", "uncategorized",
}


def uid():
    return str(uuid4())


def now():
    return datetime.now(timezone.utc).isoformat()


def fail(code, message, status=422):
    raise HTTPException(status_code=status, detail={"code": code, "message": message})


def category_for(description):
    value = description.lower()
    for words, category in [
        (("продукт", "супермаркет", "еда"), "groceries"),
        (("ресторан", "кафе", "ужин"), "restaurants"),
        (("транспорт", "метро", "такси"), "transport"),
        (("техник", "электрон"), "electronics"),
        (("аптек", "медицин"), "health"),
    ]:
        if any(word in value for word in words):
            return category
    return "uncategorized"


def require_category(value):
    if value not in CATEGORIES:
        fail("INVALID_CATEGORY", "Неизвестная категория")
    return value


def iso_date(value):
    try:
        return date.fromisoformat(value).isoformat()
    except (TypeError, ValueError):
        fail("INVALID_DATE", "Дата должна быть в формате YYYY-MM-DD")
