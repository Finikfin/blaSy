"""All changes to economic meaning pass through these transactional functions."""
import json

from .common import category_for, fail, now, require_category, uid
from .db import all_rows, one


def event(conn, event_id, lock=False):
    row = one(conn, "SELECT * FROM events WHERE id=%s AND active=1" + (" FOR UPDATE" if lock else ""), (event_id,))
    if not row:
        fail("NOT_FOUND", "Событие не найдено", 404)
    return row


def event_raws(conn, event_id):
    return all_rows(conn, "SELECT r.* FROM raw_transactions r JOIN event_raw er ON er.raw_id=r.id WHERE er.event_id=%s ORDER BY r.booking_date,r.id", (event_id,))


def snapshot(conn, event_id):
    return {
        "event": event(conn, event_id),
        "receivables": all_rows(conn, "SELECT id,participant,original_minor,created_date FROM receivables WHERE origin_event_id=%s", (event_id,)),
        "refund": one(conn, "SELECT id,purchase_event_id,amount_minor FROM refunds WHERE refund_event_id=%s", (event_id,)),
        "settlement": one(conn, "SELECT id,receivable_id,amount_minor,date FROM settlements WHERE event_id=%s", (event_id,)),
    }


def effects_for(conn, event_id):
    e = event(conn, event_id)
    raws = event_raws(conn, event_id)
    movements = all_rows(conn, "SELECT date,amount_minor FROM movements WHERE event_id=%s ORDER BY date,id", (event_id,))
    if not movements:
        return []
    day = str(movements[0]["date"])
    total = sum(abs(m["amount_minor"]) for m in movements if m["amount_minor"] < 0)
    kind = e["kind"]
    category = e["category"]
    if kind == "EXPENSE":
        return [(day, "expense", total, category)]
    if kind == "INCOME":
        return [(day, "income", sum(m["amount_minor"] for m in movements if m["amount_minor"] > 0), None)]
    if kind == "SHARED_PURCHASE":
        return [(day, "expense", e["own_share_minor"], category)]
    if kind == "PURCHASE_REFUND":
        link = one(conn, "SELECT purchase_event_id,amount_minor FROM refunds WHERE refund_event_id=%s", (event_id,))
        if not link:
            return []
        purchase = event(conn, link["purchase_event_id"])
        return [(day, "expense", -link["amount_minor"], purchase["category"])]
    return []


def refresh_effects(conn, event_id):
    conn.execute("DELETE FROM effects WHERE event_id=%s", (event_id,))
    for day, measure, amount, category in effects_for(conn, event_id):
        conn.execute("INSERT INTO effects(id,event_id,date,measure,amount_minor,category) VALUES (%s,%s,%s,%s,%s,%s)", (uid(), event_id, day, measure, amount, category))


def remaining(conn, receivable_id, through=None):
    row = one(conn, "SELECT original_minor FROM receivables WHERE id=%s", (receivable_id,))
    if not row:
        fail("NOT_FOUND", "Долг не найден", 404)
    where = " AND date<=%s" if through else ""
    params = (receivable_id, through) if through else (receivable_id,)
    paid = one(conn, f"SELECT COALESCE(SUM(amount_minor),0) AS amount FROM settlements WHERE receivable_id=%s{where}", params)["amount"]
    return row["original_minor"] - paid


