import type { CategoryId, EconomicEvent, Receivable } from './types'
import { CATEGORY_TITLE } from './types'
import { fmt } from './money'
import {
  byCategory, expenses, fmtDate, income, monthRange, rangeFor, shiftRange,
  unresolvedSplit, weekRange, type Range,
} from './analytics'
import { dateOf } from './classify'

/**
 * Намерение, извлечённое из фразы.
 * Модель (или локальный разбор) определяет ТОЛЬКО намерение и поля текста.
 * Ни одна сумма не считается здесь: счёт ведёт доменный слой (§7.5).
 */
export type Intent =
  | { kind: 'add_expense'; amountMinor: number; category: CategoryId; title?: string }
  | { kind: 'summary'; period: PeriodWord }
  | { kind: 'category'; category: CategoryId; period: PeriodWord }
  | { kind: 'income'; period: PeriodWord }
  | { kind: 'debts' }
  | { kind: 'unresolved' }
  | { kind: 'explain'; period: PeriodWord }
  | { kind: 'help' }

export type PeriodWord = 'today' | 'yesterday' | 'week' | 'last_week' | 'month' | 'prev_month' | 'year'

const CATEGORY_WORDS: [RegExp, CategoryId][] = [
  [/продукт|еда домой|магазин|пятёроч|пятероч|супермаркет|рынок/i, 'groceries'],
  [/кафе|ресторан|обед|ужин|завтрак|кофе|бар|достав/i, 'restaurants'],
  [/транспорт|метро|такси|автобус|бензин|проезд/i, 'transport'],
  [/дом|быт|квартир|аренд|жкх|уборк/i, 'home'],
  [/техник|электрон|ноутбук|телефон|наушник/i, 'electronics'],
  [/здоров|аптек|врач|лекарств|клиник/i, 'health'],
  [/развлеч|кино|театр|концерт|игр|подписк/i, 'entertainment'],
  [/услуг|связь|интернет|парикмахер|ремонт/i, 'services'],
]

const PERIOD_WORDS: [RegExp, PeriodWord][] = [
  [/сегодня/i, 'today'],
  [/вчера/i, 'yesterday'],
  [/прошл\w*\s+недел/i, 'last_week'],
  [/(эт\w*|текущ\w*)?\s*недел/i, 'week'],
  [/прошл\w*\s+месяц|в августе|за август/i, 'prev_month'],
  [/месяц|в сентябре|за сентябрь/i, 'month'],
  [/год/i, 'year'],
]

export function detectCategory(text: string): CategoryId | null {
  for (const [re, c] of CATEGORY_WORDS) if (re.test(text)) return c
  return null
}

function detectPeriod(text: string): PeriodWord {
  for (const [re, p] of PERIOD_WORDS) if (re.test(text)) return p
  return 'month'
}

export function resolvePeriod(p: PeriodWord, today: string): Range {
  if (p === 'today') return rangeFor('day', today)
  if (p === 'yesterday') {
    const x = dateOf(today); x.setDate(x.getDate() - 1)
    return rangeFor('day', x.toISOString().slice(0, 10))
  }
  if (p === 'week') return weekRange(today)
  if (p === 'last_week') return shiftRange(weekRange(today), 'week', -1)
  if (p === 'prev_month') return shiftRange(monthRange(today), 'month', -1)
  if (p === 'year') return rangeFor('year', today)
  return monthRange(today)
}

/** Сумма в тексте: «450», «1 200», «99,90». */
function detectAmount(text: string): number | null {
  const m = text.match(/(\d[\d  ]*(?:[.,]\d{1,2})?)\s*(?:р|₽|руб\w*)?/i)
  if (!m) return null
  const n = parseFloat(m[1].replace(/[  ]/g, '').replace(',', '.'))
  if (!isFinite(n) || n <= 0) return null
  return Math.round(n * 100)
}

/**
 * Локальный разбор намерения. Полностью детерминированный,
 * работает офлайн и без ключа — это основной путь, а не запасной.
 */
