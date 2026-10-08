/**
 * Lagekarte: Telefonnummer für einen `tel:`-Link. Eine Regel für Liste und
 * Panel: nur Ziffern und ein führendes „+“; die eingeklammerte Null nach der
 * Landesvorwahl („+49 (0) 7031 …“) fällt weg, weil sie mit „+“ nicht gewählt
 * werden darf. Ohne Ziffern: null (dann keinen Link zeigen).
 */
export function telefonFuerLink(nummer: string): string | null {
  const text = nummer.trim().replace(/\(\s*0\s*\)/g, "");
  const ziffern = text.replace(/\D/g, "");
  if (!ziffern) return null;
  return text.startsWith("+") ? `+${ziffern}` : ziffern;
}
