import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import workerSrc from 'pdfjs-dist/legacy/build/pdf.worker.mjs?url'

GlobalWorkerOptions.workerSrc = workerSrc

export async function pdfToText(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const loading = getDocument({ data: bytes })
  const doc = await loading.promise
  const pages: string[] = []

  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    const content = await page.getTextContent()
    const tokens = content.items
      .map((item: any) => (typeof item?.str === 'string' ? item.str : ''))
      .filter(Boolean)
    pages.push(tokens.join(' '))
  }

  const text = pages.join('\n').trim()
  if (!text) throw new Error('PDF не содержит текстового слоя')
  return text
}
