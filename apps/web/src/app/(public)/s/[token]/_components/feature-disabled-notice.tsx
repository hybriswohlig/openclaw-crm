"use client";

import { WhatsAppContactLink } from "./whatsapp-contact-link";
import { useT } from "./portal-i18n";

export function FeatureDisabledNotice({
  whatsappNumberE164 = null,
}: {
  whatsappNumberE164?: string | null;
}) {
  const t = useT();
  return (
    <main className="mx-auto flex min-h-svh max-w-md flex-col items-center justify-center px-6 text-center">
      <div className="text-5xl">🛠️</div>
      <h1 className="mt-6 text-xl font-medium">{t("notices.disabledTitle")}</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        {t("notices.disabledBody")}
      </p>
      <WhatsAppContactLink
        phoneE164={whatsappNumberE164}
        label={t("notices.waQuestions")}
        className="mt-5 inline-flex min-h-11 items-center gap-1.5 text-sm font-medium underline underline-offset-4"
      />
    </main>
  );
}
