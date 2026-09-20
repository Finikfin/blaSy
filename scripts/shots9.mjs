import { chromium } from 'playwright'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1200, height: 950 } })
page.on('pageerror', e => console.log('PAGE ERROR:', e.message))
await page.addInitScript(() => localStorage.clear())
await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' })
await page.waitForTimeout(800)
const state = async () => (await page.locator('.gdot.on').innerText()) + ' · '
  + (await page.locator('.pager-label').innerText())

const dev = await page.locator('.device').boundingBox()
const cx = dev.x + dev.width / 2

console.log('старт:              ', await state())

// 1. тачпад: горизонтальная прокрутка
await page.mouse.move(cx, dev.y + dev.height * 0.5)
await page.mouse.wheel(120, 0)
await page.waitForTimeout(600)
console.log('тачпад вправо:      ', await state())
await page.mouse.wheel(-120, 0)
await page.waitForTimeout(600)
console.log('тачпад влево:       ', await state())

// 2. защита от пролистывания залпом
await page.mouse.wheel(120, 0); await page.mouse.wheel(120, 0); await page.mouse.wheel(120, 0)
await page.waitForTimeout(700)
console.log('три подряд = 1 шаг: ', await state())

// 3. вертикальная прокрутка не листает
const before = await state()
await page.mouse.wheel(0, 200)
await page.waitForTimeout(500)
console.log('верт. прокрутка:    ', (await state()) === before ? 'не листает ✓' : 'СЛОМАНО')

// 4. перетаскивание мышью
await page.evaluate(() => document.querySelector('.screen').scrollTo(0, 0))
const y = dev.y + dev.height * 0.7
await page.mouse.move(cx, y)
await page.mouse.down()
await page.mouse.move(cx + 180, y, { steps: 14 })
await page.mouse.up()
await page.waitForTimeout(600)
console.log('перетаскивание:     ', await state())

// 5. клик по кнопке всё ещё работает
await page.getByRole('button', { name: /Разобрать по категориям/ }).click()
await page.waitForTimeout(500)
console.log('кнопка:             ', await page.locator('h1').innerText())
await browser.close()