export function parseIntent(text: string): Intent {
  const t = text.trim()
  if (!t) return { kind: 'help' }

  if (/долг|долж|занял|одолжил|вернул мне/i.test(t)) return { kind: 'debts' }
  if (/не разобран|неразобран|вопрос|уточнен/i.test(t)) return { kind: 'unresolved' }
  if (/почему|откуда|из чего|разбери|объясни/i.test(t)) {
    return { kind: 'explain', period: detectPeriod(t) }
  }
  if (/доход|заработал|пришло|зарплат/i.test(t) && !/расход/i.test(t)) {
    return { kind: 'income', period: detectPeriod(t) }
  }

  const amount = detectAmount(t)
  const hasAddVerb = /потратил|добавь|запиши|купил|заплатил|оплатил|наличн/i.test(t)
  const asksQuestion = /сколько|итог|сводк|расход|трат|покажи|сравн/i.test(t)

  // «450 кофе» или «добавь 300 продукты» — добавление траты
  if (amount && !asksQuestion) {
    const cat = detectCategory(t) ?? 'other'
    const title = t
      .replace(/(\d[\d  ]*(?:[.,]\d{1,2})?)\s*(?:р|₽|руб\w*)?/i, '')
      .replace(/потратил|добавь|запиши|купил|заплатил|оплатил|наличными|наличные|на\b/gi, '')
      .replace(/\s+/g, ' ').trim()
    return { kind: 'add_expense', amountMinor: amount, category: cat, title: title || undefined }
  }
  if (amount && hasAddVerb) {
    const cat = detectCategory(t) ?? 'other'
    return { kind: 'add_expense', amountMinor: amount, category: cat }
  }

  const cat = detectCategory(t)
  if (cat && asksQuestion) return { kind: 'category', category: cat, period: detectPeriod(t) }
  if (asksQuestion) return { kind: 'summary', period: detectPeriod(t) }
  return { kind: 'help' }
}

export type AssistantContext = {
  today: string
  events: EconomicEvent[]
  receivables: Receivable[]
  openQuestions: number
}

export type AssistantReply = {
  text: string
  /** Черновик операции: применяется только по кнопке пользователя. */
  draft?: { amountMinor: number; category: CategoryId; title: string }
  /** Переход на экран. */
  goto?: 'review' | 'analytics' | 'operations' | 'more'
  gotoLabel?: string
}

const plural = (n: number, one: string, few: string, many: string) => {
  const m10 = n % 10, m100 = n % 100
  if (m10 === 1 && m100 !== 11) return one
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few
  return many
}

/**
 * Ответ строится доменными функциями по уже разобранным событиям.
 * Цифры не выдумываются и не пересчитываются отдельной логикой.
 */
