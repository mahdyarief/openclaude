import * as React from "react";
import { cn } from "../lib/cn.js";

function Input({ className, ref, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      ref={ref}
      data-slot="input"
      className={cn(
        "flex h-9 w-full rounded-[var(--radius-control)] border border-line bg-field px-2.5 py-1.5 text-[13px] text-ink outline-none transition-colors duration-100",
        "placeholder:text-ink-3",
        "focus:border-accent focus-visible:ring-2 focus-visible:ring-accent/30",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "aria-[invalid=true]:border-red",
        className,
      )}
      {...props}
    />
  );
}

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex min-h-[60px] w-full rounded-[var(--radius-control)] border border-line bg-field px-2.5 py-2 text-[13px] leading-relaxed text-ink outline-none transition-colors duration-100",
        "placeholder:text-ink-3",
        "focus:border-accent focus-visible:ring-2 focus-visible:ring-accent/30",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

function Label({ className, ...props }: React.ComponentProps<"label">) {
  return (
    <label
      data-slot="label"
      className={cn(
        "text-[12.5px] font-medium text-ink-2",
        className,
      )}
      {...props}
    />
  );
}

export { Input, Textarea, Label };
