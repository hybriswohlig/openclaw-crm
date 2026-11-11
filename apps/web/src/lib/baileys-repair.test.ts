import { describe, expect, it } from "vitest";
import {
  BAILEYS_REPAIR_LIST,
  KANAL_ACCOUNTS_ANCHOR,
  baileysAuthStateKey,
  baileysRepairHref,
  baileysRepairMode,
  handleBaileysRepairClick,
  isInhouseBaileysDown,
  repairTargetFromHref,
} from "./baileys-repair";

const down = {
  id: "82027c02-f0da-49db-923a-12a1d0f9a552",
  channelType: "whatsapp",
  baileysBridgeProvider: "inhouse" as const,
  isActive: false,
  baileysPairingStatus: "logged_out",
};

describe("baileys re-pair decisions", () => {
  it("keys auth state by the one account id", () => {
    expect(baileysAuthStateKey(down.id)).toBe(`baileys.auth_state.${down.id}`);
    expect(baileysAuthStateKey("595a5e23-aaaa")).not.toContain(down.id);
  });

  it("treats a logged-out inactive in-house row as needing a fresh QR", () => {
    expect(isInhouseBaileysDown(down)).toBe(true);
    expect(baileysRepairMode(down)).toBe("repair");
    expect(baileysRepairMode({ ...down, baileysPairingStatus: "idle", isActive: true })).toBe("repair");
    expect(baileysRepairMode({ ...down, baileysPairingStatus: "error", isActive: true })).toBe("repair");
    expect(baileysRepairMode({ ...down, baileysPairingStatus: null, isActive: false })).toBe("repair");
  });

  it("does not reset a live session or an in-progress scan", () => {
    expect(
      baileysRepairMode({ ...down, isActive: true, baileysPairingStatus: "connected" }),
    ).toBeNull();
    expect(
      baileysRepairMode({ ...down, isActive: true, baileysPairingStatus: "awaiting_qr" }),
    ).toBe("resume");
    expect(
      baileysRepairMode({ ...down, isActive: false, baileysPairingStatus: "connected" }),
    ).toBe("resume");
  });

  it("ignores Cloud API rows and other providers", () => {
    expect(
      baileysRepairMode({ ...down, baileysBridgeProvider: "openclaw" }),
    ).toBeNull();
    expect(
      isInhouseBaileysDown({ ...down, channelType: "email", baileysBridgeProvider: null, baileysPairingStatus: null }),
    ).toBe(false);
  });

  it("points one disconnected account at its re-pair dialog", () => {
    const href = baileysRepairHref([down]);
    expect(href).toBe(`/integrations?baileysRepair=${down.id}`);
    expect(repairTargetFromHref(href)).toBe(down.id);
  });

  it("points several disconnected accounts at the channel list", () => {
    const href = baileysRepairHref([down, { id: "other-account" }]);
    expect(href).toBe(
      `/integrations?baileysRepair=${BAILEYS_REPAIR_LIST}#${KANAL_ACCOUNTS_ANCHOR}`,
    );
    expect(repairTargetFromHref(href)).toBe("list");
  });

  it("handles the banner click on /integrations instead of no-op navigation", () => {
    const href = baileysRepairHref([down]);
    expect(
      handleBaileysRepairClick({ pathname: "/integrations", href, modified: false }),
    ).toEqual({ preventDefault: true, target: down.id });
    expect(
      handleBaileysRepairClick({ pathname: "/inbox", href, modified: false }),
    ).toEqual({ preventDefault: false, target: null });
    expect(
      handleBaileysRepairClick({ pathname: "/integrations", href, modified: true }),
    ).toEqual({ preventDefault: false, target: null });
  });
});
