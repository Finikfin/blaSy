import type {
  Account, CategoryId, EconomicEvent, EventKind, Question, Receivable,
  ResolutionSource, CategoryId as Cat,
} from '../engine/types'
import { CATEGORY_TITLE } from '../engine/types'
import type { SrvAccount, SrvEvent, SrvQuestion, SrvReceivable } from './client'

const ACCOUNT_COLORS = ['#CCFF00', '#8FE388', '#5ED3A0', '#AAAAAA', '#3FB8AF', '#6FCF97']

const ddmm = (iso: string) => iso.slice(8, 10) + '.' + iso.slice(5, 7)
const rub = (minor: number) => Math.round(Math.abs(minor) / 100).toLocaleString('ru-RU') + ' ₽'

export function adaptAccounts(rows: SrvAccount[]): Account[] {
  return rows.map((a, i) => ({
    id: a.id,
    name: a.name,
    kind: a.kind === 'cash' ? 'cash' : 'bank',
    ownConfirmed: Boolean(a.own_confirmed),
    openingBalanceMinor: a.opening_balance_minor ?? undefined,
    openingBalanceDate: a.opening_balance_date ?? undefined,
    color: a.id === 'cash' ? '#AAAAAA' : ACCOUNT_COLORS[i % ACCOUNT_COLORS.length],
  }))
}

const SOURCE: Record<string, ResolutionSource> = {
  bank_type: 'bank_type', rule: 'rule', manual: 'user', own_accounts: 'rule', none: 'rule',
}

/**
 * Заголовок события. Сервер хранит описание в исходной записи выписки,
 * поэтому осмысленное имя операции собираем здесь, по типу события.
 */
function titleOf(e: SrvEvent, accounts: Account[]): string {
  const raw = e.raw_transactions[0]
  const description = raw?.description ?? 'Операция'
  switch (e.kind) {
    case 'OWN_TRANSFER': {
      const incoming = e.movements.find(m => m.amount_minor > 0)
      const to = accounts.find(a => a.id === incoming?.account_id)
      return to ? 'Перевод себе → ' + to.name : 'Перевод себе'
    }
    case 'CASH_WITHDRAWAL': return 'Снятие наличных'
    case 'LOAN_ISSUED': return 'В долг · ' + (e.participant ?? description)
    case 'LOAN_REPAYMENT': return 'Возврат долга · ' + (raw?.counterparty ?? description)
    case 'REIMBURSEMENT': return 'Доля · ' + description
    case 'PURCHASE_REFUND': return 'Возврат · ' + description
    default: return description
  }
}

/**
 * Основание решения человеческим языком. Сервер поле explanation не заполняет,
 * поэтому текст строим по типу события и связанным данным.
 */
function explain(e: SrvEvent, accounts: Account[]): string {
  const raw = e.raw_transactions[0]
  const cat = CATEGORY_TITLE[(e.category ?? 'uncategorized') as CategoryId]
  switch (e.kind) {
    case 'OWN_TRANSFER':
      return e.coverage_status === 'missing_counterpart'
        ? 'Счёт получателя подтверждён как свой, но вторая выписка не загружена. Операция учтена как перевод, не как расход.'
        : 'Две записи выписок склеены в одну операцию: свои счета, равные встречные суммы, реквизиты подтверждают направление. Ни расход, ни доход.'
    case 'CASH_WITHDRAWAL':
      return 'Деньги переложены в наличный кошелёк, а не потрачены. Расход возникнет при покупке за наличные.'
    case 'LOAN_ISSUED':
      return 'Перевод отмечен как выданный долг. Это дебиторская задолженность, а не расход: деньги вы ждёте обратно.'
    case 'LOAN_REPAYMENT':
      return 'Поступление связано с ранее выданным долгом. Доходом не является: уменьшается задолженность.'
    case 'SHARED_PURCHASE': {
      const own = e.own_share_minor ?? 0
      const others = e.receivables.length
      return 'Вы платили за компанию. В расходы попала только ваша доля ' + rub(own)
        + '. Остальные ' + others + ' долей — задолженность участников, не ваш расход.'
    }
    case 'REIMBURSEMENT':
      return 'Компенсация чужой доли по совместной покупке. Ни доход, ни уменьшение расхода: '
        + 'ваш расход уже равен вашей доле, а поступление гасит чужую задолженность.'
    case 'PURCHASE_REFUND':
      return 'Возврат покупки. Доходом не является: расходы уменьшаются на дату возврата, в категории «'
        + cat + '». Прошлый период не переписывается.'
    case 'INCOME':
      return raw?.bank_type === 'salary'
        ? 'Банк отметил операцию как зачисление заработной платы.'
        : 'Поступление подтверждено как доход.'
    case 'EXPENSE':
      return e.movements.some(m => m.origin === 'manual')
        ? 'Покупка за наличные, внесена вручную. Банковской строки для неё не существует.'
        : 'Банк отметил операцию как покупку. Категория «' + cat + '» предложена по названию продавца.'
    default:
      return raw && raw.amount_minor > 0
        ? 'Входящий перевод без подтверждённого основания. Автоматически считать его доходом нельзя: '
          + 'это может быть возврат долга или компенсация доли.'
        : 'Списание без подтверждённого смысла. Пока оно не разобрано, в расходы не попадает — иначе итог был бы завышен.'
  }
}

