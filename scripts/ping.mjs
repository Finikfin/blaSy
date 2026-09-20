import { chromium } from 'playwright'
const b = await chromium.launch()
const p = await b.newPage()
p.on('requestfailed', r => console.log('НЕ УДАЛСЯ:', r.url(), r.failure()?.errorText))
await p.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' })
await p.waitForTimeout(3000)
await b.close()
console.log('страница загружена')
