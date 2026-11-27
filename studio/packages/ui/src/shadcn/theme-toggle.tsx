import * as React from "react";
import { flushSync } from "react-dom";
import { Moon, Sun } from "lucide-react";
import { Button } from "./button.js";
import { cn } from "../lib/cn.js";

type TransitionVariant =
  | "circle"
  | "square"
  | "triangle"
  | "diamond"
  | "hexagon"
  | "rectangle"
  | "star";

export type ThemeToggleProps = {
  /** true when the document is in dark mode */
  dark: boolean;
  /** flips the theme; the caller owns the .dark class on <html> */
  onToggle: () => void;
  className?: string;
  /** clip-path shape of the reveal; defaults to circle (magicui default) */
  variant?: TransitionVariant;
  /** expand from the viewport center instead of the button */
  fromCenter?: boolean;
  /** transition duration in ms */
  duration?: number;
};

function polygonCollapsed(point: string, vertexCount: number): string {
  const pairs = Array.from({ length: vertexCount }, () => point).join(", ");
  return `polygon(${pairs})`;
}

// All coordinates are percentages of the snapshot reference box: Chrome 150
// renders absolute px clip-path coordinates on ::view-transition-new(root)
// unscaled on fractional display scales (e.g. Windows 150%) for the first
// transition after load, so px values land at the wrong position (#989).
function getThemeTransitionClipPaths(
  variant: TransitionVariant,
  cx: number,
  cy: number,
  maxRadius: number,
  viewportWidth: number,
  viewportHeight: number,
): [string, string] {
  const toX = (x: number) => `${(x / viewportWidth) * 100}%`;
  const toY = (y: number) => `${(y / viewportHeight) * 100}%`;
  const point = (x: number, y: number) => `${toX(x)} ${toY(y)}`;
  // circle() percentage radii resolve against hypot(w, h) / sqrt(2) of the box.
  const toRadius = (r: number) =>
    `${(r / (Math.hypot(viewportWidth, viewportHeight) / Math.SQRT2)) * 100}%`;

  switch (variant) {
    case "circle":
      return [
        `circle(0% at ${point(cx, cy)})`,
        `circle(${toRadius(maxRadius)} at ${point(cx, cy)})`,
      ];
    case "square": {
      const halfW = Math.max(cx, viewportWidth - cx);
      const halfH = Math.max(cy, viewportHeight - cy);
      const halfSide = Math.max(halfW, halfH) * 1.05;
      const end = [
        point(cx - halfSide, cy - halfSide),
        point(cx + halfSide, cy - halfSide),
        point(cx + halfSide, cy + halfSide),
        point(cx - halfSide, cy + halfSide),
      ].join(", ");
      return [polygonCollapsed(point(cx, cy), 4), `polygon(${end})`];
    }
    case "triangle": {
      const scale = maxRadius * 2.2;
      const dx = (Math.sqrt(3) / 2) * scale;
      const verts = [
        point(cx, cy - scale),
        point(cx + dx, cy + 0.5 * scale),
        point(cx - dx, cy + 0.5 * scale),
      ].join(", ");
      return [polygonCollapsed(point(cx, cy), 3), `polygon(${verts})`];
    }
    case "diamond": {
      const R = maxRadius * Math.SQRT2;
      const end = [
        point(cx, cy - R),
        point(cx + R, cy),
        point(cx, cy + R),
        point(cx - R, cy),
      ].join(", ");
      return [polygonCollapsed(point(cx, cy), 4), `polygon(${end})`];
    }
    case "hexagon": {
      const R = maxRadius * Math.SQRT2;
      const verts: string[] = [];
      for (let i = 0; i < 6; i++) {
        const angle = (Math.PI / 3) * i - Math.PI / 2;
        verts.push(point(cx + R * Math.cos(angle), cy + R * Math.sin(angle)));
      }
      return [polygonCollapsed(point(cx, cy), 6), `polygon(${verts.join(", ")})`];
    }
    case "rectangle": {
      const halfW = Math.max(cx, viewportWidth - cx) * 1.05;
      const halfH = Math.max(cy, viewportHeight - cy) * 1.05;
      const end = [
        point(cx - halfW, cy - halfH),
        point(cx + halfW, cy - halfH),
        point(cx + halfW, cy + halfH),
        point(cx - halfW, cy + halfH),
      ].join(", ");
      return [polygonCollapsed(point(cx, cy), 4), `polygon(${end})`];
    }
    case "star": {
      const R = maxRadius * Math.SQRT2;
      const verts: string[] = [];
      for (let i = 0; i < 10; i++) {
        const r = i % 2 === 0 ? R : R * 0.4;
        const angle = (Math.PI / 5) * i - Math.PI / 2;
        verts.push(point(cx + r * Math.cos(angle), cy + r * Math.sin(angle)));
      }
      return [polygonCollapsed(point(cx, cy), 10), `polygon(${verts.join(", ")})`];
    }
  }
}

