import { describe, expect, it } from "vitest";
import {
  hasOpenrouterKey,
  isSecretSettingKey,
  keepStoredSecrets,
  stripSecretSettings,
  toPublicWorkspace,
} from "./workspace-secrets";

const SCHLUESSEL = "sk-or-v1-geheim-1234567890";

// So sieht workspaces.settings in Produktion aus (Stand Oktober 2026).
const gespeichert = {
  logo: "<svg/>",
  openrouterApiKey: SCHLUESSEL,
  openrouterModel: "anthropic/claude-sonnet-4",
  reviews_engine_enabled: true,
};

describe("isSecretSettingKey", () => {
  it("erkennt Schlüssel, Tokens, Secrets und Passwörter am Namen", () => {
    for (const key of [
      "openrouterApiKey",
      "apiKey",
      "api_key",
      "OPENAI_API_KEY",
      "webhookSecret",
      "client_secret",
      "accessToken",
      "refresh_token",
      "password",
      "smtpPasswort",
      "credentials",
      "privateKey",
    ]) {
      expect(isSecretSettingKey(key), key).toBe(true);
    }
  });

  it("lässt normale Einstellungen in Ruhe", () => {
    for (const key of [
      "logo",
      "openrouterModel",
      "reviews_engine_enabled",
      "maxTokens",
      "tokenLimit",
      "publicKey",
      "hasOpenrouterKey",
    ]) {
      expect(isSecretSettingKey(key), key).toBe(false);
    }
  });
});

describe("stripSecretSettings", () => {
  it("entfernt den OpenRouter-Schlüssel und behält den Rest", () => {
    expect(stripSecretSettings(gespeichert)).toEqual({
      logo: "<svg/>",
      openrouterModel: "anthropic/claude-sonnet-4",
      reviews_engine_enabled: true,
    });
  });

  it("verändert das Original nicht", () => {
    const kopie = structuredClone(gespeichert);
    stripSecretSettings(gespeichert);
    expect(gespeichert).toEqual(kopie);
  });

  it("entfernt geheime Felder auch in verschachtelten Objekten und Listen", () => {
    const ergebnis = stripSecretSettings({
      integrationen: {
        mail: { host: "smtp.example.invalid", password: "pw", user: "info" },
        webhooks: [{ url: "https://example.invalid/hook", secret: "s3" }],
      },
    });
    expect(ergebnis).toEqual({
      integrationen: {
        mail: { host: "smtp.example.invalid", user: "info" },
        webhooks: [{ url: "https://example.invalid/hook" }],
      },
    });
    expect(JSON.stringify(ergebnis)).not.toMatch(/pw|s3/);
  });

  it("macht aus leeren oder kaputten Einstellungen ein leeres Objekt", () => {
    expect(stripSecretSettings(null)).toEqual({});
    expect(stripSecretSettings(undefined)).toEqual({});
    expect(stripSecretSettings("kaputt")).toEqual({});
    expect(stripSecretSettings([1, 2])).toEqual({});
  });
});

describe("hasOpenrouterKey", () => {
  it("meldet, ob ein Schlüssel hinterlegt ist", () => {
    expect(hasOpenrouterKey(gespeichert)).toBe(true);
    expect(hasOpenrouterKey({ openrouterApiKey: "" })).toBe(false);
    expect(hasOpenrouterKey({ logo: "<svg/>" })).toBe(false);
    expect(hasOpenrouterKey(null)).toBe(false);
  });
});

describe("toPublicWorkspace", () => {
  it("liefert die Zeile ohne Geheimnisse, aber mit hasOpenrouterKey", () => {
    const zeile = {
      id: "ws_kottke",
      name: "Kottke Umzüge",
      slug: "kottke",
      settings: gespeichert,
      createdAt: new Date("2025-01-01T00:00:00Z"),
      updatedAt: new Date("2026-10-01T00:00:00Z"),
    };

    const oeffentlich = toPublicWorkspace(zeile);

    expect(oeffentlich).toEqual({
      ...zeile,
      settings: {
        logo: "<svg/>",
        openrouterModel: "anthropic/claude-sonnet-4",
        reviews_engine_enabled: true,
      },
      hasOpenrouterKey: true,
    });
    expect(JSON.stringify(oeffentlich)).not.toContain(SCHLUESSEL);
  });

  it("kommt mit settings = null zurecht", () => {
    expect(
      toPublicWorkspace({ id: "ws", settings: null as unknown })
    ).toEqual({ id: "ws", settings: {}, hasOpenrouterKey: false });
  });
});

describe("keepStoredSecrets", () => {
  it("behält den Schlüssel, wenn die allgemeinen Einstellungen gespeichert werden", () => {
    // Allgemeine Einstellungen schicken { ...settings, logo } zurück, und
    // settings kam ohne Schlüssel aus GET /api/v1/workspace.
    const eingang = { ...stripSecretSettings(gespeichert), logo: "<svg>neu</svg>" };

    expect(keepStoredSecrets(eingang, gespeichert)).toEqual({
      logo: "<svg>neu</svg>",
      openrouterApiKey: SCHLUESSEL,
      openrouterModel: "anthropic/claude-sonnet-4",
      reviews_engine_enabled: true,
    });
  });

  it("entfernt weiterhin Felder, die der Client weglässt, nur Geheimnisse nicht", () => {
    // Logo entfernen: JSON.stringify lässt logo: undefined weg.
    const eingang = { openrouterModel: "anthropic/claude-sonnet-4" };

    expect(keepStoredSecrets(eingang, gespeichert)).toEqual({
      openrouterApiKey: SCHLUESSEL,
      openrouterModel: "anthropic/claude-sonnet-4",
    });
  });

  it("nimmt ein ausdrücklich mitgeschicktes Geheimnis", () => {
    expect(keepStoredSecrets({ openrouterApiKey: "sk-or-v1-neu" }, gespeichert)).toEqual({
      openrouterApiKey: "sk-or-v1-neu",
    });
    expect(keepStoredSecrets({ openrouterApiKey: null }, gespeichert)).toEqual({
      openrouterApiKey: null,
    });
  });

  it("holt Geheimnisse in verschachtelten Objekten zurück", () => {
    const gespeichertVerschachtelt = {
      integrationen: { mail: { host: "smtp.example.invalid", password: "pw" } },
    };
    const eingang = stripSecretSettings(gespeichertVerschachtelt);

    expect(keepStoredSecrets(eingang, gespeichertVerschachtelt)).toEqual(
      gespeichertVerschachtelt
    );
  });

  it("ändert nichts, wenn noch nichts gespeichert ist", () => {
    expect(keepStoredSecrets({ logo: "<svg/>" }, null)).toEqual({ logo: "<svg/>" });
    expect(keepStoredSecrets({ logo: "<svg/>" }, undefined)).toEqual({ logo: "<svg/>" });
  });

  it("verändert den Eingang nicht", () => {
    const eingang = { logo: "<svg/>" };
    keepStoredSecrets(eingang, gespeichert);
    expect(eingang).toEqual({ logo: "<svg/>" });
  });
});
