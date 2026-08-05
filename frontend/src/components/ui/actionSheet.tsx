// components/ui/actionSheet.tsx
// A bottom ACTION sheet: the small "are you sure?" panel that slides up
// from the bottom edge with one or two big buttons plus Cancel.
//
// How it differs from ui/sheet.tsx: that Sheet is for browsable content
// (results, layers) with draggable snap heights. This one is for a single
// quick decision, so it is fixed-height and dismisses on any tap outside.
// Per the mobile UX spec, destructive confirms are ALWAYS this pattern on
// phones, never a centered modal dialog.
//
// The slide-up uses only a transform animation (GPU-friendly, no layout
// work), matching the app-wide "transform-only animations" rule.

import type { ReactNode } from "react";

export interface ActionSheetAction {
  label: ReactNode;
  onPress: () => void;
  /** Red styling for dangerous choices like "Clear" or "Discard". */
  destructive?: boolean;
}

interface ActionSheetProps {
  /** The question, e.g. "Clear all points?" */
  title: string;
  actions: ActionSheetAction[];
  onCancel: () => void;
}

export function ActionSheet({ title, actions, onCancel }: ActionSheetProps) {
  return (
    <div className="fixed inset-0 z-50">
      {/* Dimmed backdrop; tapping it is the same as Cancel */}
      <button
        type="button"
        aria-label="Cancel"
        className="absolute inset-0 bg-black/40"
        onClick={onCancel}
      />
      {/* The sheet itself, hugging the bottom edge above the safe area.
          max-w + mx-auto keep it phone-width even on a wide desktop
          screen; full-bleed buttons across 1440px look broken. */}
      <div
        className="glass pb-safe absolute inset-x-2 bottom-2 mx-auto max-w-md p-3"
        style={{ animation: "sheet-up 200ms ease-out" }}
        role="alertdialog"
        aria-label={title}
      >
        <p className="px-2 pb-3 pt-1 text-center text-xs text-muted">{title}</p>
        <div className="flex flex-col gap-2">
          {actions.map((a, i) => (
            <button
              key={i}
              type="button"
              onClick={a.onPress}
              className={`h-12 rounded-xl text-sm font-semibold transition-colors ${
                a.destructive
                  ? "bg-nogo/15 text-nogo active:bg-nogo/25"
                  : "bg-accent text-black active:bg-accent-bright"
              }`}
            >
              {a.label}
            </button>
          ))}
          <button
            type="button"
            onClick={onCancel}
            className="h-12 rounded-xl bg-surface-2 text-sm font-medium text-foreground active:bg-surface"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
