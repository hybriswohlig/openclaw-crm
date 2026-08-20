# MCP Attachments — how an agent sees a customer photo

Status: v1 (2026-08-20), branch `fix/mcp-attachment-bytes`.
Scope: inbox attachment bytes over MCP and REST.
Related: `docs/grok-inbox-agent-plan.md` (intern, nicht im Repo), `policy/grok-inbox-agent.md`,
`policy/entwurfsassistent-fotos.md` (paste-ready prompt block).

## 1. Why this exists

Kottke quotes a **fixed price from photos**. Without pixels an agent cannot
judge kitchen dismantling, volume, floors or access — it guesses from file
names like `IMG_2231.jpg`, and a guessed price is a wrong price. Every tool
below exists so a drafting agent can look at the same photo the human sees.

### Ist (what was broken)

| The agent did | It got back | Why |
|---|---|---|
| `crm_list_deal_attachments({ recordId })` | id, fileName, mimeType, fileSize, conversationId, messageId | Metadata only — that route never selects `fileContent`. |
| `crm_api` on `/api/v1/inbox/attachments/{id}/content` | `INVALID_JSON` | The route streams the raw JPEG for the inbox `<img>`. The MCP client called `res.text()` on it, which mangles the bytes past recovery, then failed to parse them as JSON. |
| `crm_api` on `/api/v1/inbox/attachments/{id}` | Next.js app-shell **HTML with status 404** | That path had no `GET` handler at all, so the request fell through to the app shell. The agent could not tell "wrong URL" from "attachment gone". |
| `crm_api` on `/api/v1/deals/{recordId}/attachments/{id}/content` | same app-shell HTML | Invented path; no handler either. |

### Soll (what happens now)

- `crm_get_attachment` returns the pixels as an **MCP image content block** a
  vision model renders directly, metadata as text alongside.
- `/api/v1/inbox/attachments/{id}` is a real `GET` handler returning JSON with
  `contentBase64` — the canonical JSON twin of `/content`.
- A binary body reached through `crm_api` is wrapped as
  `{ _binary: true, mimeType, byteLength, fileName?, contentBase64, note }`
  instead of being parsed as JSON.
- A path with no route handler now reports code `NOT_JSON_HTML` with the real
  status and a hint pointing at `crm_get_attachment`, instead of dumping HTML.

## 2. The call an agent makes now

Two steps per deal. List first (cheap, no bytes), then fetch each image id.

```jsonc
// 1) metadata for every attachment on the deal
crm_list_deal_attachments({ recordId: "rec_00000000-0000-0000-0000-000000000000" })
// →
[
  { "id": "att_11111111-1111-1111-1111-111111111111",
    "fileName": "kueche.jpg",  "mimeType": "image/jpeg", "fileSize": 254118,
    "conversationId": "conv_aaaa…", "messageId": "msg_bbbb…",
    "createdAt": "2026-08-19T09:12:44.000Z" },
  { "id": "att_22222222-2222-2222-2222-222222222222",
    "fileName": "keller.jpg",  "mimeType": "image/jpeg", "fileSize": 198004, … }
]

// 2) one call per image id — this is the one that carries pixels
crm_get_attachment({ id: "att_11111111-1111-1111-1111-111111111111" })
crm_get_attachment({ id: "att_22222222-2222-2222-2222-222222222222",
                     recordId: "rec_00000000-0000-0000-0000-000000000000" })
```

The default result is two content blocks:

```jsonc
// text block (metadata)
{
  "id": "att_11111111-1111-1111-1111-111111111111",
  "fileName": "kueche.jpg",
  "mimeType": "image/jpeg",
  "fileSize": 254118,
  "byteLength": 254118,
  "isImage": true,
  "conversationId": "conv_aaaa…",
  "messageId": "msg_bbbb…",
  "dealRecordId": "rec_0000…",
  "createdAt": "2026-08-19T09:12:44.000Z",
  "contentDelivery": "image_block",
  "hint": "The pixels are in the image content block of this result. …"
}
// + image block: { type: "image", data: "<base64>", mimeType: "image/jpeg" }
```

`data` is **plain base64 — never a `data:image/...;base64,` URI**. That is what
the MCP SDK (1.12.1) expects, it is what `inbox_message_attachments.fileContent`
already stores, and nothing in the path re-encodes it. Prepending a data-URI
prefix (or stripping one that is not there) corrupts the image.