export function answer(intent: Intent, ctx: AssistantContext): AssistantReply {
  const { events, today } = ctx

  switch (intent.kind) {
    case 'add_expense': {
      const title = intent.title || CATEGORY_TITLE[intent.category]
      return {
        text: 'Записать трату наличными на ' + fmt(intent.amountMinor)
          + ' в категорию «' + CATEGORY_TITLE[intent.category] + '»?',
        draft: { amountMinor: intent.amountMinor, category: intent.category, title },
      }
    }

    case 'summary': {
      const r = resolvePeriod(intent.period, today)
      const exp = expenses(events, r)
      const inc = income(events, r)
      const unres = unresolvedSplit(events, r)
      const top = byCategory(events, r).filter(c => c.amountMinor > 0).slice(0, 3)
      const lines = [
        r.label + ': расходы ' + fmt(exp, { kop: false }) + ', доходы ' + fmt(inc, { kop: false }) + '.',
        top.length ? 'Больше всего — ' + top.map(c =>
          CATEGORY_TITLE[c.category].toLowerCase() + ' ' + fmt(c.amountMinor, { kop: false })).join(', ') + '.' : '',
        unres.count
          ? 'Ещё ' + unres.count + ' ' + plural(unres.count, 'операция ждёт', 'операции ждут', 'операций ждут')
            + ' решения на ' + fmt(unres.incoming + unres.outgoing, { kop: false }) + ' — итог может измениться.'
          : 'Всё разобрано, итог окончательный.',
      ].filter(Boolean)
      return {
        text: lines.join('\n'),
        goto: unres.count ? 'review' : 'analytics',
        gotoLabel: unres.count ? 'Разобрать' : 'Открыть аналитику',
      }
    }

    case 'category': {
      const r = resolvePeriod(intent.period, today)
      const row = byCategory(events, r).find(c => c.category === intent.category)
      const name = CATEGORY_TITLE[intent.category].toLowerCase()
      if (!row) return { text: r.label + ': трат по категории «' + name + '» не было.' }
      const prev = byCategory(events, shiftRange(r, intent.period === 'week' ? 'week' : 'month', -1))
        .find(c => c.category === intent.category)
      const diff = row.amountMinor - (prev?.amountMinor ?? 0)
      return {
        text: r.label + ': ' + name + ' — ' + fmt(row.amountMinor, { kop: false })
          + (row.amountMinor < 0 ? ' (минус из-за возврата покупки)' : '')
          + '.\n' + (prev
            ? (diff === 0 ? 'Столько же, сколько в прошлом периоде.'
              : (diff > 0 ? 'Больше прошлого периода на ' : 'Меньше прошлого периода на ')
                + fmt(Math.abs(diff), { kop: false }) + '.')
            : 'В прошлом периоде этой категории не было.'),
        goto: 'analytics', gotoLabel: 'Показать разрез',
      }
    }

    case 'income': {
      const r = resolvePeriod(intent.period, today)
      return {
        text: r.label + ': доходы ' + fmt(income(events, r), { kop: false })
          + '.\nПереводы себе и возвраты долгов сюда не попадают — это не доход.',
      }
    }

    case 'debts': {
      const open = ctx.receivables.filter(x => x.settledMinor < x.originalMinor)
      if (!open.length) {
        return {
          text: 'Открытых долгов нет: всё, что вы давали в долг или платили за других, вернулось.',
          goto: 'more', gotoLabel: 'История долгов',
        }
      }
      const total = open.reduce((s, x) => s + x.originalMinor - x.settledMinor, 0)
      return {
        text: 'Вам должны ' + fmt(total, { kop: false }) + ':\n'
          + open.map(x => '· ' + x.participant + ' — ' + fmt(x.originalMinor - x.settledMinor, { kop: false })
            + ' с ' + fmtDate(x.createdDate)).join('\n')
          + '\nЭти деньги не прибавляются к доступным.',
        goto: 'more', gotoLabel: 'Открыть долги',
      }
    }

    case 'unresolved': {
      const r = monthRange(today)
      const u = unresolvedSplit(events, r)
      if (!u.count) return { text: 'Неразобранных операций нет.' }
      return {
        text: u.count + ' ' + plural(u.count, 'операция', 'операции', 'операций') + ' без решения: '
          + 'входящих на ' + fmt(u.incoming, { kop: false })
          + ', исходящих на ' + fmt(u.outgoing, { kop: false })
          + '.\nПока они не разобраны, в расходы и доходы они не попадают.',
        goto: 'review', gotoLabel: 'Разобрать',
      }
    }

    case 'explain': {
      const r = resolvePeriod(intent.period, today)
      const exp = expenses(events, r)
      const neutral = events.filter(e =>
        e.date >= r.from && e.date <= r.to && e.effects.length === 0 && e.resolutionStatus === 'confirmed')
      const neutralSum = neutral.reduce((s, e) =>
        s + e.movements.reduce((a, m) => a + Math.abs(m.signedAmountMinor), 0), 0)
      const rows = byCategory(events, r)
      return {
        text: r.label + ': расходы ' + fmt(exp, { kop: false }) + ' складываются из\n'
          + rows.map(c => '· ' + CATEGORY_TITLE[c.category] + ' ' + fmt(c.amountMinor, { kop: false })).join('\n')
          + '\nЕщё ' + neutral.length + ' ' + plural(neutral.length, 'операция', 'операции', 'операций')
          + ' на ' + fmt(neutralSum, { kop: false })
          + ' прошли мимо расходов: переводы себе, долги и компенсации чужих долей.',
        goto: 'operations', gotoLabel: 'Показать операции',
      }
    }

    default:
      return {
        text: 'Могу записать трату наличными или показать цифры.\n'
          + 'Например: «400 кофе», «сколько я потратил на этой неделе», «кто мне должен», «почему 8 600».',
      }
    }
}

export const QUICK_CHIPS = [
  'Итоги за месяц',
  'Почему столько',
  'Кто мне должен',
  'Что не разобрано',
]
