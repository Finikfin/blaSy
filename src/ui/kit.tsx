import React from 'react'
import type { CategoryRow } from '../engine/analytics'
import { CATEGORY_COLOR, CATEGORY_TITLE, type EventKind } from '../engine/types'
import { fmt } from '../engine/money'

export type IconName =
  | 'home' | 'chart' | 'list' | 'more' | 'check' | 'arrow' | 'back'
  | 'transfer' | 'debt' | 'people' | 'refund' | 'cash' | 'question' | 'plus' | 'wallet' | 'chat'

const PATHS: Record<IconName, string> = {
  home: 'M3 10.5 12 3l9 7.5V21H3z',
  chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  more: 'M4 6h16M4 12h16M4 18h10',
  check: 'M4 12.5 9 17.5 20 6.5',
  arrow: 'M5 12h14M13 6l6 6-6 6',
  back: 'M19 12H5M11 18l-6-6 6-6',
  transfer: 'M4 8h13l-3-3M20 16H7l3 3',
  debt: 'M12 3v18M8 7h6a3 3 0 0 1 0 6h-4a3 3 0 0 0 0 6h6',
  people: 'M16 20v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 10a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 20v-2a4 4 0 0 0-3-3.9',
  refund: 'M3 12a9 9 0 1 0 3-6.7M3 4v5h5',
  cash: 'M2 7h20v10H2zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6',
  question: 'M9.2 9a3 3 0 1 1 4 2.8c-.8.3-1.2 1-1.2 1.8v.4M12 18h.01',
  plus: 'M12 5v14M5 12h14',
  wallet: 'M3 7h15a3 3 0 0 1 3 3v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7zM3 7l12-3M17 13h.01',
  chat: 'M21 12a8 8 0 0 1-11.6 7.1L3 21l1.9-6.4A8 8 0 1 1 21 12z',
}

export function Icon({ name, size = 20, color = 'currentColor', width = 1.7 }: {
  name: IconName; size?: number; color?: string; width?: number
}) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  )
}

export const KIND_ICON: Record<EventKind, IconName> = {
  EXPENSE: 'wallet',
  INCOME: 'arrow',
  OWN_TRANSFER: 'transfer',
  CASH_WITHDRAWAL: 'cash',
  LOAN_ISSUED: 'debt',
  LOAN_REPAYMENT: 'debt',
  SHARED_PURCHASE: 'people',
  REIMBURSEMENT: 'people',
  PURCHASE_REFUND: 'refund',
  UNRESOLVED: 'question',
}

/**
 * Кольцо расходов по категориям.
 * Отрицательные категории (возвраты) в кольцо не входят — их нельзя нарисовать
 * долей окружности. Они показаны в легенде отдельной строкой, значения не обрезаются.
 */
export function Donut({ rows, total, caption }: {
  rows: CategoryRow[]; total: number; caption?: string
}) {
  const R = 56
  const C = 2 * Math.PI * R
  const positive = rows.filter(r => r.amountMinor > 0)
  const sum = positive.reduce((s, r) => s + r.amountMinor, 0) || 1
  let offset = 0

  return (
    <div style={{ position: 'relative', width: 150, height: 150, margin: '4px auto 2px' }}>
      <svg width="150" height="150" viewBox="0 0 150 150" role="img"
        aria-label={'Расходы по категориям, всего ' + fmt(total)}>
        <circle cx="75" cy="75" r={R} fill="none" stroke="#262626" strokeWidth="15" />
        {positive.map(r => {
          const len = (r.amountMinor / sum) * C
          const el = (
            <circle key={r.category} cx="75" cy="75" r={R} fill="none"
              stroke={CATEGORY_COLOR[r.category]} strokeWidth="15"
              strokeDasharray={`${Math.max(len - 2, 0)} ${C - Math.max(len - 2, 0)}`}
              strokeDashoffset={-offset}
              transform="rotate(-90 75 75)" strokeLinecap="butt" />
          )
          offset += len
          return el
        })}
      </svg>
      <div style={{
        position: 'absolute', inset: 0, display: 'grid',
        placeContent: 'center', textAlign: 'center',
      }}>
        <div className="label">{caption ?? 'Расходы'}</div>
        <div style={{ fontSize: 19, fontWeight: 700, marginTop: 3 }}>{fmt(total, { kop: false })}</div>
      </div>
    </div>
  )
}

export function CategoryList({ rows }: { rows: CategoryRow[] }) {
  if (!rows.length) return <div className="empty">В этом периоде расходов нет.</div>
  return (
    <div>
      {rows.map(r => (
        <div className="catrow" key={r.category}>
          <span className="dot" style={{ background: CATEGORY_COLOR[r.category] }} />
          <span className="n">{CATEGORY_TITLE[r.category]}</span>
          <span className="p">{r.amountMinor > 0 ? Math.round(r.share * 100) + '%' : '—'}</span>
          <span className="a" style={r.amountMinor < 0 ? { color: 'var(--accent)' } : undefined}>
            {fmt(r.amountMinor, { kop: false })}
          </span>
        </div>
      ))}
    </div>
  )
}

export function Sheet({ title, onClose, children }: {
  title: string; onClose: () => void; children: React.ReactNode
}) {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'absolute', inset: 0, zIndex: 40,
        background: 'rgba(0,0,0,.62)', display: 'flex', alignItems: 'flex-end',
      }}>
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%', maxHeight: '78%', overflowY: 'auto',
          background: 'var(--bg)', borderTop: '1px solid var(--line)',
          borderRadius: '22px 22px 0 0', padding: '14px 18px 26px',
        }}>
        <div style={{
          width: 38, height: 4, borderRadius: 2, background: 'var(--line)',
          margin: '0 auto 14px',
        }} />
        <div className="row between" style={{ marginBottom: 12 }}>
          <h2 style={{ fontSize: 17, fontWeight: 700 }}>{title}</h2>
          <button className="chip" onClick={onClose}>Закрыть</button>
        </div>
        {children}
      </div>
    </div>
  )
}

export function StatTile({ label, value, tone, note }: {
  label: string; value: string; tone?: 'pos' | 'neg'; note?: string
}) {
  return (
    <div className="card" style={{ marginBottom: 0 }}>
      <div className="label">{label}</div>
      <div className={'amount sm ' + (tone ?? '')} style={{ marginTop: 6 }}>{value}</div>
      {note && <div className="sub tiny" style={{ marginTop: 4 }}>{note}</div>}
    </div>
  )
}
