"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { CreateListModal } from "@/components/lists/create-list-modal";
import { SidebarCrew } from "@/components/layout/sidebar-crew";
import { signOut, useSession } from "@/lib/auth-client";
import { useRouter } from "next/navigation";
import {
  Home,
  MessageSquare,
  CheckSquare,
  StickyNote,
  Bell,
  Users,
  Building2,
  Handshake,
  List,
  Plus,
  Settings,
  Sun,
  Moon,
  Database,
  CalendarDays,
  HardHat,
  Banknote,
  Plug,
  Inbox,
  Mail,
  Truck,
  Search,
  LogOut,
  BarChart3,
  ChevronRight,
} from "lucide-react";
import { useTheme } from "next-themes";

const mainNav = [
  { href: "/home", label: "Heute", icon: Home },
  { href: "/chat", label: "Chat", icon: MessageSquare },
  { href: "/tasks", label: "Aufgaben", icon: CheckSquare },
  { href: "/contract-calendar", label: "Kalender", icon: CalendarDays },
  { href: "/notifications", label: "Benachrichtigungen", icon: Bell },
];

const objectNav = [
  { href: "/objects/people", label: "Kunden", icon: Users },
  { href: "/objects/deals", label: "Leads", icon: Handshake },
];

const moreNav = [
  { href: "/statistics", label: "Statistiken", icon: BarChart3 },
  { href: "/notes", label: "Notizen", icon: StickyNote },
  { href: "/objects/companies", label: "Firmen", icon: Building2 },
  { href: "/integrations", label: "Integrationen", icon: Plug },
];

