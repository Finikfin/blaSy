/**
 * Клиент API «Честного месяца».
 * Все суммы — целые копейки, даты включительные (см. README бэкенда).
 */

export const API_BASE: string =
  (import.meta as any).env?.VITE_API_URL ?? 'http://127.0.0.1:8000'

export class ApiError extends Error {
  code: string
  status: number
  constructor(code: string, message: string, status: number) {
    super(message)
    this.code = code
    this.status = status
  }
}

async function request<T>(path: string, init?: RequestInit, timeoutMs = 12000): Promise<T> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(API_BASE + path, { ...init, signal: ctrl.signal })
    const text = await res.text()
    const body = text ? JSON.parse(text) : null
    if (!res.ok) {
      // Сервер отдаёт detail.code и detail.message
      const detail = body?.detail ?? {}
      throw new ApiError(detail.code ?? 'HTTP_' + res.status,
        detail.message ?? res.statusText, res.status)
    }
    return body as T
  } finally {
    clearTimeout(timer)
  }
}

const json = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

// ── Типы ответов сервера ─────────────────────────────────────────────

export type SrvAccount = {
  id: string
  name: string
  kind: 'bank' | 'cash'
  own_confirmed: number | boolean
  opening_balance_minor: number | null
  opening_balance_date: string | null
  cashflow_minor: number
  calculated_balance_minor: number | null
  latest_transaction_date: string | null
  coverage: { date_from: string; date_to: string; asserted_by_user: boolean }[]
}

export type SrvEffect = {
  date: string
  measure: 'expense' | 'income'
  amount_minor: number
  category: string | null
}

export type SrvMovement = {
  id: string
  account_id: string
  date: string
  amount_minor: number
  origin: 'import' | 'manual' | 'derived_cash' | string
}

export type SrvRaw = {
  id: string
  account_id: string
  booking_date: string
  amount_minor: number
  currency: string
  description: string
  bank_type: string
  external_id: string | null
  counterparty?: string | null
}

export type SrvEvent = {
  id: string
  kind: string
  resolution_status: 'confirmed' | 'unresolved'
  resolution_source: string
  coverage_status: string
  revision: number
  category: string
  own_share_minor: number | null
  participant: string | null
  explanation?: string | null
  raw_transactions: SrvRaw[]
  movements: SrvMovement[]
  effects: SrvEffect[]
  receivables: any[]
  settlement: any | null
  refund: any | null
  decisions: { id: string; command_id: string; created_at: string; undone_at: string | null }[]
}

export type SrvAnalytics = {
  date_from: string
  date_to: string
  expenses_minor: number
  income_minor: number
  net_minor: number
  unresolved_outgoing_minor: number
  unresolved_incoming_minor: number
  unresolved_count: number
  categories: { id: string; amount_minor: number }[]
  periods: { date_from: string; date_to: string; expenses_minor: number; income_minor: number }[]
  coverage: { account_id: string; date_from: string; date_to: string; asserted_by_user: boolean }[]
  coverage_warnings: string[]
  gross_purchases_minor: number
  refunds_minor: number
  previous_period: {
    date_from: string; date_to: string
    expenses_minor: number; income_minor: number; net_minor: number
    expense_difference_minor: number; expense_percent: number | null
    coverage_warnings: string[]
  } | null
}

export type SrvReceivable = {
  id: string
  origin_event_id: string
  participant: string
  original_minor: number
  created_date: string
  remaining_minor: number
  paid_minor: number
  kind: string
}

export type SrvCandidate =
  | { action: 'settle'; receivable_id: string; origin_event_id: string; participant: string; remaining_minor: number }
  | { action: 'refund'; purchase_event_id: string; available_minor: number }

export type SrvQuestion = {
  id: string
  event_id: string
  /** сервер называет поле kind: 'meaning' | 'refund' */
  kind: string
  status: string
  impact_minor: number
  snoozed_at: string | null
  revision: number
  event_kind: string
  description: string
  booking_date: string
  amount_minor: number
  counterparty: string | null
  bank_type: string
  candidates: SrvCandidate[]
}

export type SrvWeekly = SrvAnalytics & {
  new_operations_since_seen: number
  seen_at: string | null
  next_step: { kind: 'question'; question_id: string } | { kind: 'import' }
  today: string
}

export type SrvMeta = {
  currency: string
  categories: string[]
  llm: { mode: string; status: string }
  demo_today: string
}

// ── Методы ───────────────────────────────────────────────────────────

