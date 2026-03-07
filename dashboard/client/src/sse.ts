import { ref } from 'vue'

type Callback = (data: any) => void

let es: EventSource | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let reconnectDelay = 1000
const MAX_DELAY = 30_000

const listeners = new Map<string, Set<Callback>>()

export const connected = ref(false)

export function connect() {
  if (es) return

  const url = new URL('/api/events', window.location.origin)
  es = new EventSource(url.toString())

  es.onopen = () => {
    connected.value = true
    reconnectDelay = 1000
  }

  es.onerror = () => {
    connected.value = false
    cleanup()
    scheduleReconnect()
  }

  // Register existing event types on the new EventSource
  for (const eventType of listeners.keys()) {
    registerEventType(eventType)
  }
}

export function disconnect() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
  cleanup()
}

function cleanup() {
  if (es) {
    es.close()
    es = null
  }
  connected.value = false
}

function scheduleReconnect() {
  if (reconnectTimer) return
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    reconnectDelay = Math.min(reconnectDelay * 2, MAX_DELAY)
    connect()
  }, reconnectDelay)
}

function registerEventType(eventType: string) {
  if (!es) return
  es.addEventListener(eventType, (e: MessageEvent) => {
    const cbs = listeners.get(eventType)
    if (!cbs) return
    const data = e.data ? JSON.parse(e.data) : undefined
    for (const cb of cbs) cb(data)
  })
}

export function on(eventType: string, cb: Callback): () => void {
  let set = listeners.get(eventType)
  if (!set) {
    set = new Set()
    listeners.set(eventType, set)
    // Register on active EventSource
    if (es) registerEventType(eventType)
  }
  set.add(cb)

  return () => {
    set!.delete(cb)
    if (set!.size === 0) listeners.delete(eventType)
  }
}

export const sse = { connect, disconnect, on, connected }
