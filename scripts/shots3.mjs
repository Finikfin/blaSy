import { chromium } from 'playwright'

const OUT = 'scripts/shots'
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
const scroll = async (px) => {
  await page.evaluate(y => document.querySelector('.screen').scrollTo(0, y), px)
  await page.waitForTimeout(350)
}

await tab('Главная')
await scroll(760)
await shot('1b-home-weekly')

await tab('Ещё')
await page.getByRole('button', { name: 'Счета' }).click()
await shot('6-accounts')
await page.getByRole('button', { name: 'Долги' }).click()
await shot('7-debts')
await page.getByRole('button', { name: 'Данные' }).click()
await shot('5-more-data')

await page.locator('.tab').nth(2).click()
await shot('10-add-cash')

await browser.close()
console.log('готово')
