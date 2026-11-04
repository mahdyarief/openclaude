import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { cn } from "../lib/cn.js";

export type ChoiceOption = {
  value: string;
  label: string;
  hint?: string;
};

/**
 * A vertical list of single-select rows with a radio dot. Used by the config
 * panel and the agent question panel so both surfaces share one affordance.
 *
 * Keyboard: ↑/↓ move the active row, Enter/Space commits the focused option.
 * The active row is kept in sync with the controlled `value`, so reordering
 * options or switching groups never leaves the focus ring on a stale row.
 */
export function ChoiceRow({
  value,
  options,
  onSelect,
}: {
  value: string;
  options: ChoiceOption[];
  onSelect: (value: string) => void;
}) {
  const activeIndex = Math.max(
    0,
    options.findIndex(option => option.value === value),
  );
  const [focused, setFocused] = useState(activeIndex);
  const rowRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // Follow the controlled value when the option set changes (e.g. switching
  // between the model/theme/provider groups inside the config panel).
  useEffect(() => {
    setFocused(activeIndex);
  }, [activeIndex]);

  useEffect(() => {
    const el = rowRefs.current[focused];
    el?.focus();
  }, [focused]);

  const move = (delta: number) => {
    if (options.length === 0) return;
    setFocused(current => (current + delta + options.length) % options.length);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      move(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      move(-1);
    } else if (event.key === "Enter" || event.key === " ") {
      const option = options[focused];
      if (option) onSelect(option.value);
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      {options.map((option, index) => {
        const active = option.value === value;
        const isFocused = index === focused;
        return (
          <button
            key={option.value}
            ref={el => {
              rowRefs.current[index] = el;
            }}
            type="button"
            aria-pressed={active}
            tabIndex={isFocused ? 0 : -1}
            onFocus={() => setFocused(index)}
            onClick={() => onSelect(option.value)}
            onKeyDown={onKeyDown}
            className={cn(
              "flex items-center justify-between gap-3 rounded-[var(--radius-control)] border px-3 py-2 text-left text-[13px] transition-colors duration-100 outline-none",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
              active
                ? "border-accent bg-accent-tint text-ink"
                : "border-line bg-surface text-ink-2 hover:bg-hover",
              isFocused && !active
                ? "ring-2 ring-accent/30 ring-offset-0"
                : undefined,
            )}
          >
            <span className="flex flex-col">
              <span className="font-medium text-ink">{option.label}</span>
              {option.hint ? (
                <span className="text-[11.5px] text-ink-3">{option.hint}</span>
              ) : null}
            </span>
            <span
              aria-hidden
              className={cn(
                "flex size-4 shrink-0 items-center justify-center rounded-full border",
                active ? "border-accent bg-accent text-white" : "border-line",
              )}
            >
              {active ? (
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 6L9 17l-5-5" />
                </svg>
              ) : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}