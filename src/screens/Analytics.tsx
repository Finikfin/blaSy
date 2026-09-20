import React, { useState } from 'react'
import { useApp } from '../store'
import { fmt } from '../engine/money'
import { CategoryList, Donut, Icon } from '../ui/kit'
import {
  byCategory, compare, expenses, fmtDate, income, lastCompleteWeek, monthRange,
  previousRange, rangeFor, reconciliation, shiftRange, type Granularity, type Range,
} from '../engine/analytics'

const GRANS: { id: Granularity; title: string }[] = [
  { id: 'day', title: 'День' },
  { id: 'week', title: 'Неделя' },
  { id: 'month', title: 'Месяц' },
  { id: 'year', title: 'Год' },
  { id: 'custom', title: 'Период' },
]

export default function Analytics() {
  const app = useApp()
  const [gran, setGran] = useState<Granularity>('month')
  const [range, setRange] = useState<Range>(() => rangeFor('month', app.today))
  const [showRecon, setShowRecon] = useState(false)

  const setCustom = (from: string, to: string) => {
    if (!from || !to || from > to) return
    setRange({ from, to, label: fmtDate(from) + ' – ' + fmtDate(to) })
  }

  const switchGran = (g: Granularity) => {
    setGran(g)
    if (g === 'custom') {
      const m = monthRange(app.today)
      setRange({ from: m.from, to: app.today, label: fmtDate(m.from) + ' – ' + fmtDate(app.today) })
    } else setRange(rangeFor(g, app.today))
  }

  const exp = expenses(app.events, range)
  const inc = income(app.events, range)
  const rows = byCategory(app.events, range)
  const prev = previousRange(range, gran)
  const cmp = compare(exp, expenses(app.events, prev))
  const hasNegative = rows.some(r => r.amountMinor < 0)

  const month = monthRange(range.from)
  const rec = reconciliation(app.events, month)

  const week = lastCompleteWeek(app.today)
  const weekExp = expenses(app.events, week)
  const weekCmp = compare(weekExp, expenses(app.events, shiftRange(week, 'week', -1)))

  return (
    <>
      <div className="head">
        <h1>Аналитика</h1>
      </div>

      <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 12 }}>
        {GRANS.map(g => (
          <button key={g.id} className={'chip' + (gran === g.id ? ' on' : '')}
            onClick={() => switchGran(g.id)}>{g.title}</button>
        ))}
      </div>

      {gran === 'custom' ? (
        <div className="grid2" style={{ marginBottom: 14 }}>
          <input type="date" value={range.from} max={range.to}
            onChange={e => setCustom(e.target.value, range.to)}
            style={inputStyle} aria-label="Начало периода" />
          <input type="date" value={range.to} min={range.from}
            onChange={e => setCustom(range.from, e.target.value)}
            style={inputStyle} aria-label="Конец периода" />
        </div>
      ) : (
        <div className="row between" style={{ marginBottom: 14 }}>
          <button className="chip" onClick={() => setRange(r => shiftRange(r, gran, -1))}>‹</button>
          <span style={{ fontSize: 13, fontWeight: 600 }}>{range.label}</span>
          <button className="chip" onClick={() => setRange(r => shiftRange(r, gran, 1))}>›</button>
        </div>
      )}

      {/* §11 — недельная сводка живёт рядом с дашбордами */}
      <button className="linkrow" onClick={app.markWeeklySeen}>
        <span className="body">
          <span className="t">Итог недели {week.label}</span>
          <span className="m">расходы {fmt(weekExp, { kop: false })} · {weekCmp.diff === 0
            ? 'как неделей раньше'
            : (weekCmp.diff > 0 ? 'больше на ' : 'меньше на ') + fmt(Math.abs(weekCmp.diff), { kop: false })}</span>
        </span>
        {!app.weeklySeenAt && <span className="chip on">новое</span>}
      </button>

      <Donut rows={rows} total={exp} />

      <div className="sub tiny" style={{ textAlign: 'center', marginTop: 6, marginBottom: 14 }}>
        доходы {fmt(inc, { kop: false })} · {cmp.diff === 0 ? 'как в прошлом периоде'
          : (cmp.diff > 0 ? 'больше на ' : 'меньше на ') + fmt(Math.abs(cmp.diff), { kop: false })
          + ' к ' + fmtDate(prev.from) + ' – ' + fmtDate(prev.to)}
      </div>

      <div className="card">
        <CategoryList rows={rows} />
        {hasNegative && (
          <div className="sub tiny" style={{ marginTop: 10, lineHeight: 1.5 }}>
            Минус по категории — возврат покупки в этом периоде. Значение не обрезается до нуля.
          </div>
        )}
      </div>

      <div className="card">
        <div className="label" style={{ marginBottom: 12 }}>По неделям · {month.label}</div>
        <div className="bars">
          {rec.weeks.map(w => {
            const peak = Math.max(...rec.weeks.map(x => Math.abs(x.expense)), 1)
            const h = Math.max(Math.round(Math.abs(w.expense) / peak * 78), 3)
            return (
              <div className="bar-col" key={w.range.from}>
                <span className="bar-val">{fmt(w.expense, { kop: false }).replace(' ₽', '')}</span>
                <span className={'bar' + (w.expense < 0 ? ' neg' : '')} style={{ height: h }} />
                <span className="bar-cap">{w.range.label}</span>
              </div>
            )
          })}
        </div>
      </div>

      <button className="linkrow" onClick={() => setShowRecon(v => !v)}>
        <span className="body">
          <span className="t">Недели складываются в месяц</span>
          <span className="m">{month.label} · {fmt(rec.monthSum, { kop: false })}</span>
        </span>
        <span className="chip on" style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <Icon name="check" size={11} color="#0A0A0A" width={3} />
          {rec.ok ? 'сходится' : 'расхождение'}
        </span>
      </button>

      {showRecon && (
        <div className="card">
          {rec.weeks.map(w => (
            <div className="row between" key={w.range.from} style={{ padding: '6px 0' }}>
              <span className="sub tiny" style={{ margin: 0 }}>{w.range.label}</span>
              <span style={{
                fontSize: 13, fontWeight: 600,
                color: w.expense < 0 ? 'var(--accent)' : undefined,
              }}>{fmt(w.expense, { kop: false })}</span>
            </div>
          ))}
          <div className="divider" />
          <div className="row between">
            <span style={{ fontSize: 13, fontWeight: 600 }}>Сумма недель</span>
            <span className="pill-ok">{fmt(rec.weekSum, { kop: false })}</span>
          </div>
          <div className="sub tiny" style={{ marginTop: 10, lineHeight: 1.5 }}>
            Недели обрезаны границами месяца, поэтому сумма совпадает копейка в копейку.
          </div>
        </div>
      )}
    </>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 12px', borderRadius: 12,
  background: 'var(--surface)', border: '1px solid var(--line)',
  color: 'var(--text)', fontSize: 13, outline: 'none',
}
