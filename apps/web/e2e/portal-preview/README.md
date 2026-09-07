# Isolated customer portal preview

Renders the real public portal components against synthetic fixtures. This is a developer tool, not a Next.js route. It never loads customer data. The fixture intercepts API writes locally; the browser check blocks external requests.

From the repository root:

```sh
node apps/web/e2e/portal-preview/serve.mjs
node apps/web/e2e/portal-preview/check.mjs
pnpm --filter @openclaw-crm/web exec tsc --noEmit -p e2e/portal-preview/tsconfig.json
pnpm --filter @openclaw-crm/web test -- src/lib/portal-presentation.test.ts src/lib/portal-offer-selection.test.ts
```

Open `http://127.0.0.1:4178/`. Query options: `single`, `stage=2`, `stage=3`, `stage=3&live`, `stage=4` (payments off), `stage=4&payments`, `otherbrand`, `dark`, `expired`, `empty`.

The check covers desktop/mobile overflow, single/multiple options, live-state absence, branding, consent and acceptance, expiry, missing quotes and unverified payment reports. Screenshots go to `/tmp/portal-redesign`, or `PORTAL_SCREENSHOT_DIR`.

Current production contract limitations: no quotation PDF URL, no independent live-tracking toggle, no verified paid status. The UI therefore offers a printable quotation, displays only recorded live events, and keeps payment reports distinct from verified receipt. Existing AB/invoice PDFs have previews and download links. Existing selection, deposit and stage rules are retained.

On 2026-09-06, repository node_modules and .next contained macOS dataless placeholders that timed out on read. Validation used copies of these exact portal sources under `/tmp/kottke-portal-validation` with fresh dependencies; no repository lockfile or application dependencies were changed.

The document email action is mocked locally. No message is sent. Live and payment flags default to false, even if operational timestamps or payment instructions are present in a fixture.
