import { describe, expect, test } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { FileExplorer, type FileDirs, type FileEntry } from './FileExplorer.js'

const rootEntries: FileEntry[] = [
  { name: 'src', path: 'src', kind: 'dir' },
  { name: 'README.md', path: 'README.md', kind: 'file' },
]
const dirs: FileDirs = {
  '.': { loading: false, error: null, entries: rootEntries },
  src: {
    loading: false,
    error: null,
    entries: [{ name: 'app.ts', path: 'src/app.ts', kind: 'file' }],
  },
}

describe('FileExplorer', () => {
  test('renders root entries from the dirs map', () => {
    const html = renderToStaticMarkup(<FileExplorer dirs={dirs} />)
    expect(html).toContain('src')
    expect(html).toContain('README.md')
  })

  test('marks the open document row as selected', () => {
    const html = renderToStaticMarkup(
      <FileExplorer dirs={dirs} selectedPath="README.md" />,
    )
    expect(html).toContain('bg-hover-2')
  })

  test('shows a loading skeleton, not children, for an open folder that is not yet loaded', () => {
    const html = renderToStaticMarkup(
      <FileExplorer dirs={{ '.': { loading: false, error: null, entries: rootEntries } }} />,
    )
    expect(html).toContain('src')
    expect(html).not.toContain('app.ts')
  })

  test('renders the empty-project state', () => {
    const html = renderToStaticMarkup(
      <FileExplorer dirs={{ '.': { loading: false, error: null, entries: [] } }} />,
    )
    expect(html).toContain('No files in this project')
  })

  test('renders a root loading skeleton', () => {
    const html = renderToStaticMarkup(<FileExplorer dirs={{}} loading />)
    expect(html).toContain('Loading files')
  })

  test('renders an error message', () => {
    const html = renderToStaticMarkup(<FileExplorer dirs={{}} error="boom" />)
    expect(html).toContain('boom')
  })
})
