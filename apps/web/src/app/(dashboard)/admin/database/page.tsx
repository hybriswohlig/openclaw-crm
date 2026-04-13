"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Loader2, ArrowLeft, Trash2 } from "lucide-react";

type Op =
  | {
      id: string;
      kind: "rename_column";
      table: string;
      from: string;
      to: string;
    }
  | {
      id: string;
      kind: "add_column";
      table: string;
      column: string;
      dataType: string;
      nullable: boolean;
      defaultPreset: string;
    };

const DATA_TYPES = [
  "text",
  "uuid",
  "boolean",
  "integer",
  "bigint",
  "numeric",
  "double precision",
  "timestamp",
  "timestamptz",
  "date",
  "jsonb",
] as const;

const DEFAULT_PRESETS = [
  { value: "none", label: "No default" },
  { value: "now", label: "now() (timestamps only)" },
  { value: "uuid", label: "gen_random_uuid() (uuid only)" },
  { value: "true", label: "TRUE (boolean)" },
  { value: "false", label: "FALSE (boolean)" },
  { value: "empty_text", label: "'' (text only)" },
  { value: "empty_json", label: "'{}'::jsonb (jsonb only)" },
] as const;

function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export default function AdminDatabasePage() {
  const router = useRouter();
  const [gate, setGate] = useState<"loading" | "ok" | "denied">("loading");

  const [status, setStatus] = useState<{
    envDatabase: { configured: boolean; host?: string };
    activeDatabase: { configured: boolean; host?: string };
    usingCookieOverride: boolean;
    usingEnvTarget: boolean;
  } | null>(null);

  const [targetUrlDraft, setTargetUrlDraft] = useState("");
  const [testMsg, setTestMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [seedMsg, setSeedMsg] = useState<string | null>(null);
  const [tables, setTables] = useState<string[]>([]);
  const [selectedTable, setSelectedTable] = useState("");
  const [columns, setColumns] = useState<
    { column_name: string; data_type: string; is_nullable: string }[]
  >([]);

  const [renameFrom, setRenameFrom] = useState("");
  const [renameTo, setRenameTo] = useState("");

  const [addColumn, setAddColumn] = useState("");
  const [addType, setAddType] = useState<string>(DATA_TYPES[0]);
  const [addNullable, setAddNullable] = useState(true);
  const [addDefault, setAddDefault] = useState<string>("none");

  const [queue, setQueue] = useState<Op[]>([]);
  const [applyResult, setApplyResult] = useState<string | null>(null);

  const refreshStatus = useCallback(async () => {
    const res = await fetch("/api/admin/db/status");
    if (res.ok) {
      const j = await res.json();
      setStatus(j.data);
    }
  }, []);

  useEffect(() => {
    (async () => {
      const res = await fetch("/api/admin/db/me");
      const j = await res.json();
      if (!j.data?.admin) {
        setGate("denied");
        return;
      }
      setGate("ok");
      await refreshStatus();
    })();
  }, [refreshStatus]);

  useEffect(() => {
    if (gate === "denied") {
      router.replace("/home");
    }
  }, [gate, router]);

  async function handleTest(url?: string) {
    setTestMsg(null);
    setBusy(true);
    try {
      const res = await fetch("/api/admin/db/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(url ? { url } : {}),
      });
      const j = await res.json();
      if (res.ok) setTestMsg("Connection OK.");
      else setTestMsg(j.error?.message || "Connection failed.");
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveTarget() {
    setTestMsg(null);
    setBusy(true);
    try {
      const res = await fetch("/api/admin/db/target", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: targetUrlDraft.trim() }),
      });
      const j = await res.json();
      if (res.ok) {
        setTestMsg("Target database saved for this session.");
        setTargetUrlDraft("");
        await refreshStatus();
      } else {
        setTestMsg(j.error?.message || "Could not save target URL.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleSeedObjects() {
    setSeedMsg(null);
    setBusy(true);
    try {
      const res = await fetch("/api/admin/db/seed-objects", { method: "POST" });
      const j = await res.json();
      if (res.ok) setSeedMsg("Objects seeded successfully. Reload the app to see changes.");
      else setSeedMsg(j.error || "Seeding failed.");
    } finally {
      setBusy(false);
    }
  }

  async function handleClearTarget() {
    setBusy(true);
    try {
      await fetch("/api/admin/db/target", { method: "DELETE" });
      await refreshStatus();
      setTestMsg("Session target cleared. Using env DATABASE_URL / DATABASE_TARGET_URL.");
    } finally {
      setBusy(false);
    }
  }

  async function loadTables() {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/db/tables");
      const j = await res.json();
      if (res.ok) setTables(j.data.tables || []);
      else setTestMsg(j.error?.message || "Could not list tables.");
    } finally {
      setBusy(false);
    }
  }

  async function loadColumns(table: string) {
    if (!table) {
      setColumns([]);
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(
        `/api/admin/db/columns?table=${encodeURIComponent(table)}`
      );
      const j = await res.json();
      if (res.ok) setColumns(j.data.columns || []);
      else setTestMsg(j.error?.message || "Could not list columns.");
    } finally {
      setBusy(false);
    }
  }

  function enqueueRename() {
    if (!selectedTable || !renameFrom || !renameTo) return;
    setQueue((q) => [
      ...q,
      {
        id: uid(),
        kind: "rename_column",
        table: selectedTable,
        from: renameFrom,
        to: renameTo,
      },
    ]);
    setRenameFrom("");
    setRenameTo("");
    setApplyResult(null);
  }

  function enqueueAdd() {
    if (!selectedTable || !addColumn) return;
    setQueue((q) => [
      ...q,
      {
        id: uid(),
        kind: "add_column",
        table: selectedTable,
        column: addColumn,
        dataType: addType,
        nullable: addNullable,
        defaultPreset: addDefault,
      },
    ]);
    setAddColumn("");
    setApplyResult(null);
  }

  function removeQueued(id: string) {
    setQueue((q) => q.filter((o) => o.id !== id));
  }

  async function applyQueue() {
    if (queue.length === 0) return;
    setApplyResult(null);
    setBusy(true);
    try {
      const operations = queue.map((o) => {
        if (o.kind === "rename_column") {
          return {
            kind: "rename_column" as const,
            table: o.table,
            from: o.from,
            to: o.to,
          };
        }
        return {
          kind: "add_column" as const,
          table: o.table,
          column: o.column,
          dataType: o.dataType,
          nullable: o.nullable,
          defaultPreset: o.defaultPreset,
        };
      });
      const res = await fetch("/api/admin/db/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operations }),
      });
      const j = await res.json();
      if (res.ok) {
        setApplyResult(`Applied ${j.data.applied.length} statement(s).`);
        setQueue([]);
        if (selectedTable) await loadColumns(selectedTable);
      } else {
        setApplyResult(
          j.error?.message || "Apply failed. Check server logs and preview below."
        );
        if (j.data?.preview) {
          setApplyResult(
            (prev) =>
              `${prev}\n\nSQL preview:\n${(j.data.preview as string[]).join("\n")}`
          );
        }
      }
    } finally {
      setBusy(false);
    }
  }

  if (gate === "loading" || gate === "denied") {
    return (
      <div className="flex items-center justify-center py-24 text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 pb-12">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/home" className="gap-1">
            <ArrowLeft className="h-4 w-4" />
            Back
          </Link>
        </Button>
        <div>
          <h1 className="text-xl font-semibold">Database admin</h1>
          <p className="text-sm text-muted-foreground">
            Neon / Postgres connection, schema changes, and one-click apply.
          </p>
        </div>
      </div>


      <Card>
        <CardHeader>
          <CardTitle>Workspace objects</CardTitle>
          <CardDescription>
            Seeds or repairs the standard objects (Contacts, Companies, Leads), their
            attributes, pipeline stages, and built-in teams for your workspace.
            Safe to run multiple times — existing data is never overwritten.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button onClick={handleSeedObjects} disabled={busy} size="sm">
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Seed / repair workspace objects
          </Button>
          {seedMsg && (
            <p className="text-sm text-muted-foreground">{seedMsg}</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Active connection</CardTitle>
          <CardDescription>
            The app normally uses <code className="text-xs">DATABASE_URL</code>.
            You can point admin tools at another Neon branch with{" "}
            <code className="text-xs">DATABASE_TARGET_URL</code> or a session
            override (stored in an httpOnly cookie for 8 hours).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {status && (
            <ul className="space-y-1 text-muted-foreground">
              <li>
                Env <code className="text-xs">DATABASE_URL</code>:{" "}
                {status.envDatabase.configured
                  ? status.envDatabase.host ?? "set"
                  : "not set"}
              </li>
              <li>
                Active target host:{" "}
                {status.activeDatabase.configured
                  ? status.activeDatabase.host ?? "?"
                  : "not configured"}
              </li>
              <li>
                Session cookie override:{" "}
                {status.usingCookieOverride ? "yes" : "no"} · Env{" "}
                <code className="text-xs">DATABASE_TARGET_URL</code>:{" "}
                {status.usingEnvTarget ? "yes" : "no"}
              </li>
            </ul>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={busy}
              onClick={() => handleTest()}
            >
              Test active connection
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={refreshStatus}
            >
              Refresh status
            </Button>
          </div>
          {testMsg && (
            <p className="rounded-md border bg-muted/40 px-3 py-2 text-xs whitespace-pre-wrap">
              {testMsg}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Session target (Neon connection string)</CardTitle>
          <CardDescription>
            Paste the connection string from the Neon dashboard (SQL editor →
            connection details). It is validated with{" "}
            <code className="text-xs">SELECT 1</code> before being saved.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="target-url">Postgres URL</Label>
            <Input
              id="target-url"
              type="password"
              autoComplete="off"
              placeholder="postgresql://user:pass@ep-....neon.tech/neondb?sslmode=require"
              value={targetUrlDraft}
              onChange={(e) => setTargetUrlDraft(e.target.value)}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              disabled={busy || !targetUrlDraft.trim()}
              onClick={() => handleTest(targetUrlDraft.trim())}
            >
              Test this URL
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={busy || !targetUrlDraft.trim()}
              onClick={handleSaveTarget}
            >
              Save as session target
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={handleClearTarget}
            >
              Clear session target
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Tables & columns</CardTitle>
          <CardDescription>
            Inspect the <code className="text-xs">public</code> schema. Load
            tables first, then pick a table to edit columns.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={loadTables}
          >
            Load tables
          </Button>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Table</Label>
              <select
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                value={selectedTable}
                onChange={(e) => {
                  const t = e.target.value;
                  setSelectedTable(t);
                  loadColumns(t);
                }}
              >
                <option value="">Select…</option>
                {tables.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {columns.length > 0 && (
            <div className="rounded-md border max-h-48 overflow-auto text-xs">
              <table className="w-full">
                <thead>
                  <tr className="border-b bg-muted/40 text-left">
                    <th className="p-2">Column</th>
                    <th className="p-2">Type</th>
                    <th className="p-2">Nullable</th>
                  </tr>
                </thead>
                <tbody>
                  {columns.map((c) => (
                    <tr key={c.column_name} className="border-b border-border/50">
                      <td className="p-2 font-mono">{c.column_name}</td>
                      <td className="p-2 text-muted-foreground">{c.data_type}</td>
                      <td className="p-2">{c.is_nullable}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Rename column</CardTitle>
          <CardDescription>
            Queues <code className="text-xs">ALTER TABLE … RENAME COLUMN</code>.
            Also update your Drizzle schema in code so the app stays in sync.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label className="text-xs">From</Label>
            <Input
              className="h-9 w-40 font-mono text-sm"
              value={renameFrom}
              onChange={(e) => setRenameFrom(e.target.value)}
              placeholder="old_name"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">To</Label>
            <Input
              className="h-9 w-40 font-mono text-sm"
              value={renameTo}
              onChange={(e) => setRenameTo(e.target.value)}
              placeholder="new_name"
            />
          </div>
          <Button
            type="button"
            size="sm"
            disabled={!selectedTable || !renameFrom || !renameTo}
            onClick={enqueueRename}
          >
            Add to queue
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Add column</CardTitle>
          <CardDescription>
            Queues <code className="text-xs">ALTER TABLE … ADD COLUMN</code>.
            Identifier rules: letters, numbers, underscore; start with a letter.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-xs">Column name</Label>
              <Input
                className="h-9 font-mono text-sm"
                value={addColumn}
                onChange={(e) => setAddColumn(e.target.value)}
                placeholder="my_column"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Postgres type</Label>
              <select
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                value={addType}
                onChange={(e) => setAddType(e.target.value)}
              >
                {DATA_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Default</Label>
              <select
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                value={addDefault}
                onChange={(e) => setAddDefault(e.target.value)}
              >
                {DEFAULT_PRESETS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
            <label className="flex items-center gap-2 text-sm pt-6">
              <input
                type="checkbox"
                checked={addNullable}
                onChange={(e) => setAddNullable(e.target.checked)}
              />
              Nullable
            </label>
          </div>
          <Button
            type="button"
            size="sm"
            disabled={!selectedTable || !addColumn}
            onClick={enqueueAdd}
          >
            Add to queue
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Queue & apply</CardTitle>
          <CardDescription>
            All statements run in a single transaction against the active target.
            If one fails, none are committed.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {queue.length === 0 ? (
            <p className="text-sm text-muted-foreground">Queue is empty.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {queue.map((o) => (
                <li
                  key={o.id}
                  className="flex items-start justify-between gap-2 rounded-md border px-3 py-2"
                >
                  <pre className="text-xs whitespace-pre-wrap font-mono flex-1">
                    {o.kind === "rename_column"
                      ? `RENAME ${o.table}.${o.from} → ${o.to}`
                      : `ADD ${o.table}.${o.column} ${o.dataType} ${o.nullable ? "NULL" : "NOT NULL"} (${o.defaultPreset})`}
                  </pre>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="shrink-0 h-8 w-8"
                    onClick={() => removeQueued(o.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <Button
            type="button"
            disabled={busy || queue.length === 0}
            onClick={applyQueue}
          >
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Apply to database (one click)
          </Button>
          {applyResult && (
            <p className="rounded-md border bg-muted/40 px-3 py-2 text-xs whitespace-pre-wrap">
              {applyResult}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Drizzle / full schema sync</CardTitle>
          <CardDescription>
            This UI only runs raw <code className="text-xs">ALTER TABLE</code>{" "}
            commands. To keep TypeScript schema and migrations aligned, run from
            your machine:
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm space-y-2">
          <pre className="rounded-md bg-muted p-3 text-xs overflow-x-auto">
            cd apps/web{"\n"}
            pnpm db:push
          </pre>
          <p className="text-muted-foreground text-xs">
            Use the same <code className="text-xs">DATABASE_URL</code> as your Neon
            branch, or run against production only after backing up.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
