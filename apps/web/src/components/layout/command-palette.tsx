"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { Command } from "cmdk";
import { toast } from "sonner";
import {
  Search,
  Users,
  Building2,
  Handshake,
  Truck,
  List,
  Home,
  MessageSquare,
  CheckSquare,
  CalendarDays,
  Bell,
  HardHat,
  Banknote,
  BarChart3,
  StickyNote,
  Plug,
  Inbox,
  Mail,
  Settings,
  FileText,
  ArrowRight,
  Plus,
} from "lucide-react";
import { TaskDialog } from "@/components/tasks/task-dialog";
import type { SearchResult } from "@/services/search";

const OBJECT_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  people: Users,
  companies: Building2,
  deals: Handshake,
  operating_companies: Truck,
};

// Spiegelt die Sidebar-Navigation (sidebar.tsx): gleiche Labels, Routen und
// Icons, damit Tippen-zum-Finden mit der Sidebar übereinstimmt.
const PAGE_ITEMS = [
  { id: "home", label: "Heute", icon: Home, url: "/home" },
  { id: "chat", label: "Chat", icon: MessageSquare, url: "/chat" },
  { id: "tasks", label: "Aufgaben", icon: CheckSquare, url: "/tasks" },
  { id: "calendar", label: "Kalender", icon: CalendarDays, url: "/contract-calendar" },
  { id: "notifications", label: "Benachrichtigungen", icon: Bell, url: "/notifications" },
  { id: "people", label: "Kunden", icon: Users, url: "/objects/people" },
  { id: "deals", label: "Leads", icon: Handshake, url: "/objects/deals" },
  { id: "employees", label: "Mitarbeiter", icon: HardHat, url: "/employees" },
  { id: "operations", label: "Aufträge", icon: Truck, url: "/operations" },
  { id: "financial", label: "Finanzen", icon: Banknote, url: "/financial" },
  { id: "statistics", label: "Statistiken", icon: BarChart3, url: "/statistics" },
  { id: "notes", label: "Notizen", icon: StickyNote, url: "/notes" },
  { id: "companies", label: "Firmen", icon: Building2, url: "/objects/companies" },
  { id: "integrations", label: "Integrationen", icon: Plug, url: "/integrations" },
  { id: "inbox", label: "Inbox", icon: Inbox, url: "/inbox" },
  { id: "email", label: "E-Mail", icon: Mail, url: "/email" },
  { id: "settings", label: "Einstellungen", icon: Settings, url: "/settings" },
];

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [taskDialogOpen, setTaskDialogOpen] = useState(false);
  const router = useRouter();
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Toggle with Ctrl+K / Cmd+K
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Search API call with debounce
  const searchApi = useCallback(async (term: string) => {
    if (!term.trim()) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/search?q=${encodeURIComponent(term)}&limit=10`);
      if (res.ok) {
        const data = await res.json();
        setResults(data.data ?? []);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim()) {
      setResults([]);
      return;
    }
    debounceRef.current = setTimeout(() => searchApi(query), 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, searchApi]);

  function closePalette() {
    setOpen(false);
    setQuery("");
    setResults([]);
  }

  function navigate(url: string) {
    closePalette();
    router.push(url);
  }

  // Reset state when closing
  function handleOpenChange(value: boolean) {
    setOpen(value);
    if (!value) {
      setQuery("");
      setResults([]);
    }
  }

  function getResultIcon(result: SearchResult) {
    if (result.type === "list") return List;
    if (result.objectSlug && OBJECT_ICONS[result.objectSlug]) {
      return OBJECT_ICONS[result.objectSlug];
    }
    return FileText;
  }

  return (
    <>
      <Command.Dialog
        open={open}
        onOpenChange={handleOpenChange}
        label="Befehlspalette"
        className="fixed inset-0 z-50"
      >
        {/* Backdrop */}
        <div
          className="fixed inset-0 bg-black/60"
          onClick={() => handleOpenChange(false)}
        />

        {/* Dialog */}
        <div className="fixed left-1/2 top-[20%] z-50 w-full max-w-xl -translate-x-1/2 rounded-xl border border-border bg-background shadow-2xl">
          {/* Search input */}
          <div className="flex items-center gap-2 border-b border-border px-4">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
            <Command.Input
              value={query}
              onValueChange={setQuery}
              placeholder="Suchen, navigieren oder Aktion starten..."
              className="flex h-12 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
            {loading && (
              <div className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
            )}
          </div>

          {/* Results */}
          <Command.List className="max-h-80 overflow-y-auto p-2">
            <Command.Empty className="px-4 py-8 text-center text-sm text-muted-foreground">
              {query.trim()
                ? loading
                  ? "Suche läuft..."
                  : "Keine Treffer."
                : "Tippen zum Suchen oder unten eine Seite wählen."}
            </Command.Empty>

            {/* Search results */}
            {results.length > 0 && (
              <Command.Group heading="Suchergebnisse" className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground">
                {results.map((result) => {
                  const Icon = getResultIcon(result);
                  return (
                    <Command.Item
                      key={`${result.type}-${result.id}`}
                      value={`${result.title} ${result.subtitle}`}
                      onSelect={() => navigate(result.url)}
                      className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-sm aria-selected:bg-accent"
                    >
                      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <div className="flex flex-1 flex-col overflow-hidden">
                        <span className="truncate font-medium">{result.title}</span>
                        <span className="truncate text-xs text-muted-foreground">
                          {result.subtitle}
                        </span>
                      </div>
                      <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground opacity-0 group-aria-selected:opacity-100" />
                    </Command.Item>
                  );
                })}
              </Command.Group>
            )}

            {/* Quick actions */}
            <Command.Group heading="Aktionen" className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground">
              <Command.Item
                value="Neue Aufgabe erstellen"
                onSelect={() => {
                  closePalette();
                  setTaskDialogOpen(true);
                }}
                className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm aria-selected:bg-accent"
              >
                <Plus className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span>Neue Aufgabe</span>
              </Command.Item>
              <Command.Item
                value="Neuer Lead erstellen"
                onSelect={() => navigate("/objects/deals?create=1")}
                className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm aria-selected:bg-accent"
              >
                <Plus className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span>Neuer Lead</span>
              </Command.Item>
              <Command.Item
                value="Neue Notiz erstellen"
                onSelect={() => navigate("/notes?create=1")}
                className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm aria-selected:bg-accent"
              >
                <Plus className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span>Neue Notiz</span>
              </Command.Item>
            </Command.Group>

            {/* Quick navigation pages */}
            <Command.Group heading="Seiten" className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground">
              {PAGE_ITEMS.map((item) => (
                <Command.Item
                  key={item.id}
                  value={item.label}
                  onSelect={() => navigate(item.url)}
                  className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm aria-selected:bg-accent"
                >
                  <item.icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span>{item.label}</span>
                </Command.Item>
              ))}
            </Command.Group>

            {/* Show "Alle Ergebnisse anzeigen" link when there are search results */}
            {query.trim() && results.length > 0 && (
              <Command.Group className="border-t border-border mt-1 pt-1">
                <Command.Item
                  value="view-all-results"
                  onSelect={() => navigate(`/search?q=${encodeURIComponent(query)}`)}
                  className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm aria-selected:bg-accent"
                >
                  <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span>
                    Alle Ergebnisse für &bdquo;{query}&ldquo; anzeigen
                  </span>
                </Command.Item>
              </Command.Group>
            )}
          </Command.List>
        </div>
      </Command.Dialog>

      {/* "Neue Aufgabe" quick action: create-mode task dialog. onSave wirft bei
          Fehlern, der Dialog zeigt dann selbst einen Error-Toast und bleibt offen. */}
      <TaskDialog
        open={taskDialogOpen}
        onOpenChange={setTaskDialogOpen}
        mode="create"
        onSave={async (data) => {
          const res = await fetch("/api/v1/tasks", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(data),
          });
          if (!res.ok) {
            const err = await res.json().catch(() => null);
            throw new Error(
              err?.error?.message ||
                "Speichern fehlgeschlagen, bitte erneut versuchen"
            );
          }
          toast.success("Aufgabe erstellt");
        }}
      />
    </>
  );
}
