"use client";

import { useEffect, useRef } from "react";
import { cn } from "../lib/cn.js";

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
  labels?: Partial<PromptBarLabels>;
  className?: string;
};

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
  labels,
  className,
}: PromptBarProps) {
  const l = { ...DEFAULT_LABELS, ...labels };
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const canSend = value.trim().length > 0 && !disabled && !streaming;

  // Auto-grow the textarea up to ~6 lines, then scroll. `scrollHeight` is the
  // only reliable measure for a textarea that starts at one row.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 132)}px`;
  }, [value]);

  const send = () => {
    if (!canSend) return;
    onSend();
  };

  return (
    <div
      className={cn(
        "flex w-full flex-col overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface shadow-[var(--shadow-card)]",
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
        className="flex cursor-text flex-col gap-2 bg-field p-2.5 transition-[border-color,box-shadow] duration-150 focus-within:bg-surface"
      >
        <textarea
          ref={inputRef}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
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
