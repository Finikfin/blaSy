import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
const API='http://127.0.0.1:8123'
const stats = async () => {
  const t = await (await fetch(API+'/api/transactions?page=1&page_size=1')).json()
  const a = await (await fetch(API+'/api/analytics?from=2026-09-01&to=2026-09-30&grouping=month')).json()
  return { событий: t.total, расходы: a.expenses_minor/100 }
}
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1200, height: 950 } })
const sent = []
p.on('request', r => { if (r.url().includes('/api/imports')) sent.push(r.method()+' '+r.url().replace(API,'')) })
await p.addInitScript(() => localStorage.clear())
await p.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' })
await p.waitForTimeout(2500)
console.log('до :', await stats())

await p.getByRole('button', { name: /Загрузить выписку/ }).click()
await p.waitForTimeout(600)
const csv = readFileSync('scripts/demo-upload.csv','utf8')
await p.evaluate(async (text) => {
  const dt = new DataTransfer()
  dt.items.add(new File([text], 'moi-raskhody.csv', { type: 'text/csv' }))
  const z = document.querySelector('.dropzone')
  z.dispatchEvent(new DragEvent('dragover',{dataTransfer:dt,bubbles:true}))
  await new Promise(r=>setTimeout(r,200))
  z.dispatchEvent(new DragEvent('drop',{dataTransfer:dt,bubbles:true}))
}, csv)
await p.waitForTimeout(2500)
console.log('предпросмотр:', (await p.locator('.chip').allInnerTexts()).filter(c=>/новых|дублей/.test(c)).join(' | '))
await p.getByRole('button', { name: /Импортировать/ }).click()
await p.waitForTimeout(3500)
console.log('результат   :', await p.locator('.note').first().innerText())
console.log('после:', await stats())
console.log('запросы фронта:', sent.join(' | '))
await p.getByRole('button', { name: 'Закрыть' }).click()
await p.waitForTimeout(800)
await p.locator('.tab', { hasText: 'Операции' }).first().click()
await p.waitForTimeout(1200)
await p.getByPlaceholder('Поиск по описанию').fill('Даблби')
await p.waitForTimeout(800)
console.log('в списке операций:', (await p.locator('.op .t').allInnerTexts()).join(', ') || 'не найдено')
await p.screenshot({ path: 'scripts/shots/i1-uploaded.png' })
await b.close()
