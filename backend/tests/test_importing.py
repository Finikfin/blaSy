import pytest

from app.importing import normalize, parse_date, parse_money


def test_money_does_not_round_or_guess_thousands():
    assert parse_money("1 234,50") == 123450
    assert parse_money("-0.01") == -1
    for value in ("0", "1.234", "1,234", "text"):
        with pytest.raises(ValueError):
            parse_money(value)


def test_csv_mapping_and_row_errors():
    csv = "Счёт;Дата;Сумма;Валюта;Описание\nmain;03.09.2026;-100,25;RUB;Продукты\nmain;04.09.2026;0;RUB;Ноль\n"
    rows, errors, mapping, delimiter, _ = normalize(csv)
    assert delimiter == ";"
    assert mapping["account_id"] == "Счёт"
    assert rows[0]["amount_minor"] == -10025
    assert rows[0]["booking_date"] == "2026-09-03"
    assert errors[0]["row"] == 3


def test_ambiguous_date_is_rejected():
    with pytest.raises(ValueError):
        parse_date("09/03/2026")
