"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Briefcase,
  Wallet,
  Receipt,
  AlertCircle,
  CalendarClock,
  FileText,
  Scale,
  ShieldOff,
} from "lucide-react";
import { cn } from "@/lib/utils";

export interface AuftragRow {
  assignmentId: string;
  dealRecordId: string;
  dealNumber: string | null;
  dealName: string;
  stage: { title: string; color: string } | null;
  moveDate: string | null;
  role: string;
  assignedAt: string;
}

export interface TransactionRow {
  id: string;
  date: string;
  type: "salary" | "advance" | "reimbursement";
  amount: number;
  amountPaid: number;
  amountOutstanding: number;
  status: "offen" | "teilweise bezahlt" | "bezahlt";
  dueDate: string | null;
  description: string | null;
  notes: string | null;
  dealRecordId: string;
  dealNumber: string | null;
  dealName: string;
  isTaxDeductible: boolean;
  hasReceipt: boolean;
}

export interface EmployeeDetail {
  contracts: { assignmentId: string; dealRecordId: string; role: string; assignedAt: string }[];
  auftraege: AuftragRow[];
  paymentsReceived: TransactionRow[];
  outOfPocket: TransactionRow[];
  totals: {
    receivedTotal: number;
    outstandingTotal: number;
    outOfPocketOpen: number;
    deductibleReceived: number;
    nonDeductibleReceived: number;
    receiptCount: number;
  };
}

const TYPE_LABEL: Record<TransactionRow["type"], string> = {
  salary: "Lohn",
  advance: "Vorschuss",
  reimbursement: "Erstattung",
};

const STATUS_BADGE: Record<TransactionRow["status"], { label: string; cls: string }> = {
  offen: { label: "offen", cls: "bg-amber-500/15 text-amber-700" },
  "teilweise bezahlt": { label: "teilweise bezahlt", cls: "bg-blue-500/15 text-blue-700" },
  bezahlt: { label: "bezahlt", cls: "bg-emerald-500/15 text-emerald-700" },
};

export function fmtEUR(n: number): string {
  return n.toLocaleString("de-DE", { style: "currency", currency: "EUR" });
}

export function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso + (iso.length === 10 ? "T00:00:00" : "")).toLocaleDateString("de-DE");
}

function isOverdue(due: string | null, status: TransactionRow["status"]): boolean {
  if (!due) return false;
  if (status === "bezahlt") return false;
  return new Date(due + "T23:59:59") < new Date();
}

export function EmployeeDetailView({
  detail,
  onRecordPayment,
}: {
  detail: EmployeeDetail;
  onRecordPayment: (transactionId: string) => void;
}) {
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Stat label="Aufträge" value={String(detail.auftraege.length)} icon={<Briefcase className="h-3.5 w-3.5" />} />
        <Stat label="Erhalten" value={fmtEUR(detail.totals.receivedTotal)} icon={<Wallet className="h-3.5 w-3.5" />} />
        <Stat
          label="Abzugsfähig"
          value={fmtEUR(detail.totals.deductibleReceived)}
          icon={<Scale className="h-3.5 w-3.5" />}
        />
        <Stat
          label="Nicht abz."
          value={fmtEUR(detail.totals.nonDeductibleReceived)}
          icon={<ShieldOff className="h-3.5 w-3.5" />}
          highlight={detail.totals.nonDeductibleReceived > 0}
        />
        <Stat
          label="Belege"
          value={String(detail.totals.receiptCount)}
          icon={<FileText className="h-3.5 w-3.5" />}
        />
        <Stat
          label="Offene Auslagen"
          value={fmtEUR(detail.totals.outOfPocketOpen)}
          icon={<Receipt className="h-3.5 w-3.5" />}
          highlight={detail.totals.outOfPocketOpen > 0}
        />
        <Stat
          label="Insgesamt offen"
          value={fmtEUR(detail.totals.outstandingTotal)}
          icon={<AlertCircle className="h-3.5 w-3.5" />}
          highlight={detail.totals.outstandingTotal > 0}
        />
      </div>

      <DetailSection title="Aufträge" icon={<Briefcase className="h-4 w-4" />} count={detail.auftraege.length}>
        {detail.auftraege.length === 0 ? (
          <p className="text-xs text-muted-foreground py-2 px-1">Noch keine Aufträge.</p>
        ) : (
          <div className="rounded-md border border-border bg-background divide-y divide-border">
            {detail.auftraege.map((a) => (
              <Link
                key={a.assignmentId}
                href={`/objects/deals/${a.dealRecordId}`}
                className="flex items-center gap-3 px-3 py-2 text-sm hover:bg-muted/40 transition"
              >
                {a.dealNumber && <span className="font-mono text-xs text-muted-foreground">{a.dealNumber}</span>}
                <span className="font-medium flex-1 truncate">{a.dealName}</span>
                {a.stage && (
                  <span
                    className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium"
                    style={{ backgroundColor: a.stage.color + "33", color: a.stage.color }}
                  >
                    {a.stage.title}
                  </span>
                )}
                <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{a.role}</span>
                <span className="text-xs text-muted-foreground w-24 text-right">
                  {a.moveDate ? fmtDate(a.moveDate) : "kein Datum"}
                </span>
              </Link>
            ))}
          </div>
        )}
      </DetailSection>

      <DetailSection
        title="Zahlungen erhalten"
        icon={<Wallet className="h-4 w-4" />}
        count={detail.paymentsReceived.length}
      >
        {detail.paymentsReceived.length === 0 ? (
          <p className="text-xs text-muted-foreground py-2 px-1">Noch keine Zahlungen erhalten.</p>
        ) : (
          <TransactionTable rows={detail.paymentsReceived} onRecordPayment={onRecordPayment} />
        )}
      </DetailSection>

      <DetailSection
        title="Auslagen (aus eigener Tasche)"
        icon={<Receipt className="h-4 w-4" />}
        count={detail.outOfPocket.length}
      >
        {detail.outOfPocket.length === 0 ? (
          <p className="text-xs text-muted-foreground py-2 px-1">Keine Auslagen erfasst.</p>
        ) : (
          <TransactionTable rows={detail.outOfPocket} onRecordPayment={onRecordPayment} showOutstanding />
        )}
      </DetailSection>
    </div>
  );
}

