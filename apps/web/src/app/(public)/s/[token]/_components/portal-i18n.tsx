"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  DEFAULT_PORTAL_LOCALE,
  PORTAL_LOCALE_COOKIE,
  PORTAL_LOCALE_COOKIE_MAX_AGE,
  createTranslator,
  type PortalLocale,
  type PortalMessageKey,
  type Translator,
} from "@openclaw-crm/customer-portal-core";

/**
 * Portal translation context.
 *
 * The locale is resolved on the server (see page.tsx) and handed down as a
 * prop, so the first paint is already in the right language — no flash of
 * German for an English reader.
 *
 * Switching is optimistic: the UI flips immediately and persistence happens
 * in the background. If the POST fails the cookie still holds the choice, so
 * a reload stays in the chosen language.
 */

interface PortalI18nValue {
  locale: PortalLocale;
  t: Translator;
  setLocale: (next: PortalLocale) => void;
}

const PortalI18nContext = createContext<PortalI18nValue | null>(null);

export function PortalLocaleProvider({
  token,
  initialLocale,
  children,
}: {
  /** Null on screens rendered without a valid link (not-found, revoked). */
  token: string | null;
  initialLocale: PortalLocale;
  children: React.ReactNode;
}) {
  const [locale, setLocaleState] = useState<PortalLocale>(initialLocale);

  // The root layout is shared with the CRM and hard-codes lang="de"; the
  // portal owns its own language, so keep the document in sync for screen
  // readers and browser translation prompts.
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = useCallback(
    (next: PortalLocale) => {
      setLocaleState(next);

      // Written client-side as well as by the route below: if the network is
      // down the choice must still survive a reload.
      try {
        const secure = window.location.protocol === "https:" ? "; Secure" : "";
        document.cookie = `${PORTAL_LOCALE_COOKIE}=${next}; Max-Age=${PORTAL_LOCALE_COOKIE_MAX_AGE}; Path=/; SameSite=Lax${secure}`;
      } catch {
        // Cookies blocked — the in-memory state still applies for this visit.
      }

      if (!token) return;
      void fetch(`/api/public/${token}/locale`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locale: next }),
      }).catch(() => {
        // Persistence is best-effort; the cookie is the fallback.
      });
    },
    [token]
  );

  const value = useMemo<PortalI18nValue>(
    () => ({ locale, t: createTranslator(locale), setLocale }),
    [locale, setLocale]
  );

  return (
    <PortalI18nContext.Provider value={value}>
      {children}
    </PortalI18nContext.Provider>
  );
}

function usePortalI18n(): PortalI18nValue {
  const ctx = useContext(PortalI18nContext);
  if (ctx) return ctx;
  // Components rendered outside the provider (the segment error boundary)
  // still need to render text rather than crash.
  return {
    locale: DEFAULT_PORTAL_LOCALE,
    t: createTranslator(DEFAULT_PORTAL_LOCALE),
    setLocale: () => {},
  };
}

/** Translator for the active locale. */
export function useT(): Translator {
  return usePortalI18n().t;
}

/** Active locale — for date/money formatting helpers. */
export function useLocale(): PortalLocale {
  return usePortalI18n().locale;
}

/** Locale plus the setter behind the DE|EN toggle. */
export function useLocaleSwitch(): {
  locale: PortalLocale;
  setLocale: (next: PortalLocale) => void;
} {
  const { locale, setLocale } = usePortalI18n();
  return { locale, setLocale };
}

/**
 * Renders a message whose `{slot}` placeholder is a React node — a link, or a
 * bold fragment inside a sentence. Keeping the sentence whole in the
 * dictionary means a translator can move the slot wherever the grammar of
 * their language needs it, instead of us gluing fragments together.
 */
export function Slot({
  messageKey,
  slot,
  params,
}: {
  messageKey: PortalMessageKey;
  slot: React.ReactNode;
  params?: Record<string, string | number>;
}) {
  const t = useT();
  const text = t(messageKey, params);
  const index = text.indexOf("{slot}");
  if (index === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, index)}
      {slot}
      {text.slice(index + "{slot}".length)}
    </>
  );
}
