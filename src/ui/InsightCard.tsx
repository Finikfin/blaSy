import React, { useEffect, useState } from 'react'
import { useApp } from '../store'
import { buildFacts, localInsight } from '../engine/insight'
import { advise, type Advice } from '../engine/llm'
import type { Granularity, Range } from '../engine/analytics'

/**
 * Микроподсказка под итогом. Текст появляется сразу из локальных правил,
 * а затем, если модель включена, заменяется её формулировкой тех же цифр.
 * Пустого состояния и спиннера на месте подсказки не бывает.
 */
export function InsightCard({ range, gran }: { range: Range; gran: Granularity }) {
  const app = useApp()
  const facts = buildFacts(app.events, range, gran, app.today)
  const [advice, setAdvice] = useState<Advice>({ text: localInsight(facts), source: 'rules' })

  const sig = JSON.stringify(facts)
  useEffect(() => {
    let alive = true
    setAdvice({ text: localInsight(facts), source: 'rules' })
    if (!app.llm.enabled || !app.llm.apiKey) return
    advise(facts, app.llm).then(a => { if (alive) setAdvice(a) })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, app.llm.enabled, app.llm.apiKey, app.llm.model])

  if (!advice.text) return null

  return (
    <div className="insight">
      <span className="spark" aria-hidden="true">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2l1.9 5.6L19.5 9.5 13.9 11.4 12 17l-1.9-5.6L4.5 9.5l5.6-1.9L12 2z" />
          <path d="M18.5 14.5l.9 2.6 2.6.9-2.6.9-.9 2.6-.9-2.6-2.6-.9 2.6-.9.9-2.6z" opacity=".65" />
        </svg>
      </span>
      <span className="insight-body">
        <span className="insight-text">{advice.text}</span>
        <span className="insight-src">
          {advice.source === 'model'
            ? 'сформулировала модель по вашим цифрам'
            : 'посчитано по вашим операциям'}
        </span>
      </span>
    </div>
  )
}
