"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

interface PendingUser {
  id: string;
  name: string;
  email: string;
  createdAt: string;
}

export default function UserApprovalsSettingsPage() {
  const [rows, setRows] = useState<PendingUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [actionId, setActionId] = useState<string | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    setForbidden(false);
    try {
      const res = await fetch("/api/v1/admin/registration-queue");
      if (res.status === 403) {
        setForbidden(true);
        setRows([]);
        return;
      }
      if (!res.ok) {
        setError("Offene Registrierungen konnten nicht geladen werden.");
        setRows([]);
        return;
      }
      const data = await res.json();
      setRows(data.data ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function approve(id: string) {
    setActionId(id);
    setError("");
    try {
      const res = await fetch(`/api/v1/admin/users/${id}/approve`, {
        method: "POST",
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error?.message ?? "Benutzer konnte nicht freigegeben werden");
        return;
      }
      setRows((r) => r.filter((x) => x.id !== id));
    } finally {
      setActionId(null);
    }
  }

  async function reject(id: string) {
    if (!confirm("Diesen Benutzer ablehnen? Er kann sich dann nicht anmelden.")) return;
    setActionId(id);
    setError("");
    try {
      const res = await fetch(`/api/v1/admin/users/${id}/reject`, {
        method: "POST",
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error?.message ?? "Benutzer konnte nicht abgelehnt werden");
        return;
      }
      setRows((r) => r.filter((x) => x.id !== id));
    } finally {
      setActionId(null);
    }
  }

  if (forbidden) {
    return (
      <p className="text-sm text-muted-foreground">
        Du hast keine Berechtigung, Benutzer freizugeben. Bitte einen CRM-Administrator um Zugriff
        oder trage deine E-Mail-Adresse in <code className="text-xs">CRM_ADMIN_EMAILS</code> ein
        (für Bootstrap-Konten).
      </p>
    );
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold mb-1">Benutzer-Freigaben</h1>
        <p className="text-sm text-muted-foreground">
          Neue Registrierungen freigeben, bevor sie das CRM nutzen können.
        </p>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {loading ? (
        <p className="text-sm text-muted-foreground flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Lädt…
        </p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Keine offenen Registrierungen.</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((u) => (
            <li
              key={u.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border px-3 py-3"
            >
              <div className="min-w-0 text-left">
                <p className="font-medium truncate">{u.name}</p>
                <p className="text-xs text-muted-foreground truncate">{u.email}</p>
                <p className="text-[10px] text-muted-foreground mt-1">
                  Angefragt am {new Date(u.createdAt).toLocaleString("de-DE")}
                </p>
              </div>
              <div className="flex gap-2 shrink-0">
                <Button
                  size="sm"
                  disabled={actionId === u.id}
                  onClick={() => approve(u.id)}
                >
                  {actionId === u.id ? <Loader2 className="h-4 w-4 animate-spin" /> : "Freigeben"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={actionId === u.id}
                  onClick={() => reject(u.id)}
                >
                  Ablehnen
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