export function adaptEvent(e: SrvEvent, accounts: Account[]): EconomicEvent {
  const dates = e.movements.map(m => m.date).sort()
  const own = e.own_share_minor ?? 0
  const shares = e.kind === 'SHARED_PURCHASE'
    ? [
      { name: 'Я', isSelf: true, amountMinor: own, settledMinor: own },
      ...e.receivables.map((r: any) => ({
        name: r.participant as string,
        isSelf: false,
        amountMinor: r.original_minor as number,
        settledMinor: (r.original_minor as number) - (r.remaining_minor ?? 0),
      })),
    ]
    : undefined

  return {
    id: e.id,
    kind: e.kind as EventKind,
    date: dates[0] ?? e.raw_transactions[0]?.booking_date ?? '',
    title: titleOf(e, accounts),
    movements: e.movements.map(m => ({
      id: m.id,
      accountId: m.account_id,
      date: m.date,
      signedAmountMinor: m.amount_minor,
      origin: (m.origin as any) ?? 'import',
    })),
    effects: e.effects.map(f => ({
      date: f.date,
      measure: f.measure,
      amountMinor: f.amount_minor,
      category: (f.category ?? undefined) as CategoryId | undefined,
    })),
    resolutionStatus: e.resolution_status,
    resolutionSource: SOURCE[e.resolution_source] ?? 'rule',
    coverageStatus: e.coverage_status === 'missing_counterpart' ? 'missing_counterpart' : 'complete',
    category: (e.category ?? undefined) as CategoryId | undefined,
    counterparty: e.participant ?? e.raw_transactions[0]?.counterparty ?? undefined,
    explanation: explain(e, accounts),
    decisionIds: e.decisions.filter(d => !d.undone_at).map(d => d.id),
    shares,
  }
}

export function adaptReceivable(r: SrvReceivable): Receivable {
  return {
    id: r.id,
    originEventId: r.origin_event_id,
    participant: r.participant,
    originalMinor: r.original_minor,
    settledMinor: r.paid_minor,
    createdDate: r.created_date,
  }
}

const CATEGORY_GUESS: [RegExp, Cat][] = [
  [/пятёроч|пятероч|продукт|магнит|лента|рынок/i, 'groceries'],
  [/ресторан|кафе|ужин|обед|кофе/i, 'restaurants'],
  [/метро|такси|проезд|транспорт/i, 'transport'],
  [/техник|электрон/i, 'electronics'],
]
const guessCategory = (text: string): Cat => {
  for (const [re, c] of CATEGORY_GUESS) if (re.test(text)) return c
  return 'other'
}

/**
 * Вопрос сервера → карточка разбора.
 * Варианты собираются из кандидатов, которые предложил сервер:
 * клиент не придумывает связей, он только показывает и подтверждает.
 */
export function adaptQuestion(q: SrvQuestion, commandId: () => string): Question {
  const incoming = q.amount_minor > 0
  const options = []

  for (const c of q.candidates) {
    if (c.action === 'settle') {
      options.push({
        id: 'settle_' + c.receivable_id,
        label: 'Вернули долг',
        hint: c.participant,
        effectNote: 'итоги не изменятся, остаток долга уменьшится на ' + rub(q.amount_minor),
        payload: {
          action: 'settle', receivable_id: c.receivable_id,
          expected_revision: q.revision, command_id: commandId(),
        },
      })
    } else {
      options.push({
        id: 'refund_' + c.purchase_event_id,
        label: 'Это возврат покупки',
        effectNote: 'расходы уменьшатся на ' + rub(q.amount_minor),
        payload: {
          action: 'refund', purchase_event_id: c.purchase_event_id,
          expected_revision: q.revision, command_id: commandId(),
        },
      })
    }
  }

  if (incoming) {
    options.push({
      id: 'income',
      label: 'Это доход',
      effectNote: 'доходы вырастут на ' + rub(q.amount_minor),
      payload: {
        action: 'classify', kind: 'INCOME', category: 'other',
        expected_revision: q.revision, command_id: commandId(),
      },
    })
  } else {
    options.push({
      id: 'loan',
      label: 'Дал в долг',
      hint: q.counterparty ?? undefined,
      effectNote: 'расходы не изменятся, появится долг',
      payload: {
        action: 'classify', kind: 'LOAN_ISSUED', category: 'other',
        participant: q.counterparty || q.description.slice(0, 60),
        expected_revision: q.revision, command_id: commandId(),
      },
    })
    options.push({
      id: 'expense',
      label: 'Это мой расход',
      effectNote: 'расходы вырастут на ' + rub(q.amount_minor),
      payload: {
        action: 'classify', kind: 'EXPENSE',
        category: guessCategory(q.description),
        expected_revision: q.revision, command_id: commandId(),
      },
    })
  }

  options.push({ id: 'later', label: 'Позже', effectNote: 'останется неразобранным' })

  return {
    id: q.id,
    eventId: q.event_id,
    revision: q.revision,
    type: q.candidates.length ? 'settlement_group' : q.kind === 'refund' ? 'refund_link' : 'economic_meaning',
    title: incoming
      ? 'Что означает поступление ' + rub(q.amount_minor) + '?'
      : 'Что означает списание ' + rub(q.amount_minor) + '?',
    body: ddmm(q.booking_date) + ' · ' + q.description,
    relatedIds: [q.event_id],
    impactMinor: q.impact_minor,
    changesTotals: true,
    options,
  }
}
