"""Explicitly apply the documented demo decisions through the public API."""
import os

import httpx


BASE = os.getenv("API_URL", "http://127.0.0.1:8000")


def main():
    with httpx.Client(base_url=BASE, timeout=30) as client:
        def call(method, path, **kwargs):
            response = client.request(method, path, **kwargs)
            response.raise_for_status()
            return response.json()

        call("POST", "/api/demo/load")
        for account in ("main", "second", "market"):
            call("PATCH", f"/api/accounts/{account}", json={"own_confirmed": True})

        items = call("GET", "/api/transactions", params={"page_size": 200})["items"]
        by_raw_id = {raw["external_id"]: item for item in items for raw in item["raw_transactions"] if raw["external_id"]}

        def submit(raw_id, path, body):
            item = by_raw_id[raw_id]
            body.update({"expected_revision": item["revision"], "command_id": "demo-decision-" + raw_id})
            result = call("POST", path.format(id=item["id"]), json=body)
            by_raw_id[raw_id] = result["event"]
            return result

        if by_raw_id["S07"]["kind"] == "UNRESOLVED":
            submit("S07", "/api/events/{id}/classify", {"kind": "LOAN_ISSUED", "participant": "Алексей"})
        if by_raw_id["S10"]["kind"] == "EXPENSE":
            submit("S10", "/api/events/{id}/shared", {"category": "restaurants", "shares": [
                {"participant": "Я", "amount_minor": 160000, "is_self": True},
                *[{"participant": f"Друг {n}", "amount_minor": 160000, "is_self": False} for n in range(1, 5)],
            ]})
        receivables = call("GET", "/api/receivables")
        alexey = next(r for r in receivables if r["participant"] == "Алексей")
        for raw_id in ("S08", "S09"):
            if by_raw_id[raw_id]["kind"] == "UNRESOLVED":
                submit(raw_id, "/api/settlements", {"event_id": by_raw_id[raw_id]["id"], "receivable_id": alexey["id"]})
        for n in range(1, 5):
            raw_id = f"S{n + 10:02d}"
            rec = next(r for r in receivables if r["participant"] == f"Друг {n}")
            if by_raw_id[raw_id]["kind"] == "UNRESOLVED":
                submit(raw_id, "/api/settlements", {"event_id": by_raw_id[raw_id]["id"], "receivable_id": rec["id"]})
        if by_raw_id["S17"]["kind"] == "UNRESOLVED":
            submit("S17", "/api/refunds", {"event_id": by_raw_id["S17"]["id"], "purchase_event_id": by_raw_id["S16"]["id"]})
        call("POST", "/api/manual-cash-expenses", json={"booking_date": "2026-09-18", "amount_minor": 70000,
            "category": "groceries", "description": "Продукты за наличные", "command_id": "demo-cash-S19"})
        report = call("GET", "/api/analytics", params={"from": "2026-09-01", "to": "2026-09-30", "grouping": "week"})
        print({key: report[key] for key in ("expenses_minor", "income_minor", "net_minor", "unresolved_incoming_minor")})


if __name__ == "__main__":
    main()