Parameters: `id` (required), `recordId` (optional — asserts the attachment
belongs to that deal; a mismatch is a 404, indistinguishable from "does not
exist"), `format`, `maxBytes`.

Voice notes: if the transcribe cron has processed the attachment, the metadata
carries a `transcript` field. `crm_list_deal_attachments` never does.

## 3. `format`: `image` | `base64` | `both`

| `format` | Image block | `contentBase64` in the text block |
|---|---|---|
| `image` (**default**) | yes | no — the bytes are carried once, not twice |
| `base64` | no | yes |
| `both` | yes | yes |

The default deliberately omits `contentBase64` next to the image block: it
would double the token cost of every photo for zero gain.

**If your client cannot render image blocks** (no vision, or the block is
dropped) call the same id again with `format: "base64"` and decode
`contentBase64` yourself. `contentDelivery` in the metadata always says which
form you actually got (`image_block`, `base64`, `image_block+base64`), so a
silent "no image" is detectable — that silence is what sent agents back to
`crm_api` last time.

Only `image/jpeg`, `image/png`, `image/webp` and `image/gif` are eligible for
an image block (`image/jpg`, the bogus mime WhatsApp sends, is normalised to
`image/jpeg` for the block while the metadata keeps what the sender claimed).
Anything else — PDF, HEIC, audio — comes back as base64 plus a `hint` saying
why (never as an image block that would error the whole call), provided it fits
the byte budget in §4.

## 4. Size cap

Constants live in `apps/web/src/lib/attachment-content.ts`:

| Constant | Value | Meaning |
|---|---|---|
| `MAX_JSON_INLINE_BYTES` | `3 * 1024 * 1024` (3 MB) | most bytes a buffered JSON response can carry |
| `MAX_MCP_INLINE_BYTES` | = the above | default budget for one tool result, in any form |
| `MAX_MCP_INLINE_BYTES_LIMIT` | = the above | hard ceiling a caller-supplied `maxBytes` cannot exceed |

All three are the same number on purpose. This is a **transport** limit, not a
taste one: `NextResponse.json` buffers the whole body and base64 inflates it by
4/3, so a serverless platform's non-streaming response cap (~4.5 MB on Vercel)
is reached at roughly 75% of the file size the raw `/content` stream handles
fine. Letting `maxBytes` go higher would only trade an honest "too large" for a
platform HTML error page — which a JSON client can read only as "this route
does not exist".

`maxBytes` is clamped by `resolveMaxBytes()`: missing, non-finite or `<= 0`
falls back to the default; anything larger is capped at the ceiling.

The REST route enforces the same number and says so properly: over it,
`GET /api/v1/inbox/attachments/{id}` returns **413** with
`error.code: "ATTACHMENT_TOO_LARGE"` and a pointer to `/content`. Refusing in
JSON is the point — an unbounded body would instead be refused by the platform
with an HTML error page, and a JSON client can only read that as "this route
does not exist".

Over the budget the call **does not error**, but it also does not smuggle the
bytes through in the other form: no image block, no `contentBase64`,
`contentDelivery: "omitted_too_large"`, and a hint naming the byte count and
what to do. Below the hard ceiling the hint offers a higher `maxBytes`; above
it, it says so plainly and points at `/content` instead of sending you round in
a circle. The budget covers both forms on purpose: gating only the image block
would have inlined a 9 MB inbox video as ≈12 MB of base64 into one JSON-RPC
response — the larger payload, chosen *because* the smaller one was refused.

Sizing rationale, measured against production (901 attachments): the largest
**image** is a 2.4 MB JPEG and the median customer photo is ~250 KB, so no
photo comes near the limit. The rows that do are the non-photo tail — a 9.1 MB
`video/mp4`, a 4.9 MB PDF — and those belong on `/content`, not in JSON.

Ingest allows more than this route returns (WhatsApp media up to 25 MB, email
attachments up to 10 MB, the Baileys bridge unbounded), so "too large" is a
reachable answer, not a theoretical one.

The `crm_api` escape hatch is stricter: a binary body larger than
`MAX_MCP_INLINE_BYTES` throws `413 BINARY_TOO_LARGE` there. The REST routes
apply no ceiling at all, so nothing is ever unreachable.

## 5. REST routes

| Route | Returns |
|---|---|
| `GET /api/v1/deals/{recordId}/attachments` | metadata list for the deal, newest first |
| `GET /api/v1/inbox/attachments/{id}` | **JSON** `{ data: { id, fileName, mimeType, fileSize, contentBase64, isImage, conversationId, messageId, dealRecordId, createdAt, transcript? } }` — the canonical JSON route; optional `?dealRecordId=` for extra scoping |
| `GET /api/v1/inbox/attachments/{id}/content` | raw binary stream (`Content-Type` = the attachment's mime). Unchanged — the inbox renders `<img src="…/content">` against it |
| `GET /api/v1/inbox/attachments/{id}/content?format=json` | same JSON payload as the canonical route. It exists because `/content` is the URL visible in the inbox markup, so agents copy it and then die on the binary body. No `dealRecordId` scoping on this variant |

## 6. Auth and scoping

- Every route requires auth: a browser **session cookie** or an
  `Authorization: Bearer oc_sk_…` API key. No exceptions, no public URLs,
  no signed share links — customer photos are never exposed unauthenticated.
- Unauthenticated → `401 UNAUTHORIZED`.
- Rows are workspace-scoped in SQL. Another workspace's attachment id is a
  **404**, identical to a non-existent id (no existence oracle).
- `recordId` / `?dealRecordId=` adds a second `AND` on the attachment's deal.
  A mismatch is likewise a 404, on purpose.

## 7. Do not (was NICHT tun)

- **Do not** `crm_api` the `/content` path for bytes. It streams binary; you
  get the `_binary` envelope at best and burn a round trip. Use
  `crm_get_attachment` — only it returns a renderable image block.
- **Do not** guess `/api/v1/attachments/{id}` or
  `/api/v1/deals/{recordId}/attachments/{id}/content`. Neither exists. The
  inbox path is `/api/v1/inbox/attachments/{id}`.
- **Do not** treat `crm_list_deal_attachments` as "I have seen the photos".
  It is metadata only.
- **Do not** price a move from file names. No number without sight —
  photos or a viewing (`policy/customer-texting/SKILL.md`).
- **Do not** paste attachment base64 into a draft, a note or a document field.
- **Do not** wrap `data` / `contentBase64` in a `data:` URI — both are raw
  base64 and are decoded as such.

## 8. Where this lives in the code

| File | Role |
|---|---|
| `apps/web/src/lib/attachment-content.ts` | caps, renderable-mime rules, `toAttachmentPayload()` |
| `apps/web/src/lib/mcp/register-tools.ts` | tool registration + descriptions (`crm_get_attachment`, `crm_list_deal_attachments`, `crm_api`) |
| `apps/web/src/lib/mcp/dispatch.ts` | `attachmentContent()` — builds the text + image blocks |
| `apps/web/src/lib/mcp/client.ts` | binary envelope, `NOT_JSON_HTML`, `BINARY_TOO_LARGE` |
| `apps/web/src/app/api/v1/inbox/attachments/[id]/route.ts` | canonical JSON route |
| `apps/web/src/app/api/v1/inbox/attachments/[id]/content/route.ts` | binary stream + `?format=json` |
| `apps/web/src/services/inbox.ts` | `getAttachmentsForDeal()`, `getAttachmentWithContent()` |

Transport note: `crm_get_attachment` and `crm_list_deal_attachments` are
registered on **both** MCP servers — the remote one at `https://<host>/api/mcp`
(`apps/web/src/lib/mcp/register-tools.ts`) and the local stdio one in `apps/mcp`
(`apps/mcp/src/tools/definitions.ts`). They read the same REST route, so the
JSON is identical. The one difference: only the remote server adds the
**image content block**, because the stdio server's `handleTool` returns text
content only. An agent on stdio therefore always decodes `contentBase64`
itself — which is why the stdio tool description does not mention `format`.

| | remote `/api/mcp` | stdio `apps/mcp` |
|---|---|---|
| `crm_list_deal_attachments` | yes | yes |
| `crm_get_attachment` | yes | yes |
| image content block | yes (default) | no — base64 only |
| `format` / `maxBytes` params | yes | no |
