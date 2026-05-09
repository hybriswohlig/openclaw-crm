"use client";

import { use, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Loader2, CalendarRange } from "lucide-react";
import { EmployeeAvatar } from "@/components/employees/employee-avatar";
import {
  EmployeeDetailView,
  fmtEUR,
  fmtDate,
  type EmployeeDetail,
  type TransactionRow,
} from "@/components/employees/employee-detail-view";
import { cn } from "@/lib/utils";

type EmployeeStatus = "active" | "on_leave" | "inactive";

interface EmployeeRecord {
  id: string;
  name: string;
  experience: string | null;
  hourlyRate: string;
  role: string | null;
  status: EmployeeStatus;
  photoBase64: string | null;
}

interface MonthlyBucket {
  month: string;
  paid: number;
  owed: number;
}

const STATUS_LABEL: Record<EmployeeStatus, string> = {
  active: "Aktiv",
  on_leave: "In Urlaub",
  inactive: "Inaktiv",
};

const STATUS_BADGE: Record<EmployeeStatus, string> = {
  active: "bg-emerald-500/15 text-emerald-700",
  on_leave: "bg-amber-500/15 text-amber-700",
  inactive: "bg-zinc-500/15 text-zinc-700",
};

export default function EmployeeDetailPage({
  params,
}: {
  params: Promise<{ employeeId: string }>;
}) {
  const { employeeId } = use(params);

  const [employee, setEmployee] = useState<EmployeeRecord | null>(null);
  const [detail, setDetail] = useState<EmployeeDetail | null>(null);
  const [monthly, setMonthly] = useState<MonthlyBucket[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  // Date range filter for the payment ledger.
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [detailRes, monthlyRes] = await Promise.all([
        fetch(`/api/v1/employees/${employeeId}`),
        fetch(`/api/v1/employees/${employeeId}/monthly`),
      ]);

      if (detailRes.status === 404) {
        setNotFound(true);
        return;
      }
      if (detailRes.ok) {
        const data = await detailRes.json();
        const d = data.data ?? {};
        setEmployee({
          id: d.id,
          name: d.name,
          experience: d.experience,
          hourlyRate: d.hourlyRate,
          role: d.role ?? null,
          status: d.status ?? "active",
          photoBase64: d.photoBase64 ?? null,
        });
        setDetail({
          contracts: d.contracts ?? [],
          auftraege: d.auftraege ?? [],
          paymentsReceived: d.paymentsReceived ?? [],
          outOfPocket: d.outOfPocket ?? [],
          totals: d.totals ?? {
            receivedTotal: 0,
            outstandingTotal: 0,
            outOfPocketOpen: 0,
            deductibleReceived: 0,
            nonDeductibleReceived: 0,
            receiptCount: 0,
          },
        });
      }
      if (monthlyRes.ok) {
        const data = await monthlyRes.json();
        setMonthly((data.data as MonthlyBucket[]) || []);
      }
    } finally {
      setLoading(false);
    }
  }, [employeeId]);

  useEffect(() => {
    reload();
  }, [reload]);

  const filteredDetail = useMemo<EmployeeDetail | null>(() => {
    if (!detail) return null;
    const inRange = (txDate: string) => {
      if (from && txDate < from) return false;
      if (to && txDate > to) return false;
      return true;
    };
    const filterTx = (rows: TransactionRow[]) =>
      from || to ? rows.filter((t) => inRange(t.date)) : rows;
    return {
      ...detail,
      paymentsReceived: filterTx(detail.paymentsReceived),
      outOfPocket: filterTx(detail.outOfPocket),
    };
  }, [detail, from, to]);

  async function recordPayment(transactionId: string) {
    const input = prompt("Betrag der Zahlung in EUR (z. B. 50 oder -50 zum Stornieren):");
    if (!input) return;
    const delta = Number(input.replace(",", "."));
    if (!Number.isFinite(delta) || delta === 0) {
      alert("Ungültiger Betrag.");
      return;
    }
    const res = await fetch(`/api/v1/employee-transactions/${transactionId}/record-payment`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ delta }),
    });
    if (res.ok) await reload();
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (notFound || !employee || !detail) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <Link href="/employees" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Zurück zum Team
        </Link>
        <p className="mt-6 text-sm text-muted-foreground">Mitarbeiter nicht gefunden.</p>
      </div>
    );
  }

  const lastJob =
    detail.auftraege.find((a) => a.moveDate)?.moveDate ?? null;

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <Link
        href="/employees"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-3"
      >
        <ArrowLeft className="h-4 w-4" /> Zurück zum Team
      </Link>

      <div className="flex items-start gap-4 mb-6">
        <EmployeeAvatar name={employee.name} photoBase64={employee.photoBase64} size="lg" />
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold">{employee.name}</h1>
            <span
              className={cn(
                "inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium",
                STATUS_BADGE[employee.status]
              )}
            >
              {STATUS_LABEL[employee.status]}
            </span>
          </div>
          <div className="text-sm text-muted-foreground mt-0.5">
            {employee.role || "Keine Rolle gesetzt"}
            {employee.experience ? ` · ${employee.experience}` : ""}
            {" · "}
            {Number(employee.hourlyRate).toLocaleString("de-DE", {
              style: "currency",
              currency: "EUR",
            })}{" "}
            / h
            {lastJob && (
              <span className="ml-2 inline-flex items-center gap-1">
                <CalendarRange className="h-3 w-3" />
                Letzter Auftrag {fmtDate(lastJob)}
              </span>
            )}
          </div>
        </div>
      </div>

      <MonthlyChart buckets={monthly} />

      <div className="my-5 rounded-lg border border-border bg-muted/30 p-3 flex flex-wrap items-end gap-3">
        <div>
          <label className="text-[11px] uppercase tracking-wider text-muted-foreground">
            Zahlungsledger – von
          </label>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="block rounded-md border border-input bg-background px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <div>
          <label className="text-[11px] uppercase tracking-wider text-muted-foreground">bis</label>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="block rounded-md border border-input bg-background px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        {(from || to) && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setFrom("");
              setTo("");
            }}
            className="h-8"
          >
            Zurücksetzen
          </Button>
        )}
        <span className="text-xs text-muted-foreground ml-auto">
          {filteredDetail
            ? `${filteredDetail.paymentsReceived.length} Zahlung(en) · ${filteredDetail.outOfPocket.length} Auslage(n) im Bereich`
            : ""}
        </span>
      </div>

      {filteredDetail && (
        <EmployeeDetailView detail={filteredDetail} onRecordPayment={recordPayment} />
      )}
    </div>
  );
}

