/**
 * Read-only Diagnose: Wie viel Noise steckt aktuell in der Lead-Pipeline?
 *   A. Lane/Classifier-Verteilung aller Konversationen
 *   B. Deals, die an info/spam-Konversationen haengen (Lane-Gate-Luecke WhatsApp)
 *   C. Lead-Lane-E-Mail-Konversationen von Noise-Absendern (Alt-Daten vor Triage)
 *   D. Nie klassifizierte Konversationen (classified_by IS NULL, Default-Lane)
 */
import "./_load-env";
import { db } from "@/db";
import { sql } from "drizzle-orm";

type Rows = Array<Record<string, unknown>>;
const log = (...a: unknown[]) => console.log(...a);

async function main() {
  log("A. Lane-Verteilung (Konversationen):");
  const lanes = (await db.execute(sql`
    SELECT lane, COALESCE(classified_by::text, 'nie klassifiziert') AS by, COUNT(*) AS n
    FROM inbox_conversations GROUP BY 1, 2 ORDER BY 1, 3 DESC
  `)) as unknown as Rows;
  for (const r of lanes) log(`  ${r.lane} / ${r.by}: ${r.n}`);

  log("\nB. Deals an info/spam-Konversationen (je Kanal):");
  const noiseDeals = (await db.execute(sql`
    SELECT ca.channel_type, c.lane, ct.display_name, c.last_message_preview,
           c.deal_record_id, r.deleted_at IS NOT NULL AS deal_deleted
    FROM inbox_conversations c
    JOIN channel_accounts ca ON ca.id = c.channel_account_id
    JOIN inbox_contacts ct ON ct.id = c.contact_id
    JOIN records r ON r.id = c.deal_record_id
    WHERE c.deal_record_id IS NOT NULL AND c.lane IN ('info','spam')
    ORDER BY ca.channel_type, c.last_message_at DESC
  `)) as unknown as Rows;
  log(`  gesamt: ${noiseDeals.length}`);
  for (const r of noiseDeals.slice(0, 30)) {
    const prev = String(r.last_message_preview ?? "").slice(0, 50);
    log(`  [${r.channel_type}/${r.lane}${r.deal_deleted ? "/deal-geloescht" : ""}] ${r.display_name}: "${prev}"`);
  }

  log("\nC. Lead-Lane-E-Mails von Noise-Absendern (Alt-Daten):");
  const legacyNoise = (await db.execute(sql`
    SELECT ct.email, ct.display_name, COUNT(*) AS convs,
           COUNT(c.deal_record_id) AS with_deal,
           BOOL_OR(c.classified_by IS NULL) AS never_classified
    FROM inbox_conversations c
    JOIN channel_accounts ca ON ca.id = c.channel_account_id
    JOIN inbox_contacts ct ON ct.id = c.contact_id
    WHERE ca.channel_type = 'email' AND c.lane = 'lead' AND ct.email ~* '(aliexpress|temu|shein|noreply|no-reply|no_reply|donotreply|newsletter|marketing@|news@|promo|paypal|amazon|ebay\\.|booking\\.|linkedin|facebookmail|accounts\\.google|tiktok|netflix|mailer-daemon|bounce)'
    GROUP BY 1, 2 ORDER BY 3 DESC
  `)) as unknown as Rows;
  log(`  Absender: ${legacyNoise.length}`);
  for (const r of legacyNoise) {
    log(`  ${r.email} (${r.display_name}): ${r.convs} Konv., davon ${r.with_deal} mit Deal${r.never_classified ? ", nie klassifiziert" : ""}`);
  }

  log("\nD. Nie klassifizierte Konversationen je Kanal (Default lane='lead'):");
  const unclassified = (await db.execute(sql`
    SELECT ca.channel_type, COUNT(*) AS n, COUNT(c.deal_record_id) AS with_deal
    FROM inbox_conversations c
    JOIN channel_accounts ca ON ca.id = c.channel_account_id
    WHERE c.classified_by IS NULL AND c.lane = 'lead'
    GROUP BY 1
  `)) as unknown as Rows;
  for (const r of unclassified) log(`  ${r.channel_type}: ${r.n} (davon ${r.with_deal} mit Deal)`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("diagnose-lead-noise failed:", err);
    process.exit(1);
  });
