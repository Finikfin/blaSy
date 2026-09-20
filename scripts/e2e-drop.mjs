import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1200, height: 950 } })
const errs = []
p.on('pageerror', e => errs.push(e.message))
await p.addInitScript(() => localStorage.clear())
await p.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' })
await p.waitForTimeout(2500)

console.log('ссылки на главной:', (await p.locator('.quietlink').allInnerTexts()).map(t => t.trim()).join(' | '))
await p.screenshot({ path: 'scripts/shots/h1-home-import-link.png' })

await p.getByRole('button', { name: /Загрузить выписку/ }).click()
await p.waitForTimeout(700)
console.log('зона загрузки:', await p.locator('.dz-title').innerText())
await p.screenshot({ path: 'scripts/shots/h2-dropzone.png' })

// эмулируем перетаскивание файла
const csv = readFileSync('backend/fixtures/demo-first.csv', 'utf8')
await p.evaluate(async (text) => {
  const dt = new DataTransfer()
  dt.items.add(new File([text], 'demo-first.csv', { type: 'text/csv' }))
  const zone = document.querySelector('.dropzone')
  zone.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true }))
  await new Promise(r => setTimeout(r, 300))
  zone.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true }))
}, csv)
await p.waitForTimeout(3000)
const chips = (await p.locator('.chip').allInnerTexts()).filter(c => /новых|дублей|ошибок/.test(c))
console.log('после перетаскивания:', chips.join(' | ') || 'предпросмотр не появился')
await p.screenshot({ path: 'scripts/shots/h3-dropped.png' })
console.log(errs.length ? 'ОШИБКИ: ' + errs.slice(0,3).join(' | ') : 'ошибок нет')
await b.close()
