export function RevokedNotice({ firmaDisplayName }: { firmaDisplayName: string }) {
  return (
    <main className="mx-auto flex min-h-svh max-w-md flex-col items-center justify-center px-6 text-center">
      <div className="text-5xl">🔒</div>
      <h1 className="mt-6 text-xl font-medium">Link nicht mehr verfügbar</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        Dieser Status-Link wurde geschlossen oder ist abgelaufen.
        Bitte kontaktieren Sie {firmaDisplayName}, falls Sie weiterhin
        Informationen zu Ihrem Umzug benötigen.
      </p>
    </main>
  );
}
