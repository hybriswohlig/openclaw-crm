#!/usr/bin/env tsx
/**
 * Diagnose the WhatsApp integration end-to-end.
 *
 *   pnpm --filter @openclaw-crm/web whatsapp:diagnose
 *
 * Reports:
 *   1. Configured channel accounts (WABA Cloud + Baileys)
 *   2. App-level secrets in workspace_settings (verify token + app secret)
 *   3. Recent inbound / outbound messages per account
 *   4. Live ping of Meta Graph /{phone_number_id} with the stored token
 *      → succeeds = token still valid; 401/403 = token expired or revoked.
 *
 * Nothing is mutated — read-only.
 */
import path from "node:path";
import { config as loadEnv } from "dotenv";

// Same env-file precedence as next.config.ts — repo-root .env.local wins.
loadEnv({ path: path.resolve(__dirname, "../../../.env"), quiet: true });
loadEnv({ path: path.resolve(__dirname, "../../../.env.local"), override: true, quiet: true });
loadEnv({ path: path.resolve(__dirname, "../.env"), override: true, quiet: true });
loadEnv({ path: path.resolve(__dirname, "../.env.local"), override: true, quiet: true });

import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import * as schema from "../src/db/schema/index";
import { eq, and, desc } from "drizzle-orm";

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
  console.error("DATABASE_URL is not set — check repo-root .env.local");
  process.exit(1);
}

const sql = neon(dbUrl);
const db = drizzle(sql, { schema });

const {
  channelAccounts,
  inboxMessages,
  inboxConversations,
  workspaceSettings,
} = schema;

// Same key names as inbox-whatsapp.ts — duplicated locally so the script
// doesn't transitively import the real db client.
const WA_APP_SECRET_KEY = "whatsapp.app_secret";
const WA_VERIFY_TOKEN_KEY = "whatsapp.verify_token";

function color(s: string, c: "green" | "red" | "yellow" | "gray" | "bold"): string {
  const codes = { green: 32, red: 31, yellow: 33, gray: 90, bold: 1 } as const;
  return process.stdout.isTTY ? `\x1b[${codes[c]}m${s}\x1b[0m` : s;
}

const ok = (s: string) => color("✓ " + s, "green");
const err = (s: string) => color("✗ " + s, "red");
const warn = (s: string) => color("⚠ " + s, "yellow");
const dim = (s: string) => color(s, "gray");

