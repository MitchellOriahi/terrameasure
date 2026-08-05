// components/ui/tooltip.tsx
// A tiny CSS-only tooltip. No library, no JavaScript timers.
//
// How it works: you wrap any element in <Tooltip label="...">. The wrapper
// is a "group" (Tailwind's name for "let children react to my hover state").
// The label bubble sits in the DOM the whole time but fully transparent;
// hovering or keyboard-focusing the wrapper fades it in AFTER a 300ms
// delay (transition-delay), so quick mouse passes never flash tooltips.
//
// Design notes:
// - Dark glass look to match the rest of the floating UI.
// - A small rotated square makes the arrow.
// - "side" picks above/below; "align" slides the bubble left/right so a
//   tooltip near a screen edge does not get clipped off screen.
// - Hidden entirely below the md breakpoint: phones have no hover, and a
//   tap-triggered tooltip would just get in the way of the tap itself.
//   Mobile buttons carry visible text labels instead.

import type { ReactNode } from "react";

type Side = "top" | "bottom";
type Align = "start" | "center" | "end";

// Where the bubble sits relative to the wrapped element.
const SIDE_CLASS: Record<Side, string> = {
  bottom: "top-full mt-2",
  top: "bottom-full mb-2",
};

// How the bubble lines up horizontally. "start" pins its left edge to the
// element's left edge (use near the LEFT screen edge), "end" pins its
// right edge (use near the RIGHT screen edge), "center" centers it.
const ALIGN_CLASS: Record<Align, string> = {
  start: "left-0",
  center: "left-1/2 -translate-x-1/2",
  end: "right-0",
};

// The arrow: a 8x8 square rotated 45 degrees, poking out of the bubble
// toward the element. Its position depends on both side and align.
function arrowClass(side: Side, align: Align): string {
  const vertical =
    side === "bottom"
      ? "-top-1 border-l border-t" // bubble below, arrow points up
      : "-bottom-1 border-b border-r"; // bubble above, arrow points down
  const horizontal =
    align === "start"
      ? "left-4"
      : align === "end"
        ? "right-4"
        : "left-1/2 -ml-1";
  return `absolute h-2 w-2 rotate-45 border-line bg-surface ${vertical} ${horizontal}`;
}

export interface TooltipProps {
  /** The text shown in the bubble. Keep it short: one line, one idea. */
  label: string;
  side?: Side;
  align?: Align;
  /** Extra classes for the wrapper span (rarely needed). */
  className?: string;
  children: ReactNode;
}

export function Tooltip({
  label,
  side = "bottom",
  align = "center",
  className = "",
  children,
}: TooltipProps) {
  return (
    // group/tt gives this group a name so nested groups never clash.
    <span className={`group/tt relative inline-flex ${className}`}>
      {children}
      <span
        role="tooltip"
        className={
          // pointer-events-none: the bubble must never steal the mouse
          // from the button under it. delay-300 only applies on SHOW
          // (the group-hover state); hiding is instant.
          "pointer-events-none absolute z-50 w-max max-w-56 rounded-lg " +
          "border border-line bg-surface/95 px-2.5 py-1.5 text-[11px] " +
          "font-medium leading-snug text-foreground shadow-lg " +
          "backdrop-blur-md " +
          "opacity-0 transition-opacity duration-150 " +
          "group-hover/tt:opacity-100 group-hover/tt:delay-300 " +
          "group-focus-within/tt:opacity-100 group-focus-within/tt:delay-300 " +
          "max-md:hidden " +
          `${SIDE_CLASS[side]} ${ALIGN_CLASS[align]}`
        }
      >
        {label}
        <span aria-hidden className={arrowClass(side, align)} />
      </span>
    </span>
  );
}
