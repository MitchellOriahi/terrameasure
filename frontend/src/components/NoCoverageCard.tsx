// components/NoCoverageCard.tsx
// The card shown when a map tap lands outside our 5 pilot counties.
//
// Why a card and not a toast? This is the single most common "wall" a
// visitor can hit (most US counties have no parcel data yet), and a
// 3.5-second toast vanished before people finished reading it. The card
// stays until dismissed, names the counties we DO cover (so it reads as
// a roadmap, not a shrug), and hands the user the one action that still
// works everywhere: draw the boundary yourself.
//
// Two homes, matching the ParcelCard pattern:
//   desktop : floating glass card, bottom-left (where the parcel card
//             would have appeared, so the eye is already looking there)
//   mobile  : bottom-anchored card above the action bar

import { PenLine, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useIsMobile } from "@/hooks/useIsMobile";

interface NoCoverageCardProps {
  /** Close the card without doing anything. */
  onDismiss: () => void;
  /** Start the right draw mode for this device (page decides which). */
  onDraw: () => void;
}

/** The card body: heading, honest coverage note, and the draw button. */
function NoCoverageBody({ onDismiss, onDraw }: NoCoverageCardProps) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-start justify-between gap-2">
        <h2 className="text-sm font-semibold text-foreground">
          No parcel records here yet
        </h2>
        <Button
          variant="ghost"
          size="iconSm"
          aria-label="Dismiss coverage notice"
          className="-mr-1 -mt-1 shrink-0"
          onClick={onDismiss}
        >
          <X size={16} />
        </Button>
      </div>

      <p className="text-xs leading-relaxed text-muted">
        Parcel data covers 5 pilot counties (Maricopa AZ, Travis TX, King
        WA, Mecklenburg NC, Miami-Dade FL) while we roll out nationwide
        coverage. You can still survey this land: draw the boundary
        yourself.
      </p>

      <Button variant="primary" size="sm" className="mt-1" onClick={onDraw}>
        <PenLine size={14} />
        Draw boundary
      </Button>
    </div>
  );
}

export function NoCoverageCard(props: NoCoverageCardProps) {
  const isMobile = useIsMobile();

  if (isMobile) {
    // Bottom-anchored, floating just above the mobile action bar so the
    // "Draw boundary" button sits right where thumbs already are.
    return (
      <div className="absolute inset-x-3 bottom-24 z-30">
        <div className="glass p-4">
          <NoCoverageBody {...props} />
        </div>
      </div>
    );
  }

  // Desktop: same spot and size as the ParcelCard, since this card IS
  // the answer to "why did no parcel card appear".
  return (
    <aside className="glass absolute bottom-8 left-4 z-20 w-80 p-4">
      <NoCoverageBody {...props} />
    </aside>
  );
}
