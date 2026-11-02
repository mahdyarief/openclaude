import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)

export class AgentNotFoundError extends Error {
  constructor() {
    super(
      'Could not resolve @rayss-dev/openclaude. Install it with: npm i -g @rayss-dev/openclaude',
    )
    this.name = 'AgentNotFoundError'
  }
}

// @rayss-dev/openclaude is ESM-only and its "./sdk" export declares only
// "import" conditions, so require.resolve() throws ERR_PACKAGE_PATH_NOT_EXPORTED.
// Read the package's own exports map and join the resolved subpath targets.
function resolveEntry(specifier: string): string {
  const scope = specifier.replace(/^@rayss-dev\/openclaude\//, '')
  const pkgJsonPath = require.resolve('@rayss-dev/openclaude/package.json')
  const pkgDir = dirname(pkgJsonPath)
  const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf8')) as {
    exports?: Record<string, string | { import?: string }>
  }
  const entry = pkg.exports?.[`./${scope}`]
  const target = typeof entry === 'string' ? entry : entry?.import
  if (!target) throw new AgentNotFoundError()
  return pathToFileURL(join(pkgDir, target)).href
}

export function resolveAgentEntry(): { sdk: string; acp: string } {
  try {
    return {
      sdk: resolveEntry('@rayss-dev/openclaude/sdk'),
      acp: resolveEntry('@rayss-dev/openclaude/acp'),
    }
  } catch {
    throw new AgentNotFoundError()
  }
}
