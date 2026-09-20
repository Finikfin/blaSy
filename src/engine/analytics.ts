import type {
  Account, CategoryId, EconomicEvent, Minor, Movement,
} from './types'
import { dateOf } from './classify'

export type Granularity = 'day' | 'week' | 'month' | 'year' | 'custom'
export type Range = { from: string; to: string; label: string }

export const iso = (x: Date) => {
  const y = x.getFullYear()
  const m = String(x.getMonth() + 1).padStart(2, '0')
  const d = String(x.getDate()).padStart(2, '0')
  return y + '-' + m + '-' + d
}

const MONTH_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря']
const MONTH_NOM = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь']

export const fmtDate = (s: string) => {
  const x = dateOf(s)
  return x.getDate() + ' ' + MONTH_GEN[x.getMonth()]
}

// ── Периоды (§5.3). from и to включительны. ──────────────────────────
export function dayRange(anchor: string): Range {
  return { from: anchor, to: anchor, label: fmtDate(anchor) }
}

/** Неделя начинается в понедельник. */
export function weekRange(anchor: string): Range {
  const x = dateOf(anchor)
  const shift = (x.getDay() + 6) % 7
  const from = new Date(x); from.setDate(x.getDate() - shift)
  const to = new Date(from); to.setDate(from.getDate() + 6)
  // «21–27 сентября» внутри месяца, «28 сентября – 4 октября» на стыке
  const label = from.getMonth() === to.getMonth()
    ? from.getDate() + '–' + fmtDate(iso(to))
    : fmtDate(iso(from)) + ' – ' + fmtDate(iso(to))
  return { from: iso(from), to: iso(to), label }
}

export function monthRange(anchor: string): Range {
  const x = dateOf(anchor)
  const from = new Date(x.getFullYear(), x.getMonth(), 1)
  const to = new Date(x.getFullYear(), x.getMonth() + 1, 0)
  return { from: iso(from), to: iso(to), label: MONTH_NOM[x.getMonth()] + ' ' + x.getFullYear() }
}

export function yearRange(anchor: string): Range {
  const y = dateOf(anchor).getFullYear()
  return { from: y + '-01-01', to: y + '-12-31', label: String(y) + ' год' }
}

export function rangeFor(g: Granularity, anchor: string): Range {
  if (g === 'day') return dayRange(anchor)
  if (g === 'week') return weekRange(anchor)
  if (g === 'year') return yearRange(anchor)
  return monthRange(anchor)
}

export function shiftRange(r: Range, g: Granularity, dir: number): Range {
  const x = dateOf(r.from)
  if (g === 'day') { x.setDate(x.getDate() + dir); return dayRange(iso(x)) }
  if (g === 'week') { x.setDate(x.getDate() + 7 * dir); return weekRange(iso(x)) }
  if (g === 'month') { x.setMonth(x.getMonth() + dir); return monthRange(iso(x)) }
  if (g === 'year') { x.setFullYear(x.getFullYear() + dir); return yearRange(iso(x)) }
  const len = Math.round((dateOf(r.to).getTime() - dateOf(r.from).getTime()) / 86400000) + 1
  const f = dateOf(r.from); f.setDate(f.getDate() + len * dir)
  const t = dateOf(r.to); t.setDate(t.getDate() + len * dir)
  return { from: iso(f), to: iso(t), label: fmtDate(iso(f)) + ' – ' + fmtDate(iso(t)) }
}

/** §5.3 — предыдущий период. Для произвольного диапазона — той же длины. */
export const previousRange = (r: Range, g: Granularity) => shiftRange(r, g, -1)

/** Недельные строки месяца, обрезанные его границами. Их сумма равна месяцу. */
export function weeksOfMonth(month: Range): Range[] {
  const out: Range[] = []
  let cur = weekRange(month.from)
  while (cur.from <= month.to) {
    const from = cur.from < month.from ? month.from : cur.from
    const to = cur.to > month.to ? month.to : cur.to
    out.push({ from, to, label: dateOf(from).getDate() + '–' + dateOf(to).getDate() })
    cur = shiftRange(cur, 'week', 1)
  }
  return out
}

// ── Суммы (§5.3). Единственный источник истины — AnalyticEffect. ─────
const inRange = (date: string, r: Range) => date >= r.from && date <= r.to

