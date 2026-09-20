import React, { useState } from 'react'
import { useApp } from '../store'
import { Sheet } from '../ui/kit'
import { CATEGORY_TITLE, type CategoryId } from '../engine/types'
import { fmt } from '../engine/money'

const CATS: CategoryId[] = [
  'groceries', 'restaurants', 'transport', 'home',
  'electronics', 'health', 'entertainment', 'services', 'other',
]

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', ',', '0', '⌫']

/**
 * Быстрый ввод наличной покупки — одно действие на операцию.
 * Банковские операции приходят импортом, руками вносится только то,
 * чего в выписке физически нет: траты наличными.
 */
export default function Add({ onClose }: { onClose: () => void }) {
  const app = useApp()
  const [raw, setRaw] = useState('')
  const [cat, setCat] = useState<CategoryId>('groceries')
  const [title, setTitle] = useState('')

  const minor = Math.round(parseFloat(raw.replace(',', '.') || '0') * 100)
  const cashAccount = app.accounts.find(a => a.kind === 'cash')!

  const tap = (k: string) => {
    if (k === '⌫') return setRaw(r => r.slice(0, -1))
    if (k === ',' && (raw.includes(',') || !raw)) return
    if (raw.includes(',') && raw.split(',')[1]?.length >= 2) return
    if (raw.replace(',', '').length > 8) return
    setRaw(r => r + k)
  }

  const save = () => {
    if (minor <= 0) return
    app.addManual({
      id: 'M' + Date.now(),
      accountId: cashAccount.id,
      date: app.today,
      amountMinor: -minor,
      description: title.trim() || CATEGORY_TITLE[cat] + ', наличные',
      category: cat,
    })
    onClose()
  }

  return (
    <Sheet title="Трата наличными" onClose={onClose}>
      <div style={{ textAlign: 'center', padding: '4px 0 12px' }}>
        <div className="amount" style={{ fontSize: 36 }}>{fmt(minor, { kop: minor % 100 !== 0 })}</div>
        <div className="sub tiny" style={{ marginTop: 4 }}>
          Списывается с кошелька · {cashAccount.name}
        </div>
      </div>

      <input
        value={title}
        onChange={e => setTitle(e.target.value)}
        placeholder="Где потратили (необязательно)"
        aria-label="Описание"
        style={{
          width: '100%', padding: '11px 14px', borderRadius: 12, marginBottom: 10,
          background: 'var(--surface)', border: '1px solid var(--line)',
          color: 'var(--text)', fontSize: 13, outline: 'none',
        }} />

      <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 12 }}>
        {CATS.map(c => (
          <button key={c} className={'chip' + (cat === c ? ' on' : '')} onClick={() => setCat(c)}>
            {CATEGORY_TITLE[c]}
          </button>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
        {KEYS.map(k => (
          <button key={k} onClick={() => tap(k)}
            style={{
              padding: '15px 0', borderRadius: 14, background: 'var(--surface)',
              border: '1px solid var(--line)', fontSize: 19, fontWeight: 600,
            }}>
            {k}
          </button>
        ))}
      </div>

      <button className="btn" style={{ marginTop: 14, opacity: minor > 0 ? 1 : .4 }}
        onClick={save} disabled={minor <= 0}>
        Сохранить
      </button>
      <div className="note" style={{ marginTop: 10 }}>
        Наличная покупка не дедуплицируется с банковскими строками: в выписке её нет
        и появиться она там не может.
      </div>
    </Sheet>
  )
}
