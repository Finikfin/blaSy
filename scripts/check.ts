import { classify, DEMO_DECISIONS } from '../src/engine/classify'
import { ACCOUNTS, DEMO_TODAY, buildDemoTransactions, MANUAL_CASH_PURCHASE } from '../src/data/demo'
import {
  accountState, byCategory, expenses, income, monthRange, reconciliation, unresolvedSplit,
} from '../src/engine/analytics'
import { receivableTotals } from '../src/engine/analytics'

const raws = buildDemoTransactions()
const { events, receivables, movements, questions } = classify(
  raws, ACCOUNTS, [MANUAL_CASH_PURCHASE], DEMO_DECISIONS)

const sep = monthRange('2026-09-15')
const aug = monthRange('2026-08-15')
const cats = Object.fromEntries(byCategory(events, sep).map(r => [r.category, r.amountMinor]))
const cash = accountState(movements, ACCOUNTS, DEMO_TODAY).find(s => s.account.id === 'cash')
const market = accountState(movements, ACCOUNTS, DEMO_TODAY).find(s => s.account.id === 'market')
const unres = unresolvedSplit(events, sep)
const rec = reconciliation(events, sep)

const checks: [string, number, number][] = [
  ['банковских записей', raws.length, 69],
  ['расходы сентября', expenses(events, sep), 860000],
  ['доходы сентября', income(events, sep), 2200000],
  ['доходы − расходы', income(events, sep) - expenses(events, sep), 1340000],
  ['неразобранные входящие', unres.incoming, 50000],
  ['неразобранные исходящие', unres.outgoing, 0],
  ['неразобранных записей', unres.count, 1],
  ['продукты', cats.groceries ?? 0, 570000],
  ['транспорт', cats.transport ?? 0, 200000],
  ['техника', cats.electronics ?? 0, -70000],
  ['кафе и рестораны', cats.restaurants ?? 0, 160000],
  ['расходы августа', expenses(events, aug), 420000],
  ['открытые долги', receivableTotals(receivables).open, 0],
  ['наличные на 30.09', cash?.balanceMinor ?? -1, 430000],
  ['изменение market', market?.changeMinor ?? 0, 50000],
  ['сумма недель = месяц', rec.weekSum, rec.monthSum],
]

let bad = 0
for (const [name, got, want] of checks) {
  const ok = got === want
  if (!ok) bad++
  console.log((ok ? 'OK   ' : 'FAIL ') + name.padEnd(26) + String(got).padStart(10) + '  ожидалось ' + want)
}
console.log('\nнедельные срезы сентября:')
for (const w of rec.weeks) console.log('  ' + w.range.label.padEnd(8) + String(w.expense / 100).padStart(8) + ' ₽   доход ' + w.income / 100)
console.log('\nоткрытых вопросов при эталонных решениях: ' + questions.filter(q => !DEMO_DECISIONS[q.id]).length)
console.log(bad === 0 ? '\nВСЕ КОНТРОЛЬНЫЕ СУММЫ СОШЛИСЬ' : '\nРАСХОЖДЕНИЙ: ' + bad)