interface ListItem {
  id: string;
  name: string;
  objectName: string;
  entryCount: number;
}

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const router = useRouter();
  const { data: session } = useSession();
  const [lists, setLists] = useState<ListItem[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [accountName, setAccountName] = useState<string | null>(null);
  const [accountLogo, setAccountLogo] = useState<string | null>(null);
  const [workspaceRole, setWorkspaceRole] = useState<string | null>(null);
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
  const { theme, setTheme } = useTheme();

  useEffect(() => {
    fetch("/api/admin/db/me")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.data?.admin) setIsPlatformAdmin(true);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch("/api/v1/lists")
      .then((res) => res.json())
      .then((data) => {
        if (data.data) setLists(data.data);
      })
      .catch(() => {});

    fetch("/api/v1/workspace")
      .then((res) => res.json())
      .then((data) => {
        if (data.data?.name) setAccountName(data.data.name);
        if (data.data?.role) setWorkspaceRole(data.data.role);
        if (data.data?.settings?.logo) setAccountLogo(data.data.settings.logo);
      })
      .catch(() => {});
  }, []);

  async function handleCreateList(name: string, objectSlug: string) {
    const res = await fetch("/api/v1/lists", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, objectSlug }),
    });
    if (res.ok) {
      const listRes = await fetch("/api/v1/lists");
      if (listRes.ok) {
        const data = await listRes.json();
        if (data.data) setLists(data.data);
      }
    }
  }

  function openCommandPalette() {
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true })
    );
  }

  async function handleSignOut() {
    await signOut();
    router.push("/login");
  }

  return (
    <aside
      className="flex h-full w-[236px] flex-col overflow-hidden"
      style={{
        borderRight: "1px solid var(--line)",
        background: "color-mix(in srgb, var(--paper) 70%, var(--paper-2))",
        padding: "16px 12px",
        gap: 14,
      }}
    >
      {/* Brand */}
      <div className="flex items-center gap-2.5 px-2 pb-2 pt-1">
        {accountLogo ? (
          <div className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-foreground/10">
            <div
              className="h-full w-full p-0.5 [&>svg]:h-full [&>svg]:w-full"
              dangerouslySetInnerHTML={{ __html: accountLogo }}
            />
          </div>
        ) : (
          <span
            className="inline-block h-2 w-2 shrink-0 rounded-full"
            style={{ background: "var(--kottke-accent)" }}
            aria-hidden
          />
        )}
        <span
          className="k-display flex-1 truncate text-[17px]"
          style={{ fontWeight: 500, letterSpacing: "-0.02em" }}
        >
          {accountName ? (
            accountName
          ) : (
            <>
              Kottke{" "}
              <em
                style={{
                  fontStyle: "italic",
                  fontWeight: 300,
                  color: "var(--ink-muted)",
                }}
              >
                Umzüge
              </em>
            </>
          )}
        </span>
      </div>

      {/* Search */}
      <button
        type="button"
        onClick={openCommandPalette}
        className="flex items-center gap-2 rounded-[10px] border bg-white px-2.5 py-2 text-left text-[12.5px] hover:border-[color-mix(in_srgb,var(--ink)_28%,transparent)]"
        style={{
          borderColor: "var(--line)",
          color: "var(--ink-soft)",
        }}
      >
        <Search className="h-3.5 w-3.5 opacity-55" />
        <span className="flex-1" style={{ color: "var(--ink-muted)" }}>
          Alles durchsuchen
        </span>
        <kbd
          className="rounded px-1.5 py-px text-[10px]"
          style={{
            fontFamily: "var(--f-mono)",
            color: "var(--ink-muted)",
            border: "1px solid var(--line)",
            background: "var(--paper)",
          }}
        >
          ⌘K
        </kbd>
      </button>

      {/* Main navigation */}
      <nav className="-mx-0.5 flex flex-1 flex-col gap-0.5 overflow-y-auto px-0.5 k-scroll">
        {mainNav.map((item) => (
          <NavItem
            key={item.href}
            {...item}
            active={pathname === item.href}
            onClick={onNavigate}
          />
        ))}

        <Divider />

        {objectNav.map((item) => (
          <NavItem
            key={item.href}
            {...item}
            active={pathname.startsWith(item.href)}
            onClick={onNavigate}
          />
        ))}

        {lists.length > 0 && (
          <>
            <Divider />
            <div className="space-y-0.5">
              {lists.map((list) => (
                <Link
                  key={list.id}
                  href={`/lists/${list.id}`}
                  onClick={onNavigate}
                  className="flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13.5px] transition-colors"
                  style={
                    pathname === `/lists/${list.id}`
                      ? activeStyle
                      : inactiveStyle
                  }
                >
                  <List className="h-4 w-4 shrink-0" />
                  <span className="truncate">{list.name}</span>
                  <span
                    className="ml-auto text-[11px]"
                    style={{ color: "var(--ink-muted)" }}
                  >
                    {list.entryCount}
                  </span>
                </Link>
              ))}
            </div>
          </>
        )}

        <button
          onClick={() => setCreateOpen(true)}
          className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13.5px]"
          style={{ color: "var(--ink-muted)" }}
        >
          <Plus className="h-4 w-4 shrink-0" />
          <span>Neue Liste</span>
        </button>

        <Divider />

        <NavItem
          href="/employees"
          label="Mitarbeiter"
          icon={HardHat}
          active={pathname === "/employees"}
          onClick={onNavigate}
        />

        <Divider />

        <NavItem
          href="/operations"
          label="Aufträge"
          icon={Truck}
          active={pathname.startsWith("/operations")}
          onClick={onNavigate}
        />

        <NavItem
          href="/financial"
          label="Finanzen"
          icon={Banknote}
          active={pathname.startsWith("/financial")}
          onClick={onNavigate}
        />

        <Divider />

        <MoreGroup pathname={pathname} onNavigate={onNavigate} />

        <Divider />

        <NavItem
          href="/inbox"
          label="Inbox"
          icon={Inbox}
          active={pathname.startsWith("/inbox")}
          onClick={onNavigate}
        />

        <NavItem
          href="/email"
          label="E-Mail"
          icon={Mail}
          active={pathname.startsWith("/email")}
          onClick={onNavigate}
        />

        <SidebarCrew />
      </nav>

      {/* Footer: settings + user + theme/signout */}
      <div
        className="flex flex-col gap-0.5 pt-2"
        style={{ borderTop: "1px solid var(--line)" }}
      >
        {workspaceRole === "admin" && (
          <NavItem
            href="/settings"
            label="Einstellungen"
            icon={Settings}
            active={pathname.startsWith("/settings")}
            onClick={onNavigate}
          />
        )}

        {isPlatformAdmin && (
          <NavItem
            href="/admin/database"
            label="Database admin"
            icon={Database}
            active={pathname.startsWith("/admin/database")}
            onClick={onNavigate}
          />
        )}

        <div className="flex items-center gap-2.5 rounded-lg px-2.5 py-2">
          <span
            className="k-avatar a1"
            aria-hidden
            style={{ width: 28, height: 28, fontSize: 11 }}
          >
            {(session?.user?.name?.[0] ?? "K").toUpperCase()}
          </span>
          <div className="min-w-0 flex-1 text-[13px]">
            <div className="truncate" style={{ fontWeight: 500 }}>
              {session?.user?.name ?? "Konto"}
            </div>
            <div
              className="truncate text-[11px]"
              style={{ color: "var(--ink-muted)" }}
            >
              {workspaceRole === "admin" ? "Teamleitung" : "Team"}
            </div>
          </div>
          <button
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            className="rounded-md p-1"
            style={{ color: "var(--ink-muted)" }}
            aria-label={theme === "dark" ? "Light mode" : "Dark mode"}
            title={theme === "dark" ? "Light mode" : "Dark mode"}
          >
            {theme === "dark" ? (
              <Sun className="h-3.5 w-3.5" />
            ) : (
              <Moon className="h-3.5 w-3.5" />
            )}
          </button>
          <button
            onClick={handleSignOut}
            className="rounded-md p-1"
            style={{ color: "var(--ink-muted)" }}
            aria-label="Abmelden"
            title="Abmelden"
          >
            <LogOut className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <CreateListModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSubmit={handleCreateList}
      />
    </aside>
  );
}

