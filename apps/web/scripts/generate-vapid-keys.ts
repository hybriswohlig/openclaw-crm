#!/usr/bin/env tsx
/**
 * Generates a fresh VAPID keypair for Web Push.
 * Run once per environment, then paste the output into `.env.local`:
 *
 *   pnpm --filter @openclaw-crm/web push:generate-keys
 */
import webpush from "web-push";

const keys = webpush.generateVAPIDKeys();

console.log(`
# Web Push VAPID keys — append to apps/web/.env.local (or repo root .env.local)

VAPID_PUBLIC_KEY=${keys.publicKey}
NEXT_PUBLIC_VAPID_PUBLIC_KEY=${keys.publicKey}
VAPID_PRIVATE_KEY=${keys.privateKey}
VAPID_SUBJECT=mailto:hello@kottke-umzuege.de
`);
