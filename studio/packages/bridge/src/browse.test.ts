import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { browseDirectory, listRoots } from './browse.js'

const dirs: string[] = []
async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'ocs-browse-'))
  dirs.push(dir)
  return dir
}
afterEach(async () => {
  await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

describe('browseDirectory', () => {
  test('lists directories before files, sorted by name', async () => {
    const root = await tempDir()
    await mkdir(join(root, 'zeta'))
    await mkdir(join(root, 'alpha'))
    await writeFile(join(root, 'b.txt'), '')
    await writeFile(join(root, 'a.txt'), '')

    const listing = browseDirectory(root)
    expect(listing.path).toBe(root)
    expect(listing.entries.map(entry => `${entry.kind}:${entry.name}`)).toEqual([
      'dir:alpha',
      'dir:zeta',
      'file:a.txt',
      'file:b.txt',
    ])
    expect(listing.entries[0]?.path).toBe(join(root, 'alpha'))
  })

  test('defaults to the home directory when no path is given', () => {
    const listing = browseDirectory(undefined)
    expect(listing.path).toBe(homedir())
  })

  test('reports the parent, and null at the filesystem root', async () => {
    const root = await tempDir()
    expect(browseDirectory(root).parent).toBe(join(root, '..').replace(/[\\/]\.\.$/, ''))
    const fsRoot = browseDirectory(root).path.split(/[\\/]/)[0] + (process.platform === 'win32' ? '\\' : '/')
    expect(browseDirectory(fsRoot).parent).toBeNull()
  })

  test('rejects relative paths', () => {
    expect(() => browseDirectory('relative/path')).toThrow(/absolute/)
  })

  test('rejects a file path', async () => {
    const root = await tempDir()
    const file = join(root, 'file.txt')
    await writeFile(file, '')
    expect(() => browseDirectory(file)).toThrow(/not a directory/)
  })
})

describe('listRoots', () => {
  test('always includes home, with absolute paths', () => {
    const roots = listRoots()
    expect(roots[0]).toEqual({ name: 'Home', path: homedir() })
    expect(roots.every(root => root.path.length > 0)).toBe(true)
  })
})
