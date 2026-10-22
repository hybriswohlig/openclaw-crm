import { describe, expect, it } from "vitest";
import {
  isSecretSettingKey,
  mergeWorkspaceSettingsUpdate,
  redactWorkspaceSettings,
} from "./workspace-settings";

// workspaces.settings mixes UI settings (logo, model, flags) with the
// OpenRouter API key. GET /api/v1/workspace goes to every member's browser,
// and /settings PATCHes the whole object back — so secrets must be stripped
// on the way out AND preserved on the way in.
describe("isSecretSettingKey", () => {
  it.each(["openrouterApiKey", "smtpPassword", "webhookSecret", "accessToken", "api_key"])(
    "treats %s as secret",
    (key) => {
      expect(isSecretSettingKey(key)).toBe(true);
    }
  );

  it.each(["logo", "openrouterModel", "reviews_engine_enabled", "customDomain", "paypalHandle"])(
    "treats %s as public",
    (key) => {
      expect(isSecretSettingKey(key)).toBe(false);
    }
  );
});

describe("redactWorkspaceSettings", () => {
  it("drops the OpenRouter key and keeps the rest", () => {
    expect(
      redactWorkspaceSettings({
        openrouterApiKey: "sk-or-1",
        openrouterModel: "m",
        logo: "<svg/>",
        reviews_engine_enabled: false,
      })
    ).toEqual({ openrouterModel: "m", logo: "<svg/>", reviews_engine_enabled: false });
  });

  it("returns an empty object for non-object settings", () => {
    expect(redactWorkspaceSettings(null)).toEqual({});
    expect(redactWorkspaceSettings("x")).toEqual({});
    expect(redactWorkspaceSettings([1])).toEqual({});
  });
});

describe("mergeWorkspaceSettingsUpdate", () => {
  it("keeps stored secrets when the client omits them", () => {
    expect(
      mergeWorkspaceSettingsUpdate({ openrouterApiKey: "sk-1", logo: "a" }, { logo: "b" })
    ).toEqual({ logo: "b", openrouterApiKey: "sk-1" });
  });

  it("does not let the client overwrite a stored secret", () => {
    expect(
      mergeWorkspaceSettingsUpdate({ openrouterApiKey: "sk-1" }, { openrouterApiKey: "evil" })
    ).toEqual({ openrouterApiKey: "sk-1" });
  });

  it("does not let the client add a secret", () => {
    expect(mergeWorkspaceSettingsUpdate({}, { openrouterApiKey: "x", logo: "b" })).toEqual({
      logo: "b",
    });
  });
});
