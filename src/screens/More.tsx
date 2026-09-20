import React, { useMemo, useRef, useState } from 'react'
import { useApp } from '../store'
import { fmt } from '../engine/money'
import { Icon } from '../ui/kit'
import { accountState, expenses, fmtDate, income, monthRange } from '../engine/analytics'
import { buildDemoTransactions, toCsv } from '../data/demo'
import { LLM_PRESETS } from '../engine/llm'

const fieldStyle: React.CSSProperties = {
  width: '100%', padding: '10px 12px', borderRadius: 12, marginBottom: 8,
  background: 'var(--surface-2)', border: '1px solid var(--line)',
  color: 'var(--text)', fontSize: 13, outline: 'none',
}

export default function More({ onImport }: { onImport: () => void }) {
  const app = useApp()
  const [tab, setTab] = useState<'accounts' | 'debts' | 'data'>('accounts')

  const states = useMemo(
    () => accountState(app.movements, app.accounts, app.today),
    [app.movements, app.accounts, app.today],
  )
  const open = app.receivables.filter(r => r.settledMinor < r.originalMinor)
  const closed = app.receivables.filter(r => r.settledMinor >= r.originalMinor)
  const month = monthRange(app.today)
  const activePreset = LLM_PRESETS.find(x => x.authScheme === app.llm.authScheme) ?? LLM_PRESETS[0]
  const fileRef = useRef<HTMLInputElement>(null)
  const [imported, setImported] = useState<string | null>(null)

  // Сверка: то, что показывает экран, против того, что считает сервер
  const clientExpenses = expenses(app.events, month)
  const clientIncome = income(app.events, month)
  const serverMatches = app.serverAnalytics
    ? clientExpenses === app.serverAnalytics.expenses_minor
      && clientIncome === app.serverAnalytics.income_minor
    : false

  const downloadCsv = () => {
    const blob = new Blob([toCsv(buildDemoTransactions())], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'demo.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <>
      <div className="head">
        <div>
          <h1>Ещё</h1>
          <div className="sub">Счета, долги и данные</div>
        </div>
      </div>

      <div className="seg" style={{ marginBottom: 12 }}>
        <button className={tab === 'accounts' ? 'on' : ''} onClick={() => setTab('accounts')}>Счета</button>
        <button className={tab === 'debts' ? 'on' : ''} onClick={() => setTab('debts')}>Долги</button>
        <button className={tab === 'data' ? 'on' : ''} onClick={() => setTab('data')}>Данные</button>
      </div>

      {tab === 'accounts' && (
        <>
          <div className="card">
            {states.map(s => (
              <div className="op" key={s.account.id}>
                <span className="ic">
                  <Icon name={s.account.kind === 'cash' ? 'wallet' : 'transfer'}
                    size={17} color={s.account.color} />
                </span>
                <span className="body">
                  <span className="t">{s.account.name}</span>
                  <span className="m">
                    {s.balanceKnown ? 'расчётный остаток' : 'начальный остаток неизвестен'}
                  </span>
                </span>
                <span className="v">
                  {s.balanceKnown
                    ? fmt(s.balanceMinor!, { kop: false })
                    : fmt(s.changeMinor, { kop: false, sign: true })}
                  <small>{s.balanceKnown ? 'остаток' : 'изменение'}</small>
                </span>
              </div>
            ))}
          </div>
          <div className="note">
            Там, где банк не сообщил начальный остаток, показано <b>изменение по загруженным
            операциям</b>, а не баланс. Пустое место — это отсутствие данных, а не ноль на счёте.
          </div>
        </>
      )}

      {tab === 'debts' && (
        <>
          <div className="card">
            <div className="label">Мне должны</div>
            <div className="amount" style={{ marginTop: 6 }}>
              {fmt(open.reduce((s, r) => s + r.originalMinor - r.settledMinor, 0), { kop: false })}
            </div>
            <div className="sub tiny" style={{ marginTop: 6 }}>
              Остаток на {fmtDate(app.today)}. К доступным деньгам не прибавляется.
            </div>
          </div>

          {open.length > 0 && (
            <div className="card">
              <div className="label" style={{ marginBottom: 4 }}>Открытые</div>
              {open.map(r => (
                <div className="op" key={r.id}>
                  <span className="ic"><Icon name="debt" size={17} color="var(--danger)" /></span>
                  <span className="body">
                    <span className="t">{r.participant}</span>
                    <span className="m">
                      с {fmtDate(r.createdDate)} · вернул {fmt(r.settledMinor, { kop: false })}
                    </span>
                  </span>
                  <span className="v">{fmt(r.originalMinor - r.settledMinor, { kop: false })}
                    <small>остаток</small></span>
                </div>
              ))}
            </div>
          )}

          {closed.length > 0 && (
            <div className="card">
              <div className="label" style={{ marginBottom: 4 }}>Закрытые</div>
              {closed.map(r => (
                <div className="op" key={r.id}>
                  <span className="ic"><Icon name="check" size={17} color="var(--accent)" /></span>
                  <span className="body">
                    <span className="t">{r.participant}</span>
                    <span className="m">с {fmtDate(r.createdDate)} · вернул полностью</span>
                  </span>
                  <span className="v">{fmt(r.originalMinor, { kop: false })}<small>закрыт</small></span>
                </div>
              ))}
            </div>
          )}

          {app.receivables.length === 0 && (
            <div className="empty">Долгов нет. Отметьте перевод человеку как «Дал в долг»,
              и он появится здесь.</div>
          )}
        </>
      )}

      {tab === 'data' && (
        <>
          <div className="card">
            <div className="row between">
              <div className="label">Источник данных</div>
              <span className={'chip' + (app.mode === 'server' ? ' on' : ' warn')}>
                {app.mode === 'server' ? 'сервер' : app.mode === 'loading' ? 'подключение' : 'офлайн'}
              </span>
            </div>
            <div className="sub tiny" style={{ marginTop: 8, lineHeight: 1.5 }}>
              {app.mode === 'server'
                ? 'Все операции, решения и долги хранит API на ' + app.apiBase
                  + '. Цифры на экранах считаются из его данных.'
                : 'API недоступен, работает встроенный демо-набор в браузере. '
                  + 'Решения сохраняются локально и на сервер не уходят.'}
            </div>
            {app.mode !== 'server' && (
              <button className="btn ghost sm" style={{ marginTop: 12 }}
                disabled={app.busy} onClick={app.reconnect}>
                Подключиться заново
              </button>
            )}
          </div>

          {app.mode === 'server' && (
            <div className="card">
              <div className="label" style={{ marginBottom: 10 }}>Импорт выписки</div>
              <button className="btn ghost sm" onClick={onImport}>Загрузить файл</button>
              <div className="sub tiny" style={{ marginTop: 8, lineHeight: 1.5 }}>
                CSV до 10 МБ. Сначала предпросмотр с числом новых строк и дублей,
                запись — только после подтверждения.
              </div>
            </div>
          )}

          {app.serverAnalytics && (
            <div className="card">
              <div className="row between">
                <div className="label">Сверка с сервером · сентябрь</div>
                <span className={'chip' + (serverMatches ? ' on' : ' warn')}>
                  {serverMatches ? 'сходится' : 'расхождение'}
                </span>
              </div>
              <div className="row between" style={{ marginTop: 10 }}>
                <span className="sub tiny" style={{ margin: 0 }}>Расходы: экран / сервер</span>
                <span style={{ fontWeight: 600 }}>
                  {fmt(clientExpenses, { kop: false })} / {fmt(app.serverAnalytics.expenses_minor, { kop: false })}
                </span>
              </div>
              <div className="row between" style={{ marginTop: 6 }}>
                <span className="sub tiny" style={{ margin: 0 }}>Доходы: экран / сервер</span>
                <span style={{ fontWeight: 600 }}>
                  {fmt(clientIncome, { kop: false })} / {fmt(app.serverAnalytics.income_minor, { kop: false })}
                </span>
              </div>
            </div>
          )}

          <div className="card">
            <div className="label">Покрытие данных</div>
            <div className="sub tiny" style={{ marginTop: 6, lineHeight: 1.5 }}>
              Загружено {app.rawCount} банковских записей.
              Последняя операция — {fmtDate(app.events[0]?.date ?? app.today)}.
            </div>
            <div className="divider" />
            <div className="row between">
              <span className="sub tiny" style={{ margin: 0 }}>Демонстрационная дата</span>
              <span className="chip on">{fmtDate(app.today)}</span>
            </div>
            <div className="sub tiny" style={{ marginTop: 8 }}>
              Дата задана демо-набором и не подменяет системную дату скрыто.
            </div>
          </div>

          <div className="card">
            <div className="label">Контрольные суммы · {month.label}</div>
            <div className="note" style={{ marginTop: 8 }}>
              Эталонные значения из ТЗ: расходы <b>8 600 ₽</b>, доходы <b>22 000 ₽</b>,
              неразобранные входящие <b>500 ₽</b>, наличные <b>4 300 ₽</b>, открытые долги <b>0 ₽</b>.
              Приложение считает их из событий, а не хранит готовыми.
            </div>
          </div>

          <div className="card">
            <div className="label" style={{ marginBottom: 10 }}>Разбор</div>
            <button className="btn ghost sm" onClick={app.resetReview}>
              Пройти разбор заново
            </button>
            <div className="sub tiny" style={{ margin: '8px 0 12px' }}>
              Снимает все решения и возвращает вопросы в очередь — удобно показывать вживую.
            </div>
            <button className="btn ghost sm" onClick={app.restoreReference}>
              Вернуть эталонное состояние
            </button>
          </div>

          <div className="card">
            <div className="row between">
              <div className="label">Языковая модель</div>
              <button
                className={'chip' + (app.llm.enabled ? ' on' : '')}
                onClick={() => app.setLlm({ ...app.llm, enabled: !app.llm.enabled })}>
                {app.llm.enabled ? 'включена' : 'выключена'}
              </button>
            </div>
            <div className="sub tiny" style={{ marginTop: 8, lineHeight: 1.5 }}>
              Модель только формулирует фразы: разбирает текст в чате и подписывает подсказку
              на главной. Суммы и связи она не считает — без неё приложение работает полностью.
            </div>
            {app.llm.enabled && (
              <div style={{ marginTop: 12 }}>
                <div className="label" style={{ marginBottom: 6 }}>Провайдер</div>
                <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
                  {LLM_PRESETS.map(preset => (
                    <button
                      key={preset.id}
                      className={'chip' + (app.llm.authScheme === preset.authScheme ? ' on' : '')}
                      onClick={() => app.setLlm({
                        ...app.llm,
                        baseUrl: preset.baseUrl,
                        authScheme: preset.authScheme,
                        model: preset.model,
                      })}>
                      {preset.title}
                    </button>
                  ))}
                </div>
                <input
                  value={app.llm.baseUrl}
                  onChange={e => app.setLlm({ ...app.llm, baseUrl: e.target.value })}
                  placeholder="https://api.openai.com/v1"
                  aria-label="Адрес API"
                  style={fieldStyle} />
                <input
                  value={app.llm.model}
                  onChange={e => app.setLlm({ ...app.llm, model: e.target.value })}
                  placeholder={activePreset.modelHint}
                  aria-label="Название модели"
                  style={fieldStyle} />
                <input
                  type="password"
                  value={app.llm.apiKey}
                  onChange={e => app.setLlm({ ...app.llm, apiKey: e.target.value })}
                  placeholder="API-ключ"
                  aria-label="Ключ API"
                  style={fieldStyle} />
                <div className="note" style={{ marginTop: 4 }}>
                  Заголовок авторизации: <b>{app.llm.authScheme === 'api-key' ? 'Api-Key' : 'Bearer'}</b>.
                  {!activePreset.vision && ' Чтение чеков с изображения этот провайдер не поддерживает — вкладка «Чек» предложит ввести сумму вручную.'}
                </div>
                <div className="note" style={{ marginTop: 8 }}>
                  Ключ хранится <b>в этом браузере</b> и на сервер приложения не уходит.
                  Для продакшена ключ обязан жить на бэкенде — у фронтенда своего хранилища секретов нет.
                </div>
              </div>
            )}
          </div>

          <div className="card">
            <div className="label" style={{ marginBottom: 10 }}>Демо-набор</div>
            <button className="btn ghost sm" onClick={downloadCsv}>Скачать demo.csv</button>
            <div className="sub tiny" style={{ marginTop: 8 }}>
              Тот же набор, на котором идёт демонстрация: 69 банковских записей
              и одна ручная наличная покупка.
            </div>
          </div>

          <div className="note">
            Операции и решения хранятся только в этом браузере.
            {app.llm.enabled && app.llm.apiKey
              ? ' Исключение — включённая модель: ей уходит текст вашего сообщения и уже'
                + ' посчитанные итоги периода. Номера счетов, контрагенты и список операций не передаются.'
              : ' Ни одна операция не уходит на сервер.'}
          </div>
        </>
      )}
    </>
  )
}
