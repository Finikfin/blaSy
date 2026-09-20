import { chromium } from 'playwright'
const OUT = 'scripts/shots'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1200, height: 950 } })
const errors = []
page.on('pageerror', e => errors.push('PAGE ERROR: ' + e.message))
page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()) })
const reqs = []
page.on('response', r => { if (r.url().includes(':8123')) reqs.push(r.status() + ' ' + r.url().replace('http://127.0.0.1:8123','')) })

await page.addInitScript(() => localStorage.clear())
await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' })
await page.waitForTimeout(2500)
const shot = async (n) => { await page.waitForTimeout(400); await page.screenshot({ path: OUT+'/'+n+'.png' }); console.log('saved', n) }

console.log('--- запросы к API:')
for (const r of [...new Set(reqs)]) console.log('   ', r)

console.log('--- главная:')
console.log('   итог:', (await page.locator('.amount.hero').innerText()).replace(/\s+/g,' '))
console.log('   строка:', (await page.locator('.hero-split').innerText()).replace(/\s+/g,' '))
console.log('   подсказка:', await page.locator('.insight-text').innerText())
await shot('e1-home-server')

await page.locator('.tab', { hasText: 'Ещё' }).first().click()
await page.getByRole('button', { name: 'Данные' }).click()
await page.waitForTimeout(600)
console.log('--- источник данных:', await page.locator('.chip.on, .chip.warn').first().innerText())
await shot('e2-more-server')

if (errors.length) { console.log('--- ОШИБКИ:'); errors.slice(0,8).forEach(e => console.log('   ', e)) }
else console.log('--- ошибок в консоли нет')
await browser.close()
