import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)

// @rayss-dev/openclaude is ESM-only and its "./sdk" export declares only
// "import" conditions, so require.resolve() throws ERR_PACKAGE_PATH_NOT_EXPORTED.
// Read the package's own exports map and join the resolved subpath targets.
function resolveEntry(specifier) {
  const scope = specifier.replace(/^@rayss-dev\/openclaude\//, '')
  const pkgJsonPath = require.resolve('@rayss-dev/openclaude/package.json')
  const pkgDir = dirname(pkgJsonPath)
  const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf8'))
  const entry = pkg.exports?.[`./${scope}`]
  const target = typeof entry === 'string' ? entry : entry?.import
  if (!target) throw new Error(`Cannot resolve ${specifier}`)
  return pathToFileURL(join(pkgDir, target)).href
}

const acpPath = process.env.OPENCLAUDE_ACP_ENTRY ?? resolveEntry('@rayss-dev/openclaude/acp')

// Importing the acp entry auto-starts the stdio server. The entrypoint calls
// init() (which enables config access) on the first JSON-RPC message, so no
// external warm-up of the SDK is required.
await import(acpPath)
