"use client";

import { lazy, Suspense, useEffect, useState } from "react";
import { Eye, FileText, Loader2, Pencil, Save } from "lucide-react";
import ReactMarkdown from "react-markdown";

import { Button } from "../shadcn/button.js";
import { ScrollArea } from "../shadcn/scroll-area.js";
import { Skeleton } from "../shadcn/skeleton.js";
import { ToggleGroup, ToggleGroupItem } from "../shadcn/toggle-group.js";

// Monaco is heavy (~2 MB), so it is only pulled in when a document is opened.
const CodeSurface = lazy(() =>
  import("./CodeSurface.js").then(m => ({ default: m.CodeSurface })),
);

export type DocumentSource = {
  /** workspace-relative path, shown in the header */
  path: string;
  /** rendered text content (already decoded) */
  text: string;
  /** true when the file is binary or too large to render as text */
  truncated: boolean;
  size: number;
  loading?: boolean;
  error?: string | null;
};

export type DocumentViewerProps = {
  source: DocumentSource;
  /**
   * Fired with the edited text when the user saves. The parent performs the
   * network write and is responsible for refreshing `source.text`. While the
   * save is in flight, pass `saving={true}` to disable the controls.
   */
  onSave?: (text: string) => void;
  /** true while a save request is pending */
  saving?: boolean;
  /** error returned from the last save attempt */
  saveError?: string | null;
};

// Preview: Markdown files render as prose; every other text file renders in a
// read-only Monaco surface so it gets syntax colouring by type. Edit: the same
// Monaco surface becomes editable, with line numbers, syntax colouring, and
// language-service diagnostics (error squiggles). The viewer is a pure
// presenter: it tracks a local draft + dirty flag and hands edits back through
// `onSave`, so the bridge round-trip lives on the caller.
type Mode = "preview" | "edit";

export function DocumentViewer({
  source,
  onSave,
  saving = false,
  saveError = null,
}: DocumentViewerProps) {
  const isMarkdown = /\.(md|markdown|mdx)$/i.test(source.path);
  const canEdit = !source.truncated && !source.loading && !source.error;

  const [mode, setMode] = useState<Mode>("preview");
  const [draft, setDraft] = useState(source.text);
  const [dirty, setDirty] = useState(false);
  const [dark, setDark] = useState(
    () => typeof document !== "undefined" && document.documentElement.classList.contains("dark"),
  );

  // Re-sync the draft whenever the underlying file changes (new tab, reload,
  // or a successful save that returns fresh bytes). Drops any un-saved edits
  // because the source is now authoritative.
  useEffect(() => {
    setDraft(source.text);
    setDirty(false);
  }, [source.text]);

  // Keep Monaco's theme in step with the shell's `.dark` class.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    const sync = () => setDark(root.classList.contains("dark"));
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  // Kept above the early returns: hooks must run in the same order on every
  // render, and loading/error/truncated states render before the body below.
  const shownText = dirty ? draft : source.text;

  if (source.loading) {
    return (
      <div className="flex h-full flex-col gap-3 p-6">
        <div className="flex items-center gap-2 text-ink-2">
          <Loader2 size={16} className="animate-spin" aria-hidden />
          <span className="font-mono text-[12px]">{source.path}</span>
        </div>
        <div className="flex flex-col gap-2">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-4" style={{ width: `${90 - i * 6}%` }} />
          ))}
        </div>
      </div>
    );
  }

  if (source.error) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <p className="text-sm" role="alert" style={{ color: "var(--red)" }}>
          {source.error}
        </p>
      </div>
    );
  }

  if (!canEdit) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center">
        <p className="text-sm text-ink-3">
          {source.truncated
            ? source.size > 0
              ? "Can't preview this file as text (binary or too large)."
              : "This file is empty."
            : "This file can't be edited here."}
        </p>
      </div>
    );
  }

  function handleChange(value: string) {
    setDraft(value);
    setDirty(value !== source.text);
  }

  function handleSave() {
    if (!dirty || saving) return;
    onSave?.(draft);
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-line px-4 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <FileText size={15} className="shrink-0 text-ink-3" aria-hidden />
          <span className="truncate font-mono text-[12px] text-ink-2">{source.path}</span>
          {dirty ? (
            <span className="shrink-0 text-[11px] text-orange" aria-label="Unsaved changes">
              ●
            </span>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {saveError ? (
            <span
              className="max-w-[220px] truncate text-[11px]"
              role="alert"
              style={{ color: "var(--red)" }}
            >
              {saveError}
            </span>
          ) : null}
          <ToggleGroup
            type="single"
            value={mode}
            onValueChange={value => {
              if (value) setMode(value as Mode);
            }}
            aria-label="View mode"
          >
            <ToggleGroupItem value="preview" aria-label="Preview" title="Preview">
              <Eye size={14} />
            </ToggleGroupItem>
            <ToggleGroupItem value="edit" aria-label="Edit" title="Edit">
              <Pencil size={14} />
            </ToggleGroupItem>
          </ToggleGroup>
          <Button
            type="button"
            variant="accent"
            size="sm"
            onClick={handleSave}
            disabled={!dirty || saving}
            aria-label="Save file"
            className="gap-1.5"
          >
            {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
            Save
          </Button>
        </div>
      </header>

      {mode === "preview" && isMarkdown ? (
        <ScrollArea className="min-h-0 flex-1">
          <div className="mx-auto max-w-[820px] px-6 py-6">
            {shownText.length === 0 ? (
              <p className="text-sm text-ink-3">This file is empty.</p>
            ) : (
              <div className="openclaude-prose text-ink">
                <ReactMarkdown>{shownText}</ReactMarkdown>
              </div>
            )}
          </div>
        </ScrollArea>
      ) : (
        <Suspense
          fallback={
            <div className="flex min-h-0 flex-1 items-center justify-center gap-2 text-ink-2">
              <Loader2 size={15} className="animate-spin" aria-hidden />
              <span className="text-[12px]">Loading editor…</span>
            </div>
          }
        >
          <CodeSurface
            path={source.path}
            value={shownText}
            editable={mode === "edit"}
            dark={dark}
            {...(mode === "edit" ? { onChange: handleChange } : {})}
          />
        </Suspense>
      )}
    </div>
  );
}
