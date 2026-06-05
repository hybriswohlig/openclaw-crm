"use client";

import { useEffect, useState } from "react";
import {
  Loader2,
  Users,
  KeyRound,
  Plus,
  RotateCcw,
  Copy,
  Check,
  CircleSlash,
  Clock,
  CircleCheck,
  X,
} from "lucide-react";

interface AccountRow {
  employeeId: string;
  employeeName: string;
  userId: string | null;
  username: string | null;
  hasPassword: boolean;
}

type AccountStatus = "none" | "pending" | "active";

function statusOf(row: AccountRow): AccountStatus {
  if (!row.userId) return "none";
  if (!row.hasPassword) return "pending";
  return "active";
}

const STATUS_META: Record<
  AccountStatus,
  { label: string; className: string; Icon: typeof CircleSlash }
> = {
  none: {
    label: "Kein Zugang",
    className: "bg-muted text-muted-foreground",
    Icon: CircleSlash,
  },
  pending: {
    label: "Wartet auf Passwort",
    className:
      "bg-amber-500/15 text-amber-600 dark:text-amber-400",
    Icon: Clock,
  },
  active: {
    label: "Aktiv",
    className:
      "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
    Icon: CircleCheck,
  },
};

function StatusBadge({ status }: { status: AccountStatus }) {
  const meta = STATUS_META[status];
  const Icon = meta.Icon;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${meta.className}`}
    >
      <Icon className="h-3.5 w-3.5" />
      {meta.label}
    </span>
  );
}

function SetupLinkBox({
  url,
  onClose,
}: {
  url: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback: select-and-copy via a temporary textarea
      const ta = document.createElement("textarea");
      ta.value = url;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      try {
        document.execCommand("copy");
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch {
        // ignore
      }
      document.body.removeChild(ta);
    }
  }

  return (
    <div className="mt-3 rounded-xl border border-border bg-primary/5 p-3">
      <div className="mb-2 flex items-start justify-between gap-2">
        <p className="text-sm font-medium text-foreground">
          Diesen Link dem Mitarbeiter geben
        </p>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md p-1 text-muted-foreground hover:bg-muted"
          aria-label="Schließen"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <p className="mb-3 text-xs text-muted-foreground">
        Der Mitarbeiter öffnet diesen Link einmalig und legt damit sein
        Passwort fest. Der Link ist nur begrenzt gültig.
      </p>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <input
          type="text"
          readOnly
          value={url}
          onFocus={(e) => e.currentTarget.select()}
          className="w-full flex-1 rounded-lg border border-border bg-background px-3 py-2 font-mono text-xs text-foreground outline-none focus:ring-2 focus:ring-ring"
        />
        <button
          type="button"
          onClick={copy}
          className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90"
        >
          {copied ? (
            <>
              <Check className="h-4 w-4" />
              Kopiert
            </>
          ) : (
            <>
              <Copy className="h-4 w-4" />
              Kopieren
            </>
          )}
        </button>
      </div>
    </div>
  );
}

export default function MitarbeiterZugaengePage() {
  const [rows, setRows] = useState<AccountRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // per-employee local UI state
  const [usernames, setUsernames] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const [setupUrls, setSetupUrls] = useState<Record<string, string | null>>({});

  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch("/api/v1/admin/employee-accounts");
      if (!res.ok) {
        throw new Error("Mitarbeiter konnten nicht geladen werden.");
      }
      const body = await res.json();
      setRows((body.data as AccountRow[]) ?? []);
    } catch (err) {
      setLoadError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function setBusyFor(id: string, value: boolean) {
    setBusy((prev) => ({ ...prev, [id]: value }));
  }
  function setErrorFor(id: string, value: string | null) {
    setErrors((prev) => ({ ...prev, [id]: value }));
  }

  async function createAccount(row: AccountRow) {
    const username = (usernames[row.employeeId] ?? "").trim();
    if (!username) {
      setErrorFor(row.employeeId, "Bitte einen Benutzernamen eingeben.");
      return;
    }
    setBusyFor(row.employeeId, true);
    setErrorFor(row.employeeId, null);
    try {
      const res = await fetch("/api/v1/admin/employee-accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeId: row.employeeId, username }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body.error || "Zugang konnte nicht erstellt werden.");
      }
      setSetupUrls((prev) => ({
        ...prev,
        [row.employeeId]: body.data?.setupUrl ?? null,
      }));
      // reflect new account locally so the row switches to "Wartet auf Passwort"
      setRows((prev) =>
        prev.map((r) =>
          r.employeeId === row.employeeId
            ? {
                ...r,
                userId: body.data?.userId ?? "pending",
                username: body.data?.username ?? username,
                hasPassword: false,
              }
            : r
        )
      );
    } catch (err) {
      setErrorFor(row.employeeId, (err as Error).message);
    } finally {
      setBusyFor(row.employeeId, false);
    }
  }

  async function resetPassword(row: AccountRow) {
    setBusyFor(row.employeeId, true);
    setErrorFor(row.employeeId, null);
    try {
      const res = await fetch(
        `/api/v1/admin/employee-accounts/${row.employeeId}/reset`,
        { method: "POST" }
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          body.error || "Passwort konnte nicht zurückgesetzt werden."
        );
      }
      setSetupUrls((prev) => ({
        ...prev,
        [row.employeeId]: body.data?.setupUrl ?? null,
      }));
      // a reset invalidates the password until the new link is used
      setRows((prev) =>
        prev.map((r) =>
          r.employeeId === row.employeeId
            ? { ...r, hasPassword: false }
            : r
        )
      );
    } catch (err) {
      setErrorFor(row.employeeId, (err as Error).message);
    } finally {
      setBusyFor(row.employeeId, false);
    }
  }

  function closeSetupUrl(id: string) {
    setSetupUrls((prev) => ({ ...prev, [id]: null }));
  }

  return (
    <div className="max-w-3xl">
      <div className="mb-6 flex items-start gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Users className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-xl font-semibold text-foreground">
            Mitarbeiter-Zugänge
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Hier verwalten Sie die Zugänge zum Mitarbeiter-Portal. Erstellen Sie
            für jeden Mitarbeiter einen Benutzernamen und geben Sie ihm den
            einmaligen Link, mit dem er sein eigenes Passwort festlegt.
          </p>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : loadError ? (
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-sm text-red-500">{loadError}</p>
          <button
            type="button"
            onClick={load}
            className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-muted"
          >
            <RotateCcw className="h-4 w-4" />
            Erneut versuchen
          </button>
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-8 text-center">
          <p className="text-sm text-muted-foreground">
            Es sind noch keine Mitarbeiter angelegt.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((row) => {
            const status = statusOf(row);
            const isBusy = !!busy[row.employeeId];
            const error = errors[row.employeeId] ?? null;
            const setupUrl = setupUrls[row.employeeId] ?? null;
            const hasAccount = status !== "none";

            return (
              <div
                key={row.employeeId}
                className="rounded-2xl border border-border bg-card p-4 shadow-sm"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-base font-medium text-foreground">
                      {row.employeeName}
                    </p>
                    {row.username ? (
                      <p className="mt-0.5 flex items-center gap-1.5 text-sm text-muted-foreground">
                        <KeyRound className="h-3.5 w-3.5" />
                        <span className="font-mono">{row.username}</span>
                      </p>
                    ) : (
                      <p className="mt-0.5 text-sm text-muted-foreground">
                        Noch kein Benutzername
                      </p>
                    )}
                  </div>
                  <StatusBadge status={status} />
                </div>

                {!hasAccount ? (
                  <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
                    <input
                      type="text"
                      value={usernames[row.employeeId] ?? ""}
                      onChange={(e) =>
                        setUsernames((prev) => ({
                          ...prev,
                          [row.employeeId]: e.target.value,
                        }))
                      }
                      placeholder="Benutzername"
                      autoComplete="off"
                      autoCapitalize="none"
                      spellCheck={false}
                      disabled={isBusy}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") createAccount(row);
                      }}
                      className="w-full flex-1 rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
                    />
                    <button
                      type="button"
                      onClick={() => createAccount(row)}
                      disabled={isBusy}
                      className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
                    >
                      {isBusy ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Plus className="h-4 w-4" />
                      )}
                      Zugang erstellen
                    </button>
                  </div>
                ) : (
                  <div className="mt-4">
                    <button
                      type="button"
                      onClick={() => resetPassword(row)}
                      disabled={isBusy}
                      className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-border bg-background px-4 py-2 text-sm font-medium text-foreground transition hover:bg-muted disabled:opacity-60"
                    >
                      {isBusy ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <RotateCcw className="h-4 w-4" />
                      )}
                      Passwort zurücksetzen
                    </button>
                  </div>
                )}

                {error && (
                  <p className="mt-3 text-sm text-red-500">{error}</p>
                )}

                {setupUrl && (
                  <SetupLinkBox
                    url={setupUrl}
                    onClose={() => closeSetupUrl(row.employeeId)}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