function Stat({
  label,
  value,
  icon,
  highlight,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  highlight?: boolean;
}) {
  return (
    <div
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5",
        highlight ? "border-amber-500/40 bg-amber-500/10 text-amber-700" : "border-border bg-background"
      )}
    >
      {icon}
      <span className="text-muted-foreground">{label}:</span>
      <span className="font-medium text-foreground">{value}</span>
    </div>
  );
}

function DetailSection({
  title,
  icon,
  count,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="flex items-center gap-2 mb-1.5 px-1">
        {icon}
        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</h4>
        <span className="text-xs text-muted-foreground">({count})</span>
      </div>
      {children}
    </section>
  );
}

function TransactionTable({
  rows,
  onRecordPayment,
  showOutstanding,
}: {
  rows: TransactionRow[];
  onRecordPayment: (transactionId: string) => void;
  showOutstanding?: boolean;
}) {
  return (
    <div className="rounded-md border border-border bg-background overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-muted/40">
          <tr className="text-xs text-muted-foreground">
            <th className="text-left px-3 py-1.5 font-medium">Datum</th>
            <th className="text-left px-3 py-1.5 font-medium">Typ</th>
            <th className="text-left px-3 py-1.5 font-medium">Deal</th>
            <th className="text-right px-3 py-1.5 font-medium">Betrag</th>
            <th className="text-right px-3 py-1.5 font-medium">Bezahlt</th>
            {showOutstanding && <th className="text-right px-3 py-1.5 font-medium">Offen</th>}
            <th className="text-left px-3 py-1.5 font-medium">Status</th>
            <th className="text-left px-3 py-1.5 font-medium">Beleg</th>
            <th className="text-left px-3 py-1.5 font-medium">Steuer</th>
            <th className="text-left px-3 py-1.5 font-medium">Fällig</th>
            <th className="text-left px-3 py-1.5 font-medium">Kommentar</th>
            <th className="px-3 py-1.5" />
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((t) => {
            const overdue = isOverdue(t.dueDate, t.status);
            const sb = STATUS_BADGE[t.status];
            return (
              <tr key={t.id} className="hover:bg-muted/30">
                <td className="px-3 py-1.5 whitespace-nowrap">{fmtDate(t.date)}</td>
                <td className="px-3 py-1.5 whitespace-nowrap text-muted-foreground">{TYPE_LABEL[t.type]}</td>
                <td className="px-3 py-1.5">
                  <Link href={`/objects/deals/${t.dealRecordId}`} className="hover:underline">
                    {t.dealNumber ? <span className="font-mono text-xs mr-1.5">{t.dealNumber}</span> : null}
                    <span className="text-xs">{t.dealName}</span>
                  </Link>
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums">{fmtEUR(t.amount)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{fmtEUR(t.amountPaid)}</td>
                {showOutstanding && (
                  <td
                    className={cn(
                      "px-3 py-1.5 text-right tabular-nums",
                      t.amountOutstanding > 0 && "text-amber-700 font-medium"
                    )}
                  >
                    {fmtEUR(t.amountOutstanding)}
                  </td>
                )}
                <td className="px-3 py-1.5 whitespace-nowrap">
                  <span className={cn("inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium", sb.cls)}>
                    {sb.label}
                  </span>
                </td>
                <td className="px-3 py-1.5 whitespace-nowrap">
                  {t.hasReceipt ? (
                    <a
                      href={`/api/v1/employee-transactions/${t.id}/receipt`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                      title="Beleg ansehen"
                    >
                      <FileText className="h-3.5 w-3.5" />
                      ansehen
                    </a>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </td>
                <td className="px-3 py-1.5 whitespace-nowrap text-xs">
                  {t.isTaxDeductible ? (
                    <span className="inline-flex items-center gap-1 text-emerald-700">
                      <Scale className="h-3 w-3" />
                      abz.
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-muted-foreground">
                      <ShieldOff className="h-3 w-3" />
                      nicht abz.
                    </span>
                  )}
                </td>
                <td className="px-3 py-1.5 whitespace-nowrap text-xs">
                  {t.dueDate ? (
                    <span
                      className={cn(
                        "inline-flex items-center gap-1",
                        overdue ? "text-red-600 font-medium" : "text-muted-foreground"
                      )}
                    >
                      <CalendarClock className="h-3 w-3" />
                      {fmtDate(t.dueDate)}
                      {overdue && " (überfällig)"}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
                <td className="px-3 py-1.5 text-xs text-muted-foreground max-w-[24ch] truncate" title={[t.description, t.notes].filter(Boolean).join(" – ") || undefined}>
                  {[t.description, t.notes].filter(Boolean).join(" – ") || "—"}
                </td>
                <td className="px-3 py-1.5 text-right">
                  {t.status !== "bezahlt" && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onRecordPayment(t.id)}
                      className="h-7 text-xs"
                    >
                      + Zahlung
                    </Button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
