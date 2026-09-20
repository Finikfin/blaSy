"""Regenerate the deterministic, synthetic 69-row demo fixture."""
import argparse
import csv
from pathlib import Path


HEADER = ["transaction_id", "account_id", "booking_date", "amount", "currency", "description", "bank_type", "counterparty", "counterparty_account_id"]


def build():
    rows = []

    def add(identifier, account, day, rubles, description, kind, counterparty="", target=""):
        rows.append([identifier, account, day, f"{rubles:.2f}", "RUB", description, kind, counterparty, target])

    for day in range(1, 31):
        add(f"B{day:03d}", "main", f"2026-09-{day:02d}", -100, "Продукты", "purchase")
    for index, day in enumerate((2, 5, 8, 11, 14, 17, 20, 23, 26, 29), 31):
        add(f"B{index:03d}", "main", f"2026-09-{day:02d}", 1000, "Зарплата", "salary")
    for index, day in enumerate((3, 6, 9, 12, 15, 18, 21, 24, 27, 30), 41):
        add(f"B{index:03d}", "main", f"2026-09-{day:02d}", -200, "Транспорт", "purchase")
    specials = [
        ("S01", "main", "09-03", -10000, "Перевод на свою карту", "transfer", "Мой второй счёт", "second"),
        ("S02", "second", "09-03", 10000, "Перевод со своей карты", "transfer", "Мой основной счёт", "main"),
        ("S03", "main", "09-04", -6000, "Пополнение маркетплейса", "transfer", "Моя карта маркетплейса", "market"),
        ("S04", "market", "09-04", 6000, "Пополнение своей карты", "transfer", "Мой основной счёт", "main"),
        ("S05", "market", "09-05", -2000, "Продукты", "purchase"),
        ("S06", "market", "09-06", -3500, "Техника", "purchase"),
        ("S07", "main", "09-07", -3000, "Перевод Алексею", "transfer", "Алексей"),
        ("S08", "main", "09-14", 1500, "Алексей частичный возврат", "transfer", "Алексей"),
        ("S09", "main", "09-21", 1500, "Алексей возврат", "transfer", "Алексей"),
        ("S10", "main", "09-10", -8000, "Ресторан", "purchase"),
        ("S11", "main", "09-11", 1600, "Друг 1 за ужин", "transfer", "Друг 1"),
        ("S12", "main", "09-12", 1600, "Друг 2 за ужин", "transfer", "Друг 2"),
        ("S13", "main", "09-13", 1600, "Друг 3 за ужин", "transfer", "Друг 3"),
        ("S14", "main", "09-14", 1600, "Друг 4 за ужин", "transfer", "Друг 4"),
        ("S15", "main", "09-15", 500, "Неизвестный отправитель за обед", "unknown", "Неизвестный"),
        ("S16", "main", "08-28", -4200, "Техника", "purchase"),
        ("S17", "main", "09-16", 4200, "Возврат техники", "refund"),
        ("S18", "main", "09-17", -5000, "Снятие наличных", "cash_withdrawal"),
        ("S20", "main", "09-25", 12000, "Дополнительный доход", "salary"),
    ]
    for identifier, account, day, rubles, description, kind, *rest in specials:
        add(identifier, account, "2026-" + day, rubles, description, kind, *rest)
    return rows


def write(path, rows):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as stream:
        writer = csv.writer(stream, lineterminator="\n")
        writer.writerow(HEADER)
        writer.writerows(rows)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--directory", type=Path, default=Path(__file__).resolve().parent.parent / "fixtures")
    args = parser.parse_args()
    rows = build()
    write(args.directory / "demo.csv", rows)
    write(args.directory / "demo-first.csv", [r for r in rows if r[0] == "S16" or r[2] <= "2026-09-14"])
    write(args.directory / "demo-second.csv", [r for r in rows if r[2] >= "2026-09-10"])


if __name__ == "__main__":
    main()
