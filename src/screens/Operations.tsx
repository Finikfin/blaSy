import React, { useMemo, useState } from 'react'
import { useApp } from '../store'
import { fmt } from '../engine/money'
import { Icon, KIND_ICON, Sheet } from '../ui/kit'
import { CATEGORY_TITLE, KIND_TITLE, type EconomicEvent } from '../engine/types'
import { fmtDate } from '../engine/analytics'

type Filter = 'all' | 'expense' | 'income' | 'neutral' | 'unresolved'

const FILTERS: { id: Filter; title: string }[] = [
  { id: 'all', title: 'Все' },
  { id: 'expense', title: 'Расходы' },
  { id: 'income', title: 'Доходы' },
  { id: 'neutral', title: 'Нейтральные' },
  { id: 'unresolved', title: 'Не разобрано' },
]

export default function Operations() {
  const app = useApp()
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<EconomicEvent | null>(null)

  const list = useMemo(() => app.events.filter(e => {
    if (query && !e.title.toLowerCase().includes(query.toLowerCase())) return false
    if (filter === 'all') return true
    if (filter === 'unresolved') return e.resolutionStatus === 'unresolved'
    const hasExpense = e.effects.some(f => f.measure === 'expense')
    const hasIncome = e.effects.some(f => f.measure === 'income')
    if (filter === 'expense') return hasExpense
    if (filter === 'income') return hasIncome
    return e.resolutionStatus === 'confirmed' && e.effects.length === 0
  }), [app.events, filter, query])

  const canUndo = (e: EconomicEvent) =>
    app.mode === 'server'
      ? Boolean(e.decisionIds?.length)
      : e.resolutionSource === 'user'

  return (
    <>
      <div className="head">
        <div>
          <h1>Операции</h1>
          <div className="sub">{list.length} экономических событий</div>
        </div>
      </div>

      <input
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder="Поиск по описанию"
        aria-label="Поиск по описанию"
        style={{
          width: '100%', padding: '11px 14px', borderRadius: 12, marginBottom: 10,
          background: 'var(--surface)', border: '1px solid var(--line)',
          color: 'var(--text)', fontSize: 13, outline: 'none',
        }} />

      <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 10 }}>
        {FILTERS.map(f => (
          <button key={f.id} className={'chip' + (filter === f.id ? ' on' : '')}
            onClick={() => setFilter(f.id)}>{f.title}</button>
        ))}
      </div>

      <div className="card">
        {list.length === 0 && <div className="empty">Ничего не найдено.</div>}
        {list.map(e => {
          const eff = e.effects[0]
          const value = eff
            ? fmt(eff.measure === 'income' ? eff.amountMinor : -eff.amountMinor, { kop: false })
            : fmt(e.movements.reduce((s, m) => s + m.signedAmountMinor, 0), { kop: false })
          return (
            <button className="op" key={e.id} onClick={() => setOpen(e)}>
              <span className="ic">
                <Icon name={KIND_ICON[e.kind]} size={17}
                  color={e.resolutionStatus === 'unresolved' ? 'var(--danger)' : 'var(--dim)'} />
              </span>
              <span className="body">
                <span className="t">{e.title}</span>
                <span className="m">
                  {fmtDate(e.date)} · {KIND_TITLE[e.kind]}
                  {e.category ? ' · ' + CATEGORY_TITLE[e.category] : ''}
                </span>
              </span>
              <span className="v">
                {value}
                <small>{eff ? 'в итогах' : 'не влияет'}</small>
              </span>
            </button>
          )
        })}
      </div>

      {open && (
        <Sheet title={open.title} onClose={() => setOpen(null)}>
          <div className="row" style={{ gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
            <span className="chip on">{KIND_TITLE[open.kind]}</span>
            {open.category && <span className="chip">{CATEGORY_TITLE[open.category]}</span>}
            <span className={'chip' + (open.resolutionStatus === 'unresolved' ? ' warn' : '')}>
              {open.resolutionStatus === 'unresolved' ? 'не разобрано'
                : open.resolutionSource === 'user' ? 'решение пользователя'
                  : open.resolutionSource === 'rule' ? 'правило' : 'тип банка'}
            </span>
            {open.coverageStatus === 'missing_counterpart' && (
              <span className="chip warn">вторая выписка не загружена</span>
            )}
          </div>

          <div className="label">Основание</div>
          <div className="note" style={{ marginTop: 6 }}>{open.explanation}</div>

          <div className="label" style={{ marginTop: 16 }}>Аналитический эффект</div>
          <div className="card" style={{ marginTop: 6 }}>
            {open.effects.length === 0
              ? <div className="sub tiny" style={{ margin: 0 }}>
                Не влияет ни на расходы, ни на доходы.
              </div>
              : open.effects.map((f, i) => (
                <div className="row between" key={i} style={{ padding: '3px 0' }}>
                  <span className="sub tiny" style={{ margin: 0 }}>
                    {f.measure === 'expense' ? 'Расход' : 'Доход'} · {fmtDate(f.date)}
                  </span>
                  <span style={{ fontWeight: 600, color: f.amountMinor < 0 ? 'var(--accent)' : undefined }}>
                    {fmt(f.amountMinor, { kop: false })}
                  </span>
                </div>
              ))}
          </div>

          <div className="label" style={{ marginTop: 16 }}>Записи выписки</div>
          <div className="card" style={{ marginTop: 6 }}>
            {open.movements.map(m => (
              <div className="row between" key={m.id} style={{ padding: '4px 0' }}>
                <span className="sub tiny" style={{ margin: 0 }}>
                  {fmtDate(m.date)} · {app.accounts.find(a => a.id === m.accountId)?.name}
                  {m.origin === 'derived_cash' ? ' · производное' : ''}
                  {m.origin === 'manual' ? ' · вручную' : ''}
                </span>
                <span style={{ fontWeight: 600 }}>{fmt(m.signedAmountMinor, { kop: false })}</span>
              </div>
            ))}
          </div>

          {open.shares && (
            <>
              <div className="label" style={{ marginTop: 16 }}>Доли участников</div>
              <div className="card" style={{ marginTop: 6 }}>
                {open.shares.map(s => (
                  <div className="row between" key={s.name} style={{ padding: '4px 0' }}>
                    <span className="sub tiny" style={{ margin: 0 }}>
                      {s.name}{s.isSelf ? ' · ваша доля' : s.settledMinor >= s.amountMinor ? ' · вернул' : ' · должен'}
                    </span>
                    <span style={{ fontWeight: 600 }}>{fmt(s.amountMinor, { kop: false })}</span>
                  </div>
                ))}
              </div>
            </>
          )}

          {canUndo(open) && (
            <button className="btn ghost sm" style={{ marginTop: 16 }}
              disabled={app.busy}
              onClick={() => { app.undoEvent(open); setOpen(null) }}>
              Отменить решение
            </button>
          )}
        </Sheet>
      )}
    </>
  )
}
