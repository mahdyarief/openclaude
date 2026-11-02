import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../apps/web/dist', import.meta.url))
const port = Number(process.env.WEB_PORT ?? 8768)
// Default to loopback: this server has no auth, so binding wider is opt-in.
const host = process.env.WEB_HOST ?? '127.0.0.1'

const types = {
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

function send(res, status, filePath) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(500).end('internal error')
      return
    }
    res.writeHead(status, { 'Content-Type': types[path.extname(filePath)] ?? 'application/octet-stream' })
    res.end(data)
  })
}

http
  .createServer((req, res) => {
    let pathname
    try {
      pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname)
    } catch {
      res.writeHead(400).end('bad request')
      return
    }
    if (pathname === '/') pathname = '/index.html'

    const filePath = path.join(root, pathname)
    // Reject anything that escapes the static root (path traversal).
    if (filePath !== root && !filePath.startsWith(root + path.sep)) {
      res.writeHead(403).end('forbidden')
      return
    }

    const stat = fs.statSync(filePath, { throwIfNoEntry: false })
    if (stat?.isFile()) {
      send(res, 200, filePath)
      return
    }
    // Single-page app: client-side routes fall back to the shell.
    if (!path.extname(filePath)) {
      send(res, 200, path.join(root, 'index.html'))
      return
    }
    res.writeHead(404).end('not found')
  })
  .listen(port, host, () => console.log(`serving web UI on ${host}:${port} from ${root}`))
