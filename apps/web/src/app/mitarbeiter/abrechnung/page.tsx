import { redirect } from "next/navigation";
import {
  Wallet,
  TrendingUp,
  ArrowDownCircle,
  Gift,
  Building2,
  Receipt,
} from "lucide-react";
import { getEmployeePortalContext } from "@/lib/employee-portal-auth";
import { getEmployeeDetailExtras } from "@/services/employees";
import PortalShell from "../_components/portal-shell";

const eur = new Intl.NumberFormat("de-DE", {
  style: "currency",
  currency: "EUR",
});

function formatDate(value: string | null): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("de-DE");
}

const KIND_LABEL: Record<string, string> = {
  earning: "Verdienst",
  reimbursement: "Erstattung",
  payment: "Auszahlung",
  in_kind: "Sachbezug",
};

const KIND_STYLE: Record<string, string> = {
  earning: "bg-green-500/10 text-green-600 dark:text-green-400",
  reimbursement: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  payment: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  in_kind: "bg-purple-500/10 text-purple-600 dark:text-purple-400",
};

export default async function AbrechnungPage() {
  const ctx = await getEmployeePortalContext();
  if (!ctx) redirect("/login");

  const extras = await getEmployeeDetailExtras(ctx.workspaceId, ctx.employeeId);

  const saldoTotal = extras?.saldoTotal ?? 0;
  const totals = extras?.totals ?? {
    earnedTotal: 0,
    paidTotal: 0,
    reimbursementTotal: 0,
    inKindTotal: 0,
    receiptCount: 0,
  };
  const saldoByCompany = extras?.saldoByCompany ?? [];
  const ledger = extras?.ledger ?? [];

  const isPositive = saldoTotal > 0;

  return (
    <PortalShell employeeName={ctx.employeeName}>
      <div className="space-y-4">
        <h1 className="px-1 text-sm font-medium text-muted-foreground">
          Deine Abrechnung
        </h1>

        {/* Saldo gesamt */}
        <div
          className={`rounded-2xl border p-5 shadow-sm ${
            isPositive
              ? "border-green-500/30 bg-green-500/10"
              : "border-border bg-card"
          }`}
        >
          <div className="flex items-center gap-2 text-muted-foreground">
            <Wallet className="size-4" aria-hidden="true" />
            <span className="text-xs">Saldo</span>
          </div>
          <p
            className={`mt-1 text-3xl font-semibold ${
              isPositive ? "text-green-600 dark:text-green-400" : "text-foreground"
            }`}
          >
            {eur.format(saldoTotal)}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {isPositive
              ? "Dieser Betrag steht dir noch zu."
              : saldoTotal < 0
                ? "Aktuell ist dein Konto ausgeglichen oder leicht im Minus."
                : "Dein Konto ist ausgeglichen."}
          </p>
        </div>

        {/* Kacheln */}
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-2xl border border-border bg-card p-3 shadow-sm">
            <TrendingUp
              className="size-5 text-green-600 dark:text-green-400"
              aria-hidden="true"
            />
            <p className="mt-2 text-xs text-muted-foreground">Verdient</p>
            <p className="mt-0.5 text-sm font-semibold">
              {eur.format(totals.earnedTotal)}
            </p>
          </div>
          <div className="rounded-2xl border border-border bg-card p-3 shadow-sm">
            <ArrowDownCircle
              className="size-5 text-amber-600 dark:text-amber-400"
              aria-hidden="true"
            />
            <p className="mt-2 text-xs text-muted-foreground">Ausgezahlt</p>
            <p className="mt-0.5 text-sm font-semibold">
              {eur.format(totals.paidTotal)}
            </p>
          </div>
          <div className="rounded-2xl border border-border bg-card p-3 shadow-sm">
            <Gift
              className="size-5 text-purple-600 dark:text-purple-400"
              aria-hidden="true"
            />
            <p className="mt-2 text-xs text-muted-foreground">Sachbezug</p>
            <p className="mt-0.5 text-sm font-semibold">
              {eur.format(totals.inKindTotal)}
            </p>
          </div>
        </div>

        {/* Pro-Firma-Saldo */}
        {saldoByCompany.length > 0 ? (
          <div className="space-y-2">
            <h2 className="px-1 text-sm font-medium text-muted-foreground">
              Saldo pro Firma
            </h2>
            <ul className="space-y-2">
              {saldoByCompany.map((c) => (
                <li
                  key={c.companyId ?? c.companyName}
                  className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-background">
                      <Building2
                        className="size-4 text-muted-foreground"
                        aria-hidden="true"
                      />
                    </div>
                    <span className="truncate text-sm font-medium">
                      {c.companyName}
                    </span>
                  </div>
                  <span
                    className={`shrink-0 text-sm font-semibold ${
                      c.balance > 0
                        ? "text-green-600 dark:text-green-400"
                        : "text-foreground"
                    }`}
                  >
                    {eur.format(c.balance)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {/* Buchungsverlauf */}
        <div className="space-y-2">
          <h2 className="px-1 text-sm font-medium text-muted-foreground">
            Buchungsverlauf
          </h2>

          {ledger.length === 0 ? (
            <div className="rounded-2xl border border-border bg-card p-8 text-center shadow-sm">
              <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-xl bg-background">
                <Receipt
                  className="size-6 text-muted-foreground"
                  aria-hidden="true"
                />
              </div>
              <p className="text-base font-medium">Noch keine Buchungen</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Hier siehst du künftig deine Verdienste und Auszahlungen.
              </p>
            </div>
          ) : (
            <ul className="space-y-2">
              {ledger.map((row) => {
                const label = KIND_LABEL[row.kind] ?? row.kind;
                const badgeStyle =
                  KIND_STYLE[row.kind] ?? "bg-muted text-muted-foreground";
                const isCredit =
                  row.kind === "earning" || row.kind === "reimbursement";
                const sign = isCredit ? "+" : "−";
                const dateLabel = formatDate(row.date);
                return (
                  <li
                    key={row.id}
                    className="rounded-2xl border border-border bg-card p-4 shadow-sm"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 space-y-1.5">
                        <span
                          className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${badgeStyle}`}
                        >
                          {label}
                        </span>
                        {row.dealName ? (
                          <p className="truncate text-sm font-medium">
                            {row.dealName}
                            {row.dealNumber ? (
                              <span className="text-muted-foreground">
                                {" "}
                                · {row.dealNumber}
                              </span>
                            ) : null}
                          </p>
                        ) : null}
                        {row.description ? (
                          <p className="truncate text-xs text-muted-foreground">
                            {row.description}
                          </p>
                        ) : null}
                        {dateLabel ? (
                          <p className="text-xs text-muted-foreground">
                            {dateLabel}
                          </p>
                        ) : null}
                      </div>
                      <span
                        className={`shrink-0 text-base font-semibold ${
                          isCredit
                            ? "text-green-600 dark:text-green-400"
                            : "text-foreground"
                        }`}
                      >
                        {sign}
                        {eur.format(row.amount)}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </PortalShell>
  );
}