def create_event_for_raw(conn, raw):
    kind = "EXPENSE" if raw["bank_type"] == "purchase" and raw["amount_minor"] < 0 else "INCOME" if raw["bank_type"] == "salary" and raw["amount_minor"] > 0 else "CASH_WITHDRAWAL" if raw["bank_type"] == "cash_withdrawal" and raw["amount_minor"] < 0 else "UNRESOLVED"
    confirmed = kind != "UNRESOLVED"
    eid = uid()
    rule = one(conn, "SELECT category FROM rules WHERE LOWER(merchant)=LOWER(%s) AND enabled=1", (raw["description"].strip(),))
    category = rule["category"] if rule else category_for(raw["description"])
    conn.execute("INSERT INTO events(id,kind,resolution_status,resolution_source,category,created_at) VALUES (%s,%s,%s,%s,%s,%s)",
                 (eid, kind, "confirmed" if confirmed else "unresolved", "bank_type" if confirmed else "none", category, now()))
    conn.execute("INSERT INTO event_raw(event_id,raw_id) VALUES (%s,%s)", (eid, raw["id"]))
    conn.execute("INSERT INTO movements(id,event_id,raw_id,account_id,date,amount_minor,origin) VALUES (%s,%s,%s,%s,%s,%s,'import')",
                 (uid(), eid, raw["id"], raw["account_id"], raw["booking_date"], raw["amount_minor"]))
    if kind == "CASH_WITHDRAWAL":
        conn.execute("INSERT INTO accounts(id,name,kind,own_confirmed,opening_balance_minor,opening_balance_date) VALUES ('cash','Наличные','cash',1,0,%s) ON CONFLICT(id) DO NOTHING", (raw["booking_date"],))
        conn.execute("INSERT INTO movements(id,event_id,account_id,date,amount_minor,origin) VALUES (%s,%s,'cash',%s,%s,'derived_cash')", (uid(), eid, raw["booking_date"], -raw["amount_minor"]))
    refresh_effects(conn, eid)
    if not confirmed:
        qkind = "refund" if raw["bank_type"] == "refund" else "meaning"
        conn.execute("INSERT INTO questions(id,event_id,kind,impact_minor,evidence_signature) VALUES (%s,%s,%s,%s,%s)", (uid(), eid, qkind, abs(raw["amount_minor"]), raw["fingerprint"]))
    return eid


def auto_pair_transfers(conn):
    candidates = all_rows(conn, """SELECT e.id AS event_id,r.* FROM events e JOIN event_raw er ON er.event_id=e.id
        JOIN raw_transactions r ON r.id=er.raw_id JOIN accounts a ON a.id=r.account_id
        WHERE e.active=1 AND e.kind IN ('UNRESOLVED','OWN_TRANSFER') AND r.bank_type='transfer' AND a.own_confirmed=1""")
    for row in candidates:
        target = row["counterparty_account_ref"]
        own = one(conn, "SELECT 1 FROM accounts WHERE id=%s AND own_confirmed=1", (target,)) if target else None
        if not own:
            continue
        matches = [candidate for candidate in candidates if candidate["event_id"] != row["event_id"] and candidate["account_id"] == target
                   and candidate["counterparty_account_ref"] == row["account_id"] and candidate["amount_minor"] == -row["amount_minor"]
                   and abs((candidate["booking_date"] - row["booking_date"]).days) <= 3]
        if len(matches) > 1:
            continue
        eid = row["event_id"]
        if not one(conn, "SELECT 1 FROM events WHERE id=%s AND active=1", (eid,)):
            continue
        if matches:
            other = matches[0]["event_id"]
            if not one(conn, "SELECT 1 FROM events WHERE id=%s AND active=1", (other,)):
                continue
            conn.execute("UPDATE event_raw SET event_id=%s WHERE event_id=%s", (eid, other))
            conn.execute("UPDATE movements SET event_id=%s WHERE event_id=%s", (eid, other))
            conn.execute("UPDATE events SET active=0 WHERE id=%s", (other,))
            conn.execute("UPDATE questions SET status='resolved' WHERE event_id=%s", (other,))
        conn.execute("UPDATE events SET kind='OWN_TRANSFER',resolution_status='confirmed',resolution_source='own_accounts',coverage_status=%s,revision=revision+1 WHERE id=%s", ("complete" if matches else "missing_counterpart", eid))
        conn.execute("UPDATE questions SET status='resolved' WHERE event_id=%s", (eid,))
        refresh_effects(conn, eid)


def record_decision(conn, eid, command_id, before):
    did = uid()
    after = snapshot(conn, eid)
    conn.execute("INSERT INTO decisions(id,event_id,command_id,before_json,after_json,created_at) VALUES (%s,%s,%s,%s,%s,%s)",
                 (did, eid, command_id, json.dumps(before, default=str, ensure_ascii=False), json.dumps(after, default=str, ensure_ascii=False), now()))
    return did


def check_command(conn, command_id, eid, expected_revision):
    previous = one(conn, "SELECT id,event_id FROM decisions WHERE command_id=%s", (command_id,))
    if previous:
        if previous["event_id"] != eid:
            fail("COMMAND_ID_CONFLICT", "Ключ команды уже использован", 409)
        return previous["id"]
    current = event(conn, eid, lock=True)
    if current["revision"] != expected_revision:
        fail("STALE_REVISION", "Событие изменилось; обновите карточку", 409)
    return None


