// components/site3d/Site3DEntryButton.tsx
// The "View site in 3D" button that appears in the results panel after
// a survey completes. Deliberately self-contained: it reads everything
// it needs from the store and the map context, and renders NOTHING when
// 3D would not work (no map yet, no DEM footprint, or already in 3D).
// That way the results panel can drop it in as one line and never worry
// about guarding it.

import { useMap } from "@vis.gl/react-maplibre";
import { Rotate3d } from "lucide-react";
import { useAppStore } from "@/store/appStore";
import { enterSite3d, site3dAvailable } from "@/lib/site3d";
import { Button } from "@/components/ui/button";

export function Site3DEntryButton() {
  const { main: map } = useMap();
  const survey = useAppStore((s) => s.survey);
  const site3d = useAppStore((s) => s.site3d);

  if (!map || !survey || site3d || !site3dAvailable(survey)) return null;

  return (
    <Button
      size="md"
      className="w-full"
      aria-label="View site in 3D"
      onClick={() => enterSite3d(map, survey)}
    >
      <Rotate3d size={16} />
      View site in 3D
    </Button>
  );
}
