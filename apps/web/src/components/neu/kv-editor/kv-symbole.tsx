/** Kleine Linien-Symbole des KV-Editors (Strich in currentColor, wie die Navigation). */

const svg = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
  width: 18,
  height: 18,
};

/** Verlauf: Uhr mit Pfeil zurück. */
export function SymbolVerlauf() {
  return (
    <svg {...svg}>
      <path d="M3.5 12a8.5 8.5 0 1 0 2.5-6" />
      <path d="M3 4v4h4" />
      <path d="M12 7.5V12l3 2" />
    </svg>
  );
}

/** Sprechblase (KI-Chat). */
export function SymbolSprechblase() {
  return (
    <svg {...svg}>
      <path d="M4 5.5h16v10H10l-4.5 3.5V15.5H4z" />
      <path d="M8.5 10.5h.01M12 10.5h.01M15.5 10.5h.01" strokeWidth={2.4} />
    </svg>
  );
}

/** Stift (Bearbeiten). */
export function SymbolStift() {
  return (
    <svg {...svg}>
      <path d="M4 20h4L19 9l-4-4L4 16z" />
      <path d="M13.5 6.5l4 4" />
    </svg>
  );
}

/** Pfeil nach oben (Pushen). */
export function SymbolPushen() {
  return (
    <svg {...svg}>
      <path d="M12 19V6" />
      <path d="M6.5 11.5L12 6l5.5 5.5" />
      <path d="M5 4h14" />
    </svg>
  );
}

export function SymbolSchliessen() {
  return (
    <svg {...svg} width={16} height={16}>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

export function SymbolSenden() {
  return (
    <svg {...svg} width={16} height={16}>
      <path d="M4 12l16-8-6 16-2.5-6.5z" />
    </svg>
  );
}
