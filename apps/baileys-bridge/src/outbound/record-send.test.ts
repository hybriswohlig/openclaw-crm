import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { OutboundPayload } from "../lib/crm-client.js";
import { bridgeSendOutboundPayload, postBridgeSendRecord } from "./record-send.js";

const KOTTKE = "acc-kottke";
const CEYLAN = "acc-ceylan";

describe("bridgeSendOutboundPayload", () => {
  it("records the sending account only, as a bridge-send, with no send instruction", () => {
    const payload = bridgeSendOutboundPayload({
      accountId: KOTTKE,
      peerWaId: "491511112233@s.whatsapp.net",
      externalMessageId: "BAE5ABC",
      kind: "text",
      body: "Hallo",
      sentAt: "2026-10-01T09:30:00.000Z",
    });
    assert.ok(payload);
    assert.equal(payload.accountId, KOTTKE);
    assert.notEqual(payload.accountId, CEYLAN);
    assert.equal(payload.peerWaId, "491511112233");
    assert.equal(payload.peerJid, "491511112233@s.whatsapp.net");
    assert.equal(payload.externalMessageId, "BAE5ABC");
    assert.equal(payload.origin, "bridge-send");
    assert.equal(payload.rawHeaders?.source, "bridge-send");
    assert.equal(JSON.stringify(payload).includes("/accounts/"), false);
    assert.equal(JSON.stringify(payload).includes("sendMessage"), false);
  });

  it("does not build a CRM chat for a group send", () => {
    assert.equal(
      bridgeSendOutboundPayload({
        accountId: KOTTKE,
        peerWaId: "120363000@g.us",
        externalMessageId: "BAE5GRP",
        kind: "text",
        body: "Gruppe",
      }),
      null,
    );
  });
});

describe("postBridgeSendRecord", () => {
  it("posts that account's outbound row and has no send function", async () => {
    const posts: OutboundPayload[] = [];
    const ok = await postBridgeSendRecord(
      {
        postOutbound: async (p) => {
          posts.push(p);
          return true;
        },
      },
      {
        accountId: KOTTKE,
        peerWaId: "491511112233",
        externalMessageId: "BAE5ABC",
        kind: "text",
        body: "Hallo",
        sentAt: "2026-10-01T09:30:00.000Z",
      },
    );
    assert.equal(ok, "stored");
    assert.equal(posts.length, 1);
    assert.equal(posts[0]?.accountId, KOTTKE);
    assert.equal(posts[0]?.origin, "bridge-send");
  });

  it("keeps a Ceylan record off the Kottke post and skips groups", async () => {
    const posts: OutboundPayload[] = [];
    const crm = {
      postOutbound: async (p: OutboundPayload) => {
        posts.push(p);
        return true;
      },
    };
    await postBridgeSendRecord(crm, {
      accountId: CEYLAN,
      peerWaId: "491700000000",
      externalMessageId: "BAE5CEY",
      kind: "text",
      body: "Ceylan",
    });
    const skipped = await postBridgeSendRecord(crm, {
      accountId: KOTTKE,
      peerWaId: "120363000@g.us",
      externalMessageId: "BAE5GRP",
      kind: "text",
      body: "Gruppe",
    });
    await postBridgeSendRecord(crm, {
      accountId: KOTTKE,
      peerWaId: "491511112233",
      externalMessageId: "BAE5KOT",
      kind: "text",
      body: "Kottke",
    });
    assert.equal(skipped, "skipped");
    assert.deepEqual(
      posts.map((p) => p.accountId),
      [CEYLAN, KOTTKE],
    );
    assert.equal(posts[0]?.externalMessageId, "BAE5CEY");
    assert.equal(posts[1]?.externalMessageId, "BAE5KOT");
  });
});
