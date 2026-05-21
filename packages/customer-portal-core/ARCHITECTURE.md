# customer-portal-core

Pure-logic package for the Kottke customer status portal. **No** Drizzle, **no** Next.js,
**no** filesystem access. Everything in this package is deterministic and side-effect-free
so it can move into its own repo / app the day the portal grows up.

## Why this package exists

When the portal eventually splits out (own repo, own Vercel project), the boundary
that needs to survive the split is:

1. The **types** describing a customer link, KVA snapshot, stage, etc.
2. The **token format** and `generateToken` / `validateTokenShape`.
3. The **stage derivation** function — takes a portable context, returns 1-4.
4. The **payment-link builders** (EPC Girocode, PayPal.me URL).
5. The **per-firma branding constants** until they live in the DB.

Everything DB-shaped lives in `apps/web/src/db/schema/customer-portal.ts` —
that file is consumed by the *adapter* (`services/customer-portal-data.ts`), not by
this package.

## How to lift this out later

When you spin up `apps/customer-portal` or a separate repo:

1. Copy this directory verbatim. Done.
2. The new app calls the CRM's existing public API (`/api/public/[token]/state`,
   `/api/public/[token]/confirm-kva`) over HTTPS — those endpoints are the
   contract between portal and CRM. No DB sharing needed.
3. Optionally replicate the four `customer_*` tables to a portal-owned DB and
   replace the adapter; the public API and the package keep working unchanged.

## What MUST NOT go in this package

- Drizzle schemas or `db.select()` calls.
- React or Next.js APIs.
- Environment variable lookups.
- `crypto.randomUUID` from Node — use Web Crypto via the abstracted helper.

Keep the surface small. If you find yourself adding a function that only one
caller uses, leave it next to the caller instead.
