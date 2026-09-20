import React, { useRef, useState } from 'react'
import type { Granularity, Range } from '../engine/analytics'

export type GranOption = { id: Granularity; title: string }

/**
 * Оболочка главной. Свайп ловится на всей площади экрана, а не только
 * на шапке: пользователь тянет в любом месте и листает дробность —
 * те самые страницы, что показаны точками.
 *
 * Вертикальная прокрутка не страдает: жест считается горизонтальным,
 * только если по X сдвинулись заметно дальше, чем по Y.
 */
export function PeriodSwiper({
  grans, gran, range, onGran, onShiftPeriod, children,
}: {
  grans: GranOption[]
  gran: Granularity
  range: Range
  onGran: (g: Granularity) => void
  onShiftPeriod: (dir: number) => void
  children: React.ReactNode
}) {
  const [dx, setDx] = useState(0)
  const [anim, setAnim] = useState<'left' | 'right' | null>(null)
  const start = useRef<{ x: number; y: number } | null>(null)
  const horizontal = useRef(false)
  // Одна прокрутка тачпада = один шаг, иначе жест пролистывает всё подряд
  const wheelLock = useRef(false)

  const index = grans.findIndex(g => g.id === gran)

  const playAnim = (dir: number) => {
    setAnim(dir > 0 ? 'left' : 'right')
    window.setTimeout(() => setAnim(null), 220)
  }

  /** Шаг по точкам. На краях упираемся — колец у пагинации нет. */
  const stepGran = (dir: number) => {
    const next = index + dir
    if (next < 0 || next >= grans.length) {
      setDx(dir * 14)
      window.setTimeout(() => setDx(0), 130)
      return
    }
    playAnim(dir)
    onGran(grans[next].id)
  }

  const shiftPeriod = (dir: number) => {
    playAnim(dir)
    onShiftPeriod(dir)
  }

  const onDown = (e: React.PointerEvent) => {
    // На интерактивных элементах жест не начинаем — иначе ломаются нажатия
    if ((e.target as HTMLElement).closest('button, a, input, textarea, select')) return
    start.current = { x: e.clientX, y: e.clientY }
    horizontal.current = false
    // Захват указателя: палец или курсор может уйти за пределы блока,
    // но события продолжат приходить сюда и жест не «зависнет»
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId) } catch { /* не поддержано */ }
  }

  /**
   * Горизонтальная прокрутка тачпада или колеса с наклоном.
   * На ноутбуке «свайп» — это именно wheel с deltaX, а не перетаскивание.
   */
  const onWheel = (e: React.WheelEvent) => {
    const { deltaX, deltaY } = e
    if (Math.abs(deltaX) < 12 || Math.abs(deltaX) <= Math.abs(deltaY)) return
    if (wheelLock.current) return
    wheelLock.current = true
    stepGran(deltaX > 0 ? 1 : -1)
    window.setTimeout(() => { wheelLock.current = false }, 450)
  }

  const onMove = (e: React.PointerEvent) => {
    if (!start.current) return
    const mx = e.clientX - start.current.x
    const my = e.clientY - start.current.y
    if (!horizontal.current) {
      if (Math.abs(my) > 12 && Math.abs(my) > Math.abs(mx)) { start.current = null; return }
      if (Math.abs(mx) > 12 && Math.abs(mx) > Math.abs(my) * 1.4) horizontal.current = true
      else return
    }
    setDx(mx)
  }

  const onUp = () => {
    if (!start.current) { setDx(0); return }
    const moved = horizontal.current ? dx : 0
    start.current = null
    horizontal.current = false
    setDx(0)
    if (Math.abs(moved) > 50) stepGran(moved < 0 ? 1 : -1)
  }

  return (
    <div
      className="pager-zone"
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      onLostPointerCapture={onUp}
      onWheel={onWheel}
      onKeyDown={e => {
        if (e.key === 'ArrowLeft') { e.preventDefault(); stepGran(-1) }
        if (e.key === 'ArrowRight') { e.preventDefault(); stepGran(1) }
        if (e.key === 'ArrowUp') { e.preventDefault(); shiftPeriod(1) }
        if (e.key === 'ArrowDown') { e.preventDefault(); shiftPeriod(-1) }
      }}
      tabIndex={0}
      role="group"
      aria-label={'Итог за период ' + range.label
        + '. Листайте влево и вправо, чтобы сменить длительность периода'}
      style={{
        transform: dx ? 'translateX(' + dx * 0.3 + 'px)' : undefined,
        transition: dx ? 'none' : 'transform .18s ease-out',
      }}>
      <div className="gdots" role="tablist" aria-label="Длительность периода">
        {grans.map(g => (
          <button
            key={g.id}
            role="tab"
            aria-selected={gran === g.id}
            aria-label={g.title}
            className={'gdot' + (gran === g.id ? ' on' : '')}
            onClick={() => onGran(g.id)}>
            {gran === g.id ? g.title : <span className="pip" />}
          </button>
        ))}
      </div>

      <div className="pager-nav">
        <button className="navchev" aria-label="Предыдущий период"
          onClick={() => shiftPeriod(-1)}>‹</button>
        <span className="pager-label">{range.label}</span>
        <button className="navchev" aria-label="Следующий период"
          onClick={() => shiftPeriod(1)}>›</button>
      </div>

      <div className={'pager-inner' + (anim ? ' slide-' + anim : '')} key={gran + range.from}>
        {children}
      </div>
    </div>
  )
}
