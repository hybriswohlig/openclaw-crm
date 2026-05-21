export function FeatureDisabledNotice({ firmaDisplayName }: { firmaDisplayName: string }) {
  return (
    <main className="mx-auto flex min-h-svh max-w-md flex-col items-center justify-center px-6 text-center">
      <div className="text-5xl">🛠️</div>
      <h1 className="mt-6 text-xl font-medium">Aktuell nicht verfügbar</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        {firmaDisplayName} hat das Status-Portal aktuell deaktiviert. Bitte
        wenden Sie sich für aktuelle Informationen zu Ihrem Umzug direkt an
        Ihren Ansprechpartner.
      </p>
    </main>
  );
}
