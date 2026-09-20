import type { Account, BankType, RawTransaction } from '../engine/types'
import { rub } from '../engine/money'

/** §11: демо использует управляемую дату, она видна в интерфейсе. */
export const DEMO_TODAY = '2026-09-30'

export const ACCOUNTS: Account[] = [
  { id: 'main', name: 'Основная карта', kind: 'bank', ownConfirmed: true, color: '#CCFF00' },
  { id: 'second', name: 'Вторая карта', kind: 'bank', ownConfirmed: true, color: '#8FE388' },
  { id: 'market', name: 'Карта маркетплейса', kind: 'bank', ownConfirmed: true, color: '#5ED3A0' },
  {
    id: 'cash', name: 'Наличные', kind: 'cash', ownConfirmed: true, color: '#AAAAAA',
    openingBalanceMinor: 0, openingBalanceDate: '2026-09-01',
  },
]

const sep = (day: number) => '2026-09-' + String(day).padStart(2, '0')

const tx = (
  id: string, accountId: string, bookingDate: string, amountRub: number,
  description: string, bankType: BankType,
  counterparty?: string, counterpartyAccountRef?: string,
): RawTransaction => ({
  id, accountId, bookingDate, signedAmountMinor: rub(amountRub),
  description, bankType, counterparty, counterpartyAccountRef,
})

/**
 * Эталонный демонстрационный набор §17.1.
 * 69 банковских записей. Генерация детерминированная, идентификаторы стабильны.
 * Ручная наличная покупка S19 в CSV не входит — создаётся отдельно.
 */
export function buildDemoTransactions(): RawTransaction[] {
  const out: RawTransaction[] = []

  // B001–B030: покупка продуктов каждый день сентября, −100 ₽
  for (let day = 1; day <= 30; day++) {
    out.push(tx('B' + String(day).padStart(3, '0'), 'main', sep(day), -100,
      'Пятёрочка, продукты', 'purchase'))
  }
  // B031–B040: доход +1 000 ₽ по чётным опорным дням
  const incomeDays = [2, 5, 8, 11, 14, 17, 20, 23, 26, 29]
  incomeDays.forEach((day, i) => {
    out.push(tx('B' + String(31 + i), 'main', sep(day), 1000,
      'ООО Ромашка, выплата', 'salary', 'ООО Ромашка'))
  })
  // B041–B050: транспорт −200 ₽
  const transportDays = [3, 6, 9, 12, 15, 18, 21, 24, 27, 30]
  transportDays.forEach((day, i) => {
    out.push(tx('B' + String(41 + i), 'main', sep(day), -200,
      'Метро, проездной', 'purchase'))
  })

  out.push(
    // S1. Перевод между своими картами
    tx('S01', 'main', sep(3), -10000, 'Перевод на свою карту', 'transfer', 'Вторая карта', 'second'),
    tx('S02', 'second', sep(3), 10000, 'Перевод со своего счёта', 'transfer', 'Основная карта', 'main'),
    // S2. Карта маркетплейса
    tx('S03', 'main', sep(4), -6000, 'Пополнение карты маркетплейса', 'transfer', 'Карта маркетплейса', 'market'),
    tx('S04', 'market', sep(4), 6000, 'Пополнение со своего счёта', 'transfer', 'Основная карта', 'main'),
    tx('S05', 'market', sep(5), -2000, 'Маркетплейс, продукты', 'purchase'),
    tx('S06', 'market', sep(6), -3500, 'Маркетплейс, техника', 'purchase'),
    // S3. Долг и два возврата
    tx('S07', 'main', sep(7), -3000, 'Перевод Алексею', 'transfer', 'Алексей'),
    tx('S08', 'main', sep(14), 1500, 'Перевод от Алексея', 'transfer', 'Алексей'),
    tx('S09', 'main', sep(21), 1500, 'Перевод от Алексея', 'transfer', 'Алексей'),
    // S4. Ресторан на пятерых
    tx('S10', 'main', sep(10), -8000, 'Ресторан Веранда', 'purchase'),
    tx('S11', 'main', sep(11), 1600, 'Перевод от Друг 1, за ужин', 'transfer', 'Друг 1'),
    tx('S12', 'main', sep(12), 1600, 'Перевод от Друг 2, за ужин', 'transfer', 'Друг 2'),
    tx('S13', 'main', sep(13), 1600, 'Перевод от Друг 3, за ужин', 'transfer', 'Друг 3'),
    tx('S14', 'main', sep(14), 1600, 'Перевод от Друг 4, за ужин', 'transfer', 'Друг 4'),
    // S5. 500 ₽ «за обед» без долга
    tx('S15', 'main', sep(15), 500, 'Перевод, за обед', 'transfer'),
    // S6. Покупка в августе и возврат в сентябре
    tx('S16', 'main', '2026-08-28', -4200, 'Магазин техники', 'purchase'),
    tx('S17', 'main', sep(16), 4200, 'Магазин техники, возврат', 'refund'),
    // S7. Снятие наличных
    tx('S18', 'main', sep(17), -5000, 'Снятие в банкомате', 'cash_withdrawal'),
    // Дополнительный доход
    tx('S20', 'main', sep(25), 12000, 'ООО Ромашка, выплата', 'salary', 'ООО Ромашка'),
  )

  return out
}

/** S19 — ручная наличная покупка. Банковской строки для неё не существует. */
export const MANUAL_CASH_PURCHASE = {
  id: 'S19',
  accountId: 'cash',
  date: sep(18),
  amountMinor: rub(-700),
  description: 'Рынок, продукты за наличные',
  category: 'groceries' as const,
}

/** Разбиение эталонного набора на два перекрывающихся файла (§17.4). */
export function demoFirstHalf(all: RawTransaction[]) {
  return all.filter(t => t.bookingDate <= '2026-09-14')
}
export function demoSecondHalf(all: RawTransaction[]) {
  return all.filter(t => t.bookingDate >= '2026-09-10')
}

export function toCsv(rows: RawTransaction[]): string {
  const head = 'transaction_id,account_id,booking_date,amount,currency,description,bank_type,counterparty,counterparty_account_id'
  const esc = (s = '') => (/[",;\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s)
  const body = rows.map(r => [
    r.id, r.accountId, r.bookingDate, (r.signedAmountMinor / 100).toFixed(2), 'RUB',
    esc(r.description), r.bankType, esc(r.counterparty), esc(r.counterpartyAccountRef),
  ].join(','))
  return [head, ...body].join('\n')
}
