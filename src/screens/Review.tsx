import React from 'react'
import { useApp, SESSION_LIMIT } from '../store'
import { fmt } from '../engine/money'
import { Icon } from '../ui/kit'

export default function Review({ go }: { go: (tab: string) => void }) {
  const app = useApp()
  const remaining = app.openQuestions.length
  const limitReached = !app.unlocked && app.sessionCount >= SESSION_LIMIT

  return (
    <>
      <div className="head">
        <div>
          <h1>Разбор</h1>
          <div className="sub">
            {remaining ? 'Открытых вопросов: ' + remaining : 'Открытых вопросов нет'}
          </div>
        </div>
        <span className="chip">{app.sessionCount} / {SESSION_LIMIT}</span>
      </div>

      {remaining === 0 && (
        <div className="card">
          <div className="row" style={{ gap: 12 }}>
            <span className="ic" style={{
              width: 38, height: 38, borderRadius: 12, background: 'var(--accent)',
              display: 'grid', placeItems: 'center', flex: 'none',
            }}>
              <Icon name="check" size={18} color="#0A0A0A" width={2.4} />
            </span>
            <div>
              <div style={{ fontSize: 15, fontWeight: 600 }}>Всё разобрано</div>
              <div className="sub tiny" style={{ marginTop: 3 }}>
                Каждая операция получила подтверждённую трактовку.
              </div>
            </div>
          </div>
          <button className="btn sm" style={{ marginTop: 14 }} onClick={() => go('analytics')}>
            Открыть итоги
          </button>
        </div>
      )}

      {app.proposed.map(q => (
        <div className="q" key={q.id}>
          <div className="row between" style={{ marginBottom: 8 }}>
            <span className="label">
              {q.changesTotals ? 'Меняет итог' : 'Не меняет итог'}
            </span>
            <span className="chip">
              {q.impactIsVolume ? 'объём ' : 'до '}{fmt(Math.abs(q.impactMinor), { kop: false })}
            </span>
          </div>
          <h3>{q.title}</h3>
          <div className="sub tiny" style={{ marginTop: 5 }}>{q.body}</div>
          {q.options.map(o => (
            <button className="opt" key={o.id} onClick={() => app.decide(q.id, o.id)}>
              <div className="ol">{o.label}{o.hint ? ' · ' + o.hint : ''}</div>
              {o.effectNote && <div className="oe">{o.effectNote}</div>}
            </button>
          ))}
        </div>
      ))}

      {limitReached && remaining > 0 && (
        <div className="card">
          <div style={{ fontSize: 15, fontWeight: 600 }}>Основное разобрали</div>
          <div className="sub tiny" style={{ marginTop: 6, lineHeight: 1.5 }}>
            Осталось {remaining} {remaining === 1 ? 'вопрос' : 'вопросов'} — можно вернуться позже.
            Мы не показываем больше трёх карточек за сессию, чтобы разбор не превращался в работу.
          </div>
          <button className="btn ghost sm" style={{ marginTop: 12 }} onClick={app.unlockQueue}>
            Разобрать ещё
          </button>
        </div>
      )}

      {Object.keys(app.snoozed).length > 0 && (
        <div className="note" style={{ marginTop: 6 }}>
          Отложенные вопросы никуда не делись: они остаются в полной очереди и не меняют
          классификацию операций.
        </div>
      )}
    </>
  )
}
