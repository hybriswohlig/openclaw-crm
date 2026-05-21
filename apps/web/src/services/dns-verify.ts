/**
 * Domain verification for customer-portal subdomains.
 *
 * The check runs against the live DNS hierarchy from the Vercel function, NOT
 * against the OS resolver cache. We use the built-in `node:dns/promises` API
 * which on Vercel functions uses the same upstream resolvers Vercel itself
 * uses, so the answers match what Vercel sees when it decides whether the
 * domain is "configured" on their side.
 *
 * What we check:
 *   1) Subdomain → CNAME should resolve to `cname.vercel-dns.com`
 *      Apex     → A record should be `76.76.21.21` (Vercel's edge IP)
 *   2) The HTTPS endpoint should respond (proves Vercel routed the host
 *      to a project AND the certificate is provisioned).
 *
 * Vercel API cross-check (optional, in services/vercel-domains.ts) layers on
 * top — gives us the canonical "this domain belongs to OUR project" answer.
 */

import { promises as dns } from "node:dns";

/**
 * Vercel's official endpoints for self-managed domains.
 * - Apex: A record to 76.76.21.21
 * - Subdomain: CNAME to cname.vercel-dns.com
 */
export const VERCEL_APEX_A_RECORD = "76.76.21.21";
export const VERCEL_SUBDOMAIN_CNAME = "cname.vercel-dns.com";

export interface DnsCheckResult {
  domain: string;
  isSubdomain: boolean;
  expectedRecord: { type: "A"; value: string } | { type: "CNAME"; value: string };
  resolved: {
    aRecords: string[];
    cnameTarget: string | null;
  };
  dnsOk: boolean;
  httpsReachable: boolean;
  /** Round-trip ms for the HTTPS HEAD. -1 if not attempted. */
  httpsLatencyMs: number;
  /** When dnsOk is false, an English string explaining what's missing. */
  errorMessage: string | null;
  checkedAt: string;
}

/**
 * Heuristic: subdomain if the host has 3+ DNS labels (e.g.
 * `status.kottke-umzuege.de`). Two labels = apex (`kottke-umzuege.de`).
 *
 * Imperfect for compound TLDs (`example.co.uk`) — UI should let the admin
 * override with an explicit type if needed. For Kottke's de-domains this is
 * fine.
 */
export function isSubdomainHost(host: string): boolean {
  return host.split(".").filter(Boolean).length >= 3;
}

export async function checkDomain(rawDomain: string): Promise<DnsCheckResult> {
  const domain = rawDomain.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  const isSubdomain = isSubdomainHost(domain);
  const expected = isSubdomain
    ? ({ type: "CNAME", value: VERCEL_SUBDOMAIN_CNAME } as const)
    : ({ type: "A", value: VERCEL_APEX_A_RECORD } as const);

  let aRecords: string[] = [];
  let cnameTarget: string | null = null;
  let dnsOk = false;
  let errorMessage: string | null = null;

  try {
    if (isSubdomain) {
      const cnames = await withTimeout(dns.resolveCname(domain), 5000);
      cnameTarget = cnames[0] ?? null;
      dnsOk = !!cnameTarget && cnameTarget.toLowerCase() === VERCEL_SUBDOMAIN_CNAME;
      if (!dnsOk) {
        errorMessage = cnameTarget
          ? `CNAME zeigt auf "${cnameTarget}" statt auf "${VERCEL_SUBDOMAIN_CNAME}".`
          : `Es ist kein CNAME für "${domain}" hinterlegt. Bitte CNAME → ${VERCEL_SUBDOMAIN_CNAME} setzen.`;
      }
    } else {
      const a = await withTimeout(dns.resolve(domain, "A"), 5000);
      aRecords = a;
      dnsOk = a.includes(VERCEL_APEX_A_RECORD);
      if (!dnsOk) {
        errorMessage = a.length
          ? `A-Record zeigt auf ${a.join(", ")} statt auf ${VERCEL_APEX_A_RECORD}.`
          : `Es ist kein A-Record für "${domain}" hinterlegt. Bitte A → ${VERCEL_APEX_A_RECORD} setzen.`;
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Distinguish "no such record" from "lookup failed" so the UI can be precise.
    if (/(ENOTFOUND|ENODATA)/.test(msg)) {
      errorMessage = `Keine DNS-Einträge gefunden. Bitte zuerst ${expected.type} → ${expected.value} setzen.`;
    } else {
      errorMessage = `DNS-Lookup fehlgeschlagen: ${msg}`;
    }
  }

  // HTTPS reachability — only attempt when DNS already matches, otherwise it'd
  // just time out and confuse the UI.
  let httpsReachable = false;
  let httpsLatencyMs = -1;
  if (dnsOk) {
    const start = Date.now();
    try {
      const res = await fetch(`https://${domain}/__portal_health`, {
        method: "HEAD",
        redirect: "manual",
        // Vercel-side timeout: 4s.
        signal: AbortSignal.timeout(4000),
      });
      // Anything that handshakes successfully counts as reachable — even a 404
      // or a 308. What we care about is "TLS works and a Vercel project is
      // responding here".
      httpsReachable = res.status > 0;
      httpsLatencyMs = Date.now() - start;
    } catch {
      httpsReachable = false;
      httpsLatencyMs = Date.now() - start;
    }
  }

  return {
    domain,
    isSubdomain,
    expectedRecord: expected,
    resolved: { aRecords, cnameTarget },
    dnsOk,
    httpsReachable,
    httpsLatencyMs,
    errorMessage,
    checkedAt: new Date().toISOString(),
  };
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms)
    ),
  ]);
}
