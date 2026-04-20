import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Bot, X, Send, Eraser, Search, FileText, Minimize2, Maximize2, ChevronsDown } from 'lucide-react'
import { api, isElectron } from '../../lib/ipc-client'
import { useAgentStore, historyToChatMessages, type AgentChatMessage } from '../../stores/agent-store'
import type { AgentMessage, AgentWebSearchResult } from '@shared/types'
import { cn } from '../../lib/utils'

function tenderIdFromPath(pathname: string): string | null {
  const m = pathname.match(/\/aanbestedingen\/([^/]+)/)
  return m ? m[1] : null
}

function formatAssistantText(text: string): string {
  // Verwijder eventuele tool-call tags uit zichtbare tekst
  return text.replace(/<<TOOL>>[\s\S]*?<<END>>/g, '').trim()
}

export function AgentPanel() {
  const location = useLocation()
  const navigate = useNavigate()
  const tenderId = tenderIdFromPath(location.pathname)

  const {
    panelOpen,
    setPanelOpen,
    togglePanel,
    messages,
    isStreaming,
    activeTenderId,
    setActiveTender,
    setMessages,
    startStreaming,
    appendToStreamingAssistant,
    pushToolEvent,
    finishStreaming,
    addMessage,
    pendingUserInput,
    setPendingUserInput,
  } = useAgentStore()

  const [input, setInput] = useState('')
  const [minimized, setMinimized] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<AgentWebSearchResult[]>([])
  const [searchOpen, setSearchOpen] = useState(false)
  const [searching, setSearching] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Sync active tender with route
  useEffect(() => {
    if (tenderId !== activeTenderId) {
      setActiveTender(tenderId)
    }
  }, [tenderId, activeTenderId, setActiveTender])

  // Load history when panel opens or tender changes
  useEffect(() => {
    if (!panelOpen) return
    let cancelled = false
    ;(async () => {
      try {
        const history = (await api.agentGetHistory?.({ tenderId: tenderId || undefined })) as
          | AgentMessage[]
          | null
        if (!cancelled && Array.isArray(history)) {
          setMessages(historyToChatMessages(history))
        }
      } catch {
        /* ignore */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [panelOpen, tenderId, setMessages])

  // Subscribe to streaming chunks
  useEffect(() => {
    if (!isElectron) return
    const unsub = api.onAgentStreamChunk?.((data: unknown) => {
      const c = data as {
        id: string
        tender_id?: string
        delta?: string
        done?: boolean
        error?: string
        tool_call?: { name: string; args: Record<string, unknown>; result?: string }
      }
      if (!c) return
      const state = useAgentStore.getState()
      // Use the frontend's currentStreamId as the message ID, since the backend
      // generates its own stream ID that won't match the frontend's.
      const messageId = state.currentStreamId
      if (!messageId) return
      if (c.delta) {
        state.appendToStreamingAssistant(messageId, c.delta)
      }
      if (c.tool_call) {
        state.pushToolEvent(messageId, c.tool_call)
      }
      if (c.error) {
        state.appendToStreamingAssistant(messageId, `\n\n[Fout: ${c.error}]`)
      }
      if (c.done) {
        state.finishStreaming()
      }
    })
    return () => {
      unsub?.()
    }
  }, [])

  // Auto-scroll when new messages or streaming
  useEffect(() => {
    if (!scrollRef.current) return
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [messages, panelOpen])

  // Pick up pending input from other components (e.g. RisicoTab "Bespreek met agent")
  useEffect(() => {
    if (panelOpen && pendingUserInput) {
      setInput(pendingUserInput)
      setPendingUserInput(null)
    }
  }, [panelOpen, pendingUserInput, setPendingUserInput])

  const sendMessage = async () => {
    const text = input.trim()
    if (!text || isStreaming) return
    setInput('')
    const userMsg: AgentChatMessage = {
      id: `u-${Date.now()}`,
      role: 'user',
      content: text,
      tender_id: tenderId || undefined,
      created_at: new Date().toISOString(),
    }
    addMessage(userMsg)
    const streamId = `s-${Date.now()}`
    startStreaming(streamId)
    try {
      const res = (await api.agentSendMessage?.({
        tenderId: tenderId || undefined,
        message: text,
      })) as { ok: boolean; error?: string; text?: string } | null
      if (!res?.ok && res?.error) {
        appendToStreamingAssistant(streamId, `\n[Fout: ${res.error}]`)
      }
    } catch (e) {
      appendToStreamingAssistant(streamId, `\n[Fout: ${e instanceof Error ? e.message : String(e)}]`)
    } finally {
      finishStreaming()
    }
  }

  const clearHistory = async () => {
    await api.agentClearHistory?.({ tenderId: tenderId || undefined })
    setMessages([])
  }

  const quickAction = (label: string) => {
    setInput(label)
  }

  const openTenderIfNone = () => {
    if (!tenderId) navigate('/aanbestedingen')
  }

  const runWebSearch = async () => {
    const q = searchQuery.trim()
    if (!q) return
    setSearching(true)
    try {
      const res = (await api.agentWebSearch?.({ query: q, count: 6 })) as
        | { ok: boolean; results?: AgentWebSearchResult[]; error?: string }
        | null
      if (res?.ok && res.results) {
        setSearchResults(res.results)
      } else {
        setSearchResults([])
      }
    } finally {
      setSearching(false)
    }
  }

  const pinResult = async (r: AgentWebSearchResult) => {
    if (!tenderId) return
    await api.agentPinSearchResult?.({
      tenderId,
      url: r.url,
      summary: `${r.title} — ${r.snippet}`,
      query: searchQuery,
    })
  }

  const hasTenderContext = !!tenderId

  const visibleMessages = useMemo(() => {
    return messages.map((m) => ({
      ...m,
      content: m.role === 'assistant' ? formatAssistantText(m.content) : m.content,
    }))
  }, [messages])

  if (!panelOpen) {
    return (
      <button
        onClick={() => setPanelOpen(true)}
        className="fixed bottom-6 right-6 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-blue-600 text-white shadow-lg ring-2 ring-blue-300 hover:bg-blue-700"
        aria-label="Open aanbestedingsagent"
        title="Aanbestedingsagent"
      >
        <Bot className="h-7 w-7" />
        {isStreaming && <span className="absolute top-1 right-1 h-3 w-3 rounded-full bg-amber-400 animate-pulse" />}
      </button>
    )
  }

  return (
    <div
      className={cn(
        'fixed bottom-6 right-6 z-40 flex flex-col rounded-xl border border-[var(--border)] bg-[var(--card)] shadow-2xl',
        minimized ? 'h-14 w-80' : 'h-[640px] w-[440px] max-w-[95vw]',
      )}
    >
      <div className="flex items-center justify-between border-b border-[var(--border)] px-3 py-2">
        <div className="flex items-center gap-2">
          <Bot className="h-5 w-5 text-blue-600" />
          <div className="text-sm font-semibold">Aanbestedingsagent</div>
          {hasTenderContext ? (
            <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-700">
              tender-context
            </span>
          ) : (
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-500">
              globaal
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            className="rounded p-1 text-[var(--muted-foreground)] hover:bg-[var(--muted)]"
            onClick={() => setMinimized((v) => !v)}
            title={minimized ? 'Uitklappen' : 'Inklappen'}
          >
            {minimized ? <Maximize2 className="h-4 w-4" /> : <Minimize2 className="h-4 w-4" />}
          </button>
          <button
            className="rounded p-1 text-[var(--muted-foreground)] hover:bg-[var(--muted)]"
            onClick={clearHistory}
            title="Historie wissen"
          >
            <Eraser className="h-4 w-4" />
          </button>
          <button
            className="rounded p-1 text-[var(--muted-foreground)] hover:bg-[var(--muted)]"
            onClick={() => setPanelOpen(false)}
            title="Sluiten"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {!minimized && (
        <>
          <div className="flex gap-1 overflow-x-auto border-b border-[var(--border)] px-2 py-1 text-[11px]">
            <button
              className="rounded bg-[var(--muted)] px-2 py-1 hover:bg-blue-50"
              onClick={() => quickAction(hasTenderContext ? 'Toon deadlines en bedragen voor deze aanbesteding.' : 'Welke aanbestedingen hebben deze week een deadline?')}
            >
              Deadlines & bedragen
            </button>
            <button
              className="rounded bg-[var(--muted)] px-2 py-1 hover:bg-blue-50"
              onClick={() =>
                quickAction(
                  hasTenderContext
                    ? 'Vat de risicoanalyse samen en noem de drie zwaarste risico\'s.'
                    : 'Welke tenders hebben hoog-risico-status?',
                )
              }
            >
              Risico's
            </button>
            <button
              className="rounded bg-[var(--muted)] px-2 py-1 hover:bg-blue-50"
              onClick={() => quickAction(hasTenderContext ? 'Welke documenten zijn nog niet ingevuld?' : 'Welke tender heeft de meeste openstaande velden?')}
            >
              Invulstatus
            </button>
            <button
              className="rounded bg-[var(--muted)] px-2 py-1 hover:bg-blue-50"
              onClick={() => setSearchOpen((v) => !v)}
              title="Open internet-zoekopdracht"
            >
              <Search className="inline h-3 w-3 mr-1" /> Internet
            </button>
            {!hasTenderContext && (
              <button
                className="rounded bg-[var(--muted)] px-2 py-1 hover:bg-blue-50"
                onClick={openTenderIfNone}
              >
                <FileText className="inline h-3 w-3 mr-1" /> Kies tender
              </button>
            )}
          </div>

          {searchOpen && (
            <div className="border-b border-[var(--border)] bg-[var(--muted)]/40 p-2">
              <div className="flex gap-1">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void runWebSearch()
                  }}
                  placeholder="Zoekterm voor internet…"
                  className="flex-1 rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-xs"
                />
                <button
                  disabled={searching}
                  onClick={() => void runWebSearch()}
                  className="rounded bg-blue-600 px-2 py-1 text-xs text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {searching ? '…' : 'Zoek'}
                </button>
              </div>
              {searchResults.length > 0 && (
                <div className="mt-2 space-y-1 max-h-40 overflow-y-auto">
                  {searchResults.map((r) => (
                    <div key={r.url} className="rounded border border-[var(--border)] bg-[var(--background)] p-2 text-[11px]">
                      <a href={r.url} target="_blank" rel="noreferrer" className="font-semibold text-blue-700 hover:underline line-clamp-1">
                        {r.title || r.url}
                      </a>
                      <div className="text-[var(--muted-foreground)] line-clamp-2">{r.snippet}</div>
                      <div className="mt-1 flex items-center gap-2">
                        <a href={r.url} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline text-[10px]">
                          Open
                        </a>
                        {hasTenderContext && (
                          <button
                            className="rounded bg-green-50 px-1.5 py-0.5 text-[10px] text-green-800 hover:bg-green-100"
                            onClick={() => void pinResult(r)}
                          >
                            Toevoegen aan dossier
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-2 space-y-2">
            {visibleMessages.length === 0 && (
              <div className="mt-6 text-center text-xs text-[var(--muted-foreground)]">
                <Bot className="mx-auto mb-2 h-6 w-6 opacity-50" />
                <div>
                  {hasTenderContext
                    ? 'Stel een vraag over deze aanbesteding, vraag om een document samen in te vullen, of laat de agent iets opzoeken.'
                    : 'Geen tender geselecteerd. Vraag iets globaal, of kies eerst een aanbesteding.'}
                </div>
              </div>
            )}
            {visibleMessages.map((m) => (
              <MessageBubble key={m.id} msg={m} />
            ))}
            {isStreaming && (
              <div className="flex justify-start">
                <div className="max-w-[90%] rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-900">
                  <span className="inline-block animate-pulse">Agent denkt…</span>
                </div>
              </div>
            )}
          </div>

          <div className="border-t border-[var(--border)] p-2">
            <div className="flex gap-1">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    void sendMessage()
                  }
                }}
                placeholder={hasTenderContext ? 'Vraag iets over deze aanbesteding…' : 'Typ hier je vraag…'}
                rows={2}
                className="flex-1 resize-none rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-xs"
              />
              <button
                onClick={() => void sendMessage()}
                disabled={isStreaming || !input.trim()}
                className="rounded bg-blue-600 px-3 text-white hover:bg-blue-700 disabled:opacity-50"
                aria-label="Versturen"
              >
                <Send className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-1 flex justify-between text-[10px] text-[var(--muted-foreground)]">
              <span>Enter verstuurt · Shift+Enter nieuwe regel</span>
              <span>
                <ChevronsDown className="inline h-3 w-3" /> leert van correcties
              </span>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function MessageBubble({ msg }: { msg: AgentChatMessage }) {
  const isUser = msg.role === 'user'
  return (
    <div className={cn('flex', isUser ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[92%] whitespace-pre-wrap rounded-lg px-3 py-2 text-xs leading-relaxed',
          isUser ? 'bg-blue-600 text-white' : 'bg-[var(--muted)] text-[var(--foreground)]',
          msg.error && 'border border-red-400 bg-red-50 text-red-900',
        )}
      >
        {msg.content || (msg.streaming ? '…' : '')}
        {msg.tool_events && msg.tool_events.length > 0 && (
          <div className="mt-2 space-y-1 border-t border-black/10 pt-1">
            {msg.tool_events.map((t, i) => (
              <div key={i} className="rounded bg-black/5 px-1.5 py-1 text-[10px] font-mono">
                <span className="font-semibold">{t.name}</span>
                {t.result && <span className="ml-1 opacity-70">→ {t.result.slice(0, 120)}</span>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
