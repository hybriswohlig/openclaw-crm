"use client";

import { PORTAL_LOCALES, type PortalLocale } from "@openclaw-crm/customer-portal-core";
import { useLocaleSwitch, useT } from "./portal-i18n";

/**
 * DE | EN segmented control in the portal header.
 *
 * Small and quiet by design: the overwhelming majority of customers are
 * German and the page already opens in their language, so this is an escape
 * hatch, not a decision the page asks everyone to make.
 */
export function LanguageToggle({ primaryColor }: { primaryColor: string }) {
  const { locale, setLocale } = useLocaleSwitch();
  const t = useT();
  const accent = `#${primaryColor}`;

  return (
    <div
      role="group"
      aria-label={t("header.languageLabel")}
      className="inline-flex shrink-0 items-center rounded-full border border-border/60 bg-card/70 p-0.5 backdrop-blur"
    >
      {PORTAL_LOCALES.map((code) => {
        const isActive = code === locale;
        return (
          <button
            key={code}
            type="button"
            onClick={() => setLocale(code)}
            aria-pressed={isActive}
            lang={code}
            title={labelFor(code, t)}
            className={
              "min-w-11 rounded-full px-2.5 py-1.5 text-[11px] font-medium uppercase tracking-wider transition-colors " +
              (isActive
                ? "text-white"
                : "text-muted-foreground hover:text-foreground")
            }
            style={isActive ? { background: accent } : undefined}
          >
            {code.toUpperCase()}
            <span className="sr-only"> — {labelFor(code, t)}</span>
          </button>
        );
      })}
    </div>
  );
}

function labelFor(
  code: PortalLocale,
  t: ReturnType<typeof useT>
): string {
  return code === "de" ? t("header.languageDe") : t("header.languageEn");
}
