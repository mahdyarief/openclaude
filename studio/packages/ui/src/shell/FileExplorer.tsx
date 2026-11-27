"use client";

import { useEffect, useRef, useState } from "react";
import { File as FileIcon, Folder, FolderOpen, FolderTree, RefreshCw } from "lucide-react";

import { cn } from "../lib/cn.js";
import { Skeleton } from "../shadcn/skeleton.js";
import { ScrollArea } from "../shadcn/scroll-area.js";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../shadcn/collapsible.js";
import { Button } from "../shadcn/button.js";

/** One row in the explorer tree, as returned by the bridge listing. */
export type FileEntry = {
  name: string;
  /** path relative to the workspace root, POSIX separators */
  path: string;
  kind: "file" | "dir";
  size?: number;
};

/**
 * Listing state for one directory, keyed by its workspace-relative path.
 * `'.'` is the workspace root. `entries` is null until the first fetch lands.
 */
export type DirListing = {
  loading: boolean;
  error: string | null;
  entries: FileEntry[] | null;
};
export type FileDirs = Record<string, DirListing>;

export type FileExplorerProps = {
  /** directory listings keyed by workspace-relative path */
  dirs: FileDirs;
  /** true while the root listing loads for the first time */
  loading?: boolean;
  /** error from the root listing */
  error?: string | null;
  /** relative path of the currently open document, highlighted in the tree */
  selectedPath?: string | null;
  /** open a file in a document tab */
  onSelectFile?: (relativePath: string) => void;
  /** fetch (or refresh) one directory's entries */
  onLoadDir?: (relativePath: string) => void;
  onRefresh?: () => void;
};

export function FileExplorer({
  dirs,
  loading = false,
  error = null,
  selectedPath = null,
  onSelectFile,
  onLoadDir,
  onRefresh,
}: FileExplorerProps) {
  const root = dirs["."];

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <header className="flex h-11 shrink-0 items-center justify-between gap-2 border-b border-line px-2.5">
        <h2 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-2">
          <FolderTree size={13} className="text-ink-3" aria-hidden />
          Files
        </h2>
        <Button
          type="button"
          variant="quiet"
          size="icon"
          onClick={onRefresh}
          aria-label="Refresh files"
          className="size-7"
        >
          <RefreshCw size={15} />
        </Button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col divide-y divide-line">
        <div className="flex min-h-0 flex-1 flex-col">
          <ScrollArea className="min-h-0 flex-1">
            <div className="p-1.5">
              {error ? (
                <p className="px-2 py-3 text-sm" role="alert" style={{ color: "var(--red)" }}>
                  {error}
                </p>
              ) : loading && !root?.entries ? (
                <div className="flex flex-col gap-2 px-2 py-3" role="status" aria-live="polite">
                  <span className="sr-only">Loading files</span>
                  {Array.from({ length: 6 }, (_, i) => (
                    <Skeleton key={i} className="h-5" style={{ width: `${85 - ((i * 13) % 40)}%` }} />
                  ))}
                </div>
              ) : !root?.entries || root.entries.length === 0 ? (
                <p className="px-2 py-3 text-sm text-ink-3">No files in this project</p>
              ) : (
                <ul className="flex flex-col gap-0.5">
                  {root.entries.map(entry => (
                    <TreeNode
                      key={entry.path}
                      node={entry}
                      depth={0}
                      dirs={dirs}
                      selectedPath={selectedPath}
                      onSelectFile={onSelectFile}
                      onLoadDir={onLoadDir}
                    />
                  ))}
                </ul>
              )}
            </div>
          </ScrollArea>
        </div>
      </div>
    </div>
  );
}

