import type { MoveScope } from "@openclaw-crm/customer-portal-core";

/**
 * Read-only summary of the move scope. Drives "you are agreeing to this"
 * clarity on Stage 1, and stays visible on Stage 2 once the AB is in.
 */
export function ScopeSummary({ scope }: { scope: MoveScope }) {
  const hasAny =
    scope.moveDate ||
    scope.fromAddress ||
    scope.toAddress ||
    scope.volumeCbm ||
    scope.workerCount ||
    scope.inventoryNotes;
  if (!hasAny) return null;

  return (
    <div className="overflow-hidden rounded-2xl border border-border/50 bg-card">
      <div className="border-b border-border/50 px-6 py-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        Eckdaten
      </div>
      <dl className="divide-y divide-border/50 text-sm">
        <Row label="Termin" value={formatDate(scope.moveDate)} />
        <Row label="Abholung" value={scope.fromAddress} />
        <Row label="Ziel" value={scope.toAddress} />
        <Row
          label="Etage"
          value={
            scope.floorsFrom != null || scope.floorsTo != null
              ? `${scope.floorsFrom ?? "?"} → ${scope.floorsTo ?? "?"}`
              : null
          }
        />
        {scope.volumeCbm != null && (
          <Row label="Volumen" value={`ca. ${scope.volumeCbm} m³`} />
        )}
        {scope.workerCount != null && (
          <Row label="Helfer" value={`${scope.workerCount} Personen`} />
        )}
        {scope.transporterName && (
          <Row label="Transporter" value={scope.transporterName} />
        )}
        {scope.inventoryNotes && (
          <Row label="Notizen" value={scope.inventoryNotes} multiline />
        )}
      </dl>
    </div>
  );
}

function Row({
  label,
  value,
  multiline,
}: {
  label: string;
  value: string | null;
  multiline?: boolean;
}) {
  if (!value) return null;
  return (
    <div className="flex flex-col gap-1 px-6 py-3 sm:flex-row sm:items-baseline sm:gap-6">
      <dt className="w-32 shrink-0 text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd
        className={
          "text-sm " + (multiline ? "whitespace-pre-wrap leading-relaxed" : "")
        }
      >
        {value}
      </dd>
    </div>
  );
}

function formatDate(ymd: string | null): string | null {
  if (!ymd) return null;
  const d = new Date(`${ymd}T00:00:00`);
  if (Number.isNaN(d.getTime())) return ymd;
  return d.toLocaleDateString("de-DE", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}
