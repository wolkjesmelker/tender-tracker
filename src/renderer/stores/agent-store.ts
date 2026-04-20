import { create } from 'zustand'
import type {
  AgentMessage,
  AgentFillState,
  AgentDocumentFillSummary,
  AgentWebSearchResult,
} from '@shared/types'

export interface AgentChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  tender_id?: string
  created_at: string
  streaming?: boolean
  error?: boolean
  tool_events?: { name: string; args: Record<string, unknown>; result?: string }[]
}

interface WizardState {
  open: boolean
  tenderId: string | null
  documentNaam: string | null
}

interface AgentStore {
  panelOpen: boolean
  activeTenderId: string | null
  messages: AgentChatMessage[]
  isStreaming: boolean
  currentStreamId: string | null
  fillSummaries: AgentDocumentFillSummary[]
  fillStates: AgentFillState[]
  wizard: WizardState
  lastSearchResults: AgentWebSearchResult[]
  pendingUserInput: string | null
  setPendingUserInput: (text: string | null) => void

  setPanelOpen: (open: boolean) => void
  togglePanel: () => void
  setActiveTender: (id: string | null) => void
  setMessages: (msgs: AgentChatMessage[]) => void
  addMessage: (m: AgentChatMessage) => void
  appendToStreamingAssistant: (id: string, delta: string) => void
  finishStreaming: () => void
  pushToolEvent: (
    id: string,
    tool: { name: string; args: Record<string, unknown>; result?: string },
  ) => void
  startStreaming: (streamId: string) => void

  setFillSummaries: (s: AgentDocumentFillSummary[]) => void
  setFillStates: (s: AgentFillState[]) => void
  mergeFillState: (s: AgentFillState) => void

  openWizard: (tenderId: string, documentNaam: string) => void
  closeWizard: () => void

  setSearchResults: (r: AgentWebSearchResult[]) => void
}

export const useAgentStore = create<AgentStore>((set) => ({
  panelOpen: false,
  activeTenderId: null,
  messages: [],
  isStreaming: false,
  currentStreamId: null,
  fillSummaries: [],
  fillStates: [],
  wizard: { open: false, tenderId: null, documentNaam: null },
  lastSearchResults: [],
  pendingUserInput: null,

  setPanelOpen: (open) => set({ panelOpen: open }),
  togglePanel: () => set((s) => ({ panelOpen: !s.panelOpen })),
  setActiveTender: (id) => set({ activeTenderId: id }),
  setMessages: (messages) => set({ messages }),
  addMessage: (m) => set((s) => ({ messages: [...s.messages, m] })),

  startStreaming: (streamId) =>
    set((s) => ({
      isStreaming: true,
      currentStreamId: streamId,
      messages: [
        ...s.messages,
        {
          id: streamId,
          role: 'assistant',
          content: '',
          created_at: new Date().toISOString(),
          streaming: true,
        },
      ],
    })),

  appendToStreamingAssistant: (id, delta) =>
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === id ? { ...m, content: m.content + delta } : m,
      ),
    })),

  pushToolEvent: (id, tool) =>
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === id
          ? { ...m, tool_events: [...(m.tool_events || []), tool] }
          : m,
      ),
    })),

  finishStreaming: () =>
    set((s) => ({
      isStreaming: false,
      currentStreamId: null,
      messages: s.messages.map((m) => (m.streaming ? { ...m, streaming: false } : m)),
    })),

  setFillSummaries: (fillSummaries) => set({ fillSummaries }),
  setFillStates: (fillStates) => set({ fillStates }),
  mergeFillState: (s) =>
    set((st) => {
      const idx = st.fillStates.findIndex(
        (x) =>
          x.tender_id === s.tender_id &&
          x.document_naam === s.document_naam &&
          x.field_id === s.field_id,
      )
      const next = [...st.fillStates]
      if (idx >= 0) next[idx] = s
      else next.push(s)
      return { fillStates: next }
    }),

  openWizard: (tenderId, documentNaam) =>
    set({ wizard: { open: true, tenderId, documentNaam } }),
  closeWizard: () => set({ wizard: { open: false, tenderId: null, documentNaam: null } }),

  setSearchResults: (lastSearchResults) => set({ lastSearchResults }),
  setPendingUserInput: (pendingUserInput) => set({ pendingUserInput }),
}))

export function historyToChatMessages(history: AgentMessage[]): AgentChatMessage[] {
  return history
    .filter((h) => h.role === 'user' || h.role === 'assistant')
    .map((h) => ({
      id: h.id,
      role: h.role as 'user' | 'assistant',
      content: h.content,
      tender_id: h.tender_id,
      created_at: h.created_at,
    }))
}
