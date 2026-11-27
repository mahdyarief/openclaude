import { cn } from "../lib/cn.js";

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("animate-pulse rounded-[var(--radius-control)] bg-line-strong/40", className)}
      {...props}
    />
  );
}

export { Skeleton };