async function main() {
  console.log(color("\n=== WhatsApp Integration Diagnostic ===\n", "bold"));

  // ── 1. Channel accounts ─────────────────────────────────────────────────
  // Hand-rolled column list so the script works even if the local DB hasn't
  // been migrated up to 0017_baileys_columns yet.
  const baseAccounts = await db
    .select({
      id: channelAccounts.id,
      workspaceId: channelAccounts.workspaceId,
      channelType: channelAccounts.channelType,
      name: channelAccounts.name,
      address: channelAccounts.address,
      credential: channelAccounts.credential,
      wabaId: channelAccounts.wabaId,
      waPhoneNumberId: channelAccounts.waPhoneNumberId,
      isActive: channelAccounts.isActive,
    })
    .from(channelAccounts)
    .where(eq(channelAccounts.channelType, "whatsapp"));

  // Try to fetch baileys columns separately — skip silently if missing.
  type BaileysExtras = {
    baileysBridgeProvider: string | null;
    baileysPairingStatus: string | null;
    baileysLastSeenAt: Date | null;
    baileysLastDisconnectReason: string | null;
  };
  const baileysExtras = new Map<string, BaileysExtras>();
  try {
    const extras = await db
      .select({
        id: channelAccounts.id,
        baileysBridgeProvider: channelAccounts.baileysBridgeProvider,
        baileysPairingStatus: channelAccounts.baileysPairingStatus,
        baileysLastSeenAt: channelAccounts.baileysLastSeenAt,
        baileysLastDisconnectReason:
          channelAccounts.baileysLastDisconnectReason,
      })
      .from(channelAccounts)
      .where(eq(channelAccounts.channelType, "whatsapp"));
    for (const e of extras) baileysExtras.set(e.id, e);
  } catch {
    console.log(
      warn(
        "Baileys columns not present in this DB — run migration 0017_baileys_columns to enable Baileys diagnostics.\n"
      )
    );
  }

  const accounts = baseAccounts.map((a) => ({
    ...a,
    baileysBridgeProvider: baileysExtras.get(a.id)?.baileysBridgeProvider ?? null,
    baileysPairingStatus: baileysExtras.get(a.id)?.baileysPairingStatus ?? null,
    baileysLastSeenAt: baileysExtras.get(a.id)?.baileysLastSeenAt ?? null,
    baileysLastDisconnectReason:
      baileysExtras.get(a.id)?.baileysLastDisconnectReason ?? null,
  }));

  if (accounts.length === 0) {
    console.log(err("Keine WhatsApp-Kanäle konfiguriert."));
    console.log(
      dim("    Add one in /settings/whatsapp or via /integrations.\n")
    );
    process.exit(0);
  }

  console.log(`Found ${color(String(accounts.length), "bold")} WhatsApp account(s):\n`);

  for (const a of accounts) {
    const kind = a.waPhoneNumberId
      ? "WABA Cloud API"
      : `Baileys (${a.baileysBridgeProvider ?? "openclaw"})`;
    console.log(color(`▸ ${a.name}`, "bold") + dim(`  [${kind}]`));
    console.log(`    id:            ${dim(a.id)}`);
    console.log(`    address:       ${a.address}`);
    console.log(
      `    isActive:      ${a.isActive ? ok("yes") : err("no — inbound webhooks ignored")}`
    );

    if (a.waPhoneNumberId) {
      console.log(`    phone_number_id: ${a.waPhoneNumberId}`);
      console.log(`    waba_id:         ${a.wabaId ?? dim("(not set)")}`);
      console.log(
        `    access_token:    ${a.credential ? ok(`set (${a.credential.length} chars)`) : err("MISSING")}`
      );
    } else {
      const pairing = a.baileysPairingStatus ?? "idle";
      const pairingLabel =
        pairing === "connected"
          ? ok(pairing)
          : pairing === "logged_out" || pairing === "error"
            ? err(pairing)
            : warn(pairing);
      console.log(`    pairing:         ${pairingLabel}`);
      console.log(
        `    last_seen:       ${a.baileysLastSeenAt?.toISOString() ?? dim("(never)")}`
      );
      if (a.baileysLastDisconnectReason) {
        console.log(
          `    last_disconnect: ${warn(a.baileysLastDisconnectReason)}`
        );
      }
    }

    // ── Last messages on this account
    const lastInbound = await db
      .select({
        id: inboxMessages.id,
        sentAt: inboxMessages.sentAt,
        createdAt: inboxMessages.createdAt,
        body: inboxMessages.body,
        fromAddress: inboxMessages.fromAddress,
      })
      .from(inboxMessages)
      .innerJoin(
        inboxConversations,
        eq(inboxMessages.conversationId, inboxConversations.id)
      )
      .where(
        and(
          eq(inboxConversations.channelAccountId, a.id),
          eq(inboxMessages.direction, "inbound")
        )
      )
      .orderBy(desc(inboxMessages.sentAt))
      .limit(3);

    const lastOutbound = await db
      .select({
        id: inboxMessages.id,
        sentAt: inboxMessages.sentAt,
        status: inboxMessages.status,
        body: inboxMessages.body,
        toAddress: inboxMessages.toAddress,
      })
      .from(inboxMessages)
      .innerJoin(
        inboxConversations,
        eq(inboxMessages.conversationId, inboxConversations.id)
      )
      .where(
        and(
          eq(inboxConversations.channelAccountId, a.id),
          eq(inboxMessages.direction, "outbound")
        )
      )
      .orderBy(desc(inboxMessages.sentAt))
      .limit(3);

    console.log(dim("    ── Last inbound:"));
    if (lastInbound.length === 0) {
      console.log("      " + dim("(none ever received)"));
    } else {
      for (const m of lastInbound) {
        const when = (m.sentAt ?? m.createdAt)?.toISOString().slice(0, 19) ?? "?";
        const preview = (m.body ?? "").slice(0, 60).replace(/\n/g, " ");
        console.log(`      ${dim(when)}  from ${m.fromAddress ?? "?"}: ${preview}`);
      }
    }

    console.log(dim("    ── Last outbound:"));
    if (lastOutbound.length === 0) {
      console.log("      " + dim("(none ever sent)"));
    } else {
      for (const m of lastOutbound) {
        const when = m.sentAt?.toISOString().slice(0, 19) ?? "?";
        const status = m.status ?? "?";
        const statusColor =
          status === "failed"
            ? err(status)
            : status === "delivered"
              ? ok(status)
              : warn(status);
        const preview = (m.body ?? "").slice(0, 60).replace(/\n/g, " ");
        console.log(
          `      ${dim(when)}  to ${m.toAddress ?? "?"}: ${preview}  [${statusColor}]`
        );
      }
    }

    // ── Meta token live check (WABA Cloud only) ────────────────────────
    if (a.waPhoneNumberId && a.credential) {
      console.log(dim("    ── Meta Graph API token check:"));
      try {
        const url = `https://graph.facebook.com/v21.0/${a.waPhoneNumberId}?fields=id,display_phone_number,verified_name,quality_rating`;
        const res = await fetch(url, {
          headers: { Authorization: `Bearer ${a.credential}` },
        });
        const body = await res.json().catch(() => ({}));
        if (res.ok) {
          console.log(
            `      ${ok("token valid")}  number=${body.display_phone_number ?? "?"}  quality=${body.quality_rating ?? "?"}  verified_name="${body.verified_name ?? "?"}"`
          );
        } else {
          const meta = body as { error?: { message?: string; code?: number; type?: string } };
          console.log(
            `      ${err(`HTTP ${res.status}`)} ${meta.error?.message ?? "no message"}  (code=${meta.error?.code ?? "?"}, type=${meta.error?.type ?? "?"})`
          );
          if (res.status === 401 || meta.error?.code === 190) {
            console.log(
              "      " +
                warn(
                  "Token expired or revoked. Generate a new system-user token in the Meta Business Manager and update the channel."
                )
            );
          }
        }
      } catch (e) {
        console.log(
          `      ${err("network error")} ${e instanceof Error ? e.message : String(e)}`
        );
      }
    }

    console.log();
  }

  // ── 2. Workspace-level WA secrets ─────────────────────────────────────
  const workspaceIds = [...new Set(accounts.map((a) => a.workspaceId))];
  for (const wsId of workspaceIds) {
    console.log(color("Workspace secrets:", "bold") + dim(` (${wsId})`));
    // Secrets live in workspace_settings as pgp_sym_encrypt(value_encrypted).
    // We only check presence here (is_secret = true AND value_encrypted IS
    // NOT NULL) — decrypting would require the WORKSPACE_SETTINGS_ENC_KEY,
    // which we don't need just to confirm "set / not set".
    const rows = (await sql`
      SELECT key, (is_secret = true AND value_encrypted IS NOT NULL) AS has_secret
      FROM workspace_settings
      WHERE workspace_id = ${wsId}
        AND key = ANY(${[WA_VERIFY_TOKEN_KEY, WA_APP_SECRET_KEY]})
    `) as Array<{ key: string; has_secret: boolean }>;
    const byKey = new Map(rows.map((r) => [r.key, r.has_secret]));

    const verify = byKey.get(WA_VERIFY_TOKEN_KEY);
    const secret = byKey.get(WA_APP_SECRET_KEY);
    console.log(
      `  ${WA_VERIFY_TOKEN_KEY.padEnd(28)} ${verify ? ok("set (encrypted)") : err("MISSING — Meta GET handshake will 403")}`
    );
    console.log(
      `  ${WA_APP_SECRET_KEY.padEnd(28)} ${secret ? ok("set (encrypted)") : err("MISSING — webhook POST signature check fails")}`
    );
    console.log();
  }

  // ── 3. Webhook URL hint ──────────────────────────────────────────────
  const base =
    process.env.NEXT_PUBLIC_APP_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "?");
  console.log(color("Webhook URL Meta should be calling:", "bold"));
  console.log(`  ${base}/api/webhooks/whatsapp`);
  console.log();
  console.log(
    dim(
      "If the GET handshake works but POSTs never arrive, verify the subscription\n" +
        "in Meta Business Manager → WhatsApp → Configuration → Webhooks.\n"
    )
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(err("Diagnostic crashed:"), e);
    process.exit(1);
  });
