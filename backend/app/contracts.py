"""Response types used for OpenAPI handoff to the frontend."""
from datetime import date
from typing import Any

from pydantic import BaseModel, ConfigDict


class PreviewCounts(BaseModel):
    new: int
    duplicate: int
    conflict: int
    errors: int


class PreviewCoverage(BaseModel):
    date_from: date | None
    date_to: date | None
    asserted_by_user: bool


class PreviewResponse(BaseModel):
    preview_id: str
    headers: list[str]
    mapping: dict[str, str | None]
    encoding: str
    delimiter: str
    sample: list[dict[str, Any]]
    rows: list[dict[str, Any]]
    errors: list[dict[str, Any]]
    counts: PreviewCounts
    suggested_coverage: PreviewCoverage


class CommitResponse(BaseModel):
    batch_id: str
    new: int
    duplicate: int
    unresolved: int | None = None
    review_session_id: str | None = None
    idempotent_replay: bool


class CategoryTotal(BaseModel):
    id: str
    amount_minor: int


class PeriodTotal(BaseModel):
    date_from: date
    date_to: date
    expenses_minor: int
    income_minor: int


class CoverageInfo(BaseModel):
    account_id: str
    date_from: date
    date_to: date
    asserted_by_user: bool


class PreviousPeriod(BaseModel):
    date_from: date
    date_to: date
    expenses_minor: int
    income_minor: int
    net_minor: int
    expense_difference_minor: int
    expense_percent: float | None
    coverage_warnings: list[str]


class AnalyticsResponse(BaseModel):
    date_from: date
    date_to: date
    expenses_minor: int
    income_minor: int
    net_minor: int
    unresolved_outgoing_minor: int
    unresolved_incoming_minor: int
    unresolved_count: int
    categories: list[CategoryTotal]
    periods: list[PeriodTotal]
    coverage: list[CoverageInfo]
    coverage_warnings: list[str]
    gross_purchases_minor: int
    refunds_minor: int
    previous_period: PreviousPeriod | None = None


class RawTransactionResponse(BaseModel):
    model_config = ConfigDict(extra="allow")
    id: str
    account_id: str
    booking_date: date
    amount_minor: int
    currency: str
    description: str
    bank_type: str
    external_id: str | None


class MovementResponse(BaseModel):
    id: str
    account_id: str
    date: date
    amount_minor: int
    origin: str


class EffectResponse(BaseModel):
    date: date
    measure: str
    amount_minor: int
    category: str | None


class EventResponse(BaseModel):
    model_config = ConfigDict(extra="allow")
    id: str
    kind: str
    resolution_status: str
    resolution_source: str
    coverage_status: str
    revision: int
    category: str
    own_share_minor: int | None
    participant: str | None
    raw_transactions: list[RawTransactionResponse]
    movements: list[MovementResponse]
    effects: list[EffectResponse]
    receivables: list[dict[str, Any]]
    settlement: dict[str, Any] | None
    refund: dict[str, Any] | None
    decisions: list[dict[str, Any]]


class TransactionPage(BaseModel):
    total: int
    page: int
    page_size: int
    items: list[EventResponse]


class DecisionResponse(BaseModel):
    decision_id: str
    event: EventResponse


class ManualResponse(BaseModel):
    event: EventResponse
    idempotent_replay: bool


class UndoResponse(BaseModel):
    event: EventResponse | None
    event_id: str
