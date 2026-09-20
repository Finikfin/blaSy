import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const OUT = 'scripts/shots'
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1200, height: 950 } })
page.on('pageerror', e => console.log('PAGE ERROR:', e.message))
await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' })
await page.waitForTimeout(700)

const shot = async (name) => {
  await page.waitForTimeout(400)
  await page.screenshot({ path: `${OUT}/${name}.png` })
  console.log('saved', name)
}
const tab = async (label) => {
  await page.locator('.tab', { hasText: label }).first().click()
  await page.waitForTimeout(350)
}
const scrollTo = async (text) => {
  await page.getByText(text).first().scrollIntoViewIfNeeded()
  await page.waitForTimeout(350)
}

await tab('Операции')
await shot('8-operations')

await tab('Аналитика')
await scrollTo('Сходимость')
await shot('4b-analytics-recon')

await tab('Главная')
await scrollTo('Сводка за неделю')
await shot('1b-home-weekly')

await browser.close()
console.log('готово')
