import { cn } from "../lib/cn.js";

export type ChoiceOption = {
  value: string;
  label: string;
  hint?: string;
};

/**
 * A vertical list of single-select rows with a radio dot. Used by the config
 * panel and the agent question panel so both surfaces share one affordance.
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
  return (
    <div className="flex flex-col gap-1.5">
      {options.map(option => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => onSelect(option.value)}
            className={cn(
              "flex items-center justify-between gap-3 rounded-[var(--radius-control)] border px-3 py-2 text-left text-[13px] transition-colors duration-100 outline-none",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
              active
                ? "border-accent bg-accent-tint text-ink"
                : "border-line bg-surface text-ink-2 hover:bg-hover",
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
