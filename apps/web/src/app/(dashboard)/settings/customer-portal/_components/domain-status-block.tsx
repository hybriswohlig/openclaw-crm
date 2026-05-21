"use client";

import { Loader2, RefreshCw, ExternalLink, AlertCircle, CheckCircle2 } from "lucide-react";
import type { OperatingCompanyPortalSettings } from "@/services/customer-portal-config";

/**
 * Renders the per-OC domain status + DNS instructions + Verify action.
 * Shown inside the operating-company card when expanded.
 */
export function DomainStatusBlock({
  settings,
  onVerify,
  verifying,
}: {
  settings: OperatingCompanyPortalSettings;
  onVerify: () => void;
  verifying: boolean;
}) {
  const { customDomain, domainVerificationState, vercelIntegrationAvailable } = settings;

  if (!customDomain) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-muted/30 p-4 text-sm">
        <div className="font-medium">Keine Domain hinterlegt</div>
        <p className="mt-1 text-xs text-muted-foreground">
          Trage unter „Bearbeiten" eine Subdomain ein (z.&nbsp;B.{" "}
          <code>status.kottke-umzuege.de</code>), um den Kunden-Link unter
          eurer eigenen Domain auszuliefern.
        </p>
      </div>
    );
  }

  const isSubdomain = customDomain.split(".").filter(Boolean).length >= 3;
  const dnsRecord = isSubdomain
    ? { type: "CNAME", value: "cname.vercel-dns.com" }
    : { type: "A", value: "76.76.21.21" };

  return (
    <div className="space-y-3 rounded-lg border border-border/50 bg-background p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-medium">Domain & DNS</div>
          <a
            href={`https://${customDomain}`}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-0.5 inline-flex items-center gap-1 text-xs text-muted-foreground hover:underline"
          >
            https://{customDomain}
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>
        <button
          type="button"
          onClick={onVerify}
          disabled={verifying}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-background px-3 text-xs font-medium hover:bg-accent disabled:opacity-50"
        >
          {verifying ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          Jetzt prüfen
        </button>
      </div>

      {/* DNS requirement */}
      <div className="rounded-md border border-border/50 bg-card p-3 text-xs">
        <div className="font-medium text-foreground">DNS-Eintrag erforderlich</div>
        <div className="mt-1 grid grid-cols-[auto_auto_1fr] gap-x-4 gap-y-1 text-muted-foreground">
          <span>Typ</span>
          <code className="font-mono">{dnsRecord.type}</code>
          <span />
          <span>Name</span>
          <code className="font-mono">
            {isSubdomain ? customDomain.split(".")[0] : "@"}
          </code>
          <span className="text-[10px]">
            (im DNS-Anbieter — meistens nur der erste Teil)
          </span>
          <span>Wert</span>
          <code className="font-mono">{dnsRecord.value}</code>
          <span />
        </div>
        {!vercelIntegrationAvailable && (
          <p className="mt-2 text-[11px] text-muted-foreground">
            Bitte zusätzlich im Vercel-Dashboard die Domain bei diesem Projekt
            ergänzen, sonst akzeptiert Vercel die Anfragen nicht.
          </p>
        )}
      </div>

      {/* Live status */}
      <StatusLine state={domainVerificationState} settings={settings} />

      {/* Vercel verification challenges */}
      {settings.vercelVerification && settings.vercelVerification.length > 0 && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/40 dark:text-amber-200">
          <div className="font-medium">Zusätzliche Vercel-Verifikation</div>
          <ul className="mt-1 space-y-1">
            {settings.vercelVerification.map((v, i) => (
              <li key={i} className="font-mono leading-relaxed">
                {v.type} · {v.domain} → {v.value}
                {v.reason ? (
                  <span className="ml-1 not-italic opacity-70">({v.reason})</span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function StatusLine({
  state,
  settings,
}: {
  state: OperatingCompanyPortalSettings["domainVerificationState"];
  settings: OperatingCompanyPortalSettings;
}) {
  if (state === "verified") {
    return (
      <div className="flex items-center gap-2 text-xs text-emerald-700 dark:text-emerald-300">
        <CheckCircle2 className="h-4 w-4" />
        DNS richtig konfiguriert, Domain bei Vercel aktiv, HTTPS erreichbar.
        {settings.domainVerifiedAt && (
          <span className="text-muted-foreground">
            ({new Date(settings.domainVerifiedAt).toLocaleString("de-DE")})
          </span>
        )}
      </div>
    );
  }
  if (state === "pending_dns") {
    return (
      <div className="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-300">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          DNS-Eintrag fehlt oder zeigt noch nicht auf Vercel.
          {settings.domainLastCheckError ? ` ${settings.domainLastCheckError}` : ""}
        </span>
      </div>
    );
  }
  if (state === "pending_ssl") {
    return (
      <div className="flex items-center gap-2 text-xs text-amber-700 dark:text-amber-300">
        <Loader2 className="h-4 w-4 animate-spin" />
        DNS ist richtig — Vercel stellt jetzt das SSL-Zertifikat aus (≈30-90 s).
      </div>
    );
  }
  if (state === "error") {
    return (
      <div className="flex items-start gap-2 text-xs text-red-700 dark:text-red-300">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          {settings.domainLastCheckError ?? "Verifizierung fehlgeschlagen."}
        </span>
      </div>
    );
  }
  return (
    <div className="text-xs text-muted-foreground">
      Noch nicht geprüft — klicke auf „Jetzt prüfen", um den DNS-Eintrag zu
      validieren.
    </div>
  );
}
