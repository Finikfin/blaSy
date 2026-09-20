"""Run with TEST_DATABASE_URL pointing to a disposable PostgreSQL database."""
import os
from pathlib import Path
from uuid import uuid4

import psycopg
import pytest
from fastapi.testclient import TestClient

from app import db
from app.main import app


FIXTURES = Path(__file__).resolve().parent.parent / "fixtures"


@pytest.fixture
def client(monkeypatch):
    url = os.getenv("TEST_DATABASE_URL")
    if not url:
        pytest.skip("Set TEST_DATABASE_URL to a disposable PostgreSQL database")
    schema = "test_" + uuid4().hex
    with psycopg.connect(url) as conn:
        conn.execute(f"CREATE SCHEMA {schema}")
    original = db.psycopg.connect

    def isolated(*args, **kwargs):
        conn = original(url, row_factory=db.dict_row)
        conn.execute(f"SET search_path TO {schema}")
        return conn

    monkeypatch.setattr(db, "connect", isolated)
    try:
        with TestClient(app) as test_client:
            yield test_client
    finally:
        with original(url) as conn:
            conn.execute(f"DROP SCHEMA {schema} CASCADE")


def test_demo_control_totals_and_undo(client):
    response = client.post("/api/demo/load")
    assert response.status_code == 200, response.text
    assert response.json()["new"] == 69
    assert client.post("/api/demo/load").json()["idempotent_replay"] is True
    for aid in ("main", "second", "market"):
        assert client.patch(f"/api/accounts/{aid}", json={"own_confirmed": True}).status_code == 200
    items = client.get("/api/transactions?page_size=200").json()["items"]
    by_id = {r["external_id"]: e for e in items for r in e["raw_transactions"]}
    assert by_id["S01"]["id"] == by_id["S02"]["id"]
    assert by_id["S03"]["id"] == by_id["S04"]["id"]
    def command(path, e, body, key):
        return client.post(path, json={**body, "expected_revision": e["revision"], "command_id": key})
    loan = command(f"/api/events/{by_id['S07']['id']}/classify", by_id["S07"], {"kind": "LOAN_ISSUED", "participant": "Алексей"}, "loan")
    assert loan.status_code == 200, loan.text
    shared = command(f"/api/events/{by_id['S10']['id']}/shared", by_id["S10"], {"shares": [{"participant": "Я", "amount_minor": 160000, "is_self": True}] + [{"participant": f"Друг {n}", "amount_minor": 160000} for n in range(1, 5)]}, "shared")
    assert shared.status_code == 200, shared.text
    receivables = client.get("/api/receivables").json()
    for raw_id, person in [("S08", "Алексей"), ("S09", "Алексей")] + [(f"S{n+10:02d}", f"Друг {n}") for n in range(1, 5)]:
        e = by_id[raw_id]
        rec = next(r for r in receivables if r["participant"] == person)
        response = command("/api/settlements", e, {"event_id": e["id"], "receivable_id": rec["id"]}, raw_id)
        assert response.status_code == 200, response.text
    e = by_id["S17"]
    refunded = command("/api/refunds", e, {"event_id": e["id"], "purchase_event_id": by_id["S16"]["id"]}, "refund")
    assert refunded.status_code == 200, refunded.text
    unknown = by_id["S15"]
    excessive = command("/api/refunds", unknown, {"event_id": unknown["id"], "purchase_event_id": by_id["S16"]["id"]}, "bad-refund")
    assert excessive.status_code == 409
    assert excessive.json()["detail"]["code"] == "REFUND_EXCEEDS_PURCHASE"
    alexey = next(r for r in receivables if r["participant"] == "Алексей")
    excessive_settlement = command("/api/settlements", unknown, {"event_id": unknown["id"], "receivable_id": alexey["id"]}, "bad-settlement")
    assert excessive_settlement.status_code == 409
    assert excessive_settlement.json()["detail"]["code"] == "SETTLEMENT_EXCEEDS_REMAINING"
    cash = client.post("/api/manual-cash-expenses", json={"booking_date": "2026-09-18", "amount_minor": 70000, "category": "groceries", "description": "Продукты", "command_id": "cash"})
    assert cash.status_code == 200, cash.text
    report = client.get("/api/analytics?from=2026-09-01&to=2026-09-30&grouping=week").json()
    assert (report["expenses_minor"], report["income_minor"], report["net_minor"], report["unresolved_incoming_minor"]) == (860000, 2200000, 1340000, 50000)
    assert [p["expenses_minor"] for p in report["periods"]] == [650000, 270000, -240000, 130000, 50000]
    assert sum(r["remaining_minor"] for r in client.get("/api/receivables").json()) == 0
    assert next(a for a in client.get("/api/accounts").json() if a["id"] == "cash")["calculated_balance_minor"] == 430000
    e = by_id["S15"]
    decision = command(f"/api/events/{e['id']}/classify", e, {"kind": "INCOME"}, "s15")
    assert decision.status_code == 200
    assert client.get("/api/analytics?from=2026-09-01&to=2026-09-30").json()["income_minor"] == 2250000
    assert client.post(f"/api/decisions/{decision.json()['decision_id']}/undo").status_code == 200
    assert client.get("/api/analytics?from=2026-09-01&to=2026-09-30").json()["income_minor"] == 2200000
    assert client.post(f"/api/decisions/{shared.json()['decision_id']}/undo").status_code == 409
    assert client.post(f"/api/decisions/{shared.json()['decision_id']}/undo?cascade=true").status_code == 200
    after_cascade = client.get("/api/analytics?from=2026-09-01&to=2026-09-30").json()
    assert after_cascade["expenses_minor"] == 1500000
    assert after_cascade["unresolved_incoming_minor"] == 690000


