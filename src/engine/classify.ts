import type {
  Account, AnalyticEffect, CategoryId, EconomicEvent, Movement,
  Question, RawTransaction, Receivable,
} from './types'
import { splitEvenly } from './money'

export const dateOf = (s: string) => new Date(s + 'T12:00:00')
export const daysBetween = (a: string, b: string) =>
  Math.round((dateOf(b).getTime() - dateOf(a).getTime()) / 86400000)
export const ddmm = (iso: string) => iso.slice(8, 10) + '.' + iso.slice(5, 7)

// §7.5, §10.8 — словарь категорий. Работает без внешней модели.
const CATEGORY_RULES: [RegExp, CategoryId][] = [
  [/пятёрочка|продукт|рынок|магнит|лента|вкусвилл/i, 'groceries'],
  [/ресторан|кафе|бар|ужин|обед|кофейня/i, 'restaurants'],
  [/метро|такси|проездн|транспорт|бензин/i, 'transport'],
  [/техник|электрон|ноутбук|телефон/i, 'electronics'],
  [/аптек|клиник|врач|здоров/i, 'health'],
  [/кино|театр|подписк|развлеч/i, 'entertainment'],
  [/аренда|жкх|быт|дом/i, 'home'],
  [/комисси/i, 'fees'],
  [/связь|интернет|услуг/i, 'services'],
]

export function suggestCategory(description: string): CategoryId {
  for (const [re, cat] of CATEGORY_RULES) if (re.test(description)) return cat
  return 'uncategorized'
}

/** Решения пользователя: id вопроса → id выбранного варианта. */
export type Decisions = Record<string, string>

export type ClassifyResult = {
  events: EconomicEvent[]
  questions: Question[]
  receivables: Receivable[]
  movements: Movement[]
}

export type ManualEntry = {
  id: string
  accountId: string
  date: string
  amountMinor: number
  description: string
  category: CategoryId
}

const SELF = 'Я'

/**
 * §7.1 — порядок классификации. Все правила детерминированные:
 * один и тот же вход при одних и тех же решениях даёт один и тот же выход.
 */
