import { chromium } from 'playwright'
const OUT = 'scripts/shots'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1200, height: 950 } })
page.on('pageerror', e => console.log('PAGE ERROR:', e.message))
await page.addInitScript(() => localStorage.clear())
await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' })
await page.waitForTimeout(800)
const shot = async (n) => { await page.waitForTimeout(450); await page.screenshot({ path: OUT+'/'+n+'.png' }); console.log('saved', n) }
const state = async () => (await page.locator('.gdot.on').innerText()) + ' | '
  + (await page.locator('.pager-label').innerText()) + ' | '
  + (await page.locator('.amount.hero').innerText()).replace(/\s+/g,' ')

console.log('старт:', await state())
await shot('n1-home')

// свайп у самого низа экрана — проверяем, что зона на всю страницу
const dev = await page.locator('.device').boundingBox()
const swipeAt = async (yFrac, dx) => {
  const y = dev.y + dev.height * yFrac
  await page.mouse.move(dev.x + dev.width/2, y)
  await page.mouse.down()
  await page.mouse.move(dev.x + dev.width/2 + dx, y, { steps: 14 })
  await page.mouse.up()
  await page.waitForTimeout(500)
}
await swipeAt(0.75, 170)
console.log('свайп внизу экрана:', await state())
await shot('n2-week-low-swipe')
await swipeAt(0.35, -170)
console.log('свайп обратно:     ', await state())

// вертикальный жест не должен листать
const before = await state()
const y = dev.y + dev.height * 0.6
await page.mouse.move(dev.x + dev.width/2, y)
await page.mouse.down()
await page.mouse.move(dev.x + dev.width/2, y - 160, { steps: 14 })
await page.mouse.up()
await page.waitForTimeout(400)
console.log('после верт. жеста: ', (await state()) === before ? 'не изменилось ✓' : 'СЛОМАНО')

await page.getByRole('button', { name: /Разобрать по категориям/ }).click()
await page.waitForTimeout(500)
await shot('n3-analytics-top')
await page.evaluate(() => document.querySelector('.screen').scrollTo(0, 620))
await shot('n4-analytics-bars')
await browser.close()
console.log('готово')
