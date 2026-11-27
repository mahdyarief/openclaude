export type BridgeConfig = { url: string; token: string; tokenless?: boolean }

const STORAGE_KEY = 'openclaude.bridge'

function parseStored(storage: Storage): BridgeConfig | null {
  const raw = storage.getItem(STORAGE_KEY)
  if (!raw) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as BridgeConfig).url === 'string' &&
      (typeof (parsed as BridgeConfig).token === 'string' ||
        (parsed as BridgeConfig).tokenless === true)
    ) {
      return parsed as BridgeConfig
    }
  } catch {
    return null
  }
  return null
}

export function readBridgeConfig(
  search: string,
  storage: Storage | null,
  pageHostname?: string,
): BridgeConfig | null {
  const params = new URLSearchParams(search)
  const url = params.get('bridge')
  const token = params.get('token')
  const tokenless = params.get('tokenless') === '1' || params.get('tokenless') === ''
  if (url && (token || tokenless)) {
    return { url, token: token ?? '', ...(tokenless ? { tokenless: true } : {}) }
  }
  const stored = storage ? parseStored(storage) : null
  if (stored && pageHostname && !isReachableFrom(stored.url, pageHostname)) {
    // Keep the token and just re-point the bridge at the host we were served
    // from, so a stale loopback config reconnects without user input.
    return {
      url: defaultBridgeUrl(pageHostname),
      token: stored.token,
      ...(stored.tokenless === true ? { tokenless: true } : {}),
    }
  }
  return stored
}

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])

// A bridge stored as ws://127.0.0.1 only works when the page is itself served
// from loopback; otherwise the browser would dial the visitor's own machine.
export function isReachableFrom(bridgeUrl: string, pageHostname: string): boolean {
  let host: string
  try {
    host = new URL(bridgeUrl).hostname
  } catch {
    return false
  }
  if (LOOPBACK.has(host) && !LOOPBACK.has(pageHostname)) return false
  return true
}

// The web app is served next to the bridge on the same host, so the bridge URL
// can be derived instead of typed: http://host:8768 -> ws://host:8787.
export function defaultBridgeUrl(hostname: string): string {
  return `ws://${hostname}:8787`
}

export function saveBridgeConfig(storage: Storage, config: BridgeConfig): void {
  storage.setItem(STORAGE_KEY, JSON.stringify(config))
}