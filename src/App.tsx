import React, { useState } from 'react'
import { AppProvider, useApp } from './store'
import { Icon, type IconName } from './ui/kit'
import Home from './screens/Home'
import Review from './screens/Review'
import Operations from './screens/Operations'
import Analytics from './screens/Analytics'
import More from './screens/More'
import Add from './screens/Add'
import Chat from './screens/Chat'
import Import from './screens/Import'

type Tab = 'home' | 'analytics' | 'operations' | 'more' | 'review'

const TABS: { id: Tab; title: string; icon: IconName }[] = [
  { id: 'home', title: 'Главная', icon: 'home' },
  { id: 'analytics', title: 'Аналитика', icon: 'chart' },
  { id: 'operations', title: 'Операции', icon: 'list' },
  { id: 'more', title: 'Ещё', icon: 'more' },
]

function StatusBar() {
  return (
    <div className="statusbar">
      <span>9:41</span>
      <span className="icons">
        {[6, 9, 12, 15].map(h => (
          <i key={h} className="bar" style={{ height: h }} />
        ))}
        <svg width="16" height="11" viewBox="0 0 16 11" fill="none" aria-hidden="true">
          <rect x="0.5" y="0.5" width="13" height="10" rx="2.5" stroke="currentColor" opacity=".5" />
          <rect x="2" y="2" width="10" height="7" rx="1.5" fill="currentColor" />
          <path d="M15 4v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity=".5" />
        </svg>
      </span>
    </div>
  )
}

function Shell() {
  const app = useApp()
  const [tab, setTab] = useState<Tab>('home')
  const [adding, setAdding] = useState(false)
  const [chatting, setChatting] = useState(false)
  const [importing, setImporting] = useState(false)

  const go = (t: string) => setTab(t as Tab)

  return (
    <div className="stage">
      <div className="device">
        <div className="notch" />
        <StatusBar />

        {app.mode === 'loading' && (
          <div className="screen" style={{ display: 'grid', placeContent: 'center' }}>
            <div className="empty">Подключаюсь к серверу…</div>
          </div>
        )}

        {app.mode !== 'loading' && (
        <main className="screen" key={tab}>
          {tab === 'home' && <Home go={go} onImport={() => setImporting(true)} />}
          {tab === 'review' && <Review go={go} />}
          {tab === 'analytics' && <Analytics />}
          {tab === 'operations' && <Operations />}
          {tab === 'more' && <More onImport={() => setImporting(true)} />}
        </main>
        )}

        {(app.mode === 'local' || app.error) && (
          <button className="statusbar-note" onClick={app.error ? app.dismissError : app.reconnect}>
            {app.error ?? 'Сервер недоступен · работает офлайн-демо'}
          </button>
        )}

        <nav className="tabbar">
          {TABS.slice(0, 2).map(t => (
            <button key={t.id} className={'tab' + (tab === t.id ? ' active' : '')}
              onClick={() => setTab(t.id)}>
              <span style={{ position: 'relative' }}>
                <Icon name={t.icon} size={21} />
                {t.id === 'analytics' && !app.weeklySeenAt && <span className="badge dot" />}
              </span>
              {t.title}
            </button>
          ))}

          <button className="tab" onClick={() => setChatting(true)} aria-label="Открыть помощника">
            <span style={{
              width: 44, height: 44, borderRadius: 16, background: 'var(--accent)',
              display: 'grid', placeItems: 'center', marginTop: -8,
              boxShadow: '0 6px 18px rgba(204,255,0,.22)',
            }}>
              <Icon name="chat" size={22} color="#0A0A0A" width={2.2} />
            </span>
          </button>

          {TABS.slice(2).map(t => (
            <button key={t.id} className={'tab' + (tab === t.id ? ' active' : '')}
              onClick={() => setTab(t.id)}>
              <span style={{ position: 'relative' }}>
                <Icon name={t.icon} size={21} />
                {t.id === 'more' && app.openQuestions.length > 0 && (
                  <span className="badge">{app.openQuestions.length}</span>
                )}
              </span>
              {t.title}
            </button>
          ))}
        </nav>

        {chatting && (
          <Chat
            go={go}
            onClose={() => setChatting(false)}
            onOpenPad={() => { setChatting(false); setAdding(true) }}
            onImport={() => { setChatting(false); setImporting(true) }} />
        )}
        {adding && <Add onClose={() => setAdding(false)} />}
        {importing && <Import onClose={() => setImporting(false)} />}
      </div>
    </div>
  )
}

export default function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  )
}
