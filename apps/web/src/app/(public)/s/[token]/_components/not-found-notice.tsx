export function NotFoundNotice() {
  return (
    <main className="mx-auto flex min-h-svh max-w-md flex-col items-center justify-center px-6 text-center">
      <div className="text-5xl">🔍</div>
      <h1 className="mt-6 text-xl font-medium">Link nicht gefunden</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        Dieser Status-Link ist ungültig. Bitte überprüfen Sie die URL oder
        wenden Sie sich an Ihren Ansprechpartner.
      </p>
    </main>
  );
}
