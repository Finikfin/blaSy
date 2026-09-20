import React, { useState } from 'react'
import { useApp } from '../store'
import { fmt } from '../engine/money'
import { Icon } from '../ui/kit'
import { PeriodSwiper } from '../ui/PeriodSwiper'
import { InsightCard } from '../ui/InsightCard'
import {
  expenses, fmtDate, income, rangeFor, shiftRange, unresolvedSplit,
  type Granularity,
} from '../engine/analytics'

/** Русское склонение по числу: 1 операция, 2 операции, 5 операций. */
function plural(n: number, one: string, few: string, many: string) {
  const m10 = n % 10, m100 = n % 100
  if (m10 === 1 && m100 !== 11) return one
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few
  return many
}

/** Цвет суммы по знаку: минус красный, плюс лаймовый, ноль нейтральный. */
const tone = (minor: number) => (minor < 0 ? 'neg' : minor > 0 ? 'pos' : '')

const GRANS: { id: Granularity; title: string }[] = [
  { id: 'day', title: 'День' },
  { id: 'week', title: 'Неделя' },
  { id: 'month', title: 'Месяц' },
  { id: 'year', title: 'Год' },
]

const PERIOD_WORD: Record<Granularity, string> = {
  day: 'за день', week: 'за неделю', month: 'за месяц', year: 'за год', custom: 'за период',
}

export default function Home({ go }: { go: (tab: string) => void }) {
  const app = useApp()
  const [gran, setGran] = useState<Granularity>('month')
  const [range, setRange] = useState(() => rangeFor('month', app.today))

  const switchGran = (g: Granularity) => { setGran(g); setRange(rangeFor(g, app.today)) }

  const exp = expenses(app.events, range)
  const inc = income(app.events, range)
  const net = inc - exp
  const unres = unresolvedSplit(app.events, range)

  return (
    <>
      <div className="head">
        <h1>Честный месяц</h1>
        <span className="chip" title="Демонстрационная дата, а не текущая">{fmtDate(app.today)}</span>
      </div>

      <PeriodSwiper
        grans={GRANS}
        gran={gran}
        range={range}
        onGran={switchGran}
        onShiftPeriod={dir => setRange(r => shiftRange(r, gran, dir))}>

        <div style={{ textAlign: 'center', paddingBottom: 20 }}>
          <div className={'amount hero ' + tone(net)} style={{ fontSize: 44 }}>
            {fmt(net, { kop: false, sign: true })}
          </div>
          <div className="hero-caption">
            {net > 0 ? 'в плюсе ' : net < 0 ? 'в минусе ' : 'по нулям '}{PERIOD_WORD[gran]}
          </div>

          <div className="hero-split">
            <span>потрачено <b className="money-neg">{fmt(-exp, { kop: false, sign: true })}</b></span>
            <span className="hero-split-sep" />
            <span>доходы <b className="money-pos">{fmt(inc, { kop: false, sign: true })}</b></span>
          </div>
        </div>

        <InsightCard range={range} gran={gran} />

        <button className="btn" onClick={() => go('analytics')}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          Разобрать по категориям
          <Icon name="arrow" size={17} color="#0A0A0A" width={2.2} />
        </button>

        {unres.count > 0 && (
          <button className="quietlink" onClick={() => go('review')}>
            <span className="dotmark" />
            {plural(unres.count, '1 операция ждёт', unres.count + ' операции ждут',
              unres.count + ' операций ждут')} решения · {fmt(unres.incoming + unres.outgoing, { kop: false })}
          </button>
        )}
      </PeriodSwiper>
    </>
  )
}
