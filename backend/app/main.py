import hashlib
import json
import os
from contextlib import asynccontextmanager
from datetime import date, timedelta
from pathlib import Path
from typing import Literal

from fastapi import BackgroundTasks, FastAPI, File, Form, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from .common import CATEGORIES, category_for, fail, now, require_category, uid
from .contracts import AnalyticsResponse, CommitResponse, DecisionResponse, EventResponse, ManualResponse, PreviewResponse, TransactionPage, UndoResponse
from .db import all_rows, migrate, one, transaction
from .domain import auto_pair_transfers, check_command, classify, create_event_for_raw, event, event_raws, remaining, refund, refresh_effects, settle, share, snapshot, undo
from .importing import FIELDS, decode_file, mark_duplicates, normalize
from .text_suggestions import configured_mode, suggest


@asynccontextmanager
async def lifespan(app):
    migrate()
    yield


app = FastAPI(title="Честный месяц API", version="0.1.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=os.getenv("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(","), allow_credentials=False, allow_methods=["*"], allow_headers=["*"])


class Coverage(BaseModel):
    account_id: str
    date_from: date
    date_to: date
    asserted_by_user: bool = False


class CommitRequest(BaseModel):
    preview_id: str
    selected_rows: list[int] | None = None
    import_valid_only: bool = False
    coverage: list[Coverage] = Field(default_factory=list)
    idempotency_key: str = Field(min_length=1, max_length=100)


class AccountRequest(BaseModel):
    id: str = Field(min_length=1, max_length=100)
    name: str = Field(min_length=1, max_length=100)
    kind: Literal["bank", "cash"] = "bank"
    own_confirmed: bool = False
    opening_balance_minor: int | None = None
    opening_balance_date: date | None = None


class AccountPatch(BaseModel):
    name: str | None = None
    own_confirmed: bool | None = None
    opening_balance_minor: int | None = None
    opening_balance_date: date | None = None


class ClassifyRequest(BaseModel):
    kind: Literal["EXPENSE", "INCOME", "LOAN_ISSUED"]
    category: str | None = None
    participant: str | None = None
    expected_revision: int
    command_id: str = Field(min_length=1, max_length=100)


class ShareInput(BaseModel):
    participant: str = Field(min_length=1, max_length=100)
    amount_minor: int = Field(ge=0)
    is_self: bool = False


class ShareRequest(BaseModel):
    shares: list[ShareInput] = Field(min_length=2)
    category: str | None = None
    expected_revision: int
    command_id: str = Field(min_length=1, max_length=100)


class SettlementRequest(BaseModel):
    event_id: str
    receivable_id: str
    expected_revision: int
    command_id: str = Field(min_length=1, max_length=100)


class SettlementGroupRequest(BaseModel):
    items: list[SettlementRequest] = Field(min_length=1, max_length=20)


class RefundRequest(BaseModel):
    event_id: str
    purchase_event_id: str
    expected_revision: int
    command_id: str = Field(min_length=1, max_length=100)


class CashExpenseRequest(BaseModel):
    booking_date: date
    amount_minor: int = Field(gt=0)
    category: str
    description: str = Field(min_length=1, max_length=500)
    command_id: str = Field(min_length=1, max_length=100)


class SnoozeRequest(BaseModel):
    pass


class QuestionAnswer(BaseModel):
    action: Literal["classify", "settle", "refund"]
    expected_revision: int
    command_id: str
    kind: str | None = None
    category: str | None = None
    participant: str | None = None
    receivable_id: str | None = None
    purchase_event_id: str | None = None


class RulePatch(BaseModel):
    enabled: bool


class RuleRequest(BaseModel):
    merchant: str = Field(min_length=1, max_length=200)
    category: str


class SuggestionItem(BaseModel):
    description: str = Field(max_length=200)
    counterparty: str | None = Field(None, max_length=100)
    bank_type: str = Field("unknown", max_length=40)


class SuggestionRequest(BaseModel):
    descriptions: list[SuggestionItem] = Field(min_length=1, max_length=20)
    consent_external: bool = False


class ModelSettingsRequest(BaseModel):
    consent_external: bool


