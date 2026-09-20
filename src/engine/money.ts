import type { Minor } from './types'

/** Рубли → копейки. Только для литералов демо-набора. */
export const rub = (n: number): Minor => Math.round(n * 100)

/** 1245000 → «12 450 ₽», дробные копейки показываются при наличии. */
export function fmt(m: Minor, opts: { sign?: boolean; kop?: boolean } = {}): string {
  const neg = m < 0
  const abs = Math.abs(m)
  const whole = Math.trunc(abs / 100)
  const kop = abs % 100
  const showKop = opts.kop ?? kop !== 0
  const body = whole.toLocaleString('ru-RU') + (showKop ? ',' + String(kop).padStart(2, '0') : '')
  // У нуля знака нет: «+0 ₽» выглядит как ошибка расчёта
  const sign = neg ? '−' : opts.sign && m > 0 ? '+' : ''
  return sign + body + ' ₽'
}

/** Короткая форма для плиток: «12 450». */
export const fmtShort = (m: Minor) => fmt(m, { kop: false }).replace(' ₽', '')

/**
 * Деление суммы на n долей без потери копеек (§10.5).
 * Каждому floor(total/n), остаток по одной копейке по порядку, начиная с «Я».
 */
export function splitEvenly(total: Minor, n: number): Minor[] {
  const base = Math.floor(total / n)
  let rest = total - base * n
  return Array.from({ length: n }, () => {
    const extra = rest > 0 ? 1 : 0
    rest -= extra
    return base + extra
  })
}
