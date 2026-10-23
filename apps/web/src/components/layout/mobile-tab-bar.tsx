"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Home,
  Truck,
  Inbox as InboxIcon,
  Mail,
  Users,
  Menu,
  X,
  CheckSquare,
  CalendarDays,
  StickyNote,
  Bell,
  Building2,
  Handshake,
  HardHat,
  Banknote,
  Plug,
  Settings,
  type LucideIcon,
} from "lucide-react";
import {
  isMobileNavActive,
  mobileMehrContains,
  mobileMehrItems,
  mobilePrimaryTabs,
} from "./mobile-nav";
import { mehrKachelSpalte } from "./mehr-raster";

const ICONS: Record<string, LucideIcon> = {
  "/home": Home,
  "/operations": Truck,
  "/inbox": InboxIcon,
  "/contract-calendar": CalendarDays,
  "/email": Mail,
  "/tasks": CheckSquare,
  "/objects/deals": Handshake,
  "/notes": StickyNote,
  "/notifications": Bell,
  "/objects/people": Users,
  "/objects/companies": Building2,
  "/employees": HardHat,
  "/financial": Banknote,
  "/integrations": Plug,
  "/settings": Settings,
};

const primary = mobilePrimaryTabs.map((item) => ({ ...item, icon: ICONS[item.href] }));
const mehrItems = mobileMehrItems.map((item) => ({ ...item, icon: ICONS[item.href] }));

export function MobileTabBar() {
  const pathname = usePathname();
  const [unread, setUnread] = useState(0);
  const [sheetOpen, setSheetOpen] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/v1/inbox/unread-count");
        if (!res.ok) return;
        const data = await res.json();
        setUnread(Number(data?.data?.unreadCount ?? 0));
      } catch {
        // ignore
      }
    }
    load();
    const id = setInterval(load, 30000);
    return () => clearInterval(id);
  }, []);

  function isActive(href: string) {
    return isMobileNavActive(pathname, href);
  }

  const mehrActive = sheetOpen || mobileMehrContains(pathname);

  return (
    <>
      <nav
        className="flex md:hidden"
        style={{
          position: "fixed",
          left: 10,
          right: 10,
          bottom: "max(10px, env(safe-area-inset-bottom))",
          alignItems: "stretch",
          justifyContent: "space-around",
          background: "rgba(34,29,22,.94)",
          backdropFilter: "blur(20px)",
          borderRadius: 18,
          padding: "8px 6px",
          boxShadow: "0 12px 40px -10px rgba(0,0,0,.35)",
          zIndex: 40,
        }}
      >
        {primary.map((it) => {
          const Ico = it.icon;
          const active = isActive(it.href);
          return (
            <Link
              key={it.href}
              href={it.href}
              aria-current={active ? "page" : undefined}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 4,
                padding: "6px 8px",
                borderRadius: 12,
                color: active ? "var(--paper)" : "#a79b8a",
                flex: 1,
              }}
            >
              <div style={{ position: "relative" }}>
                <Ico size={21} />
                {it.showBadge && unread > 0 && (
                  <span
                    style={{
                      position: "absolute",
                      top: -3,
                      right: -4,
                      background: "var(--kottke-accent)",
                      color: "var(--paper)",
                      fontSize: 9.5,
                      fontWeight: 600,
                      padding: "1px 5px",
                      borderRadius: 999,
                      border: "2px solid rgba(34,29,22,.94)",
                    }}
                  >
                    {unread > 99 ? "99+" : unread}
                  </span>
                )}
              </div>
              <span style={{ fontSize: 10.5, letterSpacing: ".005em" }}>
                {it.label}
              </span>
            </Link>
          );
        })}

        <button
          type="button"
          onClick={() => setSheetOpen(true)}
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 4,
            padding: "6px 8px",
            borderRadius: 12,
            border: 0,
            background: "transparent",
            cursor: "pointer",
            color: mehrActive ? "var(--paper)" : "#a79b8a",
            flex: 1,
          }}
        >
          <Menu size={21} />
          <span style={{ fontSize: 10.5 }}>Mehr</span>
        </button>
      </nav>

      {sheetOpen && (
        <div
          className="md:hidden"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 50,
            background: "rgba(34,29,22,.55)",
          }}
          onClick={() => setSheetOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: 0,
              background: "var(--paper)",
              borderTopLeftRadius: 20,
              borderTopRightRadius: 20,
              padding: "12px 16px max(20px, env(safe-area-inset-bottom))",
              maxHeight: "75vh",
              overflowY: "auto",
            }}
          >
            <div className="flex items-center justify-between pb-3">
              <span
                className="k-display"
                style={{ fontSize: 18, fontWeight: 500 }}
              >
                Mehr
              </span>
              <button
                onClick={() => setSheetOpen(false)}
                style={{ border: 0, background: "transparent" }}
                aria-label="Schließen"
              >
                <X size={20} />
              </button>
            </div>
            {/* Sechs Spalten, jede Kachel zwei breit: eine unvollständige letzte Reihe steht mittig. */}
            <div className="grid grid-cols-6 gap-2">
              {mehrItems.map((it, i) => {
                const Ico = it.icon;
                const active = isActive(it.href);
                return (
                  <Link
                    key={it.href}
                    href={it.href}
                    aria-current={active ? "page" : undefined}
                    onClick={() => setSheetOpen(false)}
                    style={{
                      gridColumn: mehrKachelSpalte(i, mehrItems.length),
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      gap: 6,
                      padding: "14px 8px",
                      background: active ? "var(--ink)" : "#fff",
                      border: active ? "1px solid var(--ink)" : "1px solid var(--line)",
                      borderRadius: 12,
                      color: active ? "var(--paper)" : "var(--ink)",
                      textAlign: "center",
                    }}
                  >
                    <Ico size={20} style={{ color: active ? "var(--paper)" : "var(--ink-soft)" }} />
                    <span style={{ fontSize: 12, lineHeight: 1.2 }}>
                      {it.label}
                    </span>
                  </Link>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
