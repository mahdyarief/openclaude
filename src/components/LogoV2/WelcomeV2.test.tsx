import { describe, expect, test } from 'bun:test'
import React from 'react'
import { stripVTControlCharacters as stripAnsi } from 'node:util'
import { renderToString } from '../../utils/staticRender.js'
import { BRAND_NAME, BRAND_TAGLINE } from '../../constants/brand.js'
import { publicBuildVersion } from '../../utils/version.js'
import { WelcomeV2 } from './WelcomeV2.js'

describe('WelcomeV2', () => {
  test('renders greeting, monogram, and tagline', async () => {
    const plain = stripAnsi(await renderToString(<WelcomeV2 />, 80))

    expect(plain).toContain(`Welcome to ${BRAND_NAME}`)
    expect(plain).toContain('O C')
    expect(plain).toContain(BRAND_TAGLINE)
  })

  test('renders a compact, top-left panel', async () => {
    const plain = stripAnsi(await renderToString(<WelcomeV2 />, 80))
    const rows = plain.trimEnd().split('\n')

    expect(plain.startsWith(`Welcome to ${BRAND_NAME}`)).toBe(true)
    expect(rows.filter(row => row.includes('Welcome to'))).toHaveLength(1)
    for (const row of rows) {
      expect(row.length).toBeLessThanOrEqual(58)
    }
  })

  test('does not render the old mascot art', async () => {
    const plain = stripAnsi(await renderToString(<WelcomeV2 />, 80))

    expect(plain).not.toContain('█████████')
    expect(plain).not.toContain('██▄█████▄██')
  })
})
