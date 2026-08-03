// components/ui/button.tsx
// The app's one Button component, written in the shadcn/ui style:
// class-variance-authority (cva) defines named looks ("variants") and
// sizes, and cn() merges in any extra classes a caller passes.
//
// Why not import a giant UI kit? Buttons are 90% of what we need, and
// owning the code means the beginner maintainer can read every line.

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  // Base classes shared by every button. min-h keeps touch targets 44px+
  // on mobile per Apple/Google guidelines.
  "inline-flex items-center justify-center gap-2 rounded-xl text-sm font-medium " +
    "transition-colors outline-none focus-visible:ring-2 focus-visible:ring-accent/60 " +
    "disabled:pointer-events-none disabled:opacity-50 select-none cursor-pointer",
  {
    variants: {
      variant: {
        // Solid green: the primary action
        primary:
          "bg-accent text-black hover:bg-accent-bright active:bg-accent-bright",
        // Frosted glass: toolbar buttons floating over the map
        glass:
          "glass text-foreground hover:bg-surface-2/90 data-[active=true]:bg-accent-deep " +
          "data-[active=true]:text-accent-bright data-[active=true]:border-accent/40",
        // Quiet: text-ish buttons inside panels
        ghost: "text-muted hover:text-foreground hover:bg-surface-2/70",
        // Dangerous or destructive actions (clear survey, etc.)
        danger: "bg-nogo/15 text-nogo hover:bg-nogo/25",
      },
      size: {
        sm: "h-9 px-3 text-xs",
        md: "h-11 px-4",
        icon: "h-11 w-11 p-0",
        iconSm: "h-9 w-9 p-0",
      },
    },
    defaultVariants: { variant: "glass", size: "md" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export function Button({ className, variant, size, ...props }: ButtonProps) {
  return (
    <button
      type="button"
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}
