"""CSV normalization and preview. No financial rows are written during preview."""
import csv
import hashlib
import io
import json
import re
from collections import Counter
from datetime import datetime
from decimal import Decimal, InvalidOperation

from pypdf import PdfReader

from .common import fail, now, uid
from .db import all_rows, one


FIELDS = ("transaction_id", "account_id", "booking_date", "amount", "debit", "credit", "currency", "description", "bank_type", "counterparty", "counterparty_account_id")
ALIASES = {
    "transaction_id": {"transaction_id", "operation_id", "id", "номер операции"},
    "account_id": {"account_id", "account", "счет", "счёт"},
    "booking_date": {"booking_date", "date", "дата", "дата операции"},
    "amount": {"amount", "сумма"},
    "debit": {"debit", "списание"},
    "credit": {"credit", "зачисление"},
    "currency": {"currency", "валюта"},
    "description": {"description", "назначение", "описание"},
    "bank_type": {"bank_type", "тип операции"},
    "counterparty": {"counterparty", "контрагент"},
    "counterparty_account_id": {"counterparty_account_id", "счет контрагента", "счёт контрагента"},
}
KNOWN_TYPES = {"purchase", "salary", "transfer", "refund", "cash_withdrawal", "unknown"}


def extract_text_from_pdf(data: bytes) -> str:
    if not data.startswith(b"%PDF"):
        fail("INVALID_FILE", "Файл не является PDF")
    try:
        reader = PdfReader(io.BytesIO(data))
        pages = []
        for page in reader.pages:
            text = page.extract_text() or ""
            if text:
                pages.append(text)
        text = "\n".join(pages).strip()
        if not text:
            fail("INVALID_PDF", "PDF не содержит текста для импорта")
        return text
    except Exception as exc:  # pragma: no cover - defensive guard for malformed PDF
        fail("INVALID_PDF", f"Не удалось прочитать PDF: {exc}")


def decode_file(data, encoding=None):
    if len(data) > 10 * 1024 * 1024:
        fail("FILE_TOO_LARGE", "Размер файла превышает 10 MB")
    if data.startswith(b"%PDF"):
        return extract_text_from_pdf(data), "pdf"
    choices = [encoding] if encoding else ["utf-8-sig", "cp1251"]
    for choice in choices:
        if choice not in ("utf-8", "utf-8-sig", "cp1251"):
            fail("INVALID_ENCODING", "Поддерживаются UTF-8 и Windows-1251")
        try:
            return data.decode(choice), choice
        except UnicodeDecodeError:
            pass
    fail("INVALID_ENCODING", "Не удалось прочитать файл; выберите кодировку")


def parse_date(value):
    for fmt in ("%Y-%m-%d", "%d.%m.%Y"):
        try:
            return datetime.strptime(value.strip(), fmt).date().isoformat()
        except ValueError:
            pass
    raise ValueError("Ожидается дата YYYY-MM-DD или DD.MM.YYYY")


def parse_money(value):
    value = str(value).strip().replace("\u00a0", "").replace("\u202f", "").replace(" ", "")
    if not value or not re.fullmatch(r"[+-]?\d+(?:[.,]\d+)?", value):
        raise ValueError("Некорректная сумма")
    fractional = re.split(r"[.,]", value)
    if len(fractional) == 2 and len(fractional[1]) == 3:
        raise ValueError("Неоднозначный десятичный разделитель")
    try:
        amount = Decimal(value.replace(",", "."))
    except InvalidOperation:
        raise ValueError("Некорректная сумма")
    minor = amount * 100
    if minor != minor.to_integral_value() or minor == 0:
        raise ValueError("Сумма должна быть ненулевой с точностью до копейки")
    return int(minor)


def mapping_for(headers, mapping):
    if mapping is not None and not isinstance(mapping, dict):
        fail("INVALID_MAPPING", "Сопоставление должно быть объектом")
    if mapping:
        if any(key not in FIELDS or value not in headers for key, value in mapping.items()):
            fail("INVALID_MAPPING", "В сопоставлении есть неизвестная колонка")
        return mapping
    return {key: next((h for h in headers if h.strip().lower() in aliases), None)
            for key, aliases in ALIASES.items()}