export function expenses(events: EconomicEvent[], r: Range): Minor {
  let s = 0
  for (const e of events) for (const f of e.effects)
    if (f.measure === 'expense' && inRange(f.date, r)) s += f.amountMinor
  return s
}

export function income(events: EconomicEvent[], r: Range): Minor {
  let s = 0
  for (const e of events) for (const f of e.effects)
    if (f.measure === 'income' && inRange(f.date, r)) s += f.amountMinor
  return s
}

export const net = (events: EconomicEvent[], r: Range) => income(events, r) - expenses(events, r)

/** §5.2 инвариант 15: неразобранные входящие и исходящие не взаимозачитываются. */
export function unresolvedSplit(events: EconomicEvent[], r: Range) {
  let incoming = 0, outgoing = 0, count = 0
  for (const e of events) {
    if (e.resolutionStatus !== 'unresolved' || !inRange(e.date, r)) continue
    count++
    for (const m of e.movements) {
      if (m.signedAmountMinor > 0) incoming += m.signedAmountMinor
      else outgoing += -m.signedAmountMinor
    }
  }
  return { incoming, outgoing, count }
}

export type CategoryRow = { category: CategoryId; amountMinor: Minor; share: number }

export function byCategory(events: EconomicEvent[], r: Range): CategoryRow[] {
  const acc: Partial<Record<CategoryId, number>> = {}
  for (const e of events) for (const f of e.effects) {
    if (f.measure !== 'expense' || !inRange(f.date, r)) continue
    const c = f.category ?? 'uncategorized'
    acc[c] = (acc[c] ?? 0) + f.amountMinor
  }
  const positiveTotal = Object.values(acc).reduce((s: number, v) => s + Math.max(v ?? 0, 0), 0) || 1
  return (Object.entries(acc) as [CategoryId, number][])
    .filter(([, v]) => v !== 0)
    .map(([category, amountMinor]) => ({
      category, amountMinor, share: Math.max(amountMinor, 0) / positiveTotal,
    }))
    .sort((a, b) => b.amountMinor - a.amountMinor)
}

/**
 * §5.3 — процент показываем только при положительной базе.
 * Иначе честно отдаём абсолютную разницу и признаём, что процент не рассчитан.
 */
export function compare(current: Minor, previous: Minor) {
  const diff = current - previous
  if (previous > 0) return { diff, percent: (diff / previous) * 100, hasPercent: true as const }
  return { diff, percent: null, hasPercent: false as const }
}

/** §5.2 инвариант 9: сумма непересекающихся отрезков равна итогу периода. */
export function reconciliation(events: EconomicEvent[], month: Range) {
  const weeks = weeksOfMonth(month).map(w => ({
    range: w, expense: expenses(events, w), income: income(events, w),
  }))
  const weekSum = weeks.reduce((s, w) => s + w.expense, 0)
  const monthSum = expenses(events, month)
  return { weeks, weekSum, monthSum, ok: weekSum === monthSum }
}

/**
 * D14: без начального остатка показываем ИЗМЕНЕНИЕ по загруженным операциям,
 * а не «баланс». Наличные имеют явный начальный остаток и потому считаются.
 */
export function accountState(movements: Movement[], accounts: Account[], upTo: string) {
  return accounts.map(a => {
    const delta = movements
      .filter(m => m.accountId === a.id && m.date <= upTo)
      .reduce((s, m) => s + m.signedAmountMinor, 0)
    const known = a.openingBalanceMinor !== undefined
    return {
      account: a,
      changeMinor: delta,
      balanceMinor: known ? a.openingBalanceMinor! + delta : null,
      balanceKnown: known,
    }
  })
}

export function receivableTotals(rs: { originalMinor: Minor; settledMinor: Minor }[]) {
  const open = rs.reduce((s, r) => s + Math.max(r.originalMinor - r.settledMinor, 0), 0)
  return { open, count: rs.filter(r => r.settledMinor < r.originalMinor).length }
}

/** §11 — последняя завершённая календарная неделя относительно today. */
export function lastCompleteWeek(today: string): Range {
  const thisWeek = weekRange(today)
  return shiftRange(thisWeek, 'week', -1)
}