def classify(conn, eid, kind, category, participant, expected_revision, command_id):
    existing = check_command(conn, command_id, eid, expected_revision)
    if existing:
        return existing
    before = snapshot(conn, eid)
    current = before["event"]
    if one(conn, "SELECT 1 FROM settlements WHERE event_id=%s", (eid,)) or one(conn, "SELECT 1 FROM refunds WHERE refund_event_id=%s", (eid,)):
        fail("ALREADY_LINKED", "Сначала отмените связь", 409)
    if kind != "EXPENSE" and one(conn, "SELECT 1 FROM refunds WHERE purchase_event_id=%s", (eid,)):
        fail("DEPENDENT_DECISIONS", "Сначала отмените возвраты этой покупки", 409)
    raws = event_raws(conn, eid)
    if len(raws) > 1 and kind != "OWN_TRANSFER":
        fail("ALREADY_LINKED", "Связанный перевод нельзя классифицировать по одной стороне", 409)
    amount = sum(m["amount_minor"] for m in all_rows(conn, "SELECT amount_minor FROM movements WHERE event_id=%s AND origin!='derived_cash'", (eid,)))
    allowed = {"EXPENSE", "LOAN_ISSUED"} if amount < 0 else {"INCOME"} if amount > 0 else set()
    if kind not in allowed:
        fail("INVALID_KIND", "Тип не соответствует направлению операции")
    if one(conn, "SELECT 1 FROM receivables WHERE origin_event_id=%s AND id IN (SELECT receivable_id FROM settlements)", (eid,)):
        fail("DEPENDENT_DECISIONS", "У долга есть погашения", 409)
    conn.execute("DELETE FROM receivables WHERE origin_event_id=%s", (eid,))
    if kind == "LOAN_ISSUED":
        if not raws:
            fail("INVALID_KIND", "Ручную наличную покупку нельзя превратить в банковский долг")
        if not participant:
            fail("PARTICIPANT_REQUIRED", "Укажите человека")
        conn.execute("INSERT INTO receivables(id,origin_event_id,participant,original_minor,created_date) VALUES (%s,%s,%s,%s,%s)", (uid(), eid, participant[:100], -amount, str(raws[0]["booking_date"])))
    cat = require_category(category or current["category"])
    conn.execute("UPDATE events SET kind=%s,category=%s,participant=%s,resolution_status='confirmed',resolution_source='manual',revision=revision+1 WHERE id=%s", (kind, cat, participant, eid))
    conn.execute("UPDATE questions SET status='resolved' WHERE event_id=%s", (eid,))
    refresh_effects(conn, eid)
    for refund in all_rows(conn, "SELECT refund_event_id FROM refunds WHERE purchase_event_id=%s", (eid,)):
        refresh_effects(conn, refund["refund_event_id"])
    return record_decision(conn, eid, command_id, before)


def share(conn, eid, shares, category, expected_revision, command_id):
    existing = check_command(conn, command_id, eid, expected_revision)
    if existing:
        return existing
    before = snapshot(conn, eid)
    if before["event"]["kind"] not in ("EXPENSE", "SHARED_PURCHASE"):
        fail("INVALID_KIND", "Разделить можно только покупку")
    if one(conn, "SELECT 1 FROM refunds WHERE purchase_event_id=%s", (eid,)):
        fail("ALREADY_LINKED", "Совместный возврат покупки не поддерживается", 409)
    amount = -sum(r["amount_minor"] for r in event_raws(conn, eid))
    if amount <= 0 or sum(s["amount_minor"] for s in shares) != amount or sum(s["is_self"] for s in shares) != 1 or any(s["amount_minor"] < 0 for s in shares):
        fail("INVALID_SHARES", "Доли должны покрывать всю сумму, ровно один участник — Я")
    old = {r["participant"]: r for r in before["receivables"]}
    named = {s["participant"]: s for s in shares if not s["is_self"]}
    if len(named) != len([s for s in shares if not s["is_self"]]):
        fail("INVALID_SHARES", "Имена участников должны быть уникальными")
    for person, rec in old.items():
        paid = rec["original_minor"] - remaining(conn, rec["id"])
        if person not in named and paid or person in named and named[person]["amount_minor"] < paid:
            fail("DEPENDENT_DECISIONS", "Новая доля меньше уже полученной компенсации", 409)
        if person not in named:
            conn.execute("DELETE FROM receivables WHERE id=%s", (rec["id"],))
    for person, s in named.items():
        if s["amount_minor"] <= 0:
            fail("INVALID_SHARES", "Чужая доля должна быть положительной")
        if person in old:
            conn.execute("UPDATE receivables SET original_minor=%s WHERE id=%s", (s["amount_minor"], old[person]["id"]))
        else:
            conn.execute("INSERT INTO receivables(id,origin_event_id,participant,original_minor,created_date) VALUES (%s,%s,%s,%s,%s)", (uid(), eid, person[:100], s["amount_minor"], str(event_raws(conn, eid)[0]["booking_date"])))
    own = next(s["amount_minor"] for s in shares if s["is_self"])
    conn.execute("UPDATE events SET kind='SHARED_PURCHASE',category=%s,own_share_minor=%s,resolution_status='confirmed',resolution_source='manual',revision=revision+1 WHERE id=%s", (require_category(category or before["event"]["category"]), own, eid))
    refresh_effects(conn, eid)
    return record_decision(conn, eid, command_id, before)


