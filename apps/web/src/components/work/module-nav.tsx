"use client";

// In-page module navigation. The app sidebar is off limits (Spec §8), so
// every page of the module renders this strip under its header instead.
// Active state matches by prefix, except for the module root which must be
// an exact match or "Dashboard" would stay lit on every sub-page.
import { Suspense } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  LayoutDashboard,
  FolderKanban,
  ListChecks,
  Flag,
  BarChart3,
  Star,
} from "lucide-react";
import { cn } from "@/lib/utils";

const ITEMS = [
  { href: "/tasks", label: "Dashboard", icon: LayoutDashboard, exact: true },
  { href: "/tasks/projects", label: "Projekte", icon: FolderKanban, exact: false },
  { href: "/tasks/operative", label: "Operative Aufgaben", icon: ListChecks, exact: false },
  { href: "/tasks/sprints", label: "Sprints", icon: Flag, exact: false },
  { href: "/tasks/reports", label: "Berichte", icon: BarChart3, exact: false },
  { href: "/tasks/projects?fav=1", label: "Favoriten", icon: Star, exact: false, fav: true },
] as const;

/**
 * Self-wrapping: `useSearchParams()` needs a <Suspense> boundary or Next 15
 * fails prerendering with "useSearchParams should be wrapped in a suspense
 * boundary". Putting the boundary INSIDE the component makes it impossible
 * for a page to forget it — three pages did in an earlier draft (defect W5).
 * Never render ModuleNavInner directly.
 */
export function ModuleNav({ className }: { className?: string }) {
  return (
    <Suspense fallback={<div className={cn("h-8", className)} />}>
      <ModuleNavInner className={className} />
    </Suspense>
  );
}

function ModuleNavInner({ className }: { className?: string }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const favActive = pathname === "/tasks/projects" && params.get("fav") === "1";

  return (
    <nav
      className={cn(
        "-mx-1 flex items-center gap-1 overflow-x-auto px-1 pb-1",
        className
      )}
      aria-label="Modulnavigation"
    >
      {ITEMS.map((item) => {
        const isFav = "fav" in item && item.fav === true;
        const active = isFav
          ? favActive
          : !favActive &&
            (item.exact ? pathname === item.href : pathname.startsWith(item.href));
        const Icon = item.icon;
        return (
          <Link
            key={item.label}
            href={item.href}
            className={cn(
              "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-[6px] text-[12.5px] font-medium transition-colors",
              active
                ? "border-transparent bg-foreground text-background"
                : "border-border text-muted-foreground hover:bg-muted"
            )}
          >
            <Icon className="h-[13px] w-[13px]" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
