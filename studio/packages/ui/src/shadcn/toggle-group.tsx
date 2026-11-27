import * as React from "react";
import * as ToggleGroupPrimitive from "@radix-ui/react-toggle-group";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../lib/cn.js";

const toggleGroupVariants = cva(
  "inline-flex items-center gap-0.5 rounded-[var(--radius-control)] bg-inset p-0.5",
);

const toggleGroupItemVariants = cva(
  [
    "inline-flex items-center justify-center gap-1.5 rounded-[var(--radius-chip)] px-2 py-1 text-[12px] font-medium whitespace-nowrap",
    "text-ink-3 transition-colors duration-100",
    "hover:bg-hover hover:text-ink-2",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]",
    "disabled:pointer-events-none disabled:opacity-50",
    "data-[state=on]:bg-surface data-[state=on]:text-ink data-[state=on]:shadow-[var(--shadow-card)]",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0",
  ],
  {
    variants: {
      size: {
        default: "h-7 min-w-7",
        sm: "h-6 min-w-6 px-1.5",
      },
    },
    defaultVariants: { size: "default" },
  },
);

function ToggleGroup({
  className,
  ...props
}: React.ComponentProps<typeof ToggleGroupPrimitive.Root>) {
  return (
    <ToggleGroupPrimitive.Root
      data-slot="toggle-group"
      className={cn(toggleGroupVariants(), className)}
      {...props}
    />
  );
}

function ToggleGroupItem({
  className,
  size,
  ...props
}: React.ComponentProps<typeof ToggleGroupPrimitive.Item> &
  VariantProps<typeof toggleGroupItemVariants>) {
  return (
    <ToggleGroupPrimitive.Item
      data-slot="toggle-group-item"
      className={cn(toggleGroupItemVariants({ size }), className)}
      {...props}
    />
  );
}

export { ToggleGroup, ToggleGroupItem, toggleGroupVariants, toggleGroupItemVariants };
