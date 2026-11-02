import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../lib/cn.js";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-[var(--radius-control)] text-sm font-medium transition-[transform,background-color,opacity] duration-150 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:pointer-events-none disabled:opacity-50 active:scale-[0.98]",
  {
    variants: {
      variant: {
        default: "bg-ink text-surface shadow-[var(--shadow-btn)] hover:opacity-90",
        secondary:
          "bg-surface text-ink shadow-[var(--shadow-btn)] hover:bg-inset aria-expanded:bg-hover",
        ghost: "bg-hover-2 text-ink hover:bg-line-strong",
        accent: "bg-accent text-white hover:brightness-95",
        outline: "border border-line bg-surface text-ink hover:bg-hover",
        quiet: "text-ink-2 hover:bg-hover hover:text-ink",
        link: "text-accent-ink underline-offset-4 hover:underline",
        /* aliases kept for BeautifulUI call sites */
        primary: "bg-ink text-surface shadow-[var(--shadow-btn)] hover:opacity-90",
        success: "bg-green text-white hover:brightness-95",
      },
      size: {
        xs: "h-7 px-2.5 text-[12px]",
        sm: "h-7 px-2.5 text-[13px]",
        md: "h-9 px-3.5",
        lg: "h-10 px-5",
        icon: "size-8",
      },
    },
    defaultVariants: { variant: "default", size: "md" },
  },
);

export type ButtonProps = React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean };

function Button({ className, variant, size, asChild = false, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}

export { Button, buttonVariants };
