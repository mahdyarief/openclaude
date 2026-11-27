import { useState, type FormEvent } from 'react'
import { Button, Input, Label } from '@openclaude-studio/ui'
import { defaultBridgeUrl, type BridgeConfig } from './bridge-config.js'

export type ConnectScreenProps = {
  initial: BridgeConfig | null
  onConnect: (config: BridgeConfig) => void
}

export function ConnectScreen({ initial, onConnect }: ConnectScreenProps) {
  const [url, setUrl] = useState(initial?.url ?? defaultBridgeUrl(window.location.hostname))
  const [token, setToken] = useState(initial?.token ?? '')

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    if (!url.trim()) return
    const trimmed = token.trim()
    // An empty token connects in tokenless mode; the bridge only accepts that
    // when it was started with --tokenless.
    onConnect(trimmed ? { url: url.trim(), token: trimmed } : { url: url.trim(), token: '', tokenless: true })
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-canvas p-4 text-ink sm:p-6">
      <div className="flex w-full max-w-md flex-col items-center gap-6">
        <div className="flex flex-col items-center gap-2 text-center">
          <span
            aria-hidden
            className="inline-flex size-12 items-center justify-center rounded-[var(--radius-window)] bg-ink text-[14px] font-bold text-surface"
          >
            OC
          </span>
          <h1 className="text-lg font-semibold tracking-tight">OpenClaude Studio</h1>
          <p className="max-w-xs text-[12.5px] leading-relaxed text-ink-3">
            Connect to your local bridge to open projects and their OpenClaude
            sessions.
          </p>
        </div>

        <form
          onSubmit={submit}
          className="flex w-full flex-col gap-4 rounded-[var(--radius-window)] border border-line bg-surface p-5 shadow-[var(--shadow-card)] sm:p-6"
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="bridge-url">Bridge URL</Label>
            <Input
              id="bridge-url"
              value={url}
              onChange={event => setUrl(event.target.value)}
              className="font-mono"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="bridge-token">Token</Label>
            <Input
              id="bridge-token"
              type="password"
              value={token}
              onChange={event => setToken(event.target.value)}
              placeholder="Leave empty if the bridge runs with --tokenless"
              className="font-mono"
            />
          </div>
          <Button type="submit" variant="accent" size="md" disabled={!url.trim()}>
            Connect
          </Button>
        </form>
      </div>
    </main>
  )
}
