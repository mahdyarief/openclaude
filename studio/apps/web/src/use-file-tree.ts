import { useCallback, useEffect, useRef, useState } from 'react'
import {
  listWorkspaceDirectory,
  readWorkspaceFile,
  saveWorkspaceFile,
  type FsEntry,
  type FsFile,
} from '@openclaude-studio/acp'

// State of one directory's listing, keyed by its path relative to the workspace
// root. `'.'` is the root; nested dirs use POSIX-style relative paths like
// `src/components`. Entries are fetched lazily the first time a folder opens.
export type DirListing = {
  loading: boolean
  error: string | null
  entries: FsEntry[] | null
}
export type TreeMap = Record<string, DirListing>

export type FileTreeState = {
  /** directory listings keyed by relative path; '.' is the workspace root */
  dirs: TreeMap
  /** true while the workspace root is loading for the first time */
  loading: boolean
  /** error from the root listing, if any */
  error: string | null
  /** fetch (or refresh) a directory's entries; '.' loads the root */
  loadDir: (relPath: string) => void
  /** reload the root, dropping any expanded folders' cached entries */
  refresh: () => void
}

// Join two relative paths with a single POSIX separator.
function joinPath(base: string, name: string): string {
  if (base === '.' || base === '') return name
  return `${base}/${name}`
}

export function useFileTree(baseUrl: string, token: string, root?: string): FileTreeState {
  const [dirs, setDirs] = useState<TreeMap>({})
  const abortRef = useRef<AbortController | null>(null)
  const inFlight = useRef<Set<string>>(new Set())

  const loadDir = useCallback(
    (relPath: string) => {
      if (!root) return
      // Don't double-fetch a directory that's already loading or loaded.
      if (inFlight.current.has(relPath)) return
      inFlight.current.add(relPath)

      const controller = new AbortController()
      abortRef.current = controller
      setDirs(prev => ({
        ...prev,
        [relPath]: {
          loading: true,
          error: null,
          entries: prev[relPath]?.entries ?? null,
        },
      }))

      listWorkspaceDirectory(baseUrl, token, root, relPath)
        .then(data => {
          if (controller.signal.aborted) return
          setDirs(prev => ({
            ...prev,
            [relPath]: { loading: false, error: null, entries: data.entries },
          }))
        })
        .catch(cause => {
          if (controller.signal.aborted) return
          setDirs(prev => ({
            ...prev,
            [relPath]: {
              loading: false,
              error: cause instanceof Error ? cause.message : String(cause),
              entries: null,
            },
          }))
        })
        .finally(() => {
          inFlight.current.delete(relPath)
        })
    },
    [baseUrl, token, root],
  )

  useEffect(() => {
    if (!root) {
      setDirs({})
      return
    }
    loadDir('.')
    return () => abortRef.current?.abort()
  }, [loadDir, root])

  const refresh = useCallback(() => {
    if (!root) return
    setDirs({})
    loadDir('.')
  }, [loadDir, root])

  const rootState = dirs['.']

  return {
    dirs,
    loading: rootState?.loading ?? false,
    error: rootState?.error ?? null,
    loadDir,
    refresh,
  }
}

export type FileContentState = {
  file: FsFile | null
  loading: boolean
  error: string | null
  /** true while a save request is in flight */
  saving: boolean
  /** error from the most recent save attempt, cleared on the next save */
  saveError: string | null
  /** write `text` to the current file; resolves to true on success */
  save: (text: string) => Promise<boolean>
}

// Loads the text preview of a single workspace file. Pass `path: null` to
// clear the current preview (e.g. when the selection changes to a directory).
export function useFileContent(
  baseUrl: string,
  token: string,
  root: string | undefined,
  path: string | null,
): FileContentState {
  const [file, setFile] = useState<FsFile | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const save = useCallback(
    async (text: string): Promise<boolean> => {
      if (!root || !path) return false
      setSaving(true)
      setSaveError(null)
      try {
        const next = await saveWorkspaceFile(baseUrl, token, root, path, text)
        setFile(next)
        return true
      } catch (cause) {
        setSaveError(cause instanceof Error ? cause.message : String(cause))
        return false
      } finally {
        setSaving(false)
      }
    },
    [baseUrl, token, root, path],
  )

  useEffect(() => {
    abortRef.current?.abort()
    if (!root || !path) {
      setFile(null)
      setError(null)
      setLoading(false)
      setSaving(false)
      setSaveError(null)
      return
    }
    const controller = new AbortController()
    abortRef.current = controller
    setLoading(true)
    setError(null)
    setSaveError(null)
    readWorkspaceFile(baseUrl, token, root, path)
      .then(data => {
        if (!controller.signal.aborted) setFile(data)
      })
      .catch(cause => {
        if (!controller.signal.aborted) {
          setError(cause instanceof Error ? cause.message : String(cause))
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [baseUrl, token, root, path])

  return { file, loading, error, saving, saveError, save }
}
