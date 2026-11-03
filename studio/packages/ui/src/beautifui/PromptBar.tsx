"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { cn } from "../lib/cn.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../shadcn/dropdown-menu.js";

/* ─────────────────────────────────────────────────────────
 * PROMPT BAR
 * The bottom-of-chat composer. Controlled: the caller owns
 * the draft and the streaming state. Visually it is a card
 * with three rows — context tabs, the input field, and the
 * action row — so the affordances line up with what the
 * agent can actually do (attach, send, stop).
 * ───────────────────────────────────────────────────────── */

export type PromptTab = {
  /** stable id used for the aria-pressed check */
  id: string;
  /** visible label */
  label: string;
};

/** one entry in the permission-mode selector */
export type PromptBarModeOption = {
  /** stable id (the permission mode value) */
  id: string;
  /** visible label */
  label: string;
};

export type PromptBarLabels = {
  /** composer input placeholder */
  placeholder: string;
  /** label for the send action */
  send: string;
  /** label for the cancel action while a turn streams */
  cancel: string;
  /** label for the attach-file action */
  attach: string;
};

const DEFAULT_LABELS: PromptBarLabels = {
  placeholder: "Ask anything…",
  send: "Send",
  cancel: "Stop",
  attach: "Attach file",
};

export type PromptBarProps = {
  /** controlled draft text */
  value: string;
  onChange: (value: string) => void;
  /** fired when the user submits a non-empty draft (Enter or the send button) */
  onSend: () => void;
  /** fired while a turn is streaming instead of send */
  onCancel?: () => void;
  /** disable the send action (e.g. disconnected) */
  disabled?: boolean;
  /** a turn is in flight — swap send for cancel */
  streaming?: boolean;
  /** optional context tabs above the input (e.g. "Files", "Tools") */
  tabs?: PromptTab[];
  /** controlled active tab id; required when `tabs` is provided */
  activeTab?: string;
  onTabChange?: (id: string) => void;
  /** fired when the attach-file icon is clicked */
  onAttach?: () => void;
  /** agent permission mode; rendered as a selector in the action row */
  modes?: PromptBarModeOption[];
  /** the currently selected mode id */
  mode?: string;
  /** fired when the user picks a different permission mode */
  onModeChange?: (mode: string) => void;
  labels?: Partial<PromptBarLabels>;
  className?: string;
  /** slash commands advertised by the agent, powering the `/` menu */
  commands?: Array<{ name: string; description: string }>;
};

// The last `/word` being typed at the end of the draft, if any. Mirrors the
// upstream BeautifulUI parser: a leading `/` on a fresh token opens the menu.
function parseSlash(draft: string): { query: string; start: number } | null {
  const match = /(^|\s)\/([\w:-]*)$/.exec(draft);
  if (!match) return null;
  return { query: (match[2] ?? "").toLowerCase(), start: match.index + (match[1] ?? "").length };
}

