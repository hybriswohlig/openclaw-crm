"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, X, Loader2, UserCheck, ShieldX, Clock, MailPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface PendingUser {
  id: string;
  name: string | null;
  email: string;
  image: string | null;
  approvalStatus: "pending" | "approved" | "rejected";
  createdAt: string;
}

interface ApprovalsResponse {
  pending: PendingUser[];
  rejected: PendingUser[];
  approvedNoWorkspace: PendingUser[];
}

export default function ApprovalsPage() {
  const [data, setData] = useState<ApprovalsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [denied, setDenied] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/v1/admin/approvals");
    if (res.status === 403) {
      setDenied(true);
      setLoading(false);
      return;
    }
    if (res.ok) {
      const j = await res.json();
      setData(j.data);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function act(userId: string, action: "approve" | "reject") {
    setBusy((b) => ({ ...b, [userId]: true }));
    try {
      await fetch(`/api/v1/admin/approvals/${userId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      await load();
    } finally {
      setBusy((b) => ({ ...b, [userId]: false }));
    }
  }

  if (denied) {
    return (
      <div className="max-w-2xl">
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-6 text-center">
          <ShieldX className="h-10 w-10 mx-auto text-destructive mb-3" />
          <h2 className="text-base font-semibold">Admin access required</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Only workspace admins can approve or reject new users.
          </p>
        </div>
      </div>
    );
  }

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center h-48">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const pending = data?.pending ?? [];
  const rejected = data?.rejected ?? [];
  const orphans = data?.approvedNoWorkspace ?? [];

  return (
    <div className="max-w-2xl space-y-10">
      <div>
        <h1 className="text-xl font-semibold">User Approvals</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Anyone registering with a <code className="text-xs">@vi-kang.com</code>{" "}
          address is approved automatically. Everyone else lands here for you
          to review. Approved users are added to your workspace as members and
          can only edit items assigned to them.
        </p>
      </div>

      {/* ── Pending ───────────────────────────────────────── */}
      <Section
        title="Pending review"
        icon={Clock}
        iconClass="text-amber-500"
        description="New sign-ups waiting for you to approve or reject."
        empty="No one is waiting for approval."
        count={pending.length}
      >
        {pending.map((u) => (
          <UserRow
            key={u.id}
            user={u}
            busy={!!busy[u.id]}
            actions={
              <>
                <Button
                  size="sm"
                  className="h-7 text-xs gap-1"
                  onClick={() => act(u.id, "approve")}
                  disabled={!!busy[u.id]}
                >
                  <Check className="h-3.5 w-3.5" /> Approve
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs gap-1 text-destructive hover:text-destructive"
                  onClick={() => act(u.id, "reject")}
                  disabled={!!busy[u.id]}
                >
                  <X className="h-3.5 w-3.5" /> Reject
                </Button>
              </>
            }
          />
        ))}
      </Section>

      {/* ── Approved but not in workspace ─────────────────── */}
      {orphans.length > 0 && (
        <Section
          title="Approved — waiting to be added"
          icon={MailPlus}
          iconClass="text-indigo-500"
          description="These accounts were approved but aren't members of this workspace yet. Approve again to add them."
          empty=""
          count={orphans.length}
        >
          {orphans.map((u) => (
            <UserRow
              key={u.id}
              user={u}
              busy={!!busy[u.id]}
              actions={
                <Button
                  size="sm"
                  className="h-7 text-xs gap-1"
                  onClick={() => act(u.id, "approve")}
                  disabled={!!busy[u.id]}
                >
                  <UserCheck className="h-3.5 w-3.5" /> Add to workspace
                </Button>
              }
            />
          ))}
        </Section>
      )}

      {/* ── Rejected ───────────────────────────────────────── */}
      {rejected.length > 0 && (
        <Section
          title="Rejected"
          icon={ShieldX}
          iconClass="text-destructive"
          description="These accounts have been denied access. You can undo by approving them again."
          empty=""
          count={rejected.length}
        >
          {rejected.map((u) => (
            <UserRow
              key={u.id}
              user={u}
              busy={!!busy[u.id]}
              actions={
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs gap-1"
                  onClick={() => act(u.id, "approve")}
                  disabled={!!busy[u.id]}
                >
                  <Check className="h-3.5 w-3.5" /> Approve anyway
                </Button>
              }
            />
          ))}
        </Section>
      )}
    </div>
  );
}

// ── Subcomponents ────────────────────────────────────────

function Section({
  title,
  icon: Icon,
  iconClass,
  description,
  empty,
  count,
  children,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  iconClass?: string;
  description?: string;
  empty: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold flex items-center gap-2">
          <Icon className={cn("h-4 w-4", iconClass)} />
          {title}
          <span className="text-xs font-normal text-muted-foreground tabular-nums">
            ({count})
          </span>
        </h2>
      </div>
      {description && (
        <p className="text-xs text-muted-foreground">{description}</p>
      )}
      {count === 0 ? (
        empty && (
          <p className="text-sm text-muted-foreground italic">{empty}</p>
        )
      ) : (
        <div className="divide-y divide-border rounded-lg border border-border">
          {children}
        </div>
      )}
    </section>
  );
}

function UserRow({
  user,
  actions,
  busy,
}: {
  user: PendingUser;
  actions: React.ReactNode;
  busy: boolean;
}) {
  return (
    <div className="flex items-center justify-between px-4 py-3">
      <div className="flex items-center gap-3 min-w-0">
        {user.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={user.image} alt="" className="h-8 w-8 rounded-full" />
        ) : (
          <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center text-xs font-medium">
            {(user.name || user.email || "?")[0].toUpperCase()}
          </div>
        )}
        <div className="min-w-0">
          <p className="text-sm font-medium truncate">
            {user.name || user.email.split("@")[0]}
          </p>
          <p className="text-xs text-muted-foreground truncate">{user.email}</p>
          <p className="text-[11px] text-muted-foreground/80 mt-0.5">
            Signed up {new Date(user.createdAt).toLocaleDateString()}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {busy && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
        {actions}
      </div>
    </div>
  );
}
