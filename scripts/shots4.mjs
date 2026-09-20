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

await shot('m1-home')

// чат
await page.locator('.tab').nth(2).click()
await page.waitForTimeout(400)
await shot('m2-chat-empty')

const ask = async (text) => {
  await page.getByPlaceholder('Сообщение').fill(text)
  await page.getByRole('button', { name: 'Отправить' }).click()
  await page.waitForTimeout(600)
}

await ask('сколько я потратил в сентябре')
await ask('почему столько')
await shot('m3-chat-summary')

await ask('кто мне должен')
await ask('400 кофе')
await shot('m4-chat-add')

// подтверждаем запись
await page.getByRole('button', { name: 'Записать' }).last().click()
await page.waitForTimeout(500)
await shot('m5-chat-added')

await page.getByRole('button', { name: 'Закрыть' }).click()
await page.waitForTimeout(400)
await shot('m6-home-after')

await page.locator('.tab', { hasText: 'Аналитика' }).first().click()
await page.waitForTimeout(400)
await shot('m7-analytics')
await page.getByText('Недели складываются в месяц').click()
await page.waitForTimeout(350)
await page.evaluate(() => document.querySelector('.screen').scrollTo(0, 900))
await shot('m8-analytics-recon')

await browser.close()
console.log('готово')
