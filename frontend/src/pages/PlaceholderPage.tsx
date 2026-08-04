// pages/PlaceholderPage.tsx
// A clean "coming in this rebuild" screen shared by every route that is
// not the map yet. Each route passes in its own title, icon and blurb,
// so these screens still feel designed, not abandoned.

import type { LucideIcon } from "lucide-react";
import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { Wordmark } from "@/components/TopBar";
import { Button } from "@/components/ui/button";

interface PlaceholderPageProps {
  title: string;
  blurb: string;
  icon: LucideIcon;
}

export function PlaceholderPage({
  title,
  blurb,
  icon: Icon,
}: PlaceholderPageProps) {
  return (
    <div className="flex h-dvh flex-col bg-background">
      {/* Slim header with the wordmark and a way back to the map */}
      <header className="pt-safe flex items-center gap-3 border-b border-line px-4 py-3">
        <Link to="/map" aria-label="Back to map">
          <Button variant="ghost" size="iconSm" tabIndex={-1}>
            <ArrowLeft size={16} />
          </Button>
        </Link>
        <Wordmark />
      </header>

      {/* Centered card */}
      <main className="flex flex-1 items-center justify-center p-6">
        <div className="glass w-full max-w-md p-8 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-accent-deep">
            <Icon className="text-accent-bright" size={26} />
          </div>
          <h1 className="text-xl font-semibold text-foreground">{title}</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted">{blurb}</p>
          <span className="mt-5 inline-block rounded-full border border-line px-3 py-1 text-[10px] uppercase tracking-widest text-muted">
            coming in this rebuild
          </span>
          <div className="mt-6">
            <Link to="/map">
              <Button variant="primary" size="sm" tabIndex={-1}>
                Back to the map
              </Button>
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