class ImportProfileRequest(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    mapping: dict[str, str]
    delimiter: Literal[",", ";"] | None = None
    encoding: Literal["utf-8", "utf-8-sig", "cp1251"] | None = None
    type_mapping: dict[str, str] = Field(default_factory=dict)
    default_account_id: str | None = None
    default_currency: Literal["RUB"] | None = None


@app.get("/health")
def health():
    with transaction() as conn:
        one(conn, "SELECT 1")
    return {"status": "ok"}


@app.get("/api/meta")
def meta():
    mode = configured_mode()
    return {"currency": "RUB", "categories": sorted(CATEGORIES), "llm": {"mode": mode, "status": "disabled" if mode == "disabled" else "ready"}, "demo_today": "2026-09-30"}


@app.get("/api/settings/model")
def get_model_settings():
    with transaction() as conn:
        row = one(conn, "SELECT consent_external FROM model_settings WHERE id=1")
        return {"mode": configured_mode(), "consent_external": bool(row["consent_external"]), "key_configured": bool(os.getenv("TEXT_MODEL_API_KEY"))}


@app.patch("/api/settings/model")
def patch_model_settings(payload: ModelSettingsRequest):
    with transaction() as conn:
        conn.execute("UPDATE model_settings SET consent_external=%s WHERE id=1", (int(payload.consent_external),))
    return {"mode": configured_mode(), "consent_external": payload.consent_external}


def enrich_batch(batch_id: str):
    """Background text enrichment; failures never roll back imported financial facts."""
    try:
        with transaction() as conn:
            conn.execute("UPDATE model_jobs SET status='running' WHERE batch_id=%s", (batch_id,))
        with transaction() as conn:
            rows = all_rows(conn, "SELECT DISTINCT description,counterparty,bank_type FROM raw_transactions WHERE batch_id=%s AND description<>'' ORDER BY description LIMIT 20", (batch_id,))
        for row in rows:
            with transaction() as conn:
                result = suggest(conn, row["description"], row["counterparty"], row["bank_type"], True)
                conn.execute("UPDATE model_jobs SET processed=processed+1,failed=failed+%s WHERE batch_id=%s", (int(result["status"] != "ready"), batch_id))
        with transaction() as conn:
            conn.execute("UPDATE model_jobs SET status='done' WHERE batch_id=%s", (batch_id,))
    except Exception:
        with transaction() as conn:
            conn.execute("UPDATE model_jobs SET status='error' WHERE batch_id=%s", (batch_id,))


@app.get("/api/accounts")
def accounts():
    with transaction() as conn:
        rows = all_rows(conn, "SELECT * FROM accounts ORDER BY id")
        for row in rows:
            row["cashflow_minor"] = one(conn, "SELECT COALESCE(SUM(amount_minor),0) AS amount FROM movements WHERE account_id=%s", (row["id"],))["amount"]
            row["calculated_balance_minor"] = row["opening_balance_minor"] + row["cashflow_minor"] if row["opening_balance_minor"] is not None else None
            row["latest_transaction_date"] = one(conn, "SELECT MAX(date) AS day FROM movements WHERE account_id=%s", (row["id"],))["day"]
            row["coverage"] = all_rows(conn, "SELECT date_from,date_to,asserted_by_user FROM coverage WHERE account_id=%s ORDER BY date_from", (row["id"],))
        return rows


@app.get("/api/import-profiles")
def import_profiles():
    with transaction() as conn:
        rows = all_rows(conn, "SELECT * FROM import_profiles ORDER BY name")
        for row in rows:
            row["mapping"] = json.loads(row.pop("mapping_json"))
            row["type_mapping"] = json.loads(row.pop("type_mapping_json"))
        return rows


@app.post("/api/import-profiles")
def save_import_profile(payload: ImportProfileRequest):
    if any(key not in FIELDS or not value for key, value in payload.mapping.items()):
        fail("INVALID_MAPPING", "Неизвестное поле или пустой заголовок")
    with transaction() as conn:
        conn.execute("""INSERT INTO import_profiles(name,mapping_json,delimiter,encoding,type_mapping_json,default_account_id,default_currency)
            VALUES (%s,%s,%s,%s,%s,%s,%s) ON CONFLICT(name) DO UPDATE SET mapping_json=EXCLUDED.mapping_json,
            delimiter=EXCLUDED.delimiter,encoding=EXCLUDED.encoding,type_mapping_json=EXCLUDED.type_mapping_json,
            default_account_id=EXCLUDED.default_account_id,default_currency=EXCLUDED.default_currency""",
            (payload.name, json.dumps(payload.mapping, ensure_ascii=False), payload.delimiter, payload.encoding,
             json.dumps(payload.type_mapping, ensure_ascii=False), payload.default_account_id, payload.default_currency))
    return {"name": payload.name}


@app.post("/api/accounts")
def create_account(payload: AccountRequest):
    with transaction() as conn:
        if one(conn, "SELECT 1 FROM accounts WHERE id=%s", (payload.id,)):
            fail("ACCOUNT_EXISTS", "Счёт уже существует", 409)
        conn.execute("INSERT INTO accounts(id,name,kind,own_confirmed,opening_balance_minor,opening_balance_date) VALUES (%s,%s,%s,%s,%s,%s)",
                     (payload.id, payload.name, payload.kind, int(payload.own_confirmed), payload.opening_balance_minor, payload.opening_balance_date))
        if payload.own_confirmed:
            auto_pair_transfers(conn)
    return {"id": payload.id}


@app.patch("/api/accounts/{account_id}")
def patch_account(account_id: str, payload: AccountPatch):
    values = payload.model_dump(exclude_unset=True)
    with transaction() as conn:
        if not one(conn, "SELECT 1 FROM accounts WHERE id=%s", (account_id,)):
            fail("NOT_FOUND", "Счёт не найден", 404)
        for key, value in values.items():
            if key not in {"name", "own_confirmed", "opening_balance_minor", "opening_balance_date"}:
                continue
            conn.execute(f"UPDATE accounts SET {key}=%s WHERE id=%s", (int(value) if key == "own_confirmed" and value is not None else value, account_id))
        auto_pair_transfers(conn)
        return one(conn, "SELECT * FROM accounts WHERE id=%s", (account_id,))


@app.post("/api/imports/preview", response_model=PreviewResponse)
async def preview(file: UploadFile = File(...), profile: str = Form("default"), mapping_json: str | None = Form(None), account_id: str | None = Form(None), currency: str | None = Form(None), encoding: str | None = Form(None), delimiter: str | None = Form(None), type_mapping_json: str | None = Form(None)):
    data = await file.read(10 * 1024 * 1024 + 1)
    with transaction() as conn:
        saved = one(conn, "SELECT * FROM import_profiles WHERE name=%s", (profile,))
    if saved:
        mapping_json = mapping_json or saved["mapping_json"]
        type_mapping_json = type_mapping_json or saved["type_mapping_json"]
        account_id = account_id or saved["default_account_id"]
        currency = currency or saved["default_currency"]
        encoding = encoding or saved["encoding"]
        delimiter = delimiter or saved["delimiter"]
    text, actual_encoding = decode_file(data, encoding)
    try:
        mapping = json.loads(mapping_json) if mapping_json else None
        types = json.loads(type_mapping_json) if type_mapping_json else None
    except json.JSONDecodeError:
        fail("INVALID_MAPPING", "Неверный JSON сопоставления")
    rows, errors, mapping, actual_delimiter, headers = normalize(text, mapping, account_id, currency, delimiter, types)
    with transaction() as conn:
        rows = mark_duplicates(conn, rows, profile)
        pid = uid()
        body = {"rows": rows, "errors": errors, "profile": profile, "file_name": (file.filename or "upload.csv")[:255], "file_hash": hashlib.sha256(data).hexdigest()}
        conn.execute("INSERT INTO previews(id,created_at,payload_json) VALUES (%s,%s,%s)", (pid, now(), json.dumps(body, ensure_ascii=False)))
    return {"preview_id": pid, "headers": headers, "mapping": mapping, "encoding": actual_encoding, "delimiter": actual_delimiter,
            "sample": rows[:10], "rows": rows, "errors": errors,
            "counts": {"new": sum(r["status"] == "new" for r in rows), "duplicate": sum(r["status"] == "duplicate" for r in rows), "conflict": sum(r["status"] == "conflict" for r in rows), "errors": len(errors)},
            "suggested_coverage": {"date_from": min((r["booking_date"] for r in rows), default=None), "date_to": max((r["booking_date"] for r in rows), default=None), "asserted_by_user": False}}


@app.post("/api/imports/commit", response_model=CommitResponse)
def commit(payload: CommitRequest, background_tasks: BackgroundTasks):
    with transaction() as conn:
        conn.execute("SELECT pg_advisory_xact_lock(hashtext(%s))", ("import:" + payload.idempotency_key,))
        previous = one(conn, "SELECT * FROM batches WHERE idempotency_key=%s", (payload.idempotency_key,))
        if previous:
            return {"batch_id": previous["id"], "new": previous["rows_new"], "duplicate": previous["rows_duplicate"], "idempotent_replay": True, "review_session_id": None}
        preview_row = one(conn, "SELECT payload_json,created_at FROM previews WHERE id=%s FOR UPDATE", (payload.preview_id,))
        if not preview_row:
            fail("PREVIEW_NOT_FOUND", "Предпросмотр не найден или уже подтверждён", 404)
        if (date.today() - date.fromisoformat(preview_row["created_at"][:10])).days > 1:
            fail("PREVIEW_EXPIRED", "Предпросмотр устарел; загрузите файл снова", 409)
        body = json.loads(preview_row["payload_json"])
        conn.execute("SELECT pg_advisory_xact_lock(hashtext(%s))", ("profile:" + body["profile"],))
        if body["errors"] and not payload.import_valid_only:
            fail("INVALID_ROWS", "Есть ошибки строк; подтвердите импорт только валидных", 409)
        selected = set(payload.selected_rows) if payload.selected_rows is not None else None
        if selected is not None and not selected <= {r["source_row"] for r in body["rows"]}:
            fail("INVALID_SELECTION", "Неизвестные номера строк")
        rows = [r for r in body["rows"] if selected is None or r["source_row"] in selected]
        for r in rows:
            existing_row = one(conn, "SELECT booking_date,amount_minor,currency FROM raw_transactions WHERE stable_key=%s", (r["stable_key"],))
            if existing_row:
                r["status"] = "duplicate" if (str(existing_row["booking_date"]), existing_row["amount_minor"], existing_row["currency"]) == (r["booking_date"], r["amount_minor"], r["currency"]) else "conflict"
        if any(r["status"] == "conflict" for r in rows):
            fail("DUPLICATE_CONFLICT", "Операция изменилась после предпросмотра", 409)
        bid = uid()
        new_count = sum(r["status"] == "new" for r in rows)
        duplicate_count = sum(r["status"] == "duplicate" for r in rows)
        conn.execute("INSERT INTO batches(id,file_name,file_hash,profile,created_at,idempotency_key,rows_new,rows_duplicate) VALUES (%s,%s,%s,%s,%s,%s,%s,%s)",
                     (bid, body["file_name"], body["file_hash"], body["profile"], now(), payload.idempotency_key, new_count, duplicate_count))
        for row in rows:
            if row["status"] != "new":
                continue
            account = one(conn, "SELECT 1 FROM accounts WHERE id=%s", (row["account_id"],))
            if not account:
                conn.execute("INSERT INTO accounts(id,name,kind) VALUES (%s,%s,'bank')", (row["account_id"], row["account_id"]))
            rid = uid()
            row["id"] = rid
            occurrence = int(row["stable_key"].rsplit(":", 1)[-1]) if row["stable_key"].startswith("fp:") else 1
            conn.execute("""INSERT INTO raw_transactions(id,batch_id,source_row,external_id,account_id,booking_date,amount_minor,currency,description,bank_type,counterparty,counterparty_account_ref,fingerprint,occurrence_index,stable_key)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                (rid, bid, row["source_row"], row["external_id"], row["account_id"], row["booking_date"], row["amount_minor"], row["currency"], row["description"], row["bank_type"], row["counterparty"], row["counterparty_account_ref"], row["fingerprint"], occurrence, row["stable_key"]))
            create_event_for_raw(conn, row)
        for coverage in payload.coverage:
            if coverage.date_from > coverage.date_to:
                fail("INVALID_COVERAGE", "Начало покрытия позже конца")
            if not one(conn, "SELECT 1 FROM accounts WHERE id=%s", (coverage.account_id,)):
                fail("INVALID_COVERAGE", "Неизвестный счёт покрытия")
            conn.execute("INSERT INTO coverage(id,batch_id,account_id,date_from,date_to,asserted_by_user) VALUES (%s,%s,%s,%s,%s,%s)",
                         (uid(), bid, coverage.account_id, coverage.date_from, coverage.date_to, int(coverage.asserted_by_user)))
        auto_pair_transfers(conn)
        session_id = uid() if new_count else None
        if session_id:
            conn.execute("INSERT INTO review_sessions(id,batch_id,created_at) VALUES (%s,%s,%s)", (session_id, bid, now()))
        model_consent = one(conn, "SELECT consent_external FROM model_settings WHERE id=1")["consent_external"]
        if new_count and configured_mode() != "disabled" and (configured_mode() == "mock" or model_consent):
            conn.execute("INSERT INTO model_jobs(batch_id,status) VALUES (%s,'queued')", (bid,))
            background_tasks.add_task(enrich_batch, bid)
        conn.execute("DELETE FROM previews WHERE id=%s", (payload.preview_id,))
        unresolved = one(conn, "SELECT COUNT(*) AS n FROM questions q JOIN event_raw er ON er.event_id=q.event_id JOIN raw_transactions r ON r.id=er.raw_id WHERE r.batch_id=%s AND q.status='open'", (bid,))["n"]
        return {"batch_id": bid, "new": new_count, "duplicate": duplicate_count, "unresolved": unresolved, "review_session_id": session_id, "idempotent_replay": False}


@app.get("/api/imports/{batch_id}")
def get_import(batch_id: str):
    with transaction() as conn:
        row = one(conn, "SELECT * FROM batches WHERE id=%s", (batch_id,))
        if not row:
            fail("NOT_FOUND", "Импорт не найден", 404)
        row["text_enrichment"] = one(conn, "SELECT status,processed,failed FROM model_jobs WHERE batch_id=%s", (batch_id,)) or {"status": "disabled"}
        return row


def previous_dates(start: date, end: date, grouping: str):
    if grouping == "day":
        return start - timedelta(days=1), start - timedelta(days=1)
    if grouping == "week":
        return start - timedelta(days=7), end - timedelta(days=7)
    if grouping == "year" and start.month == 1 and start.day == 1 and end.month == 12 and end.day == 31:
        y = start.year - 1
        return date(y, 1, 1), date(y, 12, 31)
    if grouping == "month" and start.day == 1:
        prev_end = start - timedelta(days=1)
        return prev_end.replace(day=1), prev_end
    length = (end - start).days + 1
    return start - timedelta(days=length), start - timedelta(days=1)


def analytics_data(conn, start, end, grouping, include_previous=True):
    if start > end:
        fail("INVALID_PERIOD", "Начало периода позже конца")
    effects = all_rows(conn, "SELECT date,measure,amount_minor,category FROM effects WHERE date BETWEEN %s AND %s ORDER BY date", (start, end))
    expenses = sum(x["amount_minor"] for x in effects if x["measure"] == "expense")
    income = sum(x["amount_minor"] for x in effects if x["measure"] == "income")
    unresolved = all_rows(conn, """SELECT m.amount_minor FROM movements m JOIN events e ON e.id=m.event_id
        WHERE e.active=1 AND e.kind='UNRESOLVED' AND m.origin='import' AND m.date BETWEEN %s AND %s""", (start, end))
    categories = {}
    for x in effects:
        if x["measure"] == "expense":
            key = x["category"] or "uncategorized"
            categories[key] = categories.get(key, 0) + x["amount_minor"]
    chunks = []
    cursor = start
    while cursor <= end:
        if grouping == "day":
            stop = cursor
        elif grouping == "week":
            stop = min(end, cursor + timedelta(days=6 - cursor.weekday()))
        elif grouping == "month":
            next_month = (cursor.replace(day=28) + timedelta(days=4)).replace(day=1)
            stop = min(end, next_month - timedelta(days=1))
        elif grouping == "year":
            stop = min(end, date(cursor.year, 12, 31))
        else:
            stop = end
        subset = [x for x in effects if cursor <= x["date"] <= stop]
        chunks.append({"date_from": cursor, "date_to": stop,
                       "expenses_minor": sum(x["amount_minor"] for x in subset if x["measure"] == "expense"),
                       "income_minor": sum(x["amount_minor"] for x in subset if x["measure"] == "income")})
        cursor = stop + timedelta(days=1)
    coverage = all_rows(conn, "SELECT account_id,date_from,date_to,asserted_by_user FROM coverage WHERE date_to>=%s AND date_from<=%s", (start, end))
    warnings = []
    if not coverage:
        warnings.append("Покрытие периода выписками не подтверждено")
    elif any(not c["asserted_by_user"] for c in coverage):
        warnings.append("Не все периоды покрытия подтверждены пользователем")
    bank_accounts = all_rows(conn, "SELECT id FROM accounts WHERE kind='bank'")
    for account in bank_accounts:
        spans = sorted((max(start, c["date_from"]), min(end, c["date_to"])) for c in coverage if c["account_id"] == account["id"] and c["asserted_by_user"])
        covered_until = start - timedelta(days=1)
        for left, right in spans:
            if left > covered_until + timedelta(days=1):
                break
            covered_until = max(covered_until, right)
        if covered_until < end:
            warnings.append(f"Есть пробелы в подтверждённом покрытии счёта {account['id']}")
    if unresolved:
        warnings.append("Есть неразобранные поступления или списания")
    result = {"date_from": start, "date_to": end, "expenses_minor": expenses, "income_minor": income, "net_minor": income - expenses,
              "unresolved_outgoing_minor": -sum(x["amount_minor"] for x in unresolved if x["amount_minor"] < 0),
              "unresolved_incoming_minor": sum(x["amount_minor"] for x in unresolved if x["amount_minor"] > 0),
              "unresolved_count": len(unresolved), "categories": [{"id": k, "amount_minor": v} for k, v in sorted(categories.items())],
              "periods": chunks, "coverage": coverage, "coverage_warnings": warnings,
              "gross_purchases_minor": sum(x["amount_minor"] for x in effects if x["measure"] == "expense" and x["amount_minor"] > 0),
              "refunds_minor": -sum(x["amount_minor"] for x in effects if x["measure"] == "expense" and x["amount_minor"] < 0)}
    if include_previous:
        p_start, p_end = previous_dates(start, end, grouping)
        previous = analytics_data(conn, p_start, p_end, grouping, False)
        result["previous_period"] = {"date_from": p_start, "date_to": p_end, "expenses_minor": previous["expenses_minor"], "income_minor": previous["income_minor"], "net_minor": previous["net_minor"],
                                     "expense_difference_minor": expenses - previous["expenses_minor"],
                                     "expense_percent": round((expenses - previous["expenses_minor"]) * 100 / previous["expenses_minor"], 2) if previous["expenses_minor"] > 0 else None,
                                     "coverage_warnings": previous["coverage_warnings"]}
    return result


@app.get("/api/analytics", response_model=AnalyticsResponse)
def analytics(date_from: date = Query(alias="from"), date_to: date = Query(alias="to"), grouping: Literal["day", "week", "month", "year", "custom"] = "week"):
    with transaction() as conn:
        return analytics_data(conn, date_from, date_to, grouping)


@app.get("/api/transactions", response_model=TransactionPage)
def transactions(date_from: date | None = Query(None, alias="from"), date_to: date | None = Query(None, alias="to"), account_id: str | None = None, kind: str | None = None, unresolved: bool | None = None, search: str | None = None, page: int = Query(1, ge=1), page_size: int = Query(50, ge=1, le=200)):
    clauses = ["e.active=1"]
    params = []
    if date_from:
        clauses.append("m.date>=%s"); params.append(date_from)
    if date_to:
        clauses.append("m.date<=%s"); params.append(date_to)
    if account_id:
        clauses.append("m.account_id=%s"); params.append(account_id)
    if kind:
        clauses.append("e.kind=%s"); params.append(kind)
    if unresolved is not None:
        clauses.append("e.kind=" + ("'UNRESOLVED'" if unresolved else "'UNRESOLVED'"))
        if not unresolved:
            clauses[-1] = "e.kind<>'UNRESOLVED'"
    if search:
        clauses.append("r.description ILIKE %s"); params.append(f"%{search[:100]}%")
    where = " AND ".join(clauses)
    base = "FROM events e JOIN movements m ON m.event_id=e.id LEFT JOIN raw_transactions r ON r.id=m.raw_id WHERE " + where
    with transaction() as conn:
        total = one(conn, "SELECT COUNT(DISTINCT e.id) AS n " + base, params)["n"]
        ids = all_rows(conn, "SELECT e.id,MAX(m.date) AS day " + base + " GROUP BY e.id ORDER BY day DESC,e.id LIMIT %s OFFSET %s", params + [page_size, (page - 1) * page_size])
        return {"total": total, "page": page, "page_size": page_size, "items": [event_detail(conn, x["id"]) for x in ids]}


def event_detail(conn, eid):
    e = event(conn, eid)
    e["raw_transactions"] = event_raws(conn, eid)
    e["movements"] = all_rows(conn, "SELECT id,account_id,date,amount_minor,origin FROM movements WHERE event_id=%s ORDER BY date,id", (eid,))
    e["effects"] = all_rows(conn, "SELECT date,measure,amount_minor,category FROM effects WHERE event_id=%s", (eid,))
    e["receivables"] = all_rows(conn, "SELECT * FROM receivables WHERE origin_event_id=%s", (eid,))
    e["settlement"] = one(conn, "SELECT * FROM settlements WHERE event_id=%s", (eid,))
    e["refund"] = one(conn, "SELECT * FROM refunds WHERE refund_event_id=%s", (eid,))
    e["decisions"] = all_rows(conn, "SELECT id,command_id,created_at,undone_at FROM decisions WHERE event_id=%s ORDER BY created_at", (eid,))
    return e


@app.get("/api/events/{event_id}", response_model=EventResponse)
def get_event(event_id: str):
    with transaction() as conn:
        return event_detail(conn, event_id)


@app.post("/api/events/{event_id}/classify", response_model=DecisionResponse)
def classify_event(event_id: str, payload: ClassifyRequest):
    with transaction() as conn:
        did = classify(conn, event_id, payload.kind, payload.category, payload.participant, payload.expected_revision, payload.command_id)
        return {"decision_id": did, "event": event_detail(conn, event_id)}


@app.post("/api/events/{event_id}/shared", response_model=DecisionResponse)
def shared_event(event_id: str, payload: ShareRequest):
    with transaction() as conn:
        did = share(conn, event_id, [s.model_dump() for s in payload.shares], payload.category, payload.expected_revision, payload.command_id)
        return {"decision_id": did, "event": event_detail(conn, event_id)}


@app.post("/api/settlements", response_model=DecisionResponse)
def create_settlement(payload: SettlementRequest):
    with transaction() as conn:
        did = settle(conn, payload.event_id, payload.receivable_id, payload.expected_revision, payload.command_id)
        return {"decision_id": did, "event": event_detail(conn, payload.event_id)}


@app.post("/api/settlements/group")
def create_settlement_group(payload: SettlementGroupRequest):
    if len({x.event_id for x in payload.items}) != len(payload.items):
        fail("DUPLICATE_EVENT", "В группе одно поступление может встречаться один раз")
    with transaction() as conn:
        results = []
        for item in payload.items:
            did = settle(conn, item.event_id, item.receivable_id, item.expected_revision, item.command_id)
            results.append({"decision_id": did, "event": event_detail(conn, item.event_id)})
        return {"items": results}


@app.post("/api/refunds", response_model=DecisionResponse)
def create_refund(payload: RefundRequest):
    with transaction() as conn:
        did = refund(conn, payload.event_id, payload.purchase_event_id, payload.expected_revision, payload.command_id)
        return {"decision_id": did, "event": event_detail(conn, payload.event_id)}


@app.post("/api/manual-cash-expenses", response_model=ManualResponse)
def manual_cash_expense(payload: CashExpenseRequest):
    require_category(payload.category)
    with transaction() as conn:
        existing = one(conn, "SELECT event_id FROM decisions WHERE command_id=%s", (payload.command_id,))
        if existing:
            return {"event": event_detail(conn, existing["event_id"]), "idempotent_replay": True}
        if not one(conn, "SELECT 1 FROM accounts WHERE id='cash'"):
            conn.execute("INSERT INTO accounts(id,name,kind,own_confirmed) VALUES ('cash','Наличные','cash',1)")
        eid = uid()
        conn.execute("INSERT INTO events(id,kind,resolution_status,resolution_source,category,explanation,created_at) VALUES (%s,'EXPENSE','confirmed','manual',%s,%s,%s)", (eid, payload.category, payload.description, now()))
        conn.execute("INSERT INTO movements(id,event_id,account_id,date,amount_minor,origin) VALUES (%s,%s,'cash',%s,%s,'manual')", (uid(), eid, payload.booking_date, -payload.amount_minor))
        refresh_effects(conn, eid)
        conn.execute("INSERT INTO decisions(id,event_id,command_id,before_json,after_json,created_at) VALUES (%s,%s,%s,'{}','{}',%s)", (uid(), eid, payload.command_id, now()))
        return {"event": event_detail(conn, eid), "idempotent_replay": False}


@app.post("/api/decisions/{decision_id}/undo", response_model=UndoResponse)
def undo_decision(decision_id: str, cascade: bool = False):
    with transaction() as conn:
        eid = undo(conn, decision_id, cascade)
        return {"event": event_detail(conn, eid) if one(conn, "SELECT 1 FROM events WHERE id=%s AND active=1", (eid,)) else None, "event_id": eid}


@app.get("/api/receivables")
def get_receivables(through: date | None = None, status: Literal["all", "open", "closed"] = "all"):
    with transaction() as conn:
        rows = all_rows(conn, "SELECT r.*,e.kind FROM receivables r JOIN events e ON e.id=r.origin_event_id WHERE e.active=1 ORDER BY r.created_date,r.id")
        for r in rows:
            r["remaining_minor"] = remaining(conn, r["id"], through)
            r["paid_minor"] = r["original_minor"] - r["remaining_minor"]
        return [r for r in rows if status == "all" or status == "open" and r["remaining_minor"] > 0 or status == "closed" and r["remaining_minor"] == 0]


@app.get("/api/questions")
def questions(mode: Literal["recommended", "all"] = "recommended", session_id: str | None = None, status: Literal["open", "resolved", "all"] = "open", limit: int = Query(100, ge=1, le=200), offset: int = Query(0, ge=0)):
    with transaction() as conn:
        session = one(conn, "SELECT * FROM review_sessions WHERE id=%s FOR UPDATE", (session_id,)) if session_id else None
        if session_id and not session:
            fail("NOT_FOUND", "Сессия разбора не найдена", 404)
        where = "" if status == "all" else "WHERE q.status=%s"
        params = () if status == "all" else (status,)
        rows = all_rows(conn, "SELECT q.*,e.revision,e.kind AS event_kind,r.description,r.booking_date,r.amount_minor,r.counterparty,r.bank_type FROM questions q JOIN events e ON e.id=q.event_id JOIN event_raw er ON er.event_id=e.id JOIN raw_transactions r ON r.id=er.raw_id " + where + " ORDER BY q.impact_minor DESC,r.booking_date,q.id LIMIT %s OFFSET %s", (*params, 200 if mode == "recommended" else limit, 0 if mode == "recommended" else offset))
        if mode == "recommended":
            rows = [r for r in rows if r["status"] == "open" and not r["snoozed_at"]]
            if session:
                shown = json.loads(session["shown_ids"])
                for row in rows:
                    if len(shown) >= 3:
                        break
                    if row["id"] not in shown:
                        shown.append(row["id"])
                conn.execute("UPDATE review_sessions SET shown_ids=%s WHERE id=%s", (json.dumps(shown), session_id))
                rows = [r for r in rows if r["id"] in shown]
            else:
                rows = rows[:3]
        for row in rows:
            row["candidates"] = []
            if row["event_kind"] != "UNRESOLVED" or row["amount_minor"] <= 0:
                continue
            receivables = all_rows(conn, "SELECT r.id,r.origin_event_id,r.participant,r.original_minor,r.created_date,e.kind FROM receivables r JOIN events e ON e.id=r.origin_event_id WHERE e.active=1 AND r.created_date<=%s ORDER BY r.created_date DESC LIMIT 100", (row["booking_date"],))
            for rec in receivables:
                name = rec["participant"].casefold()
                text = (row["counterparty"] or "").casefold() + " " + row["description"].casefold()
                if name in text and remaining(conn, rec["id"]) >= row["amount_minor"]:
                    row["candidates"].append({"action": "settle", "receivable_id": rec["id"], "origin_event_id": rec["origin_event_id"], "participant": rec["participant"], "remaining_minor": remaining(conn, rec["id"])})
            if row["bank_type"] == "refund":
                possible = all_rows(conn, "SELECT e.id,e.category,r.amount_minor FROM events e JOIN event_raw er ON er.event_id=e.id JOIN raw_transactions r ON r.id=er.raw_id WHERE e.active=1 AND e.kind='EXPENSE' AND r.booking_date<=%s AND r.amount_minor<0 ORDER BY r.booking_date DESC LIMIT 100", (row["booking_date"],))
                for purchase in possible:
                    used = one(conn, "SELECT COALESCE(SUM(amount_minor),0) AS amount FROM refunds WHERE purchase_event_id=%s", (purchase["id"],))["amount"]
                    if purchase["category"] == category_for(row["description"]) and -purchase["amount_minor"] - used >= row["amount_minor"]:
                        row["candidates"].append({"action": "refund", "purchase_event_id": purchase["id"], "available_minor": -purchase["amount_minor"] - used})
            row["candidates"] = row["candidates"][:5]
        return {"items": rows, "total_open": one(conn, "SELECT COUNT(*) AS n FROM questions WHERE status='open'")["n"], "session_shown_count": len(shown) if session and mode == "recommended" else len(json.loads(session["shown_ids"])) if session else None}


@app.post("/api/questions/{question_id}/snooze")
def snooze(question_id: str):
    with transaction() as conn:
        if not one(conn, "SELECT 1 FROM questions WHERE id=%s", (question_id,)):
            fail("NOT_FOUND", "Вопрос не найден", 404)
        conn.execute("UPDATE questions SET snoozed_at=%s WHERE id=%s", (now(), question_id))
    return {"status": "snoozed"}


@app.post("/api/questions/{question_id}/answer", response_model=DecisionResponse)
def answer(question_id: str, payload: QuestionAnswer):
    with transaction() as conn:
        q = one(conn, "SELECT * FROM questions WHERE id=%s", (question_id,))
        if not q:
            fail("NOT_FOUND", "Вопрос не найден", 404)
        if payload.action == "classify":
            did = classify(conn, q["event_id"], payload.kind, payload.category, payload.participant, payload.expected_revision, payload.command_id)
        elif payload.action == "settle":
            did = settle(conn, q["event_id"], payload.receivable_id, payload.expected_revision, payload.command_id)
        else:
            did = refund(conn, q["event_id"], payload.purchase_event_id, payload.expected_revision, payload.command_id)
        return {"decision_id": did, "event": event_detail(conn, q["event_id"])}


@app.get("/api/rules")
def rules():
    with transaction() as conn:
        return all_rows(conn, "SELECT * FROM rules ORDER BY merchant")


@app.post("/api/rules")
def create_rule(payload: RuleRequest):
    require_category(payload.category)
    merchant = payload.merchant.strip()
    with transaction() as conn:
        existing = one(conn, "SELECT id FROM rules WHERE LOWER(merchant)=LOWER(%s)", (merchant,))
        if existing:
            fail("RULE_EXISTS", "Правило для этого описания уже есть", 409)
        rid = uid()
        conn.execute("INSERT INTO rules(id,merchant,category) VALUES (%s,%s,%s)", (rid, merchant, payload.category))
        return one(conn, "SELECT * FROM rules WHERE id=%s", (rid,))


@app.patch("/api/rules/{rule_id}")
def patch_rule(rule_id: str, payload: RulePatch):
    with transaction() as conn:
        if not one(conn, "SELECT 1 FROM rules WHERE id=%s", (rule_id,)):
            fail("NOT_FOUND", "Правило не найдено", 404)
        conn.execute("UPDATE rules SET enabled=%s WHERE id=%s", (int(payload.enabled), rule_id))
        return one(conn, "SELECT * FROM rules WHERE id=%s", (rule_id,))


@app.post("/api/text-suggestions")
def text_suggestions(payload: SuggestionRequest):
    with transaction() as conn:
        return {"mode": configured_mode(), "items": [suggest(conn, x.description, x.counterparty, x.bank_type, payload.consent_external) for x in payload.descriptions]}


@app.get("/api/weekly-review")
def weekly_review(today: date | None = None):
    today = today or date.today()
    end = today - timedelta(days=today.weekday() + 1)
    start = end - timedelta(days=6)
    with transaction() as conn:
        report = analytics_data(conn, start, end, "week")
        state = one(conn, "SELECT * FROM weekly_reviews WHERE period_from=%s", (start,))
        if state and state["seen_at"]:
            new = one(conn, "SELECT COUNT(*) AS n FROM raw_transactions r JOIN batches b ON b.id=r.batch_id WHERE r.booking_date BETWEEN %s AND %s AND b.created_at>%s", (start, end, state["seen_at"]))["n"]
        else:
            new = one(conn, "SELECT COUNT(*) AS n FROM raw_transactions WHERE booking_date BETWEEN %s AND %s", (start, end))["n"]
        question = one(conn, "SELECT id FROM questions WHERE status='open' AND snoozed_at IS NULL ORDER BY impact_minor DESC,id LIMIT 1")
        report.update({"new_operations_since_seen": new, "seen_at": state["seen_at"] if state else None, "next_step": {"kind": "question", "question_id": question["id"]} if question else {"kind": "import"}, "today": today})
        return report


class SeenRequest(BaseModel):
    period_from: date
    period_to: date


@app.post("/api/weekly-review/seen")
def mark_seen(payload: SeenRequest):
    if (payload.period_to - payload.period_from).days != 6:
        fail("INVALID_PERIOD", "Нужна полная календарная неделя")
    with transaction() as conn:
        conn.execute("INSERT INTO weekly_reviews(period_from,period_to,seen_at,last_seen_import_cursor) VALUES (%s,%s,%s,%s) ON CONFLICT(period_from) DO UPDATE SET seen_at=EXCLUDED.seen_at,last_seen_import_cursor=EXCLUDED.last_seen_import_cursor", (payload.period_from, payload.period_to, now(), now()))
    return {"status": "seen"}


@app.post("/api/demo/load")
def demo_load():
    path = Path(__file__).resolve().parent.parent / "fixtures" / "demo.csv"
    text = path.read_text(encoding="utf-8")
    rows, errors, _, _, _ = normalize(text, currency="RUB")
    if errors:
        fail("DEMO_ERROR", "Ошибка встроенного набора", 500)
    with transaction() as conn:
        conn.execute("SELECT pg_advisory_xact_lock(hashtext('builtin-demo-v1'))")
        for aid, name, kind, opening, opening_day in [("main", "Основная карта", "bank", None, None), ("second", "Вторая карта", "bank", None, None), ("market", "Карта маркетплейса", "bank", None, None), ("cash", "Наличные", "cash", 0, "2026-09-01")]:
            conn.execute("INSERT INTO accounts(id,name,kind,opening_balance_minor,opening_balance_date,own_confirmed) VALUES (%s,%s,%s,%s,%s,%s) ON CONFLICT(id) DO NOTHING", (aid, name, kind, opening, opening_day, int(kind == "cash")))
        existing = one(conn, "SELECT id FROM batches WHERE idempotency_key='builtin-demo-v1'")
        if existing:
            return {"batch_id": existing["id"], "idempotent_replay": True}
        marked = mark_duplicates(conn, rows, "demo")
        bid = uid()
        conn.execute("INSERT INTO batches(id,file_name,file_hash,profile,created_at,idempotency_key,rows_new,rows_duplicate) VALUES (%s,'demo.csv',%s,'demo',%s,'builtin-demo-v1',%s,%s)", (bid, hashlib.sha256(text.encode()).hexdigest(), now(), sum(r["status"] == "new" for r in marked), sum(r["status"] == "duplicate" for r in marked)))
        for r in marked:
            if r["status"] != "new":
                continue
            rid = uid(); r["id"] = rid
            conn.execute("""INSERT INTO raw_transactions(id,batch_id,source_row,external_id,account_id,booking_date,amount_minor,currency,description,bank_type,counterparty,counterparty_account_ref,fingerprint,occurrence_index,stable_key)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,1,%s)""", (rid, bid, r["source_row"], r["external_id"], r["account_id"], r["booking_date"], r["amount_minor"], r["currency"], r["description"], r["bank_type"], r["counterparty"], r["counterparty_account_ref"], r["fingerprint"], r["stable_key"]))
            create_event_for_raw(conn, r)
        conn.execute("INSERT INTO review_sessions(id,batch_id,created_at) VALUES (%s,%s,%s)", (uid(), bid, now()))
        return {"batch_id": bid, "idempotent_replay": False, "new": sum(r["status"] == "new" for r in marked)}