export const api = {
  health: () => request<{ status: string }>('/health', undefined, 4000),
  meta: () => request<SrvMeta>('/api/meta'),

  accounts: () => request<SrvAccount[]>('/api/accounts'),

  analytics: (from: string, to: string, grouping: string) =>
    request<SrvAnalytics>(`/api/analytics?from=${from}&to=${to}&grouping=${grouping}`),

  transactions: (params: {
    from?: string; to?: string; page?: number; pageSize?: number
    search?: string; unresolved?: boolean; kind?: string
  } = {}) => {
    const q = new URLSearchParams()
    if (params.from) q.set('from', params.from)
    if (params.to) q.set('to', params.to)
    q.set('page', String(params.page ?? 1))
    // Сервер ограничивает страницу 200 записями
    q.set('page_size', String(Math.min(params.pageSize ?? 200, 200)))
    if (params.search) q.set('search', params.search)
    if (params.unresolved !== undefined) q.set('unresolved', String(params.unresolved))
    if (params.kind) q.set('kind', params.kind)
    return request<{ total: number; page: number; page_size: number; items: SrvEvent[] }>(
      '/api/transactions?' + q.toString())
  },

  /** Все события постранично: сервер отдаёт максимум 200 за запрос. */
  allTransactions: async (params: Parameters<typeof api.transactions>[0] = {}) => {
    const first = await api.transactions({ ...params, page: 1, pageSize: 200 })
    const items = [...first.items]
    const pages = Math.ceil(first.total / first.page_size)
    for (let page = 2; page <= pages; page++) {
      const next = await api.transactions({ ...params, page, pageSize: 200 })
      items.push(...next.items)
    }
    return { total: first.total, items }
  },

  event: (id: string) => request<SrvEvent>('/api/events/' + id),

  questions: (mode: 'recommended' | 'all', sessionId?: string | null) => {
    const q = new URLSearchParams({ mode })
    if (sessionId) q.set('session_id', sessionId)
    return request<{ items: SrvQuestion[]; total_open: number; session_shown_count: number | null }>(
      '/api/questions?' + q.toString())
  },

  answerQuestion: (id: string, body: Record<string, unknown>) =>
    request<{ decision_id: string; event: SrvEvent }>(`/api/questions/${id}/answer`, json(body)),

  snoozeQuestion: (id: string) =>
    request<{ status: string }>(`/api/questions/${id}/snooze`, { method: 'POST' }),

  classify: (eventId: string, body: Record<string, unknown>) =>
    request<{ decision_id: string; event: SrvEvent }>(`/api/events/${eventId}/classify`, json(body)),

  share: (eventId: string, body: Record<string, unknown>) =>
    request<{ decision_id: string; event: SrvEvent }>(`/api/events/${eventId}/shared`, json(body)),

  settle: (body: Record<string, unknown>) =>
    request<{ decision_id: string; event: SrvEvent }>('/api/settlements', json(body)),

  refund: (body: Record<string, unknown>) =>
    request<{ decision_id: string; event: SrvEvent }>('/api/refunds', json(body)),

  manualCash: (body: {
    booking_date: string; amount_minor: number; category: string
    description: string; command_id: string
  }) => request<{ event: SrvEvent; idempotent_replay: boolean }>(
    '/api/manual-cash-expenses', json(body)),

  undo: (decisionId: string, cascade = false) =>
    request<{ event: SrvEvent | null; event_id: string }>(
      `/api/decisions/${decisionId}/undo?cascade=${cascade}`, { method: 'POST' }),

  receivables: (through?: string) =>
    request<SrvReceivable[]>('/api/receivables' + (through ? '?through=' + through : '')),

  weeklyReview: (today: string) => request<SrvWeekly>('/api/weekly-review?today=' + today),

  markWeeklySeen: (from: string, to: string) =>
    request<{ status: string }>('/api/weekly-review/seen',
      json({ period_from: from, period_to: to })),

  loadDemo: () => request<{ batch_id: string; idempotent_replay: boolean; new?: number }>(
    '/api/demo/load', { method: 'POST' }, 30000),

  previewImport: (file: File, opts: { profile?: string; account_id?: string; currency?: string } = {}) => {
    const form = new FormData()
    form.append('file', file)
    form.append('profile', opts.profile ?? 'default')
    if (opts.account_id) form.append('account_id', opts.account_id)
    form.append('currency', opts.currency ?? 'RUB')
    return request<any>('/api/imports/preview', { method: 'POST', body: form }, 30000)
  },

  commitImport: (body: Record<string, unknown>) =>
    request<any>('/api/imports/commit', json(body), 30000),
}
