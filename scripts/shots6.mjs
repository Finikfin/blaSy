import { chromium } from 'playwright'
const OUT = 'scripts/shots'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1200, height: 950 } })
page.on('pageerror', e => console.log('PAGE ERROR:', e.message))
await page.addInitScript(() => localStorage.clear())
await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' })
await page.waitForTimeout(800)
const shot = async (n) => { await page.waitForTimeout(450); await page.screenshot({ path: OUT + '/' + n + '.png' }); console.log('saved', n) }

await shot('i1-home-insight')
console.log('подсказка:', await page.locator('.insight-text').innerText())

const box = await page.locator('.pager-area').boundingBox()
const cy = box.y + box.height / 2
await page.mouse.move(box.x + box.width / 2, cy)
await page.mouse.down()
await page.mouse.move(box.x + box.width / 2 + 170, cy, { steps: 12 })
await page.mouse.up()
await page.waitForTimeout(500)
console.log('август:', await page.locator('.insight-text').innerText())
await shot('i2-home-august')

await page.locator('.gdot').nth(1).click()
await page.waitForTimeout(500)
console.log('неделя:', await page.locator('.insight-text').innerText())
await shot('i3-home-week')

await page.locator('.tab', { hasText: 'Ещё' }).first().click()
await page.getByRole('button', { name: 'Данные' }).click()
await page.waitForTimeout(300)
await page.getByRole('button', { name: 'выключена' }).click()
await page.waitForTimeout(400)
await page.evaluate(() => document.querySelector('.screen').scrollTo(0, 1200))
await shot('i4-llm-settings')
await browser.close()
console.log('готово')
