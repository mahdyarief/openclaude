"use client";

import { useRef } from "react";
import { ArrowUp } from "lucide-react";
import { cn } from "../lib/cn.js";
import { Button } from "../shadcn/button.js";
import { Textarea } from "../shadcn/input.js";

/* ─────────────────────────────────────────────────────────
 * CHAT COMPOSER — the input surface at the bottom of a chat.
 * Controlled: the caller owns the draft and decides what
 * sending means (ACP prompt, cancel, etc.).
 * ───────────────────────────────────────────────────────── */

export type ChatComposerLabels = {
  /** composer input placeholder */
  placeholder: string;
  /** label for the send action */
  send: string;
  /** label for the cancel action while a turn streams */
  cancel: string;
};

const DEFAULT_LABELS: ChatComposerLabels = {
  placeholder: "Ask anything…",
  send: "Send",
  cancel: "Stop",
};

export type ChatComposerProps = {
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
  labels?: Partial<ChatComposerLabels>;
  className?: string;
};

export default function ChatComposer({
  value,
  onChange,
  onSend,
  onCancel,
  disabled = false,
  streaming = false,
  labels,
  className,
}: ChatComposerProps) {
  const l = { ...DEFAULT_LABELS, ...labels };
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const canSend = value.trim().length > 0 && !disabled && !streaming;

  const send = () => {
    if (!canSend) return;
    onSend();
  };

  return (
    <div className={cn("w-full shrink-0 p-1.5", className)}>
      <div
        role="presentation"
        onClick={() => inputRef.current?.focus()}
        className="flex cursor-text flex-col gap-2 rounded-[var(--radius-control)] border border-line bg-field p-2.5 transition-[border-color,box-shadow] duration-150 focus-within:border-line-strong"
      >
        <Textarea
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
          className="min-h-0 resize-none border-0 bg-transparent p-0 text-[13px] leading-[1.4] focus:ring-0"
        />
        <div className="flex items-center justify-end">
          {streaming ? (
            <Button variant="outline" size="sm" aria-label={l.cancel} onClick={() => onCancel?.()}>
              {l.cancel}
            </Button>
          ) : (
            <Button
              size="icon"
              aria-label={l.send}
              disabled={!canSend}
              onClick={send}
              className="size-7 rounded-[var(--radius-control)]"
            >
              <ArrowUp size={16} strokeWidth={2.4} />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
