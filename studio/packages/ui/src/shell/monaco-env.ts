// Monaco language services run in web workers. Vite bundles each worker when it
// is referenced via `new URL(... ?worker / import.meta.url)`. Language workers
// unlock real diagnostics (error squiggles) for TS/JS, JSON, CSS and HTML; the
// core editor worker backs everything else.
const EDITOR_WORKER = new URL(
  'monaco-editor/esm/vs/editor/editor.worker.js',
  import.meta.url,
)
const JSON_WORKER = new URL('monaco-editor/esm/vs/language/json/json.worker.js', import.meta.url)
const CSS_WORKER = new URL('monaco-editor/esm/vs/language/css/css.worker.js', import.meta.url)
const HTML_WORKER = new URL('monaco-editor/esm/vs/language/html/html.worker.js', import.meta.url)
const TS_WORKER = new URL(
  'monaco-editor/esm/vs/language/typescript/ts.worker.js',
  import.meta.url,
)

self.MonacoEnvironment = {
  getWorker(_workerId: string, label: string): Worker {
    void _workerId
    const make = (url: URL) => new Worker(url, { type: 'module' })
    if (label === 'json') return make(JSON_WORKER)
    if (label === 'css' || label === 'scss' || label === 'less') return make(CSS_WORKER)
    if (label === 'html' || label === 'handlebars' || label === 'razor') return make(HTML_WORKER)
    if (label === 'typescript' || label === 'javascript') return make(TS_WORKER)
    return make(EDITOR_WORKER)
  },
}

export {}
