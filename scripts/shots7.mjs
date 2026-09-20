import { chromium } from 'playwright'
const OUT = 'scripts/shots'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1200, height: 950 } })
page.on('pageerror', e => console.log('PAGE ERROR:', e.message))
await page.addInitScript(() => localStorage.clear())
await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' })
await page.waitForTimeout(800)
const shot = async (n) => { await page.waitForTimeout(450); await page.screenshot({ path: OUT + '/' + n + '.png' }); console.log('saved', n) }
const state = async () => {
  const dot = await page.locator('.gdot.on').innerText()
  const label = await page.locator('.pager-label').innerText()
  const amount = await page.locator('.amount.hero').innerText()
  return dot + ' | ' + label + ' | ' + amount.replace(/\s+/g, ' ')
}
const box = await page.locator('.pager-area').boundingBox()
const cy = box.y + box.height / 2 + 30
const swipe = async (dx) => {
  await page.mouse.move(box.x + box.width / 2, cy)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + dx, cy, { steps: 12 })
  await page.mouse.up()
  await page.waitForTimeout(500)
}

console.log('старт:      ', await state())
await shot('c1-home-month')
await swipe(170)
console.log('свайп вправо:', await state())
await shot('c2-week')
await swipe(170)
console.log('свайп вправо:', await state())
await shot('c3-day')
await swipe(170)
console.log('упор влево: ', await state())
await swipe(-170); await swipe(-170); await swipe(-170)
console.log('три влево:  ', await state())
await shot('c4-year')
await swipe(-170)
console.log('упор вправо:', await state())

// стрелки периода
await page.getByRole('button', { name: 'Предыдущий период' }).click()
await page.waitForTimeout(450)
console.log('пред. год:  ', await state())
await page.getByRole('button', { name: 'Следующий период' }).click()
await page.waitForTimeout(450)
console.log('след. год:  ', await state())
await browser.close()
console.log('готово')
