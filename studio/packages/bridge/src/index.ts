import { spawn, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { WebSocketServer, type WebSocket } from 'ws'
import { browseDirectory, listRoots } from './browse.js'
import { listDirectory, readFileScoped, writeFileScoped } from './fs.js'
import { getSessionHistory, listProjects, listSessions, projectsRoot } from './sessions.js'
import { readState, writeState, type UiState } from './state.js'

export type BridgeOptions = {
  host?: string
  port?: number
  token?: string
  /** when true, HTTP/WS routes skip token auth entirely (opt-in, insecure) */
  tokenless?: boolean
  agentCommand?: { command: string; args: string[] }
  cwd?: string
  env?: Record<string, string>
}

// Compiled output lives in dist/, the shim ships as source. Resolve upward.
const defaultShim = fileURLToPath(new URL('../src/shim.mjs', import.meta.url))

// CORS for the /fs route. The web client and the bridge are served from
// different browser origins (e.g. :8768 vs :8787). The token is passed as a
// query parameter rather than a custom header, so a simple GET needs no
// preflight — but we still reflect the request Origin (or `*`) so cross-origin
// reads of both success and error responses are permitted.
function corsHeaders(req: IncomingMessage): Record<string, string> {
  const origin = req.headers.origin
  return {
    'access-control-allow-origin': typeof origin === 'string' ? origin : '*',
    'access-control-allow-headers': 'authorization, content-type',
    'access-control-allow-methods': 'GET, PUT, POST, OPTIONS',
  }
}

// Collects a request body into a string. Save requests carry one small JSON
// payload (the edited text), so there is no need to stream or cap it here.
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', chunk => chunks.push(Buffer.from(chunk)))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

export async function startBridge(options: BridgeOptions = {}): Promise<{
  url: string
  token: string
  close: () => Promise<void>
}> {
  const host = options.host ?? '127.0.0.1'
  const tokenless = options.tokenless === true
  const token = options.token ?? randomBytes(24).toString('hex')
  // In tokenless mode every HTTP route and the WebSocket upgrade skip the
  // token check. It is opt-in and must only be used on a trusted/private network.
  const agentCommand = options.agentCommand ?? {
    command: process.execPath,
    args: [defaultShim],
  }
  const children = new Set<ChildProcess>()
  // Live SSE subscribers. `/state` writes broadcast to every device so opening a
  // session on one device updates the rail on the others without a refresh.
  const stateSubscribers = new Set<ServerResponse>()

  const broadcastState = (state: UiState): void => {
    const frame = `event: state\ndata: ${JSON.stringify(state)}\n\n`
    for (const subscriber of stateSubscribers) {
      subscriber.write(frame)
    }
  }

  // Serializes read-modify-write cycles on the state file. Without this, two
  // devices writing at once both read the same base rev and stamp the same
  // value, so clients could drop the second write as a stale frame.
  let writeQueue: Promise<unknown> = Promise.resolve()
  const saveState = (next: Omit<UiState, 'rev'>): Promise<UiState> => {
    const run = writeQueue.then(async () => {
      const base = await readState()
      const saved = await writeState({ ...next, rev: base.rev })
      broadcastState(saved)
      return saved
    })
    writeQueue = run.catch(() => undefined)
    return run
  }

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://${host}`)

    if (
      url.pathname === '/projects' ||
      url.pathname === '/sessions' ||
      url.pathname === '/session-history' ||
      url.pathname === '/state' ||
      url.pathname === '/state/stream'
    ) {
      const cors = corsHeaders(req)
      const presented = url.searchParams.get('token')
      const header = req.headers.authorization
      const authorized = tokenless || presented === token || header === `Bearer ${token}`

      if (!authorized) {
        res.writeHead(401, cors)
        res.end()
        return
      }

      try {
        if (url.pathname === '/projects') {
          const projects = await listProjects(projectsRoot())
          res.writeHead(200, { 'content-type': 'application/json', ...cors })
          res.end(JSON.stringify({ projects }))
          return
        }

        // UI state lives on the server so the rail is identical on every device.
        // GET returns the state; PUT writes a new one (add/remove workspace,
        // active workspace, open session list). `/state/stream` opens an SSE feed
        // that replays the current state and pushes updates on every write.
        if (url.pathname === '/state/stream') {
          res.writeHead(200, {
            'content-type': 'text/event-stream',
            'cache-control': 'no-cache, no-transform',
            connection: 'keep-alive',
            ...cors,
          })
          res.write('retry: 3000\n\n')
          const state = await readState()
          res.write(`event: state\ndata: ${JSON.stringify(state)}\n\n`)
          stateSubscribers.add(res)
          req.on('close', () => stateSubscribers.delete(res))
          return
        }

        if (url.pathname === '/state') {
          if (req.method === 'PUT') {
            const body = JSON.parse(await readBody(req))
            const saved = await saveState({
              workspaces: Array.isArray(body.workspaces) ? body.workspaces : [],
              activePath: typeof body.activePath === 'string' ? body.activePath : null,
              sessions: Array.isArray(body.sessions) ? body.sessions : [],
            })
            res.writeHead(200, { 'content-type': 'application/json', ...cors })
            res.end(JSON.stringify(saved))
            return
          }
          const state = await readState()
          res.writeHead(200, { 'content-type': 'application/json', ...cors })
          res.end(JSON.stringify(state))
          return
        }

        if (url.pathname === '/session-history') {
          const cwd = url.searchParams.get('cwd')
          const id = url.searchParams.get('id')
          if (!cwd || !id) {
            res.writeHead(400, { 'content-type': 'application/json', ...cors })
            res.end(JSON.stringify({ error: 'cwd and id are required' }))
            return
          }
          const messages = await getSessionHistory(projectsRoot(), cwd, id)
          res.writeHead(200, { 'content-type': 'application/json', ...cors })
          res.end(JSON.stringify({ messages }))
          return
        }

        const cwd = url.searchParams.get('cwd')
        if (!cwd) {
          res.writeHead(400, { 'content-type': 'application/json', ...cors })
          res.end(JSON.stringify({ error: 'cwd is required' }))
          return
        }
        const sessions = await listSessions(projectsRoot(), cwd)
        res.writeHead(200, { 'content-type': 'application/json', ...cors })
        res.end(JSON.stringify({ sessions }))
        return
      } catch (err) {
        console.error('[bridge] route error', url.pathname, err)
        res.writeHead(500, { 'content-type': 'application/json', ...cors })
        res.end(JSON.stringify({ error: String(err) }))
      }
      return
    }

    if (url.pathname === '/fs') {
      const cors = corsHeaders(req)

      if (req.method === 'OPTIONS') {
        res.writeHead(204, cors)
        res.end()
        return
      }

      const presented = url.searchParams.get('token')
      const header = req.headers.authorization
      const authorized = tokenless || presented === token || header === `Bearer ${token}`

      if (!authorized) {
        res.writeHead(401, cors)
        res.end()
        return
      }

      try {
        const rel = url.searchParams.get('path') ?? '.'
        // The web client pins a workspace; scope the listing to that workspace
        // root so the explorer reflects the selected project. Defaults to the
        // bridge cwd for backward compatibility.
        const root = url.searchParams.get('root') ?? options.cwd ?? process.cwd()
        const listing = listDirectory(root, rel)
        res.writeHead(200, { 'content-type': 'application/json', ...cors })
        res.end(JSON.stringify(listing))
      } catch {
        res.writeHead(500, cors)
        res.end()
      }
      return
    }

    if (url.pathname === '/file') {
      const cors = corsHeaders(req)

      if (req.method === 'OPTIONS') {
        res.writeHead(204, cors)
        res.end()
        return
      }

      const presented = url.searchParams.get('token')
      const header = req.headers.authorization
      const authorized = tokenless || presented === token || header === `Bearer ${token}`

      if (!authorized) {
        res.writeHead(401, cors)
        res.end()
        return
      }

      try {
        const rel = url.searchParams.get('path')
        if (!rel) throw new Error('missing path')
        const root = url.searchParams.get('root') ?? options.cwd ?? process.cwd()

        if (req.method === 'PUT') {
          const body = JSON.parse(await readBody(req)) as { text?: unknown }
          if (typeof body.text !== 'string') throw new Error('body must contain a text string')
          writeFileScoped(root, rel, body.text)
          const file = readFileScoped(root, rel)
          res.writeHead(200, { 'content-type': 'application/json', ...cors })
          res.end(JSON.stringify(file))
          return
        }

        const file = readFileScoped(root, rel)
        res.writeHead(200, { 'content-type': 'application/json', ...cors })
        res.end(JSON.stringify(file))
      } catch (error) {
        res.writeHead(400, { 'content-type': 'application/json', ...cors })
        res.end(JSON.stringify({ error: error instanceof Error ? error.message : 'cannot read file' }))
      }
      return
    }

    if (url.pathname === '/browse' || url.pathname === '/roots') {
      const cors = corsHeaders(req)
      const presented = url.searchParams.get('token')
      const header = req.headers.authorization
      const authorized = tokenless || presented === token || header === `Bearer ${token}`

      if (!authorized) {
        res.writeHead(401, cors)
        res.end()
        return
      }

      try {
        if (url.pathname === '/roots') {
          res.writeHead(200, { 'content-type': 'application/json', ...cors })
          res.end(JSON.stringify({ roots: listRoots() }))
          return
        }

        const listing = browseDirectory(url.searchParams.get('path') ?? undefined)
        res.writeHead(200, { 'content-type': 'application/json', ...cors })
        res.end(JSON.stringify(listing))
        return
      } catch (error) {
        res.writeHead(400, { 'content-type': 'application/json', ...cors })
        res.end(JSON.stringify({ error: error instanceof Error ? error.message : 'cannot browse path' }))
        return
      }
    }

    res.writeHead(404)
    res.end()
  })
  const wss = new WebSocketServer({ noServer: true })

  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url ?? '/', `http://${host}`)
    const presented = url.searchParams.get('token')
    const header = request.headers.authorization
    const authorized =
      tokenless || presented === token || header === `Bearer ${token}`

    if (!authorized) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
      socket.destroy()
      return
    }

    wss.handleUpgrade(request, socket, head, ws => {
      const agent = spawn(agentCommand.command, agentCommand.args, {
        cwd: options.cwd ?? process.cwd(),
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: process.platform !== 'win32',
        env: { ...process.env, OPENCLAUDE_BRIDGE: '1', ...options.env },
      })
      children.add(agent)

      // Agent stdout is newline-delimited JSON. Chunks can split a line, so
      // buffer through readline rather than sending raw chunks.
      const lines = createInterface({ input: agent.stdout, crlfDelay: Infinity })
      lines.on('line', line => {
        if (!line.trim()) return
        try {
          JSON.parse(line)
        } catch {
          process.stderr.write(`[bridge] dropping non-JSON agent line\n`)
          return
        }
        if (ws.readyState === ws.OPEN) ws.send(line)
      })

      agent.stderr.on('data', chunk => {
        process.stderr.write(`[agent] ${chunk.toString()}`)
      })

      ws.on('message', data => {
        if (agent.stdin.destroyed) return
        const text = data.toString()
        try {
          JSON.parse(text)
        } catch {
          ws.send(JSON.stringify({
            jsonrpc: '2.0',
            id: null,
            error: { code: -32700, message: 'Parse error' },
          }))
          return
        }
        agent.stdin.write(text + '\n')
      })

      const kill = (): void => {
        children.delete(agent)
        if (agent.exitCode !== null || agent.signalCode !== null) return
        try {
          if (agent.pid !== undefined && process.platform !== 'win32') {
            process.kill(-agent.pid, 'SIGTERM')
          } else {
            agent.kill('SIGTERM')
          }
        } catch {
          agent.kill('SIGTERM')
        }
      }

      ws.on('close', kill)
      agent.on('exit', code => {
        children.delete(agent)
        if (ws.readyState === ws.OPEN) {
          ws.close(1011, `agent exited with ${code ?? 'signal'}`)
        }
      })
    })
  })

  await new Promise<void>(resolve => server.listen(options.port ?? 0, host, resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('bridge failed to bind')

  return {
    url: `ws://${host}:${address.port}`,
    token,
    close: async () => {
      for (const subscriber of stateSubscribers) subscriber.destroy()
      stateSubscribers.clear()
      for (const client of wss.clients as Set<WebSocket>) client.terminate()
      for (const child of children) {
        if (child.exitCode !== null || child.signalCode !== null) continue
        try {
          if (child.pid !== undefined && process.platform !== 'win32') {
            process.kill(-child.pid, 'SIGTERM')
          } else {
            child.kill('SIGTERM')
          }
        } catch {
          child.kill('SIGTERM')
        }
      }
      await new Promise<void>(resolve => server.close(() => resolve()))
    },
  }
}
