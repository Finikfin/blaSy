// ─────────────────────────────────────────────────────────────
// Финансовая модель. Соответствует §4, §5 ТЗ.
// D01: деньги — целое число копеек. Float в расчётах запрещён.
// ─────────────────────────────────────────────────────────────

export type Minor = number // копейки, целое

export type AccountKind = 'bank' | 'cash'

export type Account = {
  id: string
  name: string
  kind: AccountKind
  ownConfirmed: boolean
  openingBalanceMinor?: Minor
  openingBalanceDate?: string
  color: string
}

/** Неизменный факт из файла выписки (§4). */
export type RawTransaction = {
  id: string
  accountId: string
  bookingDate: string          // YYYY-MM-DD
  signedAmountMinor: Minor     // <0 списание, >0 поступление
  description: string
  bankType: BankType
  counterparty?: string
  counterpartyAccountRef?: string
}

export type BankType =
  | 'purchase' | 'salary' | 'transfer' | 'refund' | 'cash_withdrawal' | 'unknown'

/** Реальное изменение одного счёта (§4). */
export type Movement = {
  id: string
  rawId?: string
  accountId: string
  date: string
  signedAmountMinor: Minor
  origin: 'import' | 'manual' | 'derived_cash'
}

/** §5.1 — ровно эти виды событий. */
export type EventKind =
  | 'EXPENSE'
  | 'INCOME'
  | 'OWN_TRANSFER'
  | 'CASH_WITHDRAWAL'
  | 'LOAN_ISSUED'
  | 'LOAN_REPAYMENT'
  | 'SHARED_PURCHASE'
  | 'REIMBURSEMENT'
  | 'PURCHASE_REFUND'
  | 'UNRESOLVED'

export type ResolutionStatus = 'confirmed' | 'unresolved'
export type ResolutionSource = 'bank_type' | 'rule' | 'user'
export type CoverageStatus = 'complete' | 'missing_counterpart'

export type CategoryId =
  | 'groceries' | 'restaurants' | 'transport' | 'home' | 'electronics'
  | 'health' | 'entertainment' | 'services' | 'fees' | 'other' | 'uncategorized'

/** §5.3 — подписанная сумма расхода или дохода на конкретную дату. */
export type AnalyticEffect = {
  date: string
  measure: 'expense' | 'income'
  amountMinor: Minor           // может быть отрицательной (возврат)
  category?: CategoryId
}

export type EconomicEvent = {
  id: string
  kind: EventKind
  date: string
  title: string
  movements: Movement[]
  effects: AnalyticEffect[]
  resolutionStatus: ResolutionStatus
  resolutionSource: ResolutionSource
  coverageStatus: CoverageStatus
  category?: CategoryId
  counterparty?: string
  /** человеческое основание решения — показывается в карточке операции */
  explanation: string
  linkedEventId?: string
  /** решения по событию: последнее можно отменить */
  decisionIds?: string[]
  /** доли совместной покупки */
  shares?: { name: string; isSelf: boolean; amountMinor: Minor; settledMinor: Minor }[]
}

/** Дебиторка: мне должны (§5, §10.6). */
export type Receivable = {
  id: string
  originEventId: string
  participant: string
  originalMinor: Minor
  settledMinor: Minor
  createdDate: string
}

export type QuestionType =
  | 'account_ownership' | 'settlement_group' | 'economic_meaning'
  | 'refund_link' | 'missing_source' | 'category'

export type QuestionOption = {
  id: string
  label: string
  hint?: string
  /** что произойдёт с цифрами, честным текстом */
  effectNote?: string
  /** тело запроса к серверу; в офлайн-режиме не используется */
  payload?: Record<string, unknown>
}

/** §9 — вопрос очереди уточнений. */
export type Question = {
  id: string
  /** событие, к которому относится вопрос (нужно серверу) */
  eventId?: string
  /** ревизия события для защиты от гонок (§12.1) */
  revision?: number
  type: QuestionType
  title: string
  body: string
  relatedIds: string[]
  /** §9.2: оценка максимального изменения текущего итога, не «экономия» */
  impactMinor: Minor
  impactIsVolume?: boolean
  options: QuestionOption[]
  changesTotals: boolean
}

/** Решение пользователя по вопросу. */
export type Decision = {
  questionId: string
  optionId: string
  at: string
}

export const CATEGORY_TITLE: Record<CategoryId, string> = {
  groceries: 'Продукты',
  restaurants: 'Кафе и рестораны',
  transport: 'Транспорт',
  home: 'Дом и быт',
  electronics: 'Техника',
  health: 'Здоровье',
  entertainment: 'Развлечения',
  services: 'Услуги',
  fees: 'Комиссии',
  other: 'Прочее',
  uncategorized: 'Без категории',
}

export const CATEGORY_COLOR: Record<CategoryId, string> = {
  groceries: '#CCFF00',
  restaurants: '#8FE388',
  transport: '#5ED3A0',
  electronics: '#3FB8AF',
  home: '#7A9E7E',
  health: '#A3D977',
  entertainment: '#6FCF97',
  services: '#4E8D6E',
  fees: '#59635C',
  other: '#3D4A41',
  uncategorized: '#2E3A32',
}

export const KIND_TITLE: Record<EventKind, string> = {
  EXPENSE: 'Расход',
  INCOME: 'Доход',
  OWN_TRANSFER: 'Перевод себе',
  CASH_WITHDRAWAL: 'Снятие наличных',
  LOAN_ISSUED: 'Дал в долг',
  LOAN_REPAYMENT: 'Возврат долга',
  SHARED_PURCHASE: 'Платил за компанию',
  REIMBURSEMENT: 'Компенсация доли',
  PURCHASE_REFUND: 'Возврат покупки',
  UNRESOLVED: 'Не разобрано',
}
