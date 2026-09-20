from app.text_suggestions import sanitize_output


def test_model_cannot_choose_unknown_category_or_return_unbounded_text():
    result = sanitize_output({"merchant_normalized": "X" * 1000, "suggested_category": "salary", "text_tags": ["x"] * 20, "explanation": "Y" * 1000})
    assert result["suggested_category"] is None
    assert len(result["merchant_normalized"]) == 100
    assert len(result["text_tags"]) == 5
    assert len(result["explanation"]) == 300
