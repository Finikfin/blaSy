import React, {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react'
import type {
  Account, CategoryId, EconomicEvent, Movement, Question, Receivable,
} from './engine/types'
import { classify, DEMO_DECISIONS, type Decisions, type ManualEntry } from './engine/classify'
import { ACCOUNTS, DEMO_TODAY, buildDemoTransactions, MANUAL_CASH_PURCHASE } from './data/demo'
import { DEFAULT_LLM, type LlmSettings } from './engine/llm'
import { api, ApiError, API_BASE, type SrvAnalytics } from './api/client'
import { adaptAccounts, adaptEvent, adaptQuestion, adaptReceivable } from './api/adapt'

const KEY = 'honest-month-v1'

/** §9.3 — бюджет внимания: не более трёх предложенных карточек за сессию. */
export const SESSION_LIMIT = 3

/**
 * Источник данных.
 * server — единственный источник истины, все решения уходят на бэкенд.
 * local  — запасной путь, если API недоступен: демо считается в браузере,
 *          чтобы демонстрация не падала вместе с сервером.
 */
export type Mode = 'loading' | 'server' | 'local'

type Local = {
  decisions: Decisions
  snoozed: Record<string, string>
  session: { shown: string[]; count: number }
  weeklySeenAt: string | null
  manual: ManualEntry[]
  llm: LlmSettings
}

const initialLocal: Local = {
  decisions: { ...DEMO_DECISIONS },
  snoozed: {},
  session: { shown: [], count: 0 },
  weeklySeenAt: null,
  manual: [{ ...MANUAL_CASH_PURCHASE }],
  llm: { ...DEFAULT_LLM },
}

function loadLocal(): Local {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? { ...initialLocal, ...JSON.parse(raw) } : initialLocal
  } catch {
    return initialLocal
  }
}
function saveLocal(p: Local) {
  try { localStorage.setItem(KEY, JSON.stringify(p)) } catch { /* приватный режим */ }
}

const newCommandId = () =>
  (crypto.randomUUID?.() ?? 'cmd-' + Date.now() + '-' + Math.random().toString(36).slice(2))

type ServerState = {
  accounts: Account[]
  events: EconomicEvent[]
  receivables: Receivable[]
  questions: Question[]
  recommended: string[]
  weeklySeenAt: string | null
  analytics: SrvAnalytics | null
  today: string
}

const emptyServer: ServerState = {
  accounts: [], events: [], receivables: [], questions: [],
  recommended: [], weeklySeenAt: null, analytics: null, today: DEMO_TODAY,
}