def test_overlapping_csv_imports_and_preview(client):
    counts = []
    for filename in ("demo-first.csv", "demo-second.csv", "demo.csv"):
        content = (FIXTURES / filename).read_bytes()
        preview = client.post("/api/imports/preview", files={"file": (filename, content, "text/csv")}, data={"profile": "overlap"})
        assert preview.status_code == 200, preview.text
        body = preview.json()
        assert body["errors"] == []
        committed = client.post("/api/imports/commit", json={"preview_id": body["preview_id"], "idempotency_key": "overlap-" + filename,
            "coverage": [{"account_id": "main", "date_from": "2026-08-28", "date_to": "2026-09-30", "asserted_by_user": False}]})
        assert committed.status_code == 200, committed.text
        counts.append(committed.json()["new"])
    assert counts == [37, 32, 0]
    result = client.get("/api/transactions?page_size=200").json()
    assert result["total"] == 69
    assert sum(len(x["raw_transactions"]) for x in result["items"]) == 69


def test_mock_text_enrichment_is_background_and_financially_inert(client, monkeypatch):
    monkeypatch.setenv("TEXT_MODEL_MODE", "mock")
    content = b"transaction_id,account_id,booking_date,amount,currency,description,bank_type\nA1,main,2026-09-03,-100.00,RUB,Groceries,purchase\n"
    preview = client.post("/api/imports/preview", files={"file": ("sample.csv", content, "text/csv")}).json()
    committed = client.post("/api/imports/commit", json={"preview_id": preview["preview_id"], "idempotency_key": "mock-one"})
    assert committed.status_code == 200, committed.text
    batch = client.get("/api/imports/" + committed.json()["batch_id"]).json()
    assert batch["text_enrichment"]["status"] == "done"
    assert batch["text_enrichment"]["processed"] == 1
    report = client.get("/api/analytics?from=2026-09-01&to=2026-09-30").json()
    assert report["expenses_minor"] == 10000


def test_saved_column_profile_is_reused(client):
    profile = client.post("/api/import-profiles", json={"name": "other-bank", "mapping": {"booking_date": "Когда", "amount": "Сумма", "description": "Что"},
        "delimiter": ";", "default_account_id": "other", "default_currency": "RUB"})
    assert profile.status_code == 200, profile.text
    assert client.get("/api/import-profiles").json()[0]["name"] == "other-bank"
    csv = "Когда;Сумма;Что\n03.09.2026;-10,50;Продукты\n".encode("utf-8")
    preview = client.post("/api/imports/preview", files={"file": ("other.csv", csv, "text/csv")}, data={"profile": "other-bank"})
    assert preview.status_code == 200, preview.text
    assert preview.json()["rows"][0]["amount_minor"] == -1050
    assert preview.json()["rows"][0]["account_id"] == "other"


def test_manual_cash_undo_respects_later_correction(client):
    created = client.post("/api/manual-cash-expenses", json={"booking_date": "2026-09-18", "amount_minor": 70000,
        "category": "groceries", "description": "Наличные", "command_id": "manual-original"}).json()["event"]
    original_decision = created["decisions"][0]["id"]
    corrected = client.post(f"/api/events/{created['id']}/classify", json={"kind": "EXPENSE", "category": "services",
        "expected_revision": created["revision"], "command_id": "manual-correction"})
    assert corrected.status_code == 200, corrected.text
    assert client.post(f"/api/decisions/{original_decision}/undo").status_code == 409
    assert client.post(f"/api/decisions/{corrected.json()['decision_id']}/undo").status_code == 200
    assert client.post(f"/api/decisions/{original_decision}/undo").status_code == 200
