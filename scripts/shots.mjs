import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const OUT = process.argv[2] ?? 'scripts/shots'
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1200, height: 950 } })
page.on('console', m => { if (m.type() === 'error') console.log('CONSOLE ERROR:', m.text()) })
page.on('pageerror', e => console.log('PAGE ERROR:', e.message))

await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' })
await page.waitForTimeout(700)

const shot = async (name) => {
  await page.waitForTimeout(450)
  await page.screenshot({ path: `${OUT}/${name}.png` })
  console.log('saved', name)
}

const tab = async (label) => {
  await page.locator('.tab', { hasText: label }).first().click()
  await page.waitForTimeout(350)
}

await shot('1-home')

// очередь разбора: вернуть вопросы и открыть разбор
await tab('Ещё')
await page.getByRole('button', { name: 'Данные' }).click()
await shot('5-more-data')
await page.getByRole('button', { name: 'Пройти разбор заново' }).click()
await page.waitForTimeout(400)
await tab('Главная')
await shot('2-home-questions')
await page.getByText(/важных? уточнени/).first().click()
await shot('3-review')

// вернуть эталонное состояние и снять остальные экраны
await tab('Ещё')
await page.getByRole('button', { name: 'Данные' }).click()
await page.getByRole('button', { name: 'Вернуть эталонное состояние' }).click()
await page.waitForTimeout(400)
await page.getByRole('button', { name: 'Счета' }).click()
await shot('6-accounts')
await page.getByRole('button', { name: 'Долги' }).click()
await shot('7-debts')

await tab('Аналитика')
await shot('4-analytics')
await page.mouse.wheel(0, 700)
await shot('4b-analytics-recon')

await tab('Операции')
await shot('8-operations')
await page.getByText('Ресторан Веранда').first().click()
await shot('9-operation-card')

await browser.close()
console.log('готово')
