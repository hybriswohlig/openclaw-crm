import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createLogger } from "../lib/logger.js";
import type { BridgeSendRecord } from "../outbound/record-send.js";
import { buildServer, type BridgeControl } from "./server.js";

const KOTTKE = "acc-kottke";

function fakeManager() {
  const sends: string[] = [];
  const records: BridgeSendRecord[] = [];
  let recordOk = true;
  const manager: BridgeControl = {
    async start() {},
    async stop() {},
    health() {
      return [];
    },
    async sendText(accountId, peerWaId, body) {
      sends.push(`text:${accountId}:${peerWaId}:${body}`);
      return { keyId: "BAE5SENT" };
    },
    async sendMedia() {
      sends.push("media");
      return { keyId: "BAE5MEDIA" };
    },
    async recordBridgeSend(args) {
      records.push(args);
      return recordOk;
    },
  };
  return {
    manager,
    sends,
    records,
    failRecord() {
      recordOk = false;
    },
  };
}

describe("POST /accounts/:id/send", () => {
  it("sends once and records that account's outbound row", async () => {
    const fake = fakeManager();
    const app = await buildServer({
      port: 0,
      bridgeSecret: "secret",
      manager: fake.manager,
      log: createLogger("silent"),
    });
    const res = await app.inject({
      method: "POST",
      url: `/accounts/${KOTTKE}/send`,
      headers: { "x-bridge-secret": "secret", "content-type": "application/json" },
      payload: { kind: "text", peerWaId: "491511112233@s.whatsapp.net", text: "Hallo" },
    });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json(), {
      ok: true,
      externalMessageId: "BAE5SENT",
      recorded: true,
    });
    assert.deepEqual(fake.sends, ["text:acc-kottke:491511112233@s.whatsapp.net:Hallo"]);
    assert.equal(fake.records.length, 1);
    assert.equal(fake.records[0]?.accountId, KOTTKE);
    assert.equal(fake.records[0]?.externalMessageId, "BAE5SENT");
    assert.equal(fake.records[0]?.body, "Hallo");
    assert.equal(fake.records[0]?.kind, "text");
    await app.close();
  });

  it("does not record or send when the secret is wrong", async () => {
    const fake = fakeManager();
    const app = await buildServer({
      port: 0,
      bridgeSecret: "secret",
      manager: fake.manager,
      log: createLogger("silent"),
    });
    const res = await app.inject({
      method: "POST",
      url: `/accounts/${KOTTKE}/send`,
      headers: { "content-type": "application/json" },
      payload: { kind: "text", peerWaId: "491511112233", text: "Hallo" },
    });
    assert.equal(res.statusCode, 401);
    assert.deepEqual(fake.sends, []);
    assert.deepEqual(fake.records, []);
    await app.close();
  });

  it("still returns the WhatsApp id when the CRM record fails, and does not send twice", async () => {
    const fake = fakeManager();
    fake.failRecord();
    const app = await buildServer({
      port: 0,
      bridgeSecret: "secret",
      manager: fake.manager,
      log: createLogger("silent"),
    });
    const res = await app.inject({
      method: "POST",
      url: `/accounts/${KOTTKE}/send`,
      headers: { "x-bridge-secret": "secret", "content-type": "application/json" },
      payload: { kind: "text", peerWaId: "491511112233", text: "Hallo" },
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().recorded, false);
    assert.equal(res.json().externalMessageId, "BAE5SENT");
    assert.equal(fake.sends.length, 1);
    assert.equal(fake.records.length, 1);
    await app.close();
  });

  it("does not record when the WhatsApp send itself fails", async () => {
    const fake = fakeManager();
    fake.manager.sendText = async () => {
      throw new Error("not connected");
    };
    const app = await buildServer({
      port: 0,
      bridgeSecret: "secret",
      manager: fake.manager,
      log: createLogger("silent"),
    });
    const res = await app.inject({
      method: "POST",
      url: `/accounts/${KOTTKE}/send`,
      headers: { "x-bridge-secret": "secret", "content-type": "application/json" },
      payload: { kind: "text", peerWaId: "491511112233", text: "Hallo" },
    });
    assert.equal(res.statusCode, 500);
    assert.deepEqual(fake.records, []);
    await app.close();
  });
});
