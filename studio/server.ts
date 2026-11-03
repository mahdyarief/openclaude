/**
 * `openclaude studio` server.
 *
 * A single-process launcher for the Studio web app: it starts the ACP bridge
 * (which spawns the agent on each WebSocket connection) and serves the built
 * Studio SPA from disk, then rewrites the root request to inject the bridge
 * WebSocket URL so the browser connects with no setup screen. The bridge runs
 * tokenless (same-machine, single-user convenience).
 *
 * This file is bundled by `scripts/build.ts` into `dist/studio-server.mjs`
 * (with the bridge and its dependencies inlined), so the published package can
 * run it straight from `dist/` without the `studio/` source tree or `node_modules`.
 */
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { startBridge } from '@openclaude-studio/bridge'

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? undefined : process.argv[index + 1]
}

const webRoot = path.resolve(
  flag('web-root') ??
    process.env.STUDIO_WEB_ROOT ??
    fileURLToPath(new URL('./studio-web', import.meta.url)),
)
// The bridge's default shim (`../src/shim.mjs`) is a source-tree path that does
// not ship in the published package. Spawn the ACP bundle directly instead; in
// a source checkout it sits one level up in `dist/`.
const acpEntry =
  flag('acp-entry') ??
  process.env.OPENCLAUDE_ACP_ENTRY ??
  [
    new URL('./acp.mjs', import.meta.url),
    new URL('../dist/acp.mjs', import.meta.url),
  ]
    .map((url) => fileURLToPath(url))
    .find((candidate) => fs.existsSync(candidate)) ??
  fileURLToPath(new URL('./acp.mjs', import.meta.url))
const webPort = Number(flag('web-port') ?? process.env.STUDIO_WEB_PORT ?? 8768)
const bridgePort = Number(
  flag('bridge-port') ?? process.env.STUDIO_BRIDGE_PORT ?? 8787,
)
const host = flag('host') ?? process.env.STUDIO_HOST ?? '127.0.0.1'
const open = process.argv.includes('--no-open') ? false : process.env.STUDIO_OPEN !== '0'

if (!Number.isInteger(webPort) || webPort < 1 || webPort > 65535) {
  process.stderr.write(`Refusing to start Studio with invalid web port: ${webPort}\n`)
  process.exit(1)
}
if (!Number.isInteger(bridgePort) || bridgePort < 1 || bridgePort > 65535) {
  process.stderr.write(`Refusing to start Studio with invalid bridge port: ${bridgePort}\n`)
  process.exit(1)
}

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.map': 'application/json',
}

function sendFile(res: http.ServerResponse, filePath: string): void {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(500).end('internal error')
      return
    }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(filePath)] ?? 'application/octet-stream',
    })
    res.end(data)
  })
}

const bridge = await startBridge({
  host,
  port: bridgePort,
  tokenless: true,
  agentCommand: { command: process.execPath, args: [acpEntry] },
})

const bridgeWs = `ws://${host}:${bridgePort}`
// `readBridgeConfig` requires both the URL and an auth mode; tokenless bridges
// pass `tokenless=1` instead of a token.
const redirectQuery = `?bridge=${encodeURIComponent(bridgeWs)}&tokenless=1`

const web = http.createServer((req, res) => {
  let pathname: string
  try {
    pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname)
  } catch {
    res.writeHead(400).end('bad request')
    return
  }

  // The SPA boots straight into the bridge connection, so the root path just
  // needs to carry the bridge coordinates as query params.
  if (pathname === '/' && req.url?.includes('?') === false) {
    res.writeHead(302, { Location: `/${redirectQuery}` })
    res.end()
    return
  }

  if (pathname === '/') pathname = '/index.html'

  const filePath = path.normalize(path.join(webRoot, pathname))
  if (!filePath.startsWith(`${webRoot}${path.sep}`) && filePath !== webRoot) {
    res.writeHead(403).end('forbidden')
    return
  }

  const stat = fs.statSync(filePath, { throwIfNoEntry: false })
  if (stat?.isDirectory()) {
    sendFile(res, path.join(filePath, 'index.html'))
    return
  }
  if (stat) {
    sendFile(res, filePath)
    return
  }
  // SPA fallback: unknown paths serve index.html so client routing works.
  sendFile(res, path.join(webRoot, 'index.html'))
})

await new Promise<void>((resolve) => web.listen(webPort, host, resolve))

const url = `http://${host}:${webPort}/${redirectQuery}`
process.stdout.write(`Studio listening on http://${host}:${webPort}/\n`)
process.stdout.write(`bridge on ${bridgeWs}\n`)

if (open) {
  const opener =
    process.platform === 'darwin'
      ? 'open'
      : process.platform === 'win32'
        ? 'start'
        : 'xdg-open'
  import('node:child_process').then(({ spawn }) => {
    spawn(opener, [url], { stdio: 'ignore', detached: true }).unref()
  })
}

async function shutdown(signal: string): Promise<void> {
  process.stdout.write(`received ${signal}, shutting down\n`)
  web.close()
  await bridge.close()
  process.exit(0)
}

process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT', () => void shutdown('SIGINT'))
