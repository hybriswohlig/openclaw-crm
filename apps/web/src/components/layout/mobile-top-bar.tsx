"use client";

import { usePathname } from "next/navigation";
import { Menu, Search } from "lucide-react";

const TITLE_MAP: Array<[RegExp, string]> = [
  [/^\/home/, "Heute"],
  [/^\/operations/, "Aufträge"],
  [/^\/inbox/, "Inbox"],
  [/^\/tasks/, "Aufgaben"],
  [/^\/chat/, "Chat"],
  [/^\/contract-calendar/, "Kalender"],
  [/^\/notes/, "Notizen"],
  [/^\/notifications/, "Mitteilungen"],
  [/^\/objects\/people/, "Kunden"],
  [/^\/objects\/companies/, "Firmen"],
  [/^\/objects\/deals/, "Leads"],
  [/^\/employees/, "Mitarbeiter"],
  [/^\/financial/, "Finanzen"],
  [/^\/integrations/, "Integrationen"],
  [/^\/settings/, "Einstellungen"],
];

function titleFor(pathname: string): string {
  for (const [pattern, title] of TITLE_MAP) {
    if (pattern.test(pathname)) return title;
  }
  return "Kottke";
}

export function MobileTopBar({ onMenuClick }: { onMenuClick?: () => void }) {
  const pathname = usePathname();
  const title = titleFor(pathname);

  function openCommandPalette() {
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true })
    );
  }

  return (
    <header
      className="md:hidden"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "12px 10px 8px",
        borderBottom: "1px solid var(--line)",
        background: "var(--paper)",
      }}
    >
      <button
        onClick={onMenuClick}
        aria-label="Menü"
        style={{
          width: 36,
          height: 36,
          borderRadius: 10,
          border: 0,
          background: "transparent",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--ink)",
        }}
      >
        <Menu size={20} />
      </button>
      <div
        style={{
          flex: 1,
          textAlign: "center",
          fontFamily: "var(--f-display)",
          fontSize: 17,
          fontWeight: 500,
          letterSpacing: "-.015em",
        }}
      >
        {title}
      </div>
      <button
        onClick={openCommandPalette}
        aria-label="Suchen"
        style={{
          width: 36,
          height: 36,
          borderRadius: 10,
          border: 0,
          background: "transparent",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--ink)",
        }}
      >
        <Search size={18} />
      </button>
    </header>
  );
}