const activeStyle: React.CSSProperties = {
  background: "#fff",
  color: "var(--ink)",
  fontWeight: 500,
  boxShadow: "0 1px 2px rgba(34,29,22,0.04)",
};

const inactiveStyle: React.CSSProperties = {
  background: "transparent",
  color: "var(--ink-soft)",
};

function Divider() {
  return (
    <div
      className="my-2.5 mx-1"
      style={{ borderTop: "1px dashed var(--line)" }}
      aria-hidden
    />
  );
}

function MoreGroup({
  pathname,
  onNavigate,
}: {
  pathname: string;
  onNavigate?: () => void;
}) {
  const containsActive = moreNav.some((item) =>
    item.href === "/objects/companies"
      ? pathname.startsWith("/objects/companies")
      : pathname.startsWith(item.href)
  );

  const [userOpen, setUserOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setHydrated(true);
    if (typeof window !== "undefined") {
      setUserOpen(window.localStorage.getItem("sidebar.more.open") === "1");
    }
  }, []);

  const isOpen = hydrated ? userOpen || containsActive : containsActive;

  function toggle() {
    const next = !userOpen;
    setUserOpen(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem("sidebar.more.open", next ? "1" : "0");
    }
  }

  return (
    <div className="space-y-0.5">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={isOpen}
        className="relative flex w-full items-center gap-2.5 rounded-[9px] px-2.5 py-2 text-[13.5px] transition-colors"
        style={inactiveStyle}
      >
        <ChevronRight
          className="h-[15px] w-[15px] shrink-0"
          style={{
            opacity: 0.6,
            transition: "transform 140ms ease",
            transform: isOpen ? "rotate(90deg)" : "rotate(0deg)",
          }}
        />
        <span className="flex-1 truncate text-left">Mehr</span>
      </button>

      {isOpen && (
        <div className="space-y-0.5" style={{ paddingLeft: 10 }}>
          {moreNav.map((item) => {
            const active =
              item.href === "/objects/companies"
                ? pathname.startsWith("/objects/companies")
                : pathname.startsWith(item.href);
            return (
              <NavItem
                key={item.href}
                href={item.href}
                label={item.label}
                icon={item.icon}
                active={active}
                onClick={onNavigate}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

function NavItem({
  href,
  label,
  icon: Icon,
  active,
  onClick,
  badge,
}: {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  active: boolean;
  onClick?: () => void;
  badge?: number;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative flex items-center gap-2.5 rounded-[9px] px-2.5 py-2 text-[13.5px] transition-colors"
      )}
      style={active ? activeStyle : inactiveStyle}
    >
      <Icon
        className="h-[17px] w-[17px] shrink-0"
        style={{ opacity: active ? 1 : 0.7 }}
      />
      <span className="flex-1 truncate text-left">{label}</span>
      {badge ? (
        <span
          className="inline-flex items-center justify-center rounded-full px-1.5 py-px text-[10px]"
          style={{
            background: "var(--kottke-accent)",
            color: "var(--paper)",
            fontWeight: 600,
          }}
        >
          {badge}
        </span>
      ) : null}
      {active && (
        <span
          aria-hidden
          className="absolute"
          style={{
            left: -12,
            top: 8,
            bottom: 8,
            width: 2,
            background: "var(--kottke-accent)",
            borderRadius: 2,
          }}
        />
      )}
    </Link>
  );
}
