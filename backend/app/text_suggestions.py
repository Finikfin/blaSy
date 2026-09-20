"""Optional text-only adapter. Financial facts never enter provider requests."""
import hashlib
import json
import os
import urllib.error
import urllib.request

from .common import CATEGORIES, fail
from .db import one


PROMPT_VERSION = "text-v1"


def configured_mode():
    mode = os.getenv("TEXT_MODEL_MODE", "disabled")
    return mode if mode in ("disabled", "mock", "http") else "disabled"


def sanitize_output(value):
    if not isinstance(value, dict):
        return None
    category = value.get("suggested_category")
    if category not in CATEGORIES:
        category = None
    return {
        "merchant_normalized": str(value.get("merchant_normalized", ""))[:100],
        "suggested_category": category,
        "text_tags": [str(x)[:30] for x in value.get("text_tags", [])[:5]] if isinstance(value.get("text_tags"), list) else [],
        "explanation": str(value.get("explanation", ""))[:300],
    }


def suggest(conn, description, counterparty, bank_type, consent):
    mode = configured_mode()
    if mode == "disabled":
        return {"status": "disabled", "suggestion": None}
    if mode == "http" and not consent:
        return {"status": "consent_required", "suggestion": None}
    safe_input = {"description": description[:200], "counterparty": (counterparty or "")[:100], "bank_type": bank_type[:40]}
    provider = os.getenv("TEXT_MODEL_URL", "") if mode == "http" else "mock"
    model = os.getenv("TEXT_MODEL_NAME", "generic") if mode == "http" else "mock"
    key = hashlib.sha256(json.dumps([PROMPT_VERSION, provider, model, safe_input], ensure_ascii=False, sort_keys=True).encode()).hexdigest()
    cached = one(conn, "SELECT output_json,status FROM model_cache WHERE input_hash=%s", (key,))
    if cached:
        return {"status": cached["status"], "suggestion": json.loads(cached["output_json"])}
    if mode == "mock":
        output = {"merchant_normalized": description[:100], "suggested_category": None, "text_tags": [], "explanation": "Тестовая текстовая подсказка"}
        status = "ready"
    else:
        url = os.getenv("TEXT_MODEL_URL", "")
        if not url.startswith("https://"):
            fail("MODEL_CONFIG", "TEXT_MODEL_URL должен использовать HTTPS")
        body = json.dumps({"model": model, "prompt_version": PROMPT_VERSION, "input": safe_input}, ensure_ascii=False).encode()
        headers = {"Content-Type": "application/json"}
        if os.getenv("TEXT_MODEL_API_KEY"):
            headers["Authorization"] = "Bearer " + os.environ["TEXT_MODEL_API_KEY"]
        output, status = None, "unavailable"
        for attempt in range(2):
            try:
                with urllib.request.urlopen(urllib.request.Request(url, data=body, headers=headers), timeout=15) as response:
                    output = sanitize_output(json.loads(response.read(64 * 1024)))
                status = "ready" if output else "invalid_response"
                break
            except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, ValueError):
                if attempt:
                    break
    if status == "ready":
        conn.execute("INSERT INTO model_cache(input_hash,prompt_version,provider,model,output_json,status) VALUES (%s,%s,%s,%s,%s,%s)",
                     (key, PROMPT_VERSION, provider, model, json.dumps(output, ensure_ascii=False), status))
    return {"status": status, "suggestion": output}
