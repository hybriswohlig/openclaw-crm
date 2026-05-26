// Quiet-hours window for the post-move reviews engine ([KOT-622] / [KOT-603]).
//
// Window per spec §3: send only on Mon-Sat, 09:00-19:00 Europe/Berlin.
// Returns true if `now` falls OUTSIDE the send window (i.e. we must stay
// quiet). Sundays are always quiet. Hours outside [9, 19) Berlin local
// time are quiet. Time-zone handling uses Intl rather than a tz library
// because Node's ICU already has Europe/Berlin DST data and we ship on
// Vercel's Node runtime.
//
// Extracted from the cron route ([KOT-624]) so vitest can cover it
// without spinning up Next.js. The route file imports this module.
export function isQuietHoursBerlin(now: Date): boolean {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Berlin",
    weekday: "short",
    hour: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(now);
  const weekday = parts.find((p) => p.type === "weekday")?.value;
  const hour = Number(parts.find((p) => p.type === "hour")?.value);
  if (weekday === "Sun") return true;
  if (Number.isNaN(hour)) return true;
  return hour < 9 || hour >= 19;
}
