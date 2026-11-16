import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { resolveAgentEntry } from '../src/resolve-agent.js'

const shim = fileURLToPath(new URL('../src/shim.mjs', import.meta.url))
const acpEntry = fileURLToPath(resolveAgentEntry().acp)

// dist/ is gitignored; a clean checkout runs the Studio gates before the root
// build. Skip when the real package has not been built yet instead of failing.
const describeRealAgent = existsSync(acpEntry) ? describe : describe.skip

describeRealAgent('shim against the real agent', () => {
  test('session/new returns a sessionId after initialize', async () => {
    const child = spawn(process.execPath, [shim], {
      cwd: process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    const result = await new Promise<{ result?: { sessionId?: string }; error?: unknown }>(
      (resolve, reject) => {
        let buffer = ''
        const timer = setTimeout(() => {
          child.kill()
          reject(new Error('shim did not answer session/new within 30s'))
        }, 30_000)

        const cleanup = () => {
          clearTimeout(timer)
          child.kill()
        }

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
              cleanup()
              resolve(frame)
              return
            }
          }
        })

        child.on('error', error => {
          cleanup()
          reject(error)
        })
        child.on('exit', code => {
          clearTimeout(timer)
          if (code !== 0 && code !== null) reject(new Error(`shim exited with ${code}`))
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
  }, 35_000)
})
