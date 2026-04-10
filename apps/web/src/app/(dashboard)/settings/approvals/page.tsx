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
        setError("Could not load pending registrations.");
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
        setError(d.error?.message ?? "Approve failed");
        return;
      }
      setRows((r) => r.filter((x) => x.id !== id));
    } finally {
      setActionId(null);
    }
  }

  async function reject(id: string) {
    if (!confirm("Reject this user? They will not be able to sign in.")) return;
    setActionId(id);
    setError("");
    try {
      const res = await fetch(`/api/v1/admin/users/${id}/reject`, {
        method: "POST",
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error?.message ?? "Reject failed");
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
        You do not have permission to approve users. Ask a CRM administrator to grant access or add
        your email to <code className="text-xs">CRM_ADMIN_EMAILS</code> for bootstrap accounts.
      </p>
    );
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold mb-1">User approvals</h1>
        <p className="text-sm text-muted-foreground">
          Approve new registrations before they can use the CRM.
        </p>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {loading ? (
        <p className="text-sm text-muted-foreground flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No pending registrations.</p>
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
                  Requested {new Date(u.createdAt).toLocaleString()}
                </p>
              </div>
              <div className="flex gap-2 shrink-0">
                <Button
                  size="sm"
                  disabled={actionId === u.id}
                  onClick={() => approve(u.id)}
                >
                  {actionId === u.id ? <Loader2 className="h-4 w-4 animate-spin" /> : "Approve"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={actionId === u.id}
                  onClick={() => reject(u.id)}
                >
                  Reject
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
