#!/usr/bin/env tsx
/**
 * Simulate a Meta WhatsApp webhook POST against production.
 *
 *   pnpm --filter @openclaw-crm/web whatsapp:probe-webhook
 *
 * Decrypts the stored app_secret from workspace_settings, builds a minimal
 * messages-event payload with the production phone_number_id, signs it with
 * HMAC-SHA256, and POSTs to:
 *
 *   https://darioushkottke.online/api/webhooks/whatsapp
 *
 * Then re-queries the inbox to see if a row landed. If yes — the handler is
 * alive and Meta is the one not delivering. If no — production handler is
 * broken; the response code tells us where.
 */
import path from "node:path";
import { config as loadEnv } from "dotenv";

loadEnv({ path: path.resolve(__dirname, "../../../.env"), quiet: true });
loadEnv({ path: path.resolve(__dirname, "../../../.env.local"), override: true, quiet: true });
loadEnv({ path: path.resolve(__dirname, "../.env"), override: true, quiet: true });
loadEnv({ path: path.resolve(__dirname, "../.env.local"), override: true, quiet: true });

import { neon } from "@neondatabase/serverless";
import { createHmac } from "node:crypto";

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}
const encKey = process.env.SETTINGS_ENCRYPTION_KEY;
if (!encKey) {
  console.error("SETTINGS_ENCRYPTION_KEY is not set");
  process.exit(1);
}

const PROD_URL =
  process.env.PROBE_WEBHOOK_URL ??
  "https://darioushkottke.online/api/webhooks/whatsapp";

const WA_APP_SECRET_KEY = "whatsapp.app_secret";

async function main() {
  const sql = neon(dbUrl!);

  // ── Resolve workspace id (single-tenant deployment) ─────────────────
  const wsRows = (await sql`
    SELECT id FROM workspaces ORDER BY created_at ASC LIMIT 1
  `) as Array<{ id: string }>;
  if (wsRows.length === 0) {
    console.error("No workspace found");
    process.exit(1);
  }
  const workspaceId = wsRows[0].id;

  // ── Decrypt app_secret ──────────────────────────────────────────────
  const secretRows = (await sql`
    SELECT pgp_sym_decrypt(value_encrypted, ${encKey})::text AS value
    FROM workspace_settings
    WHERE workspace_id = ${workspaceId}
      AND key = ${WA_APP_SECRET_KEY}
      AND value_encrypted IS NOT NULL
    LIMIT 1
  `) as Array<{ value: string }>;
  const appSecret = secretRows[0]?.value;
  if (!appSecret) {
    console.error("app_secret not stored in workspace_settings");
    process.exit(1);
  }

  // ── Find production phone_number_id ─────────────────────────────────
  const accountRows = (await sql`
    SELECT wa_phone_number_id, address, name
    FROM channel_accounts
    WHERE channel_type = 'whatsapp'
      AND wa_phone_number_id IS NOT NULL
      AND is_active = true
    LIMIT 1
  `) as Array<{ wa_phone_number_id: string; address: string; name: string }>;
  if (accountRows.length === 0) {
    console.error("No active WABA Cloud account");
    process.exit(1);
  }
  const account = accountRows[0];
  console.log(`Using account: ${account.name} (${account.address}, phone_number_id=${account.wa_phone_number_id})`);

  // ── Build a realistic-ish inbound message payload ────────────────────
  const externalMessageId = `probe-${Date.now()}`;
  const now = Math.floor(Date.now() / 1000);
  const peerWaId = "4915159058963"; // probe-from number; same as your test number
  const payload = {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "707618195740630",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: {
                display_phone_number: account.address,
                phone_number_id: account.wa_phone_number_id,
              },
              contacts: [{ wa_id: peerWaId, profile: { name: "Webhook Probe" } }],
              messages: [
                {
                  id: externalMessageId,
                  from: peerWaId,
                  timestamp: String(now),
                  type: "text",
                  text: { body: `[probe ${new Date().toISOString()}] Webhook health check` },
                },
              ],
            },
          },
        ],
      },
    ],
  };

  const rawBody = JSON.stringify(payload);
  const signature =
    "sha256=" + createHmac("sha256", appSecret).update(rawBody).digest("hex");

  console.log(`\nPOST ${PROD_URL}`);
  console.log(`payload size: ${rawBody.length} bytes`);
  console.log(`signature: ${signature.slice(0, 24)}…\n`);

  const t0 = Date.now();
  const res = await fetch(PROD_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-hub-signature-256": signature,
      "user-agent": "facebookexternalua/probe",
    },
    body: rawBody,
  });
  const elapsed = Date.now() - t0;
  const text = await res.text();
  console.log(`status: ${res.status}  (${elapsed}ms)`);
  console.log(`body:   ${text.slice(0, 500)}`);

  // ── Verify the message landed in inbox_messages ─────────────────────
  await new Promise((r) => setTimeout(r, 1500));
  const inserted = (await sql`
    SELECT id, external_message_id, body, created_at
    FROM inbox_messages
    WHERE external_message_id = ${externalMessageId}
    LIMIT 1
  `) as Array<{
    id: string;
    external_message_id: string;
    body: string;
    created_at: Date;
  }>;

  console.log();
  if (inserted.length > 0) {
    console.log(`✓ INSERTED in inbox_messages: id=${inserted[0].id}`);
    console.log(`  body: ${inserted[0].body}`);
    console.log(`  Handler is healthy — Meta-side delivery is the issue.`);
  } else {
    console.log(`✗ NOT inserted in inbox_messages.`);
    if (res.ok) {
      console.log(`  Webhook acked but the handler errored silently. Check Vercel runtime logs:`);
      console.log(`    vercel logs darioushkottke.online`);
    } else {
      console.log(`  Webhook rejected the request. Status ${res.status} is the reason.`);
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("probe failed:", e);
    process.exit(1);
  });