def settle(conn, eid, receivable_id, expected_revision, command_id):
    existing = check_command(conn, command_id, eid, expected_revision)
    if existing:
        return existing
    before = snapshot(conn, eid)
    raws = event_raws(conn, eid)
    if len(raws) != 1 or raws[0]["amount_minor"] <= 0 or before["event"]["kind"] != "UNRESOLVED":
        fail("ALREADY_LINKED", "Поступление уже занято или имеет другой тип", 409)
    rec = one(conn, "SELECT r.*,e.kind FROM receivables r JOIN events e ON e.id=r.origin_event_id WHERE r.id=%s FOR UPDATE", (receivable_id,))
    if not rec or rec["kind"] not in ("LOAN_ISSUED", "SHARED_PURCHASE"):
        fail("NOT_FOUND", "Активный долг не найден", 404)
    amount = raws[0]["amount_minor"]
    if amount > remaining(conn, receivable_id):
        fail("SETTLEMENT_EXCEEDS_REMAINING", "Поступление больше остатка долга", 409)
    kind = "LOAN_REPAYMENT" if rec["kind"] == "LOAN_ISSUED" else "REIMBURSEMENT"
    conn.execute("INSERT INTO settlements(id,event_id,receivable_id,amount_minor,date) VALUES (%s,%s,%s,%s,%s)", (uid(), eid, receivable_id, amount, str(raws[0]["booking_date"])))
    conn.execute("UPDATE events SET kind=%s,resolution_status='confirmed',resolution_source='manual',revision=revision+1 WHERE id=%s", (kind, eid))
    conn.execute("UPDATE questions SET status='resolved' WHERE event_id=%s", (eid,))
    return record_decision(conn, eid, command_id, before)


def refund(conn, eid, purchase_id, expected_revision, command_id):
    existing = check_command(conn, command_id, eid, expected_revision)
    if existing:
        return existing
    before = snapshot(conn, eid)
    raws = event_raws(conn, eid)
    purchase = event(conn, purchase_id, lock=True)
    if len(raws) != 1 or raws[0]["amount_minor"] <= 0 or before["event"]["kind"] != "UNRESOLVED" or purchase["kind"] != "EXPENSE":
        fail("INVALID_REFUND", "Нужны свободное поступление и обычная покупка", 409)
    amount = raws[0]["amount_minor"]
    original = -sum(r["amount_minor"] for r in event_raws(conn, purchase_id))
    used = one(conn, "SELECT COALESCE(SUM(amount_minor),0) AS amount FROM refunds WHERE purchase_event_id=%s", (purchase_id,))["amount"]
    if amount + used > original:
        fail("REFUND_EXCEEDS_PURCHASE", "Возвраты превышают сумму покупки", 409)
    conn.execute("INSERT INTO refunds(id,refund_event_id,purchase_event_id,amount_minor) VALUES (%s,%s,%s,%s)", (uid(), eid, purchase_id, amount))
    conn.execute("UPDATE events SET kind='PURCHASE_REFUND',resolution_status='confirmed',resolution_source='manual',revision=revision+1 WHERE id=%s", (eid,))
    conn.execute("UPDATE questions SET status='resolved' WHERE event_id=%s", (eid,))
    refresh_effects(conn, eid)
    return record_decision(conn, eid, command_id, before)


