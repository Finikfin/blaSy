import React, { useEffect, useRef, useState } from 'react'
import { useApp } from '../store'
import { Icon } from '../ui/kit'
import { fmt } from '../engine/money'
import { CATEGORY_TITLE } from '../engine/types'
import { answer, QUICK_CHIPS, type AssistantReply } from '../engine/assistant'
import { resolveIntent } from '../engine/llm'

type Msg = {
  id: number
  role: 'user' | 'bot'
  text: string
  reply?: AssistantReply
  source?: 'local' | 'model'
  done?: string
}

let seq = 0

export default function Chat({ go, onClose, onOpenPad }: {
  go: (tab: string) => void
  onClose: () => void
  onOpenPad: () => void
}) {
  const app = useApp()
  const [msgs, setMsgs] = useState<Msg[]>([{
    id: ++seq, role: 'bot',
    text: 'Спросите про цифры или продиктуйте трату наличными.\nНапример: «400 кофе» или «сколько я потратил на этой неделе».',
  }])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [msgs])

  const send = async (text: string) => {
    const t = text.trim()
    if (!t || busy) return
    setInput('')
    setMsgs(m => [...m, { id: ++seq, role: 'user', text: t }])
    setBusy(true)
    const { intent, source } = await resolveIntent(t, app.llm)
    const reply = answer(intent, {
      today: app.today,
      events: app.events,
      receivables: app.receivables,
      openQuestions: app.openQuestions.length,
    })
    setMsgs(m => [...m, { id: ++seq, role: 'bot', text: reply.text, reply, source }])
    setBusy(false)
  }

  const confirmDraft = (msgId: number, draft: NonNullable<AssistantReply['draft']>) => {
    app.addManual({
      id: 'M' + Date.now(),
      accountId: app.accounts.find(a => a.kind === 'cash')!.id,
      date: app.today,
      amountMinor: -draft.amountMinor,
      description: draft.title,
      category: draft.category,
    })
    setMsgs(m => m.map(x => x.id === msgId
      ? { ...x, reply: undefined, done: 'Записано: ' + draft.title + ' · ' + fmt(draft.amountMinor) }
      : x))
  }

  return (
    <div style={{
      position: 'absolute', inset: 0, zIndex: 45, background: 'var(--bg)',
      display: 'flex', flexDirection: 'column',
    }}>
      <div className="row between" style={{ padding: '14px 18px 10px', flex: 'none' }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700 }}>Помощник</div>
          <div className="sub tiny">
            {app.llm.enabled && app.llm.apiKey ? 'модель включена' : 'работает офлайн'}
          </div>
        </div>
        <button className="chip" onClick={onClose}>Закрыть</button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '4px 18px 10px' }}>
        {msgs.map(m => (
          <div key={m.id} style={{
            display: 'flex',
            justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start',
            marginBottom: 10,
          }}>
            <div style={{
              maxWidth: '86%',
              padding: '11px 13px',
              borderRadius: m.role === 'user' ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
              background: m.role === 'user' ? 'var(--accent)' : 'var(--surface)',
              color: m.role === 'user' ? '#0A0A0A' : 'var(--text)',
              border: m.role === 'user' ? 'none' : '1px solid var(--line)',
              fontSize: 13, lineHeight: 1.5, whiteSpace: 'pre-wrap',
            }}>
              {m.text}

              {m.reply?.draft && (
                <div style={{ marginTop: 10 }}>
                  <div className="row" style={{ gap: 8 }}>
                    <button className="btn sm" style={{ flex: 1 }}
                      onClick={() => confirmDraft(m.id, m.reply!.draft!)}>
                      Записать
                    </button>
                    <button className="btn ghost sm" style={{ flex: 1 }}
                      onClick={() => setMsgs(x => x.map(y =>
                        y.id === m.id ? { ...y, reply: undefined, done: 'Отменено' } : y))}>
                      Отмена
                    </button>
                  </div>
                  <div className="sub tiny" style={{ marginTop: 8 }}>
                    Категория «{CATEGORY_TITLE[m.reply.draft.category]}» — можно поменять после записи
                    в карточке операции.
                  </div>
                </div>
              )}

              {m.done && (
                <div className="sub tiny" style={{ marginTop: 8, color: 'var(--accent)' }}>{m.done}</div>
              )}

              {m.reply?.goto && !m.reply.draft && (
                <button className="btn ghost sm" style={{ marginTop: 10 }}
                  onClick={() => { go(m.reply!.goto!); onClose() }}>
                  {m.reply.gotoLabel}
                </button>
              )}

              {m.role === 'bot' && m.source === 'model' && (
                <div className="sub tiny" style={{ marginTop: 6 }}>
                  фразу разобрала модель · цифры посчитаны приложением
                </div>
              )}
            </div>
          </div>
        ))}
        {busy && <div className="sub tiny">думаю…</div>}
        <div ref={endRef} />
      </div>

      <div style={{ flex: 'none', padding: '0 18px 18px' }}>
        <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 10 }}>
          <button className="chip" onClick={onOpenPad}>Ввести цифрами</button>
          {QUICK_CHIPS.map(c => (
            <button key={c} className="chip" onClick={() => send(c)}>{c}</button>
          ))}
        </div>
        <form
          onSubmit={e => { e.preventDefault(); send(input) }}
          style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="Сообщение"
            aria-label="Сообщение помощнику"
            style={{
              flex: 1, padding: '13px 15px', borderRadius: 999,
              background: 'var(--surface)', border: '1px solid var(--line)',
              color: 'var(--text)', fontSize: 13, outline: 'none',
            }} />
          <button type="submit" aria-label="Отправить"
            style={{
              width: 44, height: 44, borderRadius: 999, flex: 'none',
              background: 'var(--accent)', display: 'grid', placeItems: 'center',
            }}>
            <Icon name="arrow" size={19} color="#0A0A0A" width={2.2} />
          </button>
        </form>
      </div>
    </div>
  )
}
