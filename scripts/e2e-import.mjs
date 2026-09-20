import { chromium } from 'playwright'
const API = 'http://127.0.0.1:8123'
const count = async () => {
  const d = await (await fetch(API + '/api/transactions?page=1&page_size=1')).json()
  return d.total
}
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1200, height: 950 } })
const errors = []
page.on('pageerror', e => errors.push(e.message))
await page.addInitScript(() => localStorage.clear())
await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' })
await page.waitForTimeout(2500)

console.log('событий до импорта:', await count())

// открываем импорт из чата
await page.locator('.tab').nth(2).click()
await page.waitForTimeout(500)
await page.getByRole('button', { name: 'Загрузить выписку' }).click()
await page.waitForTimeout(600)
await page.screenshot({ path: 'scripts/shots/f1-import-empty.png' })

// тот же demo.csv: все строки должны определиться как дубли
await page.setInputFiles('input[type=file][accept=".csv,text/csv"]', 'backend/fixtures/demo.csv')
await page.waitForTimeout(3000)
const chips = await page.locator('.chip').allInnerTexts()
console.log('предпросмотр demo.csv:', chips.filter(c => /новых|дублей|ошибок|конфликт/.test(c)).join(' | '))
await page.screenshot({ path: 'scripts/shots/f2-import-duplicates.png' })

// теперь файл с новыми строками
await page.getByRole('button', { name: 'Отмена' }).click()
await page.waitForTimeout(400)
await page.setInputFiles('input[type=file][accept=".csv,text/csv"]', 'scripts/extra.csv')
await page.waitForTimeout(3000)
const chips2 = await page.locator('.chip').allInnerTexts()
console.log('предпросмотр extra.csv:', chips2.filter(c => /новых|дублей|ошибок|конфликт/.test(c)).join(' | '))
await page.screenshot({ path: 'scripts/shots/f3-import-preview.png' })

const btn = page.getByRole('button', { name: /Импортировать/ })
if (await btn.count()) {
  console.log('кнопка:', await btn.innerText())
  await btn.click()
  await page.waitForTimeout(3000)
  console.log('после импорта:', await page.locator('.note').first().innerText())
}
console.log('событий после импорта:', await count())
await page.screenshot({ path: 'scripts/shots/f4-import-done.png' })
console.log(errors.length ? 'ОШИБКИ: ' + errors.slice(0,3).join(' | ') : 'ошибок нет')
await browser.close()