// Animated theme toggle (magicui-style): a clip-path shape grows from the click
// point and floods the viewport with the incoming theme using the View
// Transitions API. Percentage coordinates keep the reveal aligned on fractional
// display scales (Chrome #989). Falls back to an instant swap without the API.
export function ThemeToggle({
  dark,
  onToggle,
  className,
  variant = "circle",
  fromCenter = false,
  duration = 400,
}: ThemeToggleProps) {
  const buttonRef = React.useRef<HTMLButtonElement>(null);
  const isTransitioningRef = React.useRef(false);

  function handleClick(event: React.MouseEvent<HTMLButtonElement>) {
    const button = buttonRef.current;
    if (!button || isTransitioningRef.current) return;

    // innerWidth/innerHeight (not visualViewport): percentages resolve against
    // the snapshot reference box, which includes classic scrollbars.
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let x: number;
    let y: number;
    if (fromCenter) {
      x = viewportWidth / 2;
      y = viewportHeight / 2;
    } else {
      const rect = button.getBoundingClientRect();
      x = rect.left + rect.width / 2;
      y = rect.top + rect.height / 2;
    }

    const maxRadius = Math.hypot(
      Math.max(x, viewportWidth - x),
      Math.max(y, viewportHeight - y),
    );

    const applyTheme = () => {
      // Toggle synchronously so the View Transitions API snapshots the new theme.
      document.documentElement.classList.toggle("dark", !dark);
      onToggle();
    };

    const doc = document as Document & {
      startViewTransition?: (cb: () => void) => { finished: Promise<void>; ready: Promise<void> };
    };
    if (typeof doc.startViewTransition !== "function") {
      applyTheme();
      return;
    }

    const clipPath = getThemeTransitionClipPaths(
      variant,
      x,
      y,
      maxRadius,
      viewportWidth,
      viewportHeight,
    );

    const root = document.documentElement;
    root.style.setProperty("--magicui-theme-toggle-vt-duration", `${duration}ms`);
    root.style.setProperty("--magicui-theme-vt-clip-from", clipPath[0]);

    const cleanup = () => {
      isTransitioningRef.current = false;
      delete root.dataset.magicuiThemeVt;
      root.style.removeProperty("--magicui-theme-toggle-vt-duration");
      root.style.removeProperty("--magicui-theme-vt-clip-from");
    };

    isTransitioningRef.current = true;
    const transition = doc.startViewTransition(() => {
      flushSync(applyTheme);
    });
    transition.finished.finally(cleanup).catch(() => {});

    transition.ready
      .then(() => {
        const anim = document.documentElement.animate(
          { clipPath },
          {
            duration,
            // Star: linear avoids easing overshoot that fights polygon
            // interpolation at t→1.
            easing: variant === "star" ? "linear" : "ease-in-out",
            fill: "forwards",
            pseudoElement: "::view-transition-new(root)",
          },
        );
        root.dataset.magicuiThemeVt = "active";
        void anim;
      })
      .catch(() => {});
  }

  return (
    <Button
      ref={buttonRef}
      type="button"
      variant="quiet"
      size="icon"
      aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
      aria-pressed={dark}
      onClick={handleClick}
      className={className}
    >
      <span
        className={cn(
          "inline-flex transition-transform duration-500 ease-[cubic-bezier(0.65,0,0.35,1)]",
          dark ? "rotate-0" : "rotate-180",
        )}
      >
        {dark ? <Moon size={16} /> : <Sun size={16} />}
      </span>
    </Button>
  );
}
