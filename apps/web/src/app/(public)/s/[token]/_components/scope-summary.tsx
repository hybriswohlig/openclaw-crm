import type { MoveScope } from "@openclaw-crm/customer-portal-core";

/**
 * Read-only summary of the move scope. Drives "you are agreeing to this"
 * clarity on Stage 1, and stays visible on Stage 2 once the AB is in.
 *
 * Layout: minimalist two-column dl with a tiny SVG glyph in front of each
 * label so the customer can scan vertically without reading. On a phone the
 * label stacks above the value so neither truncates.
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
    <div className="overflow-hidden rounded-2xl border border-border/60 bg-card">
      <div className="flex items-center justify-between border-b border-border/60 px-6 py-3">
        <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Eckdaten
        </div>
      </div>
      <dl className="divide-y divide-border/60 text-sm">
        <Row icon="calendar" label="Termin" value={formatDate(scope.moveDate)} />
        <Row icon="arrow-up" label="Abholung" value={scope.fromAddress} />
        <Row icon="arrow-down" label="Ziel" value={scope.toAddress} />
        <Row
          icon="stairs"
          label="Etage"
          value={
            scope.floorsFrom != null || scope.floorsTo != null
              ? `${scope.floorsFrom ?? "?"} → ${scope.floorsTo ?? "?"}`
              : null
          }
        />
        {scope.volumeCbm != null && (
          <Row icon="box" label="Volumen" value={`ca. ${scope.volumeCbm} m³`} />
        )}
        {scope.workerCount != null && (
          <Row
            icon="users"
            label="Helfer"
            value={`${scope.workerCount} Personen`}
          />
        )}
        {scope.transporterName && (
          <Row icon="truck" label="Transporter" value={scope.transporterName} />
        )}
        {scope.inventoryNotes && (
          <Row
            icon="note"
            label="Notizen"
            value={scope.inventoryNotes}
            multiline
          />
        )}
      </dl>
    </div>
  );
}

type IconName =
  | "calendar"
  | "arrow-up"
  | "arrow-down"
  | "stairs"
  | "box"
  | "users"
  | "truck"
  | "note";

function Row({
  icon,
  label,
  value,
  multiline,
}: {
  icon: IconName;
  label: string;
  value: string | null;
  multiline?: boolean;
}) {
  if (!value) return null;
  return (
    <div className="flex flex-col gap-1 px-6 py-3.5 sm:flex-row sm:items-baseline sm:gap-6">
      <dt className="flex w-32 shrink-0 items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground">
        <Glyph name={icon} />
        {label}
      </dt>
      <dd
        className={
          "text-sm font-medium " +
          (multiline ? "whitespace-pre-wrap leading-relaxed font-normal" : "")
        }
      >
        {value}
      </dd>
    </div>
  );
}

function Glyph({ name }: { name: IconName }) {
  const common = "h-3.5 w-3.5 opacity-60";
  switch (name) {
    case "calendar":
      return (
        <svg viewBox="0 0 24 24" fill="none" className={common} aria-hidden>
          <rect x="3" y="5" width="18" height="16" rx="2" stroke="currentColor" strokeWidth="1.7" />
          <path d="M8 3v4M16 3v4M3 10h18" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        </svg>
      );
    case "arrow-up":
      return (
        <svg viewBox="0 0 24 24" fill="none" className={common} aria-hidden>
          <path d="M12 19V5M5 12l7-7 7 7" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "arrow-down":
      return (
        <svg viewBox="0 0 24 24" fill="none" className={common} aria-hidden>
          <path d="M12 5v14M19 12l-7 7-7-7" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "stairs":
      return (
        <svg viewBox="0 0 24 24" fill="none" className={common} aria-hidden>
          <path d="M4 20h4v-4h4v-4h4V8h4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "box":
      return (
        <svg viewBox="0 0 24 24" fill="none" className={common} aria-hidden>
          <path d="M21 8L12 3 3 8m18 0l-9 5m9-5v8l-9 5m-9-13l9 5m-9-5v8l9 5" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
        </svg>
      );
    case "users":
      return (
        <svg viewBox="0 0 24 24" fill="none" className={common} aria-hidden>
          <circle cx="9" cy="8" r="3.5" stroke="currentColor" strokeWidth="1.7" />
          <path d="M2.5 20c.5-3.5 3.2-5.5 6.5-5.5s6 2 6.5 5.5M15.5 7a3.5 3.5 0 1 1 0 7M22 20c-.4-2.7-2-4.5-4-5.2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        </svg>
      );
    case "truck":
      return (
        <svg viewBox="0 0 24 24" fill="none" className={common} aria-hidden>
          <path d="M3 7h11v8H3zM14 10h4l3 3v2h-7zM7.5 18.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM17.5 18.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
        </svg>
      );
    case "note":
      return (
        <svg viewBox="0 0 24 24" fill="none" className={common} aria-hidden>
          <path d="M6 4h9l4 4v12H6zM15 4v4h4M9 13h6M9 17h4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
  }
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