function useStore() {
  const [mode, setMode] = useState<Mode>('loading')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [srv, setSrv] = useState<ServerState>(emptyServer)
  const [local, setLocal] = useState<Local>(loadLocal)
  const [unlocked, setUnlocked] = useState(false)
  const [sessionCount, setSessionCount] = useState(0)
  const mounted = useRef(true)

  // В StrictMode эффекты вызываются дважды: флаг обязан подниматься заново,
  // иначе после повторного монтирования ответы сервера молча отбрасываются
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  const patchLocal = useCallback((p: Partial<Local>) => {
    setLocal(prev => { const next = { ...prev, ...p }; saveLocal(next); return next })
  }, [])

  // ── Загрузка с сервера ──────────────────────────────────────────────
  const refresh = useCallback(async () => {
    const [accountsRaw, txs, receivables, allQ, recQ] = await Promise.all([
      api.accounts(),
      api.allTransactions(),
      api.receivables(),
      api.questions('all'),
      api.questions('recommended'),
    ])
    const accounts = adaptAccounts(accountsRaw)
    const today = DEMO_TODAY
    let weeklySeenAt: string | null = null
    let analytics: SrvAnalytics | null = null
    try {
      const weekly = await api.weeklyReview(today)
      weeklySeenAt = weekly.seen_at
    } catch { /* сводка не критична для экрана итогов */ }
    try {
      analytics = await api.analytics(today.slice(0, 8) + '01', today, 'month')
    } catch { /* сверка не критична */ }

    if (!mounted.current) return
    setSrv({
      accounts,
      events: txs.items.map(e => adaptEvent(e, accounts)),
      receivables: receivables.map(adaptReceivable),
      questions: allQ.items
        .filter(q => q.status === 'open')
        .map(q => adaptQuestion(q, newCommandId)),
      recommended: recQ.items.map(q => q.id),
      weeklySeenAt,
      analytics,
      today,
    })
  }, [])

  // Первый запуск: пробуем сервер, при неудаче честно уходим в локальный режим
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        await api.health()
        await api.loadDemo().catch(() => { /* демо уже загружено */ })
        await refresh()
        if (!cancelled) { setMode('server'); setError(null) }
      } catch (e) {
        if (cancelled) return
        setMode('local')
        setError(e instanceof ApiError ? e.message : 'Сервер недоступен: ' + API_BASE)
      }
    })()
    return () => { cancelled = true }
  }, [refresh])

  const reconnect = useCallback(async () => {
    setBusy(true)
    try {
      await api.health()
      await refresh()
      setMode('server')
      setError(null)
    } catch {
      setError('Сервер по-прежнему недоступен: ' + API_BASE)
    } finally {
      setBusy(false)
    }
  }, [refresh])

  // ── Локальный расчёт (запасной путь) ────────────────────────────────
  const localModel = useMemo(
    () => classify(buildDemoTransactions(), ACCOUNTS, local.manual, local.decisions),
    [local.manual, local.decisions],
  )

  const onServer = mode === 'server'

  const accounts: Account[] = onServer ? srv.accounts : ACCOUNTS
  const events: EconomicEvent[] = onServer ? srv.events : localModel.events
  const receivables: Receivable[] = onServer ? srv.receivables : localModel.receivables
  const movements: Movement[] = useMemo(
    () => (onServer ? events.flatMap(e => e.movements) : localModel.movements),
    [onServer, events, localModel.movements],
  )

  const openQuestions = useMemo(() => (onServer
    ? srv.questions.filter(q => !local.snoozed[q.id])
    : localModel.questions.filter(q => !local.decisions[q.id])
  ), [onServer, srv.questions, localModel.questions, local.decisions, local.snoozed])

  const proposed = useMemo(() => {
    const fresh = openQuestions.filter(q => !local.snoozed[q.id])
    if (unlocked) return fresh
    if (onServer) {
      const byRank = fresh.filter(q => srv.recommended.includes(q.id))
      const list = byRank.length ? byRank : fresh
      return list.slice(0, Math.max(SESSION_LIMIT - sessionCount, 0))
    }
    return fresh.slice(0, Math.max(SESSION_LIMIT - local.session.count, 0))
  }, [openQuestions, local.snoozed, local.session.count, unlocked, onServer, srv.recommended, sessionCount])

  // ── Действия ────────────────────────────────────────────────────────

  /** Ответ на вопрос разбора. На сервере — атомарная команда с ревизией. */
  const decide = useCallback(async (questionId: string, optionId: string) => {
    if (optionId === 'later') {
      // §9.4 — «Позже» не меняет классификацию
      if (onServer) {
        setSessionCount(c => c + 1)
        try { await api.snoozeQuestion(questionId) } catch { /* остаётся в очереди */ }
        patchLocal({ snoozed: { ...local.snoozed, [questionId]: new Date().toISOString() } })
        await refresh()
        return
      }
      setLocal(prev => {
        const next = {
          ...prev,
          snoozed: { ...prev.snoozed, [questionId]: new Date().toISOString() },
          session: { shown: [...prev.session.shown, questionId], count: prev.session.count + 1 },
        }
        saveLocal(next)
        return next
      })
      return
    }

    if (!onServer) {
      setLocal(prev => {
        const next = {
          ...prev,
          decisions: { ...prev.decisions, [questionId]: optionId },
          session: { shown: [...prev.session.shown, questionId], count: prev.session.count + 1 },
        }
        saveLocal(next)
        return next
      })
      return
    }

    const question = srv.questions.find(q => q.id === questionId)
    const option = question?.options.find(o => o.id === optionId)
    if (!option?.payload) return
    setBusy(true)
    try {
      await api.answerQuestion(questionId, option.payload)
      setSessionCount(c => c + 1)
      setError(null)
      await refresh()
    } catch (e) {
      // Устаревшая ревизия: данные изменились в другой вкладке — перечитываем
      if (e instanceof ApiError && e.status === 409) {
        setError('Операция изменилась, карточка обновлена')
        await refresh()
      } else {
        setError(e instanceof ApiError ? e.message : 'Не удалось сохранить решение')
      }
    } finally {
      setBusy(false)
    }
  }, [onServer, srv.questions, refresh, local.snoozed, patchLocal])

  /** Отмена последнего решения по операции (§12.1). */
  const undoEvent = useCallback(async (event: EconomicEvent) => {
    if (!onServer) {
      const rawId = event.movements.find(m => m.id.startsWith('m_'))?.id.slice(2)
      const key = Object.keys(local.decisions).find(k => rawId && k.endsWith('_' + rawId))
      if (!key) return
      setLocal(prev => {
        const decisions = { ...prev.decisions }
        delete decisions[key]
        const next = { ...prev, decisions }
        saveLocal(next)
        return next
      })
      return
    }
    const decisionId = event.decisionIds?.at(-1)
    if (!decisionId) return
    setBusy(true)
    try {
      await api.undo(decisionId)
      setError(null)
      await refresh()
    } catch (e) {
      if (e instanceof ApiError && e.code === 'DEPENDENT_DECISIONS') {
        // Сначала спрашиваем, потом отменяем зависимые связи — молча не рушим
        if (window.confirm('У операции есть зависимые погашения. Отменить их вместе?')) {
          await api.undo(decisionId, true).catch(() => undefined)
          await refresh()
        }
      } else {
        setError(e instanceof ApiError ? e.message : 'Не удалось отменить решение')
      }
    } finally {
      setBusy(false)
    }
  }, [onServer, local.decisions, refresh])

  const addManual = useCallback(async (m: ManualEntry) => {
    if (!onServer) {
      setLocal(prev => { const next = { ...prev, manual: [...prev.manual, m] }; saveLocal(next); return next })
      return
    }
    setBusy(true)
    try {
      await api.manualCash({
        booking_date: m.date,
        amount_minor: Math.abs(m.amountMinor),
        category: m.category as CategoryId,
        description: m.description,
        command_id: newCommandId(),
      })
      setError(null)
      await refresh()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не удалось записать трату')
    } finally {
      setBusy(false)
    }
  }, [onServer, refresh])

  const markWeeklySeen = useCallback(async () => {
    const seen = new Date().toISOString()
    patchLocal({ weeklySeenAt: seen })
    if (!onServer) return
    // Последняя завершённая неделя относительно демо-даты
    const d = new Date(srv.today + 'T12:00:00')
    const end = new Date(d); end.setDate(d.getDate() - ((d.getDay() + 6) % 7) - 1)
    const start = new Date(end); start.setDate(end.getDate() - 6)
    const iso = (x: Date) => x.toISOString().slice(0, 10)
    try {
      await api.markWeeklySeen(iso(start), iso(end))
      setSrv(s => ({ ...s, weeklySeenAt: seen }))
    } catch { /* отметка просмотра не влияет на цифры */ }
  }, [onServer, srv.today, patchLocal])

  const resetReview = useCallback(() => {
    if (onServer) {
      // На сервере решения отменяются через undo конкретных команд,
      // сбрасывать всё одной кнопкой нельзя — это разрушило бы журнал.
      setError('Сброс разбора доступен только в локальном режиме. На сервере отменяйте решения по операциям.')
      return
    }
    patchLocal({ decisions: {}, snoozed: {}, session: { shown: [], count: 0 } })
    setUnlocked(false)
  }, [onServer, patchLocal])

  const restoreReference = useCallback(() => {
    if (onServer) {
      setError('Эталонное состояние на сервере восстанавливается скриптом resolve_demo.py')
      return
    }
    patchLocal({ decisions: { ...DEMO_DECISIONS }, snoozed: {}, session: { shown: [], count: 0 } })
    setUnlocked(false)
  }, [onServer, patchLocal])

  /** Шаг 1 импорта: разбор файла без единой финансовой записи (§6.3). */
  const previewCsv = useCallback(async (file: File) => {
    setBusy(true)
    try {
      const preview = await api.previewImport(file)
      setError(null)
      return preview
    } catch (e) {
      const message = e instanceof ApiError ? e.message : 'Не удалось прочитать файл'
      setError(message)
      throw new Error(message)
    } finally {
      setBusy(false)
    }
  }, [])

  /** Шаг 2 импорта: явное подтверждение пользователем. */
  const commitCsv = useCallback(async (previewId: string, hasErrors: boolean) => {
    setBusy(true)
    try {
      const commit = await api.commitImport({
        preview_id: previewId,
        idempotency_key: newCommandId(),
        import_valid_only: hasErrors,
      })
      setError(null)
      await refresh()
      return commit
    } catch (e) {
      const message = e instanceof ApiError ? e.message : 'Не удалось импортировать файл'
      setError(message)
      throw new Error(message)
    } finally {
      setBusy(false)
    }
  }, [refresh])

  const askTextSuggestions = useCallback(async (descriptions: {
    description: string
    counterparty?: string | null
    bank_type?: string
  }[]) => {
    setBusy(true)
    try {
      const result = await api.textSuggestions({ descriptions, consent_external: true })
      setError(null)
      return result
    } catch (e) {
      const message = e instanceof ApiError ? e.message : 'Не удалось отправить текст в API'
      setError(message)
      throw new Error(message)
    } finally {
      setBusy(false)
    }
  }, [])

  return {
    mode,
    error,
    busy,
    apiBase: API_BASE,
    dismissError: () => setError(null),
    reconnect,
    refresh,

    today: onServer ? srv.today : DEMO_TODAY,
    accounts,
    events,
    receivables,
    movements,
    serverAnalytics: srv.analytics,

    openQuestions,
    proposed,
    sessionCount: onServer ? sessionCount : local.session.count,
    unlocked,
    unlockQueue: () => setUnlocked(true),
    snoozed: local.snoozed,
    decisions: local.decisions,
    weeklySeenAt: onServer ? srv.weeklySeenAt : local.weeklySeenAt,
    manual: local.manual,
    /** Сколько банковских строк стоит за событиями (ручные операции не в счёт). */
    rawCount: onServer
      ? events.reduce((n, e) => n + e.movements.filter(m => m.origin === 'import').length, 0)
      : buildDemoTransactions().length,
    llm: local.llm,

    decide,
    undoEvent,
    addManual,
    markWeeklySeen,
    resetReview,
    restoreReference,
    previewCsv,
    commitCsv,
    askTextSuggestions,
    setLlm: (llm: LlmSettings) => patchLocal({ llm }),
  }
}

type Store = ReturnType<typeof useStore>
const Ctx = createContext<Store | null>(null)

export function AppProvider({ children }: { children: React.ReactNode }) {
  const store = useStore()
  return <Ctx.Provider value={store}>{children}</Ctx.Provider>
}

export function useApp(): Store {
  const s = useContext(Ctx)
  if (!s) throw new Error('useApp вне провайдера')
  return s
}
