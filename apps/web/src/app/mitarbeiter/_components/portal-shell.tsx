"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Wallet, LogOut } from "lucide-react";
import { authClient } from "@/lib/auth-client";

const NAV_ITEMS = [
  { href: "/", label: "Aufträge", icon: Home },
  { href: "/abrechnung", label: "Abrechnung", icon: Wallet },
] as const;

export default function PortalShell({
  employeeName,
  children,
}: {
  employeeName: string;
  children: ReactNode;
}) {
  const pathname = usePathname();

  async function handleLogout() {
    await authClient.signOut();
    window.location.href = "/login";
  }

  function isActive(href: string) {
    if (href === "/") {
      return pathname === "/" || pathname === "";
    }
    return pathname === href || pathname.startsWith(href + "/");
  }

  return (
    <div className="flex min-h-svh flex-col">
      <header className="sticky top-0 z-20 border-b border-border bg-card/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-md items-center justify-between gap-3 p-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex shrink-0 items-center rounded-lg bg-white px-2 py-1 shadow-sm">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/kottke-umzuege-logo.svg"
                alt="Kottke Umzüge"
                className="h-6 w-auto"
              />
            </span>
            <span className="truncate text-sm font-medium text-muted-foreground">
              {employeeName}
            </span>
          </div>
          <button
            type="button"
            onClick={handleLogout}
            aria-label="Abmelden"
            className="inline-flex h-11 shrink-0 items-center gap-2 rounded-xl border border-border bg-background px-3 text-sm font-medium text-foreground shadow-sm active:scale-[0.98]"
          >
            <LogOut className="h-5 w-5" aria-hidden="true" />
            <span>Abmelden</span>
          </button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-md flex-1 px-4 pb-28 pt-4">
        {children}
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-card/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-md items-stretch">
          {NAV_ITEMS.map((item) => {
            const active = isActive(item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`flex flex-1 flex-col items-center justify-center gap-1 py-3 text-sm font-medium ${
                  active
                    ? "text-primary"
                    : "text-muted-foreground"
                }`}
              >
                <Icon className="h-6 w-6" aria-hidden="true" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
