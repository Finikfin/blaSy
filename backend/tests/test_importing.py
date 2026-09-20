import pytest

from app.importing import extract_text_from_pdf, normalize, parse_date, parse_money


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


def test_pdf_text_is_extracted_and_normalized():
    def make_pdf(text: str) -> bytes:
        content = text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
        stream = f"BT /F1 16 Tf 40 150 Td ({content}) Tj ET".encode("latin-1", "replace")
        objects = [
            b"<< /Type /Catalog /Pages 2 0 R >>",
            b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
            b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
            b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
            b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + stream + b"\nendstream",
        ]
        pdf = bytearray(b"%PDF-1.4\n")
        offsets = [0]
        for i, obj in enumerate(objects, start=1):
            offsets.append(len(pdf))
            pdf.extend(f"{i} 0 obj\n".encode("latin-1"))
            pdf.extend(obj)
            pdf.extend(b"\nendobj\n")
        xref_pos = len(pdf)
        pdf.extend(f"xref\n0 {len(objects) + 1}\n".encode("latin-1"))
        pdf.extend(b"0000000000 65535 f \n")
        for offset in offsets[1:]:
            pdf.extend(f"{offset:010d} 00000 n \n".encode("latin-1"))
        pdf.extend(f"trailer\n<< /Root 1 0 R /Size {len(objects) + 1} >>\nstartxref\n{xref_pos}\n%%EOF\n".encode("latin-1"))
        return bytes(pdf)

    pdf = make_pdf("Account;Date;Amount;Currency;Description\nmain;03.09.2026;-100,25;RUB;Products\n")
    text = extract_text_from_pdf(pdf)

    assert "Account" in text
    assert "03.09.2026" in text
    rows, errors, mapping, delimiter, _ = normalize(text)
    assert delimiter == ";"
    assert rows[0]["amount_minor"] == -10025
    assert errors == []


def test_ambiguous_date_is_rejected():
    with pytest.raises(ValueError):
        parse_date("09/03/2026")


def test_card_statement_rows_and_wrapped_descriptions():
    statement = """Операции по карте № 220070******1234 ИМЯ
Дата и время    Дата    Описание    Сумма операции    Сумма в валюте счёта
28.07.26 22:06    29.07.26    Оплата в Магазин    300.00 ₽    300.00 ₽
29.07.26          29.07.26    Перевод на телефон    1 200.00 ₽    1 200.00 ₽
                                +79000000000
30.07.26 12:00    30.07.26    Отмена операции оплаты Магазин    + 300.00 ₽    + 300.00 ₽
"""
    rows, errors, *_ = normalize(statement)
    assert errors == []
    assert [row["amount_minor"] for row in rows] == [-30000, -120000, 30000]
    assert [row["bank_type"] for row in rows] == ["purchase", "transfer", "refund"]
    assert all(row["account_id"] == "card-1234" for row in rows)
    assert rows[1]["description"].endswith("+79000000000")
