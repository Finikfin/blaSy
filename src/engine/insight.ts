import type { EconomicEvent, Minor } from './types'
import { CATEGORY_TITLE } from './types'
import { fmt } from './money'
import {
  byCategory, expenses, income, previousRange, unresolvedSplit,
  type Granularity, type Range,
} from './analytics'
import { dateOf } from './classify'

/**
 * Факты для подсказки. Все числа посчитаны доменным слоем заранее.
 * Языковая модель получает уже готовые значения и только формулирует фразу —
 * считать деньги ей нельзя (§7.5).
 */
export type InsightFacts = {
  periodLabel: string
  spentMinor: Minor
  prevSpentMinor: Minor
  diffMinor: Minor
  incomeMinor: Minor
  topCategory?: { title: string; amountMinor: Minor }
  biggestRise?: { title: string; diffMinor: Minor }
  biggestDrop?: { title: string; diffMinor: Minor }
  unresolvedIncomingMinor: Minor
  unresolvedCount: number
  /** Темп: заполняется только для незакрытого периода. */
  pace?: { daysElapsed: number; daysTotal: number; projectedMinor: Minor }
}

export function buildFacts(
  events: EconomicEvent[], range: Range, gran: Granularity, today: string,
): InsightFacts {
  const prev = previousRange(range, gran)
  const spent = expenses(events, range)
  const prevSpent = expenses(events, prev)

  const cur = byCategory(events, range)
  const old = byCategory(events, prev)
  const oldMap = new Map(old.map(r => [r.category, r.amountMinor]))

  const deltas = cur
    .map(r => ({
      title: CATEGORY_TITLE[r.category],
      diffMinor: r.amountMinor - (oldMap.get(r.category) ?? 0),
    }))
    .sort((a, b) => b.diffMinor - a.diffMinor)

  const unres = unresolvedSplit(events, range)
  const top = cur.find(r => r.amountMinor > 0)

  // Темп считаем только если период ещё не закончился
  let pace: InsightFacts['pace']
  if (today >= range.from && today < range.to) {
    const daysTotal = Math.round(
      (dateOf(range.to).getTime() - dateOf(range.from).getTime()) / 86400000) + 1
    const daysElapsed = Math.round(
      (dateOf(today).getTime() - dateOf(range.from).getTime()) / 86400000) + 1
    const spentSoFar = expenses(events, { ...range, to: today })
    pace = {
      daysElapsed, daysTotal,
      projectedMinor: Math.round(spentSoFar / daysElapsed * daysTotal),
    }
  }

  return {
    periodLabel: range.label,
    spentMinor: spent,
    prevSpentMinor: prevSpent,
    diffMinor: spent - prevSpent,
    incomeMinor: income(events, range),
    topCategory: top ? { title: CATEGORY_TITLE[top.category], amountMinor: top.amountMinor } : undefined,
    biggestRise: deltas[0]?.diffMinor > 0 ? deltas[0] : undefined,
    biggestDrop: deltas.at(-1)?.diffMinor < 0 ? deltas.at(-1) : undefined,
    unresolvedIncomingMinor: unres.incoming,
    unresolvedCount: unres.count,
  }
}

/** Стабильная подпись фактов: по ней кэшируется ответ модели. */
export function factsSignature(f: InsightFacts): string {
  return [
    f.periodLabel, f.spentMinor, f.prevSpentMinor, f.incomeMinor,
    f.biggestRise?.title, f.biggestRise?.diffMinor,
    f.biggestDrop?.title, f.biggestDrop?.diffMinor,
    f.unresolvedCount, f.pace?.projectedMinor,
  ].join('|')
}

/**
 * Подсказка без всякой модели: те же цифры, собранные в фразу правилами.
 * Это основной путь — приложение обязано быть полезным офлайн.
 */
export function localInsight(f: InsightFacts): string {
  const parts: string[] = []
  const comparable = f.prevSpentMinor > 0 && f.diffMinor !== 0

  if (comparable) {
    parts.push(f.diffMinor < 0
      ? 'Вы потратили на ' + fmt(-f.diffMinor, { kop: false }) + ' меньше, чем в прошлом периоде.'
      : 'Вы потратили на ' + fmt(f.diffMinor, { kop: false }) + ' больше, чем в прошлом периоде.')
  } else if (f.topCategory) {
    parts.push('Больше всего ушло на «' + f.topCategory.title.toLowerCase() + '» — '
      + fmt(f.topCategory.amountMinor, { kop: false }) + '.')
  }

  // Вторую фразу добавляем только когда есть с чем сравнивать:
  // без прошлого периода «главный вклад» просто повторил бы первую строку.
  if (comparable && f.diffMinor > 0 && f.biggestRise) {
    parts.push('Главный вклад — «' + f.biggestRise.title.toLowerCase() + '», плюс '
      + fmt(f.biggestRise.diffMinor, { kop: false }) + '.')
  } else if (comparable && f.diffMinor < 0 && f.biggestDrop) {
    parts.push('Сильнее всего просела категория «' + f.biggestDrop.title.toLowerCase() + '» — '
      + fmt(-f.biggestDrop.diffMinor, { kop: false }) + '.')
  }

  if (f.pace) {
    parts.push('При нынешнем темпе к концу периода выйдет около '
      + fmt(f.pace.projectedMinor, { kop: false }) + '.')
  }

  if (f.unresolvedCount > 0) {
    parts.push('Ещё ' + fmt(f.unresolvedIncomingMinor, { kop: false })
      + ' ждут решения — итог может измениться.')
  }

  return parts.slice(0, 2).join(' ')
}