def undo(conn, decision_id, cascade=False):
    decision = one(conn, "SELECT * FROM decisions WHERE id=%s FOR UPDATE", (decision_id,))
    if not decision:
        fail("NOT_FOUND", "Решение не найдено", 404)
    if decision["undone_at"]:
        return decision["event_id"]
    eid = decision["event_id"]
    latest = one(conn, "SELECT id FROM decisions WHERE event_id=%s AND undone_at IS NULL ORDER BY created_at DESC,id DESC LIMIT 1", (eid,))
    if latest["id"] != decision_id:
        fail("DEPENDENT_DECISIONS", "Сначала отмените более позднее решение", 409)
    if decision["before_json"] == "{}":
        if one(conn, "SELECT 1 FROM raw_transactions r JOIN event_raw er ON er.raw_id=r.id WHERE er.event_id=%s", (eid,)):
            fail("DEPENDENT_DECISIONS", "Нельзя удалить импортированную строку", 409)
        conn.execute("DELETE FROM effects WHERE event_id=%s", (eid,))
        conn.execute("DELETE FROM movements WHERE event_id=%s", (eid,))
        conn.execute("UPDATE events SET active=0 WHERE id=%s", (eid,))
        conn.execute("UPDATE decisions SET undone_at=%s WHERE id=%s", (now(), decision_id))
        return eid
    before = json.loads(decision["before_json"])
    current = event(conn, eid, lock=True)
    existing = all_rows(conn, "SELECT s.event_id FROM settlements s JOIN receivables r ON r.id=s.receivable_id WHERE r.origin_event_id=%s", (eid,))
    if existing:
        if not cascade:
            fail("DEPENDENT_DECISIONS", "Есть связанные погашения; используйте cascade=true для их совместной отмены", 409)
        for dependent in existing:
            last = one(conn, "SELECT id FROM decisions WHERE event_id=%s AND undone_at IS NULL ORDER BY created_at DESC,id DESC LIMIT 1", (dependent["event_id"],))
            if not last:
                fail("DEPENDENT_DECISIONS", "Связанное погашение нельзя отменить автоматически", 409)
            undo(conn, last["id"], cascade=True)
    conn.execute("DELETE FROM settlements WHERE event_id=%s", (eid,))
    conn.execute("DELETE FROM refunds WHERE refund_event_id=%s", (eid,))
    conn.execute("DELETE FROM receivables WHERE origin_event_id=%s", (eid,))
    for r in before["receivables"]:
        conn.execute("INSERT INTO receivables(id,origin_event_id,participant,original_minor,created_date) VALUES (%s,%s,%s,%s,%s)", (r["id"], eid, r["participant"], r["original_minor"], r["created_date"]))
    if before["settlement"]:
        s = before["settlement"]
        conn.execute("INSERT INTO settlements(id,event_id,receivable_id,amount_minor,date) VALUES (%s,%s,%s,%s,%s)", (s["id"], eid, s["receivable_id"], s["amount_minor"], s["date"]))
    if before["refund"]:
        r = before["refund"]
        conn.execute("INSERT INTO refunds(id,refund_event_id,purchase_event_id,amount_minor) VALUES (%s,%s,%s,%s)", (r["id"], eid, r["purchase_event_id"], r["amount_minor"]))
    previous = before["event"]
    conn.execute("UPDATE events SET kind=%s,resolution_status=%s,resolution_source=%s,coverage_status=%s,explanation=%s,category=%s,own_share_minor=%s,participant=%s,revision=%s WHERE id=%s",
                 (previous["kind"], previous["resolution_status"], previous["resolution_source"], previous["coverage_status"], previous["explanation"], previous["category"], previous["own_share_minor"], previous["participant"], current["revision"] + 1, eid))
    conn.execute("UPDATE questions SET status=%s WHERE event_id=%s", ("open" if previous["kind"] == "UNRESOLVED" else "resolved", eid))
    refresh_effects(conn, eid)
    for linked in all_rows(conn, "SELECT refund_event_id FROM refunds WHERE purchase_event_id=%s", (eid,)):
        refresh_effects(conn, linked["refund_event_id"])
    conn.execute("UPDATE decisions SET undone_at=%s WHERE id=%s", (now(), decision_id))
    return eid
