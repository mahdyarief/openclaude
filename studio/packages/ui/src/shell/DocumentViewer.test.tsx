import { describe, expect, test } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { DocumentViewer, type DocumentSource } from './DocumentViewer.js'

const md: DocumentSource = {
  path: 'README.md',
  text: '# Title\n\nHello world',
  truncated: false,
  size: 20,
}

describe('DocumentViewer', () => {
  test('renders the path header', () => {
    const html = renderToStaticMarkup(<DocumentViewer source={md} />)
    expect(html).toContain('README.md')
  })

  test('renders markdown as prose in preview mode', () => {
    const html = renderToStaticMarkup(<DocumentViewer source={md} />)
    expect(html).toContain('Title')
    expect(html).toContain('openclaude-prose')
  })

  test('renders plain text through Monaco in preview mode', () => {
    const html = renderToStaticMarkup(
      <DocumentViewer source={{ ...md, path: 'a.txt' }} />,
    )
    // Non-markdown files go through Monaco (lazy/Suspense), so SSR shows the
    // loading fallback. The key invariant is that markdown prose is not used.
    expect(html).not.toContain('openclaude-prose')
    expect(html).toContain('Loading editor')
  })

  test('shows a loading skeleton', () => {
    const html = renderToStaticMarkup(
      <DocumentViewer source={{ ...md, text: '', loading: true }} />,
    )
    expect(html).toContain('animate-spin')
  })

  test('shows an error message', () => {
    const html = renderToStaticMarkup(
      <DocumentViewer source={{ ...md, text: '', error: 'boom' }} />,
    )
    expect(html).toContain('boom')
  })

  test('rejects editing truncated/binary files', () => {
    const html = renderToStaticMarkup(
      <DocumentViewer source={{ ...md, truncated: true, size: 1000, text: '' }} />,
    )
    expect(html).toContain('preview this file as text')
  })

  test('exposes the save and view-mode controls', () => {
    const html = renderToStaticMarkup(<DocumentViewer source={md} />)
    expect(html).toContain('View mode')
    expect(html).toContain('aria-label="Save file"')
  })

  test('offers preview and edit modes', () => {
    const html = renderToStaticMarkup(<DocumentViewer source={md} />)
    expect(html).toContain('aria-label="Preview"')
    expect(html).toContain('aria-label="Edit"')
  })

  test('surfaces a save error', () => {
    const html = renderToStaticMarkup(
      <DocumentViewer source={md} saveError="write failed" />,
    )
    expect(html).toContain('write failed')
  })
})
