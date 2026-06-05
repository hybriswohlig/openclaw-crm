import { redirect, notFound } from "next/navigation";
import {
  ArrowRight,
  Phone,
  MapPin,
  User,
  Package,
  FileText,
  Euro,
  Crown,
  Calendar,
} from "lucide-react";
import { getEmployeePortalContext } from "@/lib/employee-portal-auth";
import { getEmployeeJobDetail } from "@/services/employee-portal-data";
import PortalShell from "../../_components/portal-shell";
import ClockWidget from "../../_components/clock-widget";
import ExpenseCapture from "../../_components/expense-capture";
import LeadDocs from "../../_components/lead-docs";
import PaymentCollect from "../../_components/payment-collect";

const eur = (n: number) =>
  new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(n);

const INVENTORY_TYPE_LABELS: Record<string, string> = {
  helper: "Helfer",
  transporter: "Transporter",
  other: "Sonstiges",
};

function typeLabel(type: string): string {
  return INVENTORY_TYPE_LABELS[type] ?? type;
}

export default async function JobDetailPage({
  params,
}: {
  params: Promise<{ dealId: string }>;
}) {
  const ctx = await getEmployeePortalContext();
  if (!ctx) redirect("/login");

  const { dealId } = await params;
  const d = await getEmployeeJobDetail(ctx.workspaceId, ctx.employeeId, dealId);
  if (!d) notFound();

  return (
    <PortalShell employeeName={ctx.employeeName}>
      <div className="space-y-4">
        {/* Kopf */}
        <header className="rounded-2xl border border-border bg-card p-4 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-lg font-semibold leading-tight">{d.dealName}</h1>
              {d.dealNumber && (
                <p className="mt-0.5 text-sm text-muted-foreground">Auftrag {d.dealNumber}</p>
              )}
            </div>
            {d.isLead && (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-xl bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground">
                <Crown className="h-4 w-4" aria-hidden="true" />
                Lead
              </span>
            )}
          </div>
          {d.moveDate && (
            <p className="mt-3 inline-flex items-center gap-2 text-base text-foreground">
              <Calendar className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
              {new Date(d.moveDate).toLocaleDateString("de-DE")}
            </p>
          )}
        </header>

        {/* Auftrag */}
        <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
          <div className="mb-3 flex items-center gap-2">
            <User className="h-5 w-5 text-primary" aria-hidden="true" />
            <h2 className="text-base font-semibold">Auftrag</h2>
          </div>
          <div className="space-y-3">
            {d.customerName && (
              <p className="text-base font-medium text-foreground">{d.customerName}</p>
            )}
            {d.customerPhone && (
              <a
                href={`tel:${d.customerPhone.replace(/\s+/g, "")}`}
                className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-border bg-background px-4 text-base font-medium text-foreground shadow-sm active:scale-[0.98]"
              >
                <Phone className="h-5 w-5" aria-hidden="true" />
                <span>{d.customerPhone}</span>
              </a>
            )}
            {(d.moveFrom || d.moveTo) && (
              <div className="rounded-xl bg-muted p-3">
                <div className="flex items-start gap-2">
                  <MapPin className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <div className="min-w-0 space-y-1 text-base">
                    {d.moveFrom && <p className="break-words">{d.moveFrom}</p>}
                    {d.moveFrom && d.moveTo && (
                      <ArrowRight className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                    )}
                    {d.moveTo && <p className="break-words font-medium">{d.moveTo}</p>}
                  </div>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* Was vereinbart wurde */}
        {d.summary && (
          <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
            <div className="mb-3 flex items-center gap-2">
              <FileText className="h-5 w-5 text-primary" aria-hidden="true" />
              <h2 className="text-base font-semibold">Was vereinbart wurde</h2>
            </div>
            <p className="whitespace-pre-line text-base leading-relaxed text-foreground">
              {d.summary}
            </p>
          </section>
        )}

        {/* Inventar / Leistungen */}
        {d.inventory.length > 0 && (
          <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
            <div className="mb-3 flex items-center gap-2">
              <Package className="h-5 w-5 text-primary" aria-hidden="true" />
              <h2 className="text-base font-semibold">Inventar / Leistungen</h2>
            </div>
            <ul className="space-y-3">
              {d.inventory.map((item, idx) => (
                <li
                  key={idx}
                  className="flex items-start justify-between gap-3 rounded-xl bg-muted p-3"
                >
                  <div className="min-w-0">
                    <p className="text-base font-medium text-foreground">
                      {item.quantity} × {typeLabel(item.type)}
                    </p>
                    {item.description && (
                      <p className="mt-0.5 break-words text-sm text-muted-foreground">
                        {item.description}
                      </p>
                    )}
                  </div>
                  <span className="shrink-0 text-sm text-muted-foreground">
                    {eur(Number(item.unitRate))}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Preis */}
        <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
          <div className="mb-3 flex items-center gap-2">
            <Euro className="h-5 w-5 text-primary" aria-hidden="true" />
            <h2 className="text-base font-semibold">Preis</h2>
          </div>
          <dl className="space-y-2 text-base">
            <div className="flex items-center justify-between">
              <dt className="text-muted-foreground">Modell</dt>
              <dd className="font-medium text-foreground">
                {d.priceModel === "fixed"
                  ? "Festpreis"
                  : d.priceModel === "hourly"
                    ? "Stundenbasis"
                    : "Unbekannt"}
              </dd>
            </div>
            {d.priceModel === "fixed" && d.fixedPrice && (
              <div className="flex items-center justify-between">
                <dt className="text-muted-foreground">Festpreis</dt>
                <dd className="font-medium text-foreground">{eur(Number(d.fixedPrice))}</dd>
              </div>
            )}
            <div className="flex items-center justify-between border-t border-border pt-2">
              <dt className="text-muted-foreground">Offen</dt>
              <dd className="text-lg font-semibold text-foreground">
                {eur(d.payment.outstanding)}
              </dd>
            </div>
          </dl>
        </section>

        {/* Client-Inseln: Zeiterfassung + Ausgaben */}
        <ClockWidget dealRecordId={d.dealRecordId} />
        <ExpenseCapture workspaceId={ctx.workspaceId} dealRecordId={d.dealRecordId} />

        {/* Lead-only: Dokumentation + Kassieren */}
        {d.isLead && (
          <>
            <LeadDocs
              workspaceId={ctx.workspaceId}
              dealRecordId={d.dealRecordId}
              initialMedia={d.media}
            />
            <PaymentCollect
              dealId={d.dealRecordId}
              priceModel={d.priceModel}
              payment={d.payment}
              paymentPreference={d.paymentPreference}
            />
          </>
        )}
      </div>
    </PortalShell>
  );
}
