# /api/public — Customer-portal contract

These routes are the **only** surface the customer portal speaks to. They are
the contract between the CRM (data owner) and the portal UI (data consumer).
The portal can later move to its own Vercel project / repo and keep calling
these endpoints unchanged.

Every endpoint is **token-scoped**: authentication is the token in the URL.
The token is 32 url-safe base64 chars representing 192 bits of randomness.
No session cookie required. No Bearer token. Brute force is impractical.

## Endpoints

### `GET /api/public/[token]/state`

Returns the full `CustomerPortalContext` (see
`@openclaw-crm/customer-portal-core/types`). Always 200 on a valid token; if
the token is revoked or expired, `meta.revoked = true`.

### `POST /api/public/[token]/confirm-kva`

Records the customer's legally binding acceptance of the offer. Idempotent
on the client side, but each successful call writes a new row in
`kva_confirmations` for audit. Body shape: `ConfirmKvaPayload`.

### `GET /api/public/[token]/documents/[id]`

Streams a PDF (Auftragsbestätigung or Rechnung). Returns 404 if the document
doesn't belong to the deal of this token.

### `GET /api/public/[token]/attachments/[id]`

Streams an image / attachment from the inbox. Same scoping rule.

## Rate-limiting

Not enforced at the route layer today. If the portal hits abuse, add Vercel
Routing Middleware rules per-path-prefix.
