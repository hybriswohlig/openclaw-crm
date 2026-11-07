import { NextRequest } from "next/server";
import { badRequest, getAuthContext, success, unauthorized } from "@/lib/api-utils";
import { uiCookieSetzen } from "@/lib/ui-cookie";
import { normalizeUiVersion } from "@/lib/ui-version";
import { getUserSettings, setUiVersion } from "@/services/user-settings";

const UI_VERSION_FEHLER = "uiVersion muss 'alt' oder 'neu' sein";

export async function GET(req: NextRequest) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized(req);

  const settings = await getUserSettings(ctx.userId);
  return success({ uiVersion: settings.uiVersion, ansichten: settings.ansichten });
}

export async function PATCH(req: NextRequest) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized(req);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest(UI_VERSION_FEHLER);
  }

  const raw =
    body && typeof body === "object" && "uiVersion" in body
      ? (body as { uiVersion: unknown }).uiVersion
      : undefined;
  const uiVersion = normalizeUiVersion(raw);
  if (!uiVersion) return badRequest(UI_VERSION_FEHLER);

  await setUiVersion(ctx.userId, uiVersion);
  return uiCookieSetzen(success({ uiVersion }), uiVersion);
}
