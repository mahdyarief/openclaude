import { startBridge } from './index.js'

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? undefined : process.argv[index + 1]
}

const token = flag('token') ?? process.env.OPENCLAUDE_BRIDGE_TOKEN
const host = flag('host') ?? process.env.OPENCLAUDE_BRIDGE_HOST ?? '127.0.0.1'
const rawPort = flag('port') ?? process.env.OPENCLAUDE_BRIDGE_PORT ?? '8787'
const port = Number(rawPort)
const tokenless =
  process.argv.includes('--tokenless') ||
  process.env.OPENCLAUDE_BRIDGE_TOKENLESS === '1'

if (!token && !tokenless) {
  process.stderr.write(
    'Refusing to start without a token. Pass --token, set OPENCLAUDE_BRIDGE_TOKEN, or pass --tokenless for an unauthenticated bridge.\n',
  )
  process.exit(1)
}

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  process.stderr.write(`Refusing to start with invalid port: ${rawPort}\n`)
  process.exit(1)
}

const bridge = await startBridge({
  host,
  port,
  tokenless,
  ...(token ? { token } : {}),
})
process.stdout.write(`bridge listening on ${bridge.url}\n`)

async function shutdown(signal: string): Promise<void> {
  process.stdout.write(`received ${signal}, shutting down\n`)
  await bridge.close()
  process.exit(0)
}

process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT', () => void shutdown('SIGINT'))