export default function PromptBar({
  value,
  onChange,
  onSend,
  onCancel,
  disabled = false,
  streaming = false,
  tabs,
  activeTab,
  onTabChange,
  onAttach,
  modes,
  mode,
  onModeChange,
  labels,
  className,
  commands = [],
}: PromptBarProps) {
  const l = { ...DEFAULT_LABELS, ...labels };
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const canSend = value.trim().length > 0 && !disabled && !streaming;
  const activeMode = modes?.find(option => option.id === mode) ?? modes?.[0];

  const slash = parseSlash(value);
  const matches = slash
    ? commands
        .filter(command => command.name.toLowerCase().startsWith(slash.query))
        .slice(0, 8)
    : [];
  const menuOpen = slash !== null && matches.length > 0;
  const [active, setActive] = useState(0);

  // Reset the highlight whenever the query or the result set changes, and keep
  // it in range when filtering shrinks the list.
  useEffect(() => {
    setActive(0);
  }, [slash?.query, matches.length]);

  const pick = (name: string) => {
    if (!slash) return;
    const before = value.slice(0, slash.start);
    onChange(`${before}/${name} `);
    inputRef.current?.focus();
  };

  // Auto-grow the textarea up to ~6 lines, then scroll. `scrollHeight` is the
  // only reliable measure for a textarea that starts at one row.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 132)}px`;
  }, [value]);

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!menuOpen) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive(i => (i + 1) % matches.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive(i => (i - 1 + matches.length) % matches.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const match = matches[active];
      if (match) pick(match.name);
    } else if (event.key === "Escape") {
      event.preventDefault();
      onChange(value.slice(0, slash.start));
    }
  };

  const send = () => {
    if (!canSend) return;
    onSend();
  };

  return (
    <div
      className={cn(
        "flex w-full flex-col rounded-[var(--radius-card)] border border-line bg-surface shadow-[var(--shadow-card)]",
        className,
      )}
    >
      {tabs && tabs.length > 0 ? (
        <div className="flex shrink-0 items-center justify-between border-b border-line p-1.5">
          <div className="flex items-center gap-0.5">
            {tabs.map((tab) => {
              const active = tab.id === activeTab;
              return (
                <button
                  key={tab.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => onTabChange?.(tab.id)}
                  className={cn(
                    "rounded-[6px] px-2 py-[3px] text-[13px] transition-[background-color,opacity] duration-100",
                    active ? "bg-field text-ink" : "text-ink-2 opacity-60 hover:opacity-100",
                  )}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      <div
        role="presentation"
        onClick={() => inputRef.current?.focus()}
        className="relative flex cursor-text flex-col gap-2 rounded-b-[var(--radius-card)] bg-field p-2.5 transition-[border-color,box-shadow] duration-150 focus-within:bg-surface"
      >
        {menuOpen ? (
          <div
            role="listbox"
            aria-label="Slash commands"
            className="absolute inset-x-2 bottom-full z-10 mb-1 rounded-[var(--radius-card)] border border-line bg-surface p-1 shadow-[var(--shadow-card)]"
            style={{ animation: "pop-in 180ms cubic-bezier(0.23,1,0.32,1) both", transformOrigin: "bottom center" }}
          >
            {matches.map((command, i) => (
              <button
                key={command.name}
                type="button"
                role="option"
                aria-selected={i === active}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(command.name)}
                className={cn(
                  "flex h-9 w-full items-center gap-2 rounded-[var(--radius-chip)] px-2 text-left transition-colors duration-100",
                  i === active ? "bg-hover" : "hover:bg-hover",
                )}
              >
                <span className="shrink-0 rounded-[var(--radius-chip)] border border-accent/30 bg-accent-tint px-1.5 py-0.5 font-mono text-[12px] font-medium text-accent-ink">
                  /{command.name}
                </span>
                <span className="min-w-0 flex-1 truncate text-[12px] text-ink-3">{command.description}</span>
              </button>
            ))}
            <div className="mt-1 border-t border-line px-2 pt-1.5 pb-1 text-[11px] text-ink-3">
              Type to filter commands · ↑↓ to move · Enter to insert
            </div>
          </div>
        ) : null}
        <textarea
          ref={inputRef}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (menuOpen) {
              onKeyDown(event);
              if (event.defaultPrevented) return;
            }
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              send();
            }
          }}
          placeholder={l.placeholder}
          aria-label="Chat prompt"
          disabled={disabled}
          rows={1}
          className="min-h-[1.4em] resize-none bg-transparent text-[13px] leading-[1.4] text-ink outline-none placeholder:text-ink-3 disabled:opacity-60"
        />
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <span className="hidden items-center gap-1 text-[10.5px] text-ink-3 min-[420px]:inline-flex">
              <kbd className="rounded-[4px] border border-line bg-canvas px-1 py-0.5 font-sans">Enter</kbd>
              to send
            </span>
            <button
              type="button"
              aria-label={l.attach}
              onClick={() => onAttach?.()}
              disabled={!onAttach}
              className="inline-flex size-7 items-center justify-center rounded-[6px] text-ink-3 transition-colors duration-100 enabled:hover:bg-hover enabled:hover:text-ink-2 disabled:opacity-40"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
              </svg>
            </button>
            {modes && modes.length > 0 && activeMode ? (
              <DropdownMenu>
                <DropdownMenuTrigger
                  aria-label="Permission mode"
                  className="inline-flex h-7 items-center gap-1 rounded-[6px] px-1.5 text-[11.5px] text-ink-2 transition-colors duration-100 hover:bg-hover hover:text-ink data-[state=open]:bg-hover"
                >
                  <span aria-hidden className="size-1.5 rounded-full bg-orange" />
                  {activeMode.label}
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="m6 9 6 6 6-6" />
                  </svg>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="min-w-[11rem]">
                  {modes.map(option => (
                    <DropdownMenuItem
                      key={option.id}
                      onSelect={() => onModeChange?.(option.id)}
                      className={cn(
                        "justify-between",
                        option.id === activeMode.id && "font-medium",
                      )}
                    >
                      {option.label}
                      {option.id === activeMode.id ? (
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                          <path d="M20 6 9 17l-5-5" />
                        </svg>
                      ) : null}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </div>
          {streaming ? (
            <button
              type="button"
              aria-label={l.cancel}
              onClick={() => onCancel?.()}
              className="inline-flex h-7 items-center justify-center rounded-[8px] border border-line-strong px-2.5 text-[12px] text-ink transition-[background-color,transform] duration-200 hover:bg-hover active:scale-[0.96]"
            >
              {l.cancel}
            </button>
          ) : (
            <button
              type="button"
              aria-label={l.send}
              disabled={!canSend}
              onClick={send}
              className={cn(
                "inline-flex size-7 items-center justify-center rounded-[8px] transition-[background-color,color,transform] duration-200",
                "enabled:active:scale-[0.96]",
              )}
              style={{
                background: canSend ? "var(--ink)" : "var(--line-strong)",
                color: canSend ? "var(--surface)" : "var(--ink-2)",
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M12 19V5M5 12l7-7 7 7" />
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
