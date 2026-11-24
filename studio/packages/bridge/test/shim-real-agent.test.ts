import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { resolveAgentEntry } from '../src/resolve-agent.js'

const shim = fileURLToPath(new URL('../src/shim.mjs', import.meta.url))

// dist/ is gitignored; a clean checkout runs the Studio gates before the root
// build. Resolve inside the guard so an unresolvable package skips instead of
// throwing during collection.
const acpEntry = (() => {
  try {
    return fileURLToPath(resolveAgentEntry().acp)
  } catch {
    return null
  }
})()
const describeRealAgent = acpEntry && existsSync(acpEntry) ? describe : describe.skip

describeRealAgent('shim against the real agent', () => {
  test('session/new returns a sessionId after initialize', async () => {
    const child = spawn(process.execPath, [shim], {
      cwd: process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    // Drain stderr: an unread pipe can fill up and stall the child, and the
    // text is useful when the child exits before answering.
    let stderr = ''
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', chunk => {
      stderr += chunk
    })
    const closed = new Promise<void>(resolve => child.once('close', () => resolve()))

    try {
      const result = await new Promise<{ result?: { sessionId?: string }; error?: unknown }>(
        (resolve, reject) => {
          let buffer = ''
          let settled = false
          const finish = (fn: () => void) => {
            if (settled) return
            settled = true
            clearTimeout(timer)
            fn()
          }
          const timer = setTimeout(() => {
            finish(() => reject(new Error('shim did not answer session/new within 30s')))
          }, 30_000)

          child.stdout.setEncoding('utf8')
          child.stdout.on('data', chunk => {
            buffer += chunk
            const lines = buffer.split('\n')
            buffer = lines.pop() ?? ''
            for (const line of lines) {
              if (!line.startsWith('{')) continue
              let frame: { id?: number; result?: { sessionId?: string }; error?: unknown }
              try {
                frame = JSON.parse(line)
              } catch {
                continue
              }
              if (frame.id === 2) {
                finish(() => resolve(frame))
                return
              }
            }
          })

          child.on('error', error => {
            finish(() => reject(error))
          })
          child.on('exit', code => {
            finish(() =>
              reject(
                new Error(
                  `shim exited before answering session/new (code ${code})${stderr ? `: ${stderr.trim()}` : ''}`,
                ),
              ),
            )
          })

          child.stdin.write(
            `${JSON.stringify({
              jsonrpc: '2.0',
              id: 1,
              method: 'initialize',
              params: { protocolVersion: 1, clientCapabilities: {} },
            })}\n`,
          )
          child.stdin.write(
            `${JSON.stringify({
              jsonrpc: '2.0',
              id: 2,
              method: 'session/new',
              params: { cwd: process.cwd() },
            })}\n`,
          )
          child.stdin.end()
        },
      )

      expect(result.error).toBeUndefined()
      expect(result.result?.sessionId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      )
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill()
      child.stdin.destroy()
      await closed
    }
  }, 35_000)
})
