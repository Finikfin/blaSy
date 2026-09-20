import { chromium } from 'playwright'

const OUT = 'scripts/shots'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1200, height: 950 } })
page.on('pageerror', e => console.log('PAGE ERROR:', e.message))
await page.addInitScript(() => localStorage.clear())
await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' })
await page.waitForTimeout(800)

const shot = async (name) => {
  await page.waitForTimeout(450)
  await page.screenshot({ path: `${OUT}/${name}.png` })
  console.log('saved', name)
}

await shot('s1-home-dots')

// свайп влево = следующий период
const box = await page.locator('.pager-area').boundingBox()
const cy = box.y + box.height / 2
const swipe = async (dx) => {
  await page.mouse.move(box.x + box.width / 2, cy)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + dx, cy, { steps: 12 })
  await page.mouse.up()
  await page.waitForTimeout(450)
}

await swipe(-160)
console.log('после свайпа влево:', await page.locator('.pager-label').innerText())
await shot('s2-home-next-month')

await swipe(180)
await swipe(180)
console.log('после двух свайпов вправо:', await page.locator('.pager-label').innerText())
await shot('s3-home-august')

// переключение дробности точкой
await page.locator('.gdot').nth(1).click()
await page.waitForTimeout(400)
console.log('дробность «Неделя»:', await page.locator('.pager-label').innerText())
await shot('s4-home-week')

await page.locator('.gdot').nth(0).click()
await page.waitForTimeout(400)
console.log('дробность «День»:', await page.locator('.pager-label').innerText())
await shot('s5-home-day')

await browser.close()
console.log('готово')
