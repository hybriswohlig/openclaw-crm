"use client";

import { useT } from "./portal-i18n";

export function NotFoundNotice() {
  const t = useT();
  return (
    <main className="mx-auto flex min-h-svh max-w-md flex-col items-center justify-center px-6 text-center">
      <div className="text-5xl">🔍</div>
      <h1 className="mt-6 text-xl font-medium">{t("notices.notFoundTitle")}</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        {t("notices.notFoundBody")}
      </p>
      <p className="mt-2 text-sm text-muted-foreground">
        {t("notices.notFoundHint")}
      </p>
    </main>
  );
}