function TreeNode({
  node,
  depth,
  dirs,
  selectedPath,
  onSelectFile,
  onLoadDir,
}: {
  node: FileEntry;
  depth: number;
  dirs: FileDirs;
  selectedPath: string | null;
  onSelectFile?: ((relativePath: string) => void) | undefined;
  onLoadDir?: ((relativePath: string) => void) | undefined;
}) {
  const indent = { paddingLeft: `${depth * 12 + 10}px` };

  if (node.kind === "dir") {
    return (
      <DirectoryNode
        node={node}
        depth={depth}
        dirs={dirs}
        selectedPath={selectedPath}
        onSelectFile={onSelectFile}
        onLoadDir={onLoadDir}
        indent={indent}
      />
    );
  }

  return (
    <li>
      <button
        type="button"
        onClick={() => onSelectFile?.(node.path)}
        style={indent}
        className={cn(
          "flex w-full items-center gap-2 rounded-[var(--radius-control)] py-1.5 pr-2 text-left text-sm",
          "text-ink-2 transition-colors duration-100 hover:bg-hover hover:text-ink",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]",
          selectedPath === node.path && "bg-hover-2 text-ink",
        )}
      >
        <FileIcon size={15} className="shrink-0" />
        <span className="truncate">{node.name}</span>
      </button>
    </li>
  );
}

function DirectoryNode({
  node,
  depth,
  dirs,
  selectedPath,
  onSelectFile,
  onLoadDir,
  indent,
}: {
  node: FileEntry;
  depth: number;
  dirs: FileDirs;
  selectedPath: string | null;
  onSelectFile?: ((relativePath: string) => void) | undefined;
  onLoadDir?: ((relativePath: string) => void) | undefined;
  indent: { paddingLeft: string };
}) {
  // Folders start collapsed; the first open triggers the lazy listing for that
  // directory. This keeps deep trees scannable instead of auto-expanding all.
  const [open, setOpen] = useState(false);
  const requested = useRef(false);
  const listing = dirs[node.path];

  useEffect(() => {
    if (!open || requested.current) return;
    requested.current = true;
    if (!listing?.entries) onLoadDir?.(node.path);
  }, [open, node.path, listing?.entries, onLoadDir]);

  return (
    <li>
      <Collapsible
        open={open}
        onOpenChange={next => {
          setOpen(next);
          if (next) onLoadDir?.(node.path);
        }}
      >
        <CollapsibleTrigger asChild>
          <Button
            type="button"
            variant="quiet"
            size="sm"
            style={indent}
            className="group h-auto w-full justify-start gap-2 py-1.5 pr-2 text-left font-normal"
          >
            <Folder className="group-data-[state=open]:hidden shrink-0" size={15} />
            <FolderOpen className="hidden group-data-[state=open]:block shrink-0" size={15} />
            <span className="truncate">{node.name}</span>
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          {listing?.loading ? (
            <div className="flex flex-col gap-1.5 py-1" style={{ paddingLeft: `${(depth + 1) * 12 + 10}px` }}>
              {Array.from({ length: 3 }, (_, i) => (
                <Skeleton key={i} className="h-4" style={{ width: `${60 - i * 10}%` }} />
              ))}
            </div>
          ) : listing?.error ? (
            <p
              className="py-1 pr-2 text-[12px]"
              role="alert"
              style={{ paddingLeft: `${(depth + 1) * 12 + 10}px`, color: "var(--red)" }}
            >
              {listing.error}
            </p>
          ) : listing?.entries && listing.entries.length > 0 ? (
            <ul className="flex flex-col gap-0.5">
              {listing.entries.map(child => (
                <TreeNode
                  key={child.path}
                  node={child}
                  depth={depth + 1}
                  dirs={dirs}
                  selectedPath={selectedPath}
                  onSelectFile={onSelectFile}
                  onLoadDir={onLoadDir}
                />
              ))}
            </ul>
          ) : listing?.entries ? (
            <p
              className="py-1 pr-2 text-[12px] text-ink-3"
              style={{ paddingLeft: `${(depth + 1) * 12 + 10}px` }}
            >
              Empty folder
            </p>
          ) : null}
        </CollapsibleContent>
      </Collapsible>
    </li>
  );
}
