import { parseIntent, answer } from '../src/engine/assistant'
import { classify, DEMO_DECISIONS } from '../src/engine/classify'
import { ACCOUNTS, DEMO_TODAY, buildDemoTransactions, MANUAL_CASH_PURCHASE } from '../src/data/demo'

const { events, receivables } = classify(
  buildDemoTransactions(), ACCOUNTS, [MANUAL_CASH_PURCHASE], DEMO_DECISIONS)
const ctx = { today: DEMO_TODAY, events, receivables, openQuestions: 1 }

const phrases = [
  'кто мне должен',
  'сколько я должен людям',
  'сколько я потратил в сентябре',
  'сколько потратил на этой неделе',
  'сколько на продукты',
  'почему столько',
  'что не разобрано',
  'какие доходы за месяц',
  '400 кофе',
  'потратил 1 200 на продукты наличными',
  '99,90 метро',
  'привет',
]
for (const p of phrases) {
  const i = parseIntent(p)
  const a = answer(i, ctx)
  console.log('« ' + p + ' »\n  intent: ' + i.kind
    + '\n  ' + a.text.split('\n')[0] + '\n')
}
