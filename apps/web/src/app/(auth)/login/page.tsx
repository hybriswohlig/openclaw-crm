"use client";

import { Suspense, useState, type SVGProps } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn } from "@/lib/auth-client";
import { trackEvent } from "@/lib/analytics";
import styles from "./login.module.css";

const Icon = {
  Mail: (p: SVGProps<SVGSVGElement>) => (
    <svg {...p} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3 7 9 6 9-6" />
    </svg>
  ),
  Lock: (p: SVGProps<SVGSVGElement>) => (
    <svg {...p} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  ),
  Eye: (p: SVGProps<SVGSVGElement>) => (
    <svg {...p} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  ),
  EyeOff: (p: SVGProps<SVGSVGElement>) => (
    <svg {...p} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.94 17.94A10.1 10.1 0 0 1 12 19c-6.5 0-10-7-10-7a17.3 17.3 0 0 1 4.06-4.94" />
      <path d="M9.88 4.24A10.8 10.8 0 0 1 12 4c6.5 0 10 7 10 7a17.4 17.4 0 0 1-3.17 4.19" />
      <line x1="2" y1="2" x2="22" y2="22" />
    </svg>
  ),
  Arrow: (p: SVGProps<SVGSVGElement>) => (
    <svg {...p} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="12 5 19 12 12 19" />
    </svg>
  ),
  Check: (p: SVGProps<SVGSVGElement>) => (
    <svg {...p} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  ),
  Pin: (p: SVGProps<SVGSVGElement>) => (
    <svg {...p} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z" />
      <circle cx="12" cy="10" r="2.5" />
    </svg>
  ),
};

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get("redirect") || "/home";
  const registered = searchParams.get("registered");
  const reason = searchParams.get("reason");

  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [remember, setRemember] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setPending(true);
    try {
      const result = await signIn.email({ email, password: pw });
      if (result.error) {
        setError(result.error.message || "E-Mail oder Passwort ungültig");
      } else {
        trackEvent("login_completed");
        router.push(redirectTo);
      }
    } catch {
      setError("Etwas ist schiefgelaufen. Bitte erneut versuchen.");
    } finally {
      setPending(false);
    }
  }

  const today = new Date().toLocaleDateString("de-DE", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  const year = new Date().getFullYear();

  return (
    <div className={styles.app}>
      <header className={styles.topbar}>
        <span className={styles.wordmark}>
          <span className={styles.dot} />
          <span>
            Kottke <span className={styles.wordmarkSub}>Umzüge</span>
          </span>
        </span>
        <span className={styles.topbarMeta}>
          <span className={styles.pulse} />
          <span>System aktiv · v1.3.3</span>
        </span>
      </header>

      <main className={styles.stage}>
        <section className={styles.brandside}>
          <div>
            <div className={`${styles.kicker} ${styles.fu} ${styles.fu1}`}>
              <span className={styles.rule} />
              <span>Interner Zugang · Team</span>
            </div>
            <h1 className={`${styles.headline} ${styles.fu} ${styles.fu2}`}>
              Willkommen
              <br />
              zurück, <em>Crew.</em>
            </h1>
            <p className={`${styles.sub} ${styles.fu} ${styles.fu3}`}>
              Ein Werkzeug für die, die es bedienen. Angebote, Aufträge, Touren,
              Rechnungen und das alles an einem Ort, gemacht für Tijara.
            </p>
          </div>

          <div className={`${styles.crew} ${styles.fu} ${styles.fu4}`}>
            <div className={styles.avatars}>
              <span className={`${styles.avatar} ${styles.a1}`}>M</span>
              <span className={`${styles.avatar} ${styles.a2}`}>J</span>
              <span className={`${styles.avatar} ${styles.a3}`}>K</span>
            </div>
            <div className={styles.crewText}>
              <b>3 aktive Nutzer</b>
              <br />
              <span className={styles.crewMuted}>
                zuletzt online vor 4 Minuten
              </span>
            </div>
          </div>
        </section>

        <div className={styles.cardwrap}>
          <form
            className={`${styles.card} ${styles.fu} ${styles.fu2}`}
            onSubmit={onSubmit}
          >
            <span className={styles.tape} aria-hidden />

            <h2 className={styles.cardTitle}>Anmelden</h2>
            <p className={styles.lede}>
              Melde dich mit deiner Team-E-Mail an. Nur eingeladene Nutzer haben
              Zugriff.
            </p>

            {registered === "pending" && (
              <div className={styles.notice}>
                Konto erstellt. Ein Administrator muss dein Konto freischalten,
                bevor du das CRM nutzen kannst.
              </div>
            )}
            {reason === "rejected" && (
              <div className={styles.errorBox}>
                Deine Registrierung wurde nicht genehmigt. Bitte wende dich an
                einen Administrator.
              </div>
            )}
            {error && <div className={styles.errorBox}>{error}</div>}

            <div className={styles.field}>
              <label htmlFor="email" className={styles.fieldLabel}>
                E-Mail
              </label>
              <div className={styles.inputWrap}>
                <Icon.Mail className={styles.inputIcon} />
                <input
                  id="email"
                  type="email"
                  className={styles.input}
                  placeholder="du@kottke-umzuege.de"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
            </div>

            <div className={styles.field}>
              <label htmlFor="pw" className={styles.fieldLabel}>
                <span>Passwort</span>
                <span className={styles.hint}>
                  <a href="#">Vergessen?</a>
                </span>
              </label>
              <div className={styles.inputWrap}>
                <Icon.Lock className={styles.inputIcon} />
                <input
                  id="pw"
                  type={showPw ? "text" : "password"}
                  className={styles.input}
                  placeholder="••••••••"
                  autoComplete="current-password"
                  value={pw}
                  onChange={(e) => setPw(e.target.value)}
                  required
                />
                <button
                  type="button"
                  className={styles.reveal}
                  aria-label={showPw ? "Passwort verbergen" : "Passwort zeigen"}
                  onClick={() => setShowPw((s) => !s)}
                >
                  {showPw ? (
                    <Icon.EyeOff width="16" height="16" />
                  ) : (
                    <Icon.Eye width="16" height="16" />
                  )}
                </button>
              </div>
            </div>

            <div className={styles.row}>
              <label className={styles.remember}>
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={(e) => setRemember(e.target.checked)}
                />
                <span className={styles.box}>
                  <Icon.Check />
                </span>
                <span>Angemeldet bleiben</span>
              </label>
            </div>

            <button type="submit" className={styles.submit} disabled={pending}>
              {pending ? (
                <span>Anmeldung läuft…</span>
              ) : (
                <>
                  <span>Ins Büro</span>
                  <Icon.Arrow className={styles.arrow} width="16" height="16" />
                </>
              )}
            </button>

            <p className={styles.footerNote}>
              Kein Konto? Nur Teamleitung kann neue Nutzer einladen.
            </p>
          </form>
        </div>
      </main>

      <footer className={styles.bottom}>
        <span className={styles.loc}>
          <Icon.Pin width="12" height="12" />
          <span>Zentrale · Marktstr. 12</span>
        </span>
        <span>{today}</span>
        <span>© {year} Kottke Umzüge</span>
      </footer>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
