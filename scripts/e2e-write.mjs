import { chromium } from 'playwright'
const API = 'http://127.0.0.1:8123'
const srv = async () => {
  const r = await fetch(API + '/api/analytics?from=2026-09-01&to=2026-09-30&grouping=month')
  const d = await r.json()
  return { exp: d.expenses_minor, inc: d.income_minor, unres: d.unresolved_count }
}
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1200, height: 950 } })
const errors = []
page.on('pageerror', e => errors.push(e.message))
await page.addInitScript(() => localStorage.clear())
await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' })
await page.waitForTimeout(2500)

const hero = async () => (await page.locator('.amount.hero').innerText()).replace(/\s+/g,' ')
console.log('до    | экран', await hero(), '| сервер', await srv())

// 1. Ответ на вопрос разбора: «500 за обед» → это доход
await page.locator('.quietlink').click()
await page.waitForTimeout(700)
console.log('вопрос:', await page.locator('.q h3').first().innerText())
await page.getByRole('button', { name: /Это доход/ }).first().click()
await page.waitForTimeout(2000)
await page.locator('.tab', { hasText: 'Главная' }).first().click()
await page.waitForTimeout(800)
console.log('после разбора | экран', await hero(), '| сервер', await srv())

// 2. Трата наличными через чат
await page.locator('.tab').nth(2).click()
await page.waitForTimeout(500)
await page.getByPlaceholder('Сообщение').fill('700 продукты')
await page.getByRole('button', { name: 'Отправить' }).click()
await page.waitForTimeout(900)
await page.getByRole('button', { name: 'Записать' }).click()
await page.waitForTimeout(2200)
await page.getByRole('button', { name: 'Закрыть' }).click()
await page.waitForTimeout(900)
console.log('после траты   | экран', await hero(), '| сервер', await srv())

// 3. Отмена решения в карточке операции
await page.locator('.tab', { hasText: 'Операции' }).first().click()
await page.waitForTimeout(800)
await page.getByPlaceholder('Поиск по описанию').fill('Неизвестный')
await page.waitForTimeout(600)
await page.locator('.op').first().click()
await page.waitForTimeout(500)
const undo = page.getByRole('button', { name: 'Отменить решение' })
if (await undo.count()) {
  await undo.click()
  await page.waitForTimeout(2200)
  console.log('после отмены  | сервер', await srv())
} else console.log('кнопки отмены нет')

await page.screenshot({ path: 'scripts/shots/e3-after-write.png' })
console.log(errors.length ? 'ОШИБКИ: ' + errors.slice(0,3).join(' | ') : 'ошибок нет')
await browser.close()
