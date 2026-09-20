import React, { useRef, useState } from 'react'
import { useApp } from '../store'
import { fmt } from '../engine/money'
import { Icon } from '../ui/kit'
import { CATEGORY_TITLE, type CategoryId } from '../engine/types'
import { readReceipt, type ReceiptDraft } from '../engine/llm'

type Tab = 'pdf' | 'photo'

/**
 * Загрузка операций. PDF идёт через серверный предпросмотр без записи,
 * затем пользователь явно подтверждает импорт.
 *
 * Фото чека ТЗ относит к нерешаемому в MVP (§2.3), поэтому оно не
 * притворяется импортом выписки: модель предлагает черновик, а операция
 * создаётся обычной ручной наличной тратой по кнопке пользователя.
 */
export default function Import({ onClose }: { onClose: () => void }) {
  const app = useApp()
  const [tab, setTab] = useState<Tab>('pdf')

  const pdfRef = useRef<HTMLInputElement>(null)
  const photoRef = useRef<HTMLInputElement>(null)

  const [fileName, setFileName] = useState('')
  const [result, setResult] = useState<string | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [preview, setPreview] = useState<any>(null)

  const [photoUrl, setPhotoUrl] = useState<string | null>(null)
  const [draft, setDraft] = useState<ReceiptDraft | null>(null)
  const [reading, setReading] = useState(false)
  const [photoNote, setPhotoNote] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)

  const modelReady = app.llm.enabled && Boolean(app.llm.apiKey)

  const pickPdf = async (file: File) => {
    setFailure(null)
    setResult(null)
    setPreview(null)
    setFileName(file.name)
    try {
      const response = await app.previewCsv(file)
      setPreview(response)
      if (!response.rows.length) setFailure('В PDF не найдены операции. Проверьте текстовый слой и формат выписки.')
    } catch (e) {
      setFailure(e instanceof Error ? e.message : 'Не удалось прочитать файл')
    }
  }

  const importPdf = async () => {
    if (!preview?.counts.new) return
    try {
      const result = await app.commitCsv(preview.preview_id, preview.counts.errors > 0)
      setResult(`Импортировано ${result.new} операций, дублей ${result.duplicate}`)
      setPreview(null)
    } catch (e) {
      setFailure(e instanceof Error ? e.message : 'Не удалось импортировать операции')
    }
  }

  const pickPhoto = async (file: File) => {
    setPhotoNote(null); setDraft(null)
    setPhotoUrl(URL.createObjectURL(file))
    if (!modelReady) {
      setPhotoNote('Чтобы прочитать сумму с изображения, включите модель в «Ещё → Данные». '
        + 'Без неё сумму придётся ввести вручную — приложение не станет её угадывать.')
      return
    }
    setReading(true)
    try {
      const got = await readReceipt(file, app.llm)
      if (!got) setPhotoNote('Модель не ответила. Сумму можно ввести вручную.')
      else if (!got.confident) {
        setDraft(got)
        setPhotoNote('Сумма распозналась неуверенно — проверьте её перед записью.')
      } else setDraft(got)
    } catch (e) {
      setPhotoNote(e instanceof Error ? e.message : 'Не удалось прочитать изображение')
    } finally {
      setReading(false)
    }
  }

  const saveDraft = async () => {
    if (!draft || draft.amountMinor <= 0) return
    await app.addManual({
      id: 'M' + Date.now(),
      accountId: app.accounts.find(a => a.kind === 'cash')?.id ?? 'cash',
      date: app.today,
      amountMinor: -draft.amountMinor,
      description: draft.merchant || CATEGORY_TITLE[draft.category],
      category: draft.category,
    })
    setResult('Записана трата ' + fmt(draft.amountMinor) + ' · ' + (draft.merchant || 'наличные'))
    setDraft(null)
    setPhotoUrl(null)
  }

  return (
    <div className="sheet-full">
      <div className="row between" style={{ padding: '14px 18px 10px', flex: 'none' }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700 }}>Загрузить операции</div>
          <div className="sub tiny">
            {app.mode === 'server' ? 'выписка уходит на сервер' : 'сервер недоступен'}
          </div>
        </div>
        <button className="chip" onClick={onClose}>Закрыть</button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '4px 18px 22px' }}>
        <div className="seg" style={{ marginBottom: 14 }}>
          <button className={tab === 'pdf' ? 'on' : ''} onClick={() => setTab('pdf')}>Выписка PDF</button>
          <button className={tab === 'photo' ? 'on' : ''} onClick={() => setTab('photo')}>Чек или скриншот</button>
        </div>

        {result && <div className="note" style={{ marginBottom: 10, color: 'var(--accent)' }}>{result}</div>}
        {failure && <div className="note" style={{ marginBottom: 10, color: 'var(--danger)' }}>{failure}</div>}

        {tab === 'pdf' && (
          <>
            <input ref={pdfRef} type="file" accept=".pdf,application/pdf" style={{ display: 'none' }}
              onChange={e => {
                const f = e.target.files?.[0]; e.target.value = ''
                if (f) pickPdf(f)
              }} />

            <button
              className={'dropzone' + (dragging ? ' over' : '')}
              disabled={app.busy || app.mode !== 'server'}
              onClick={() => pdfRef.current?.click()}
              onDragOver={e => { e.preventDefault(); setDragging(true) }}
              onDragLeave={() => setDragging(false)}
              onDrop={e => {
                e.preventDefault()
                setDragging(false)
                const f = e.dataTransfer.files?.[0]
                if (f) pickPdf(f)
              }}>
              <Icon name="list" size={22} color="var(--accent)" />
              <span className="dz-title">
                {app.busy ? 'Читаю выписку…' : dragging ? 'Отпустите файл' : 'Перетащите PDF сюда'}
              </span>
              <span className="dz-note">
                или нажмите, чтобы выбрать · сервер извлечёт текст и покажет операции
              </span>
            </button>

            {app.mode !== 'server' && (
              <div className="note">
                Отправка текста работает только при подключении к серверу.
              </div>
            )}

            {preview && (
              <>
                <div className="card">
                  <div className="label">{fileName}</div>
                  <div className="row" style={{ gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
                    <span className="chip on">новых {preview.counts.new}</span>
                    <span className="chip">дублей {preview.counts.duplicate}</span>
                    <span className="chip">ошибок {preview.counts.errors}</span>
                  </div>
                </div>

                <div className="card">
                  <div className="label" style={{ marginBottom: 6 }}>Операции для проверки</div>
                  {preview.rows.map((item: any, i: number) => (
                    <div className="op" key={i}>
                      <span className="body">
                        <span className="t">{item.description}</span>
                        <span className="m">{item.booking_date} · {item.account_id} · {item.status}</span>
                      </span>
                      <span className="v">{fmt(item.amount_minor)}</span>
                    </div>
                  ))}
                  {preview.errors.slice(0, 5).map((error: any, i: number) => (
                    <div className="note" key={i}>Строка {error.row}: {error.message}</div>
                  ))}
                </div>
                {preview.counts.new > 0 && <button className="btn" disabled={app.busy || preview.counts.conflict > 0}
                  onClick={importPdf}>Импортировать {preview.counts.new} операций</button>}
                <button className="btn ghost sm" style={{ marginTop: 8 }}
                  onClick={() => {
                    setFileName('')
                    setPreview(null)
                  }}>
                  Очистить
                </button>
              </>
            )}
          </>
        )}

        {tab === 'photo' && (
          <>
            <input ref={photoRef} type="file" accept="image/*" style={{ display: 'none' }}
              onChange={e => {
                const f = e.target.files?.[0]; e.target.value = ''
                if (f) pickPhoto(f)
              }} />

            <button
              className={'dropzone' + (dragging ? ' over' : '')}
              disabled={reading}
              onClick={() => photoRef.current?.click()}
              onDragOver={e => { e.preventDefault(); setDragging(true) }}
              onDragLeave={() => setDragging(false)}
              onDrop={e => {
                e.preventDefault()
                setDragging(false)
                const f = e.dataTransfer.files?.[0]
                if (f) pickPhoto(f)
              }}>
              <Icon name="wallet" size={22} color="var(--accent)" />
              <span className="dz-title">
                {reading ? 'Читаю изображение…' : dragging ? 'Отпустите файл' : 'Перетащите чек или скриншот'}
              </span>
              <span className="dz-note">
                {modelReady ? 'сумму прочитает модель, записывать будете вы' : 'модель выключена — сумму введёте вручную'}
              </span>
            </button>

            {photoUrl && (
              <div className="card" style={{ padding: 8 }}>
                <img src={photoUrl} alt="Загруженный чек"
                  style={{ width: '100%', borderRadius: 12, display: 'block' }} />
              </div>
            )}

            {photoNote && <div className="note">{photoNote}</div>}

            {draft && (
              <div className="card">
                <div className="label">Черновик операции</div>
                <div className="amount sm" style={{ marginTop: 8 }}>
                  {fmt(draft.amountMinor)}
                </div>
                <input
                  value={draft.merchant}
                  onChange={e => setDraft({ ...draft, merchant: e.target.value })}
                  placeholder="Где потратили"
                  aria-label="Продавец"
                  style={fieldStyle} />
                <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 10 }}>
                  {(['groceries', 'restaurants', 'transport', 'electronics', 'health', 'other'] as CategoryId[])
                    .map(c => (
                      <button key={c} className={'chip' + (draft.category === c ? ' on' : '')}
                        onClick={() => setDraft({ ...draft, category: c })}>
                        {CATEGORY_TITLE[c]}
                      </button>
                    ))}
                </div>
                <button className="btn" disabled={app.busy || draft.amountMinor <= 0} onClick={saveDraft}>
                  Записать трату
                </button>
                <div className="sub tiny" style={{ marginTop: 10, lineHeight: 1.5 }}>
                  Это ручная наличная операция, а не строка выписки: банковской записи для неё
                  не существует, и дедупликации с выпиской не будет.
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

const fieldStyle: React.CSSProperties = {
  width: '100%', padding: '10px 12px', borderRadius: 12, margin: '10px 0',
  background: 'var(--surface-2)', border: '1px solid var(--line)',
  color: 'var(--text)', fontSize: 13, outline: 'none',
}
