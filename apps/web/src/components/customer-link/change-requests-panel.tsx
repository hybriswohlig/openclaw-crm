"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface ChangeRequest {
  id: string;
  kind: "question" | "reschedule" | "damage";
  message: string;
  preferredDates: string[];
  status: "open" | "handled";
  createdAt: string;
  handledAt: string | null;
}

const KIND_LABEL: Record<ChangeRequest["kind"], string> = {
  question: "Änderung angefragt",
  reschedule: "Terminänderung",
  damage: "Schaden gemeldet",
};

function when(iso: string): string {
  return new Date(iso).toLocaleString("de-DE", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Berlin",
  });
}

/**
 * Portal change requests on the deal. Staff mark one handled after they
 * answer it. Marking handled does not message the customer.
 */
export function ChangeRequestsPanel({ dealRecordId }: { dealRecordId: string }) {
  const [rows, setRows] = useState<ChangeRequest[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const laden = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/deals/${dealRecordId}/change-requests?status=all`);
      if (!res.ok) return;
      const body = (await res.json()) as { data?: { requests?: ChangeRequest[] } };
      setRows(body.data?.requests ?? []);
    } catch {
      setRows([]);
    }
  }, [dealRecordId]);

  useEffect(() => {
    void laden();
  }, [laden]);

  async function erledigen(requestId: string) {
    setBusyId(requestId);
    try {
      const res = await fetch(`/api/v1/deals/${dealRecordId}/change-requests/${requestId}`, {
        method: "PATCH",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        toast.error(body?.error?.message ?? "Anfrage konnte nicht erledigt werden.");
        return;
      }
      toast.success("Änderungsanfrage als erledigt markiert.");
      await laden();
    } finally {
      setBusyId(null);
    }
  }

  if (!rows || rows.length === 0) return null;
  const open = rows.filter((row) => row.status === "open");
  const handled = rows.filter((row) => row.status === "handled");

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100">
      <div className="font-medium">Änderungswünsche aus dem Portal</div>
      <ul className="mt-2 space-y-3">
        {open.map((row) => (
          <li key={row.id} className="rounded-lg border border-amber-200/80 bg-white/70 px-3 py-2 dark:bg-black/20">
            <div className="text-xs font-medium">
              {KIND_LABEL[row.kind]} · {when(row.createdAt)}
            </div>
            {row.message ? <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed">{row.message}</p> : null}
            {row.preferredDates.length > 0 ? (
              <p className="mt-1 text-xs">Wunschtermine: {row.preferredDates.join(", ")}</p>
            ) : null}
            <button
              type="button"
              onClick={() => void erledigen(row.id)}
              disabled={busyId === row.id}
              className="mt-2 inline-flex items-center gap-1 text-xs font-medium underline underline-offset-2 disabled:opacity-60"
            >
              {busyId === row.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
              Erledigt
            </button>
          </li>
        ))}
        {handled.map((row) => (
          <li key={row.id} className="text-xs text-amber-900/70 dark:text-amber-100/70">
            {KIND_LABEL[row.kind]} erledigt
            {row.handledAt ? ` am ${when(row.handledAt)}` : ""}
            {row.message ? ` · ${row.message}` : ""}
          </li>
        ))}
      </ul>
    </div>
  );
}
