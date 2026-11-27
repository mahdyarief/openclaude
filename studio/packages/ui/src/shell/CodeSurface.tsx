import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import { Editor, type OnMount, type EditorProps } from '@monaco-editor/react'
import type { editor } from 'monaco-editor'
import { Loader2 } from 'lucide-react'
import './monaco-env.js'

// React 19 changed the JSX namespace; @monaco-editor/react's default export can
// fail JSX typecheck. Re-type it as a plain component to satisfy strict mode.
const MonacoEditor = Editor as unknown as (props: EditorProps) => ReactElement

export type CodeSurfaceProps = {
  /** workspace-relative path, used to infer the language */
  path: string
  /** current text */
  value: string
  /** when false the editor is read-only (preview mode) */
  editable?: boolean
  /** called on every edit; omit for read-only */
  onChange?: (value: string) => void
  /** dark palette follows the shell's .dark class */
  dark: boolean
}

// Map a file extension to a Monaco language id. Monaco ships definitions for
// the common web languages; unknown extensions fall back to plaintext.
const LANGUAGE_BY_EXT: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  json: 'json',
  jsonc: 'json',
  css: 'css',
  scss: 'scss',
  less: 'less',
  html: 'html',
  htm: 'html',
  md: 'markdown',
  markdown: 'markdown',
  yml: 'yaml',
  yaml: 'yaml',
  toml: 'ini',
  ini: 'ini',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  py: 'python',
  rb: 'ruby',
  go: 'go',
  rs: 'rust',
  java: 'java',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  hpp: 'cpp',
  cs: 'csharp',
  php: 'php',
  sql: 'sql',
  xml: 'xml',
  svg: 'xml',
  dockerfile: 'dockerfile',
  graphql: 'graphql',
}

export function languageForPath(path: string): string {
  const name = path.split(/[\\/]/).pop() ?? path
  const lower = name.toLowerCase()
  if (lower === 'dockerfile') return 'dockerfile'
  if (lower === 'makefile') return 'makefile'
  const ext = lower.includes('.') ? lower.slice(lower.lastIndexOf('.') + 1) : ''
  return LANGUAGE_BY_EXT[ext] ?? 'plaintext'
}

// Monaco-backed code surface used by both preview and edit modes. It gives
// per-file syntax colouring, a line-number gutter, and — because Monaco's
// language services are enabled — real diagnostics (error squiggles) for
// TS/JS/JSON/CSS/HTML. Loaded lazily by DocumentViewer to keep the main bundle
// small.
export function CodeSurface({ path, value, editable = false, onChange, dark }: CodeSurfaceProps) {
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null)
  const [ready, setReady] = useState(false)

  const handleMount = useCallback<OnMount>((instance) => {
    editorRef.current = instance
    setReady(true)
  }, [])

  // Keep the editor text in sync when the file changes underneath it (new tab,
  // reload after save). Only writes when the model actually differs, so typing
  // is never interrupted.
  useEffect(() => {
    const instance = editorRef.current
    if (!instance) return
    if (instance.getValue() !== value) instance.setValue(value)
  }, [value])

  // Swap the theme with the shell.
  useEffect(() => {
    const instance = editorRef.current
    if (instance) {
      import('monaco-editor').then(monaco => monaco.editor.setTheme(dark ? 'vs-dark' : 'vs'))
    }
  }, [dark])

  return (
    <div className="relative min-h-0 flex-1 overflow-hidden bg-canvas">
      {!ready ? (
        <div className="absolute inset-0 z-10 flex items-center justify-center gap-2 bg-canvas text-ink-2">
          <Loader2 size={15} className="animate-spin" aria-hidden />
          <span className="text-[12px]">Loading editor…</span>
        </div>
      ) : null}
      <MonacoEditor
        height="100%"
        path={path}
        language={languageForPath(path)}
        value={value}
        theme={dark ? 'vs-dark' : 'vs'}
        onMount={handleMount}
        onChange={next => {
          if (editable && onChange) onChange(next ?? '')
        }}
        options={{
          readOnly: !editable,
          domReadOnly: !editable,
          minimap: { enabled: false },
          lineNumbers: 'on',
          glyphMargin: true,
          folding: true,
          renderLineHighlight: editable ? 'line' : 'none',
          scrollBeyondLastLine: false,
          fontSize: 12.5,
          fontFamily: 'var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)',
          fontLigatures: false,
          automaticLayout: true,
          wordWrap: 'off',
          padding: { top: 12, bottom: 12 },
          overviewRulerBorder: false,
          scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
          quickSuggestions: editable,
          suggestOnTriggerCharacters: editable,
        }}
      />
    </div>
  )
}
