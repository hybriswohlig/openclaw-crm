"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { CreateListModal } from "@/components/lists/create-list-modal";
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
  Plug,
  Inbox,
  Store,
} from "lucide-react";
import { NELogo, NEMark } from "@/components/brand/ne-logo";
import { useTheme } from "next-themes";

const mainNav = [
  { href: "/home", label: "Home", icon: Home },
  { href: "/chat", label: "Chat", icon: MessageSquare },
  { href: "/tasks", label: "Tasks", icon: CheckSquare },
  { href: "/notes", label: "Notes", icon: StickyNote },
  { href: "/notifications", label: "Notifications", icon: Bell },
];

const objectNav = [
  { href: "/objects/people", label: "Contacts", icon: Users },
  { href: "/objects/companies", label: "Companies", icon: Building2 },
  { href: "/objects/deals", label: "Deals", icon: Handshake },
  { href: "/trade-fairs", label: "Trade Fairs", icon: Store },
];

const bottomNav = [{ href: "/settings", label: "Settings", icon: Settings }];

interface ListItem {
  id: string;
  name: string;
  objectName: string;
  entryCount: number;
}

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const [lists, setLists] = useState<ListItem[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [workspaceRole, setWorkspaceRole] = useState<string | null>(null);
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
  const [expanded, setExpanded] = useState(false);
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
        if (data.data?.role) setWorkspaceRole(data.data.role);
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

  return (
    <aside
      onMouseEnter={() => setExpanded(true)}
      onMouseLeave={() => setExpanded(false)}
      className={cn(
        "flex h-full flex-col border-r border-sidebar-border bg-sidebar sidebar-glass transition-all duration-200 ease-out overflow-hidden",
        expanded ? "w-56" : "w-12"
      )}
    >
      {/* Brand header */}
      <div className="flex h-14 items-center px-2.5">
        <div className="flex w-full items-center gap-2.5 rounded-lg px-1.5 py-1.5">
          {/* Collapsed: show the leaf mark; Expanded: show full wordmark */}
          {expanded ? (
            <NELogo className="h-5 w-auto dark:invert shrink-0" />
          ) : (
            <NEMark className="h-7 w-7 dark:invert shrink-0" />
          )}
        </div>
      </div>

      {/* Main navigation */}
      <nav className="flex-1 space-y-0.5 px-2 py-2 overflow-y-auto">
        {mainNav.map((item) => (
          <NavItem
            key={item.href}
            {...item}
            active={pathname === item.href}
            expanded={expanded}
            onClick={onNavigate}
          />
        ))}

        <div className="my-3 mx-2 h-px bg-sidebar-border" />

        {objectNav.map((item) => (
          <NavItem
            key={item.href}
            {...item}
            active={pathname.startsWith(item.href)}
            expanded={expanded}
            onClick={onNavigate}
          />
        ))}

        {expanded && lists.length > 0 && (
          <>
            <div className="my-3 mx-2 h-px bg-sidebar-border" />
            <div className="space-y-0.5">
              {lists.map((list) => (
                <Link
                  key={list.id}
                  href={`/lists/${list.id}`}
                  onClick={onNavigate}
                  className={cn(
                    "flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm transition-colors",
                    pathname === `/lists/${list.id}`
                      ? "bg-sidebar-accent text-sidebar-accent-foreground"
                      : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                  )}
                >
                  <List className="h-4 w-4 shrink-0" />
                  <span className="truncate">{list.name}</span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {list.entryCount}
                  </span>
                </Link>
              ))}
            </div>
          </>
        )}

        {expanded && (
          <button
            onClick={() => setCreateOpen(true)}
            className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
          >
            <Plus className="h-4 w-4 shrink-0" />
            <span>New list</span>
          </button>
        )}

        <div className="my-3 mx-2 h-px bg-sidebar-border" />

        <NavItem
          href="/inbox"
          label="Inbox"
          icon={Inbox}
          active={pathname.startsWith("/inbox")}
          expanded={expanded}
          onClick={onNavigate}
        />

        <NavItem
          href="/contract-calendar"
          label="Calendar"
          icon={CalendarDays}
          active={pathname.startsWith("/contract-calendar")}
          expanded={expanded}
          onClick={onNavigate}
        />

        <NavItem
          href="/integrations"
          label="Integrations"
          icon={Plug}
          active={pathname.startsWith("/integrations")}
          expanded={expanded}
          onClick={onNavigate}
        />
      </nav>

      {/* Bottom navigation — Settings visible to admins only */}
      <div className="border-t border-sidebar-border px-2 py-2 space-y-0.5">
        {bottomNav.map((item) => (
          <NavItem
            key={item.href}
            {...item}
            active={pathname.startsWith(item.href)}
            expanded={expanded}
            onClick={onNavigate}
          />
        ))}

        {isPlatformAdmin && (
          <Link
            href="/admin/database"
            onClick={onNavigate}
            title={!expanded ? "Database admin" : undefined}
            className={cn(
              "flex items-center rounded-lg py-1.5 text-sm transition-colors",
              expanded ? "gap-2.5 px-2.5" : "justify-center px-0",
              pathname.startsWith("/admin")
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            )}
          >
            <Database className="h-4 w-4 shrink-0" />
            {expanded && "Database admin"}
          </Link>
        )}

        {/* Theme toggle */}
        <button
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          className={cn(
            "flex w-full items-center rounded-lg py-1.5 text-sm transition-colors text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
            expanded ? "gap-2.5 px-2.5" : "justify-center px-0"
          )}
        >
          {theme === "dark" ? (
            <Sun className="h-4 w-4 shrink-0" />
          ) : (
            <Moon className="h-4 w-4 shrink-0" />
          )}
          {expanded && <span>{theme === "dark" ? "Light mode" : "Dark mode"}</span>}
        </button>
      </div>

      <CreateListModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSubmit={handleCreateList}
      />
    </aside>
  );
}

function NavItem({
  href,
  label,
  icon: Icon,
  active,
  expanded,
  onClick,
}: {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  active: boolean;
  expanded: boolean;
  onClick?: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      title={!expanded ? label : undefined}
      className={cn(
        "flex items-center rounded-lg py-1.5 text-sm transition-colors",
        expanded ? "gap-2.5 px-2.5" : "justify-center px-0",
        active
          ? "bg-sidebar-accent text-sidebar-accent-foreground"
          : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
      )}
    >
      <Icon className="h-4 w-4 shrink-0" />
      {expanded && label}
    </Link>
  );
}
