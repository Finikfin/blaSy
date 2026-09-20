import { classify } from '../src/engine/classify'
import { ACCOUNTS, buildDemoTransactions, MANUAL_CASH_PURCHASE } from '../src/data/demo'
import { expenses, monthRange } from '../src/engine/analytics'

const raws = buildDemoTransactions()
const sep = monthRange('2026-09-15')
const { questions, events } = classify(raws, ACCOUNTS, [MANUAL_CASH_PURCHASE], {})
console.log('вопросов без решений: ' + questions.length)
console.log('расходы до разбора: ' + expenses(events, sep) / 100 + ' ₽')
console.log('\nтоп-5 очереди (порядок = приоритет):')
questions.slice(0, 5).forEach((q, i) =>
  console.log(' ' + (i + 1) + '. ' + (q.changesTotals ? '[меняет итог] ' : '[объём]      ')
    + q.title + '  — ' + q.body))