def normalize(text, mapping=None, account_id=None, currency=None, delimiter=None, type_mapping=None):
    if type_mapping is not None and not isinstance(type_mapping, dict):
        fail("INVALID_MAPPING", "Сопоставление типов должно быть объектом")
    if delimiter is None:
        try:
            delimiter = csv.Sniffer().sniff(text[:4096], delimiters=",;").delimiter
        except csv.Error:
            delimiter = ","
    if delimiter not in (",", ";"):
        fail("INVALID_DELIMITER", "Поддерживается разделитель ',' или ';'")
    reader = csv.DictReader(io.StringIO(text, newline=""), delimiter=delimiter)
    headers = reader.fieldnames or []
    if not headers:
        fail("INVALID_CSV", "Нет заголовков CSV")
    mapping = mapping_for(headers, mapping)
    if not mapping.get("booking_date") or not (mapping.get("amount") or mapping.get("debit") and mapping.get("credit")) or not (mapping.get("account_id") or account_id) or not (mapping.get("currency") or currency):
        fail("MISSING_COLUMNS", "Нужны счёт, дата, сумма и валюта; задайте сопоставление или значения по умолчанию")
    parsed, errors = [], []
    for index, row in enumerate(reader, 2):
        if index > 10001:
            fail("TOO_MANY_ROWS", "Допускается максимум 10 000 строк")
        if None in row:
            errors.append({"row": index, "message": "Лишние значения в строке"})
            continue
        def get(key):
            return (row.get(mapping.get(key)) or "").strip() if mapping.get(key) else ""
        try:
            debit, credit = get("debit"), get("credit")
            if mapping.get("amount"):
                amount = parse_money(get("amount"))
            else:
                if bool(debit) == bool(credit):
                    raise ValueError("Заполните только списание или зачисление")
                amount = -abs(parse_money(debit)) if debit else abs(parse_money(credit))
            item = {
                "source_row": index, "external_id": get("transaction_id") or None,
                "account_id": get("account_id") or account_id,
                "booking_date": parse_date(get("booking_date")),
                "amount_minor": amount, "currency": get("currency") or currency,
                "description": get("description")[:500],
                "bank_type": (type_mapping or {}).get(get("bank_type"), get("bank_type")) or "unknown",
                "counterparty": get("counterparty")[:200] or None,
                "counterparty_account_ref": get("counterparty_account_id")[:100] or None,
            }
            if item["currency"] != "RUB":
                raise ValueError("Поддерживается только RUB")
            if not item["account_id"]:
                raise ValueError("Не указан счёт")
            if item["bank_type"] not in KNOWN_TYPES:
                item["bank_type"] = "unknown"
            fp_fields = [item[k] for k in ("account_id", "booking_date", "amount_minor", "currency", "description", "counterparty", "bank_type")]
            normalized = [re.sub(r"\s+", " ", x.strip()).casefold() if isinstance(x, str) else x for x in fp_fields]
            item["fingerprint"] = hashlib.sha256(json.dumps(normalized, ensure_ascii=False).encode()).hexdigest()
            parsed.append(item)
        except ValueError as exc:
            errors.append({"row": index, "message": str(exc)})
    return parsed, errors, mapping, delimiter, headers


def mark_duplicates(conn, rows, profile):
    occurrences = Counter()
    seen_ids = {}
    result = []
    for item in rows:
        if item["external_id"]:
            key = f"id:{profile}:{item['account_id']}:{item['external_id']}"
            previous = one(conn, "SELECT booking_date,amount_minor,currency FROM raw_transactions WHERE stable_key=%s", (key,))
            status = "conflict" if previous and (str(previous["booking_date"]), previous["amount_minor"], previous["currency"]) != (item["booking_date"], item["amount_minor"], item["currency"]) else "duplicate" if previous else "new"
            signature = (item["booking_date"], item["amount_minor"], item["currency"])
            if key in seen_ids:
                status = "duplicate" if seen_ids[key] == signature else "conflict"
            seen_ids[key] = signature
        else:
            occurrences[item["fingerprint"]] += 1
            index = occurrences[item["fingerprint"]]
            key = f"fp:{profile}:{item['fingerprint']}:{index}"
            status = "duplicate" if one(conn, "SELECT 1 FROM raw_transactions WHERE stable_key=%s", (key,)) else "new"
        item["stable_key"] = key
        item["status"] = status
        result.append(item)
    return result
