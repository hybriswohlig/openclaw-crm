import { redirect } from "next/navigation";
import Link from "next/link";
import {
  Wallet,
  ChevronRight,
  Calendar,
  MapPin,
  ArrowRight,
  Star,
  PackageOpen,
} from "lucide-react";
import { getEmployeePortalContext } from "@/lib/employee-portal-auth";
import { listMyJobs } from "@/services/employee-portal-data";
import { getEmployeeDetailExtras } from "@/services/employees";
import PortalShell from "./_components/portal-shell";

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

export default async function MitarbeiterStartPage() {
  const ctx = await getEmployeePortalContext();
  if (!ctx) redirect("/login");

  const [jobs, extras] = await Promise.all([
    listMyJobs(ctx.workspaceId, ctx.employeeId),
    getEmployeeDetailExtras(ctx.workspaceId, ctx.employeeId),
  ]);

  const saldoTotal = extras?.saldoTotal ?? 0;

  return (
    <PortalShell employeeName={ctx.employeeName}>
      <div className="space-y-4">
        {/* Saldo-Kachel */}
        <Link
          href="/abrechnung"
          className="block rounded-2xl border border-border bg-card p-4 shadow-sm active:scale-[0.99]"
        >
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground">
                <Wallet className="size-5" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">
                  Dir stehen noch zu
                </p>
                <p className="text-xl font-semibold">{eur.format(saldoTotal)}</p>
              </div>
            </div>
            <ChevronRight
              className="size-5 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
          </div>
        </Link>

        {/* Aufträge */}
        <div className="space-y-3">
          <h1 className="px-1 text-sm font-medium text-muted-foreground">
            Deine Aufträge
          </h1>

          {jobs.length === 0 ? (
            <div className="rounded-2xl border border-border bg-card p-8 text-center shadow-sm">
              <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-xl bg-background">
                <PackageOpen
                  className="size-6 text-muted-foreground"
                  aria-hidden="true"
                />
              </div>
              <p className="text-base font-medium">Keine Aufträge</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Sobald dir ein Auftrag zugeteilt wird, erscheint er hier.
              </p>
            </div>
          ) : (
            <ul className="space-y-3">
              {jobs.map((job) => {
                const dateLabel = formatDate(job.moveDate);
                return (
                  <li key={job.dealRecordId}>
                    <Link
                      href={`/auftrag/${job.dealRecordId}`}
                      className="block rounded-2xl border border-border bg-card p-4 shadow-sm active:scale-[0.99]"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-base font-semibold">
                            {job.dealName}
                          </p>
                          {job.dealNumber ? (
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              Auftrag {job.dealNumber}
                            </p>
                          ) : null}
                        </div>
                        <ChevronRight
                          className="mt-0.5 size-5 shrink-0 text-muted-foreground"
                          aria-hidden="true"
                        />
                      </div>

                      {/* Badges */}
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        {job.isLead ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground">
                            <Star
                              className="size-3.5"
                              aria-hidden="true"
                              fill="currentColor"
                            />
                            Teamleitung
                          </span>
                        ) : (
                          <span className="inline-flex items-center rounded-full border border-border bg-background px-2.5 py-1 text-xs font-medium text-muted-foreground">
                            {job.role || "Mitarbeiter"}
                          </span>
                        )}
                        {job.stage ? (
                          <span
                            className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-2.5 py-1 text-xs font-medium"
                            style={{ color: job.stage.color }}
                          >
                            <span
                              className="size-2 rounded-full"
                              style={{ backgroundColor: job.stage.color }}
                              aria-hidden="true"
                            />
                            {job.stage.title}
                          </span>
                        ) : null}
                      </div>

                      {/* Meta */}
                      <div className="mt-3 space-y-1.5 text-sm text-muted-foreground">
                        {dateLabel ? (
                          <div className="flex items-center gap-2">
                            <Calendar
                              className="size-4 shrink-0"
                              aria-hidden="true"
                            />
                            <span>{dateLabel}</span>
                          </div>
                        ) : null}
                        {job.moveFrom || job.moveTo ? (
                          <div className="flex items-start gap-2">
                            <MapPin
                              className="mt-0.5 size-4 shrink-0"
                              aria-hidden="true"
                            />
                            <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                              <span className="truncate">
                                {job.moveFrom || "Unbekannt"}
                              </span>
                              <ArrowRight
                                className="size-3.5 shrink-0"
                                aria-hidden="true"
                              />
                              <span className="truncate">
                                {job.moveTo || "Unbekannt"}
                              </span>
                            </span>
                          </div>
                        ) : null}
                      </div>
                    </Link>
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