export function classify(
  raws: RawTransaction[],
  accounts: Account[],
  manual: ManualEntry[],
  decisions: Decisions,
): ClassifyResult {
  const txs = [...raws].sort((a, b) =>
    a.bookingDate.localeCompare(b.bookingDate) || a.id.localeCompare(b.id))
  const ownAccountIds = new Set(accounts.filter(a => a.ownConfirmed).map(a => a.id))
  const accById = Object.fromEntries(accounts.map(a => [a.id, a])) as Record<string, Account>
  const cashId = accounts.find(a => a.kind === 'cash')?.id ?? 'cash'

  const events: EconomicEvent[] = []
  const questions: Question[] = []
  const receivables: Receivable[] = []
  const movements: Movement[] = []
  const used = new Set<string>()

  const mv = (t: RawTransaction): Movement => {
    const m: Movement = {
      id: 'm_' + t.id, rawId: t.id, accountId: t.accountId,
      date: t.bookingDate, signedAmountMinor: t.signedAmountMinor, origin: 'import',
    }
    movements.push(m)
    return m
  }

  const expenseEffect = (date: string, amountMinor: number, category: CategoryId): AnalyticEffect =>
    ({ date, measure: 'expense', amountMinor, category })
  const incomeEffect = (date: string, amountMinor: number): AnalyticEffect =>
    ({ date, measure: 'income', amountMinor })

  // ── 1. Переводы между подтверждёнными своими счетами (§7.2) ──────────
  for (const out of txs) {
    if (used.has(out.id) || out.signedAmountMinor >= 0) continue
    if (out.bankType !== 'transfer') continue
    const ref = out.counterpartyAccountRef
    if (!ref || !ownAccountIds.has(ref)) continue
    const mates = txs.filter(t =>
      !used.has(t.id) && t.accountId === ref &&
      t.signedAmountMinor === -out.signedAmountMinor &&
      Math.abs(daysBetween(out.bookingDate, t.bookingDate)) <= 3)
    used.add(out.id)
    const mate = mates.length === 1 ? mates[0] : undefined
    if (mate) used.add(mate.id)
    events.push({
      id: 'e_' + out.id,
      kind: 'OWN_TRANSFER',
      date: out.bookingDate,
      title: 'Перевод себе → ' + (accById[ref]?.name ?? ref),
      movements: mate ? [mv(out), mv(mate)] : [mv(out)],
      effects: [],
      resolutionStatus: 'confirmed',
      resolutionSource: 'rule',
      coverageStatus: mate ? 'complete' : 'missing_counterpart',
      explanation: mate
        ? 'Две записи выписок склеены в одну операцию: свои счета, равные встречные суммы, реквизиты подтверждают направление. Ни расход, ни доход.'
        : 'Счёт получателя подтверждён как свой, но вторая выписка не загружена. Операция учтена как перевод, не как расход.',
    })
  }

  // ── 2. Снятие наличных (§7.1, D06) ──────────────────────────────────
  for (const t of txs) {
    if (used.has(t.id) || t.bankType !== 'cash_withdrawal') continue
    used.add(t.id)
    const bankMv = mv(t)
    const derived: Movement = {
      id: 'm_' + t.id + '_cash', accountId: cashId, date: t.bookingDate,
      signedAmountMinor: -t.signedAmountMinor, origin: 'derived_cash',
    }
    movements.push(derived)
    events.push({
      id: 'e_' + t.id,
      kind: 'CASH_WITHDRAWAL',
      date: t.bookingDate,
      title: 'Снятие наличных',
      movements: [bankMv, derived],
      effects: [],
      resolutionStatus: 'confirmed',
      resolutionSource: 'bank_type',
      coverageStatus: 'complete',
      explanation: 'Деньги переложены в наличный кошелёк, а не потрачены. Расход возникнет при покупке за наличные.',
    })
  }

  // ── 3. Зарплата (§7.1) ──────────────────────────────────────────────
  for (const t of txs) {
    if (used.has(t.id) || t.bankType !== 'salary') continue
    used.add(t.id)
    events.push({
      id: 'e_' + t.id, kind: 'INCOME', date: t.bookingDate, title: t.description,
      movements: [mv(t)], effects: [incomeEffect(t.bookingDate, t.signedAmountMinor)],
      resolutionStatus: 'confirmed', resolutionSource: 'bank_type', coverageStatus: 'complete',
      counterparty: t.counterparty,
      explanation: 'Банк отметил операцию как зачисление заработной платы.',
    })
  }

  // ── 4. Покупки. Может быть превращена в совместную решением пользователя ──
  const sharedPurchases: { event: EconomicEvent; tx: RawTransaction }[] = []
  for (const t of txs) {
    if (used.has(t.id) || t.bankType !== 'purchase') continue
    used.add(t.id)
    const total = -t.signedAmountMinor
    const cat = suggestCategory(t.description)
    const qid = 'q_shared_' + t.id
    const splitDecision = decisions[qid]

    if (splitDecision && splitDecision.startsWith('split')) {
      // §7.4 — участников задаёт пользователь, система их не выводит сама.
      const n = Number(splitDecision.slice('split'.length)) || 2
      const parts = splitEvenly(total, n)
      const shares = parts.map((amountMinor, i) => ({
        name: i === 0 ? SELF : 'Друг ' + i,
        isSelf: i === 0,
        amountMinor,
        settledMinor: 0,
      }))
      const ev: EconomicEvent = {
        id: 'e_' + t.id, kind: 'SHARED_PURCHASE', date: t.bookingDate, title: t.description,
        movements: [mv(t)], effects: [expenseEffect(t.bookingDate, parts[0], cat)],
        resolutionStatus: 'confirmed', resolutionSource: 'user', coverageStatus: 'complete',
        category: cat, shares,
        explanation: 'Вы платили за компанию из ' + n + ' человек. В расходы попала только ваша доля '
          + (parts[0] / 100).toLocaleString('ru-RU') + ' ₽. Остальные доли — задолженность участников, не ваш расход.',
      }
      events.push(ev)
      sharedPurchases.push({ event: ev, tx: t })
      shares.filter(s => !s.isSelf).forEach((s, i) => receivables.push({
        id: 'rc_' + t.id + '_' + i, originEventId: ev.id, participant: s.name,
        originalMinor: s.amountMinor, settledMinor: 0, createdDate: t.bookingDate,
      }))
      continue
    }

    events.push({
      id: 'e_' + t.id, kind: 'EXPENSE', date: t.bookingDate, title: t.description,
      movements: [mv(t)], effects: [expenseEffect(t.bookingDate, total, cat)],
      resolutionStatus: 'confirmed', resolutionSource: 'bank_type', coverageStatus: 'complete',
      category: cat,
      explanation: 'Банк отметил операцию как покупку. Категория предложена по названию продавца.',
    })
  }

  // ── 5. Исходящие переводы людям: смысл задаёт пользователь ──────────
  const loans: { event: EconomicEvent; tx: RawTransaction; receivable: Receivable }[] = []
  for (const t of txs) {
    if (used.has(t.id) || t.signedAmountMinor >= 0) continue
    used.add(t.id)
    const amount = -t.signedAmountMinor
    const qid = 'q_meaning_' + t.id
    const decision = decisions[qid]
    const who = t.counterparty ?? 'получатель'

    if (decision === 'loan_issued') {
      const ev: EconomicEvent = {
        id: 'e_' + t.id, kind: 'LOAN_ISSUED', date: t.bookingDate,
        title: 'Дал в долг · ' + who, movements: [mv(t)], effects: [],
        resolutionStatus: 'confirmed', resolutionSource: 'user', coverageStatus: 'complete',
        counterparty: who,
        explanation: 'Вы отметили перевод как выданный долг. Это дебиторская задолженность, а не расход: деньги вы ждёте обратно.',
      }
      events.push(ev)
      const rc: Receivable = {
        id: 'rc_' + t.id, originEventId: ev.id, participant: who,
        originalMinor: amount, settledMinor: 0, createdDate: t.bookingDate,
      }
      receivables.push(rc)
      loans.push({ event: ev, tx: t, receivable: rc })
      continue
    }
    if (decision === 'expense') {
      const cat = suggestCategory(t.description)
      events.push({
        id: 'e_' + t.id, kind: 'EXPENSE', date: t.bookingDate, title: t.description,
        movements: [mv(t)], effects: [expenseEffect(t.bookingDate, amount, cat)],
        resolutionStatus: 'confirmed', resolutionSource: 'user', coverageStatus: 'complete',
        category: cat, counterparty: who,
        explanation: 'Вы подтвердили, что это обычный расход.',
      })
      continue
    }

    events.push({
      id: 'e_' + t.id, kind: 'UNRESOLVED', date: t.bookingDate,
      title: t.description, movements: [mv(t)], effects: [],
      resolutionStatus: 'unresolved', resolutionSource: 'rule', coverageStatus: 'complete',
      counterparty: t.counterparty,
      explanation: 'Исходящий перевод человеку. Пока смысл не подтверждён, деньги учтены как движение, но в расходы не попали — иначе итог был бы завышен.',
    })
    questions.push({
      id: qid, type: 'economic_meaning',
      title: 'Что означает перевод ' + (amount / 100).toLocaleString('ru-RU') + ' ₽?',
      body: ddmm(t.bookingDate) + ' · ' + t.description + (t.counterparty ? ' · ' + t.counterparty : ''),
      relatedIds: [t.id], impactMinor: amount, changesTotals: true,
      options: [
        { id: 'loan_issued', label: 'Дал в долг', hint: who, effectNote: 'расходы не изменятся, появится долг' },
        { id: 'expense', label: 'Это мой расход', effectNote: 'расходы вырастут на ' + (amount / 100).toLocaleString('ru-RU') + ' ₽' },
        { id: 'later', label: 'Позже', effectNote: 'останется неразобранным' },
      ],
    })
  }

  // ── 6. Возвраты покупок (§7.1, S6) ──────────────────────────────────
  for (const t of txs) {
    if (used.has(t.id) || t.bankType !== 'refund') continue
    used.add(t.id)
    const amount = t.signedAmountMinor
    const base = t.description.replace(/,\s*возврат\s*$/i, '').trim().toLowerCase()
    const origin = events.find(e =>
      (e.kind === 'EXPENSE' || e.kind === 'SHARED_PURCHASE') &&
      e.title.toLowerCase().startsWith(base) &&
      daysBetween(e.date, t.bookingDate) >= 0 && daysBetween(e.date, t.bookingDate) <= 60 &&
      (e.effects[0]?.amountMinor ?? 0) >= amount)
    const qid = 'q_refund_' + t.id
    const decision = decisions[qid]

    if (decision && decision.startsWith('link_') && origin) {
      const cat = origin.category ?? 'uncategorized'
      events.push({
        id: 'e_' + t.id, kind: 'PURCHASE_REFUND', date: t.bookingDate,
        title: 'Возврат · ' + origin.title, movements: [mv(t)],
        effects: [expenseEffect(t.bookingDate, -amount, cat)],
        resolutionStatus: 'confirmed', resolutionSource: 'user', coverageStatus: 'complete',
        category: cat, linkedEventId: origin.id,
        explanation: 'Возврат покупки от ' + ddmm(origin.date) + '. Это не доход: расходы уменьшаются на дату возврата, '
          + 'в той же категории. Прошлый период не переписывается.',
      })
      continue
    }
    if (decision === 'income') {
      events.push({
        id: 'e_' + t.id, kind: 'INCOME', date: t.bookingDate, title: t.description,
        movements: [mv(t)], effects: [incomeEffect(t.bookingDate, amount)],
        resolutionStatus: 'confirmed', resolutionSource: 'user', coverageStatus: 'complete',
        explanation: 'Вы подтвердили, что это доход.',
      })
      continue
    }

    events.push({
      id: 'e_' + t.id, kind: 'UNRESOLVED', date: t.bookingDate, title: t.description,
      movements: [mv(t)], effects: [],
      resolutionStatus: 'unresolved', resolutionSource: 'rule', coverageStatus: 'complete',
      explanation: 'Банк пометил поступление как возврат, но связь с покупкой не подтверждена. Доходом такое поступление не является.',
    })
    questions.push({
      id: qid, type: 'refund_link',
      title: 'Это возврат покупки?',
      body: (amount / 100).toLocaleString('ru-RU') + ' ₽ от ' + ddmm(t.bookingDate)
        + (origin ? ' · похоже на покупку «' + origin.title + '» от ' + ddmm(origin.date) : ''),
      relatedIds: [t.id], impactMinor: amount, changesTotals: true,
      options: [
        ...(origin ? [{
          id: 'link_' + origin.id, label: 'Да, возврат покупки от ' + ddmm(origin.date),
          effectNote: 'расходы уменьшатся на ' + (amount / 100).toLocaleString('ru-RU') + ' ₽',
        }] : []),
        { id: 'income', label: 'Нет, это доход', effectNote: 'доходы вырастут' },
        { id: 'later', label: 'Позже', effectNote: 'останется неразобранным' },
      ],
    })
  }

  // ── 7. Входящие переводы: погашения долгов и компенсации долей (§7.3) ──
  const openLoans = () => loans.filter(l => l.receivable.settledMinor < l.receivable.originalMinor)
  for (const t of txs) {
    if (used.has(t.id) || t.signedAmountMinor <= 0) continue
    used.add(t.id)
    const amount = t.signedAmountMinor
    const who = t.counterparty
    const qid = 'q_incoming_' + t.id
    const decision = decisions[qid]

    // кандидат-погашение долга: тот же контрагент, есть остаток
    const loan = openLoans().find(l =>
      who && l.receivable.participant === who && daysBetween(l.tx.bookingDate, t.bookingDate) >= 0
      && amount <= l.receivable.originalMinor - l.receivable.settledMinor)
    // кандидат-компенсация доли: контрагент есть среди участников совместной покупки
    const shared = sharedPurchases.find(sp =>
      who && sp.event.shares?.some(s => s.name === who && s.settledMinor < s.amountMinor)
      && daysBetween(sp.tx.bookingDate, t.bookingDate) >= 0)

    if (decision === 'settle' && loan) {
      loan.receivable.settledMinor += amount
      const left = loan.receivable.originalMinor - loan.receivable.settledMinor
      events.push({
        id: 'e_' + t.id, kind: 'LOAN_REPAYMENT', date: t.bookingDate,
        title: 'Возврат долга · ' + who, movements: [mv(t)], effects: [],
        resolutionStatus: 'confirmed', resolutionSource: 'user', coverageStatus: 'complete',
        counterparty: who, linkedEventId: loan.event.id,
        explanation: left > 0
          ? 'Частичный возврат долга от ' + ddmm(loan.tx.bookingDate) + '. Остаток '
            + (left / 100).toLocaleString('ru-RU') + ' ₽. Доходом не является.'
          : 'Долг от ' + ddmm(loan.tx.bookingDate) + ' закрыт полностью. Доходом не является.',
      })
      continue
    }
    if (decision === 'reimburse' && shared) {
      const share = shared.event.shares!.find(s => s.name === who)!
      share.settledMinor += amount
      const rc = receivables.find(r => r.originEventId === shared.event.id && r.participant === who)
      if (rc) rc.settledMinor += amount
      events.push({
        id: 'e_' + t.id, kind: 'REIMBURSEMENT', date: t.bookingDate,
        title: 'Доля · ' + who, movements: [mv(t)], effects: [],
        resolutionStatus: 'confirmed', resolutionSource: 'user', coverageStatus: 'complete',
        counterparty: who, linkedEventId: shared.event.id,
        explanation: 'Компенсация доли за «' + shared.event.title + '». Ни доход, ни уменьшение расхода: '
          + 'ваш расход уже равен вашей доле, а это поступление гасит чужую задолженность.',
      })
      continue
    }
    if (decision === 'income') {
      events.push({
        id: 'e_' + t.id, kind: 'INCOME', date: t.bookingDate, title: t.description,
        movements: [mv(t)], effects: [incomeEffect(t.bookingDate, amount)],
        resolutionStatus: 'confirmed', resolutionSource: 'user', coverageStatus: 'complete',
        counterparty: who,
        explanation: 'Вы подтвердили, что это доход.',
      })
      continue
    }

    events.push({
      id: 'e_' + t.id, kind: 'UNRESOLVED', date: t.bookingDate, title: t.description,
      movements: [mv(t)], effects: [],
      resolutionStatus: 'unresolved', resolutionSource: 'rule', coverageStatus: 'complete',
      counterparty: who,
      explanation: 'Входящий перевод без подтверждённого основания. Автоматически считать его доходом нельзя: '
        + 'это может быть возврат долга или компенсация доли.',
    })

    const options = [
      ...(shared ? [{
        id: 'reimburse', label: 'Вернули мою долю',
        hint: shared.event.title, effectNote: 'итоги не изменятся, долг участника закроется',
      }] : []),
      ...(loan ? [{
        id: 'settle', label: 'Возврат долга',
        hint: who, effectNote: 'итоги не изменятся, остаток долга уменьшится',
      }] : []),
      { id: 'income', label: 'Это доход', effectNote: 'доходы вырастут на ' + (amount / 100).toLocaleString('ru-RU') + ' ₽' },
      { id: 'later', label: 'Позже', effectNote: 'останется неразобранным' },
    ]
    questions.push({
      id: qid, type: loan || shared ? 'settlement_group' : 'economic_meaning',
      title: (loan || shared)
        ? 'Это погашение? ' + (amount / 100).toLocaleString('ru-RU') + ' ₽'
        : 'Что означает поступление ' + (amount / 100).toLocaleString('ru-RU') + ' ₽?',
      body: ddmm(t.bookingDate) + ' · ' + t.description,
      relatedIds: [t.id],
      impactMinor: amount,
      impactIsVolume: Boolean(loan || shared),
      changesTotals: !(loan || shared),
      options,
    })
  }

  // ── 8. Ручные операции (наличные покупки) ───────────────────────────
  for (const m of manual) {
    const amount = -m.amountMinor
    const mov: Movement = {
      id: 'm_' + m.id, accountId: m.accountId, date: m.date,
      signedAmountMinor: m.amountMinor, origin: 'manual',
    }
    movements.push(mov)
    events.push({
      id: 'e_' + m.id, kind: 'EXPENSE', date: m.date, title: m.description,
      movements: [mov], effects: [expenseEffect(m.date, amount, m.category)],
      resolutionStatus: 'confirmed', resolutionSource: 'user', coverageStatus: 'complete',
      category: m.category,
      explanation: 'Покупка за наличные, внесена вручную. Банковской строки для неё не существует.',
    })
  }

  // ── 9. Предложение «Платил за компанию» для крупных покупок ─────────
  for (const ev of events) {
    if (ev.kind !== 'EXPENSE' || !ev.effects[0]) continue
    if (ev.category !== 'restaurants') continue
    if (ev.effects[0].amountMinor < 300000) continue
    const qid = 'q_shared_' + (ev.movements[0]?.rawId ?? ev.id)
    if (decisions[qid]) continue
    const total = ev.effects[0].amountMinor
    questions.push({
      id: qid, type: 'economic_meaning',
      title: 'Вы платили за компанию?',
      body: ddmm(ev.date) + ' · ' + ev.title + ' · ' + (total / 100).toLocaleString('ru-RU') + ' ₽',
      relatedIds: [ev.id],
      impactMinor: total - Math.floor(total / 5),
      changesTotals: true,
      options: [
        { id: 'split5', label: 'Да, на пятерых поровну', effectNote: 'в расходы попадёт ' + (Math.floor(total / 5) / 100).toLocaleString('ru-RU') + ' ₽' },
        { id: 'split2', label: 'Да, пополам', effectNote: 'в расходы попадёт ' + (Math.floor(total / 2) / 100).toLocaleString('ru-RU') + ' ₽' },
        { id: 'no', label: 'Нет, платил только за себя', effectNote: 'расходы не изменятся' },
      ],
    })
  }

  // §9.2 — объяснимое ранжирование без модели
  questions.sort((a, b) =>
    Number(b.changesTotals) - Number(a.changesTotals) ||
    Math.abs(b.impactMinor) - Math.abs(a.impactMinor) ||
    b.relatedIds.length - a.relatedIds.length ||
    a.id.localeCompare(b.id))

  events.sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id))
  return { events, questions, receivables, movements }
}

/** Решения, воспроизводящие контрольное состояние §17.2. */
export const DEMO_DECISIONS: Decisions = {
  q_meaning_S07: 'loan_issued',
  q_incoming_S08: 'settle',
  q_incoming_S09: 'settle',
  q_shared_S10: 'split5',
  q_incoming_S11: 'reimburse',
  q_incoming_S12: 'reimburse',
  q_incoming_S13: 'reimburse',
  q_incoming_S14: 'reimburse',
  q_refund_S17: 'link_e_S16',
  // S15 намеренно оставлен неразобранным
}
