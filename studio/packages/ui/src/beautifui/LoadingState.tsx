"use client";

import { cn } from "../lib/cn.js";

/* ─────────────────────────────────────────────────────────
 * LOADING STATE
 * Three real loading shapes for the studio:
 *   Spinner  — an indeterminate ring for short waits
 *   Dots     — three equalising dots for streaming/thinking
 *   Skeleton — placeholder rows for a list or transcript
 * All motion is CSS-only and respects prefers-reduced-motion.
 * ───────────────────────────────────────────────────────── */

export type LoadingVariant = "Spinner" | "Dots" | "Skeleton";

export type LoadingStateLabels = {
  /** accessible label announced while loading */
  label: string;
};

const DEFAULT_LABELS: LoadingStateLabels = { label: "Loading" };

export type LoadingStateProps = {
  variant?: LoadingVariant;
  /** number of skeleton rows (Skeleton only) */
  rows?: number;
  labels?: Partial<LoadingStateLabels>;
  className?: string;
};

export default function LoadingState({
  variant = "Spinner",
  rows = 3,
  labels,
  className,
}: LoadingStateProps) {
  const l = { ...DEFAULT_LABELS, ...labels };

  return (
    <div role="status" aria-live="polite" className={cn("flex flex-col gap-2", className)}>
      <span className="sr-only">{l.label}</span>

      {variant === "Spinner" ? (
        <span
          aria-hidden
          className="inline-block size-4 rounded-full border-2 border-line-strong border-t-ink"
          style={{ animation: "spin 700ms linear infinite" }}
        />
      ) : null}

      {variant === "Dots" ? (
        <span aria-hidden className="inline-flex items-center gap-1">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="inline-block size-1.5 rounded-full bg-ink-2"
              style={{ animation: `eq-bounce 900ms ${i * 140}ms ease-in-out infinite` }}
            />
          ))}
        </span>
      ) : null}

      {variant === "Skeleton" ? (
        <div aria-hidden className="flex w-full flex-col gap-2">
          {Array.from({ length: rows }).map((_, i) => (
            <div
              key={i}
              className="h-3 rounded-[var(--radius-chip)] bg-hover-2"
              style={{
                width: `${[92, 78, 64, 86][i % 4]}%`,
                animation: `shimmer-text 1.6s ${i * 120}ms linear infinite`,
                backgroundImage:
                  "linear-gradient(90deg, var(--hover-2) 35%, var(--line-soft) 50%, var(--hover-2) 65%)",
                backgroundSize: "200% 100%",
              }}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
