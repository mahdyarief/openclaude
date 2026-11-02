import { createInterface } from 'node:readline'
import { writeFileSync } from 'node:fs'

const pidFile = process.env.FAKE_AGENT_PID_FILE
if (pidFile) writeFileSync(pidFile, String(process.pid))

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity })

rl.on('line', line => {
  if (!line.trim()) return
  const message = JSON.parse(line)
  if (message.method === 'initialize' && message.id !== undefined) {
    process.stdout.write(JSON.stringify({
      jsonrpc: '2.0',
      id: message.id,
      result: { protocolVersion: 1, agentCapabilities: { loadSession: false } },
    }) + '\n')
    return
  }
  if (message.method === 'session/new' && message.id !== undefined) {
    process.stdout.write(JSON.stringify({
      jsonrpc: '2.0',
      id: message.id,
      result: { sessionId: 'fake-session' },
    }) + '\n')
  }
})

// Stay alive until the bridge kills us; do not exit on stdin close alone.
setInterval(() => {}, 1000)