function MonthlyChart({ buckets }: { buckets: MonthlyBucket[] }) {
  const max = useMemo(() => {
    let m = 0;
    for (const b of buckets) {
      if (b.paid > m) m = b.paid;
      if (b.owed > m) m = b.owed;
    }
    return m;
  }, [buckets]);

  const totalPaid = buckets.reduce((sum, b) => sum + b.paid, 0);
  const totalOwed = buckets.reduce((sum, b) => sum + b.owed, 0);

  if (buckets.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-background p-4 text-sm text-muted-foreground">
        Keine Daten für den Verlauf.
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-background p-4">
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="text-sm font-medium">Verlauf (12 Monate)</h3>
        <div className="flex items-center gap-3 text-xs">
          <Legend color="bg-emerald-500" label={`Bezahlt ${fmtEUR(totalPaid)}`} />
          <Legend color="bg-amber-500" label={`Offen ${fmtEUR(totalOwed)}`} />
        </div>
      </div>
      <div className="flex items-end gap-2 h-40">
        {buckets.map((b) => {
          const paidPct = max > 0 ? (b.paid / max) * 100 : 0;
          const owedPct = max > 0 ? (b.owed / max) * 100 : 0;
          return (
            <div key={b.month} className="flex-1 flex flex-col items-center gap-1">
              <div className="flex items-end gap-0.5 w-full justify-center" style={{ height: "8rem" }}>
                <div
                  className="bg-emerald-500/80 hover:bg-emerald-500 transition w-3 rounded-t"
                  style={{ height: `${paidPct}%` }}
                  title={`Bezahlt: ${fmtEUR(b.paid)}`}
                />
                <div
                  className="bg-amber-500/80 hover:bg-amber-500 transition w-3 rounded-t"
                  style={{ height: `${owedPct}%` }}
                  title={`Offen: ${fmtEUR(b.owed)}`}
                />
              </div>
              <span className="text-[10px] text-muted-foreground tabular-nums">
                {b.month.slice(5)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-muted-foreground">
      <span className={cn("inline-block h-2.5 w-2.5 rounded-sm", color)} />
      <span>{label}</span>
    </span>
  );
}
