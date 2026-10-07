"use client";
/**
 * Hell/Dunkel für alle Lagekarte-Teile. Der Container (lagekarte.tsx) setzt
 * den Wert aus next-themes; Teile lesen ihn mit useLagekarteThema().
 */
import { createContext, useContext } from "react";
import type { Thema } from "@/lib/lagekarte/farben";

export const ThemaKontext = createContext<Thema>("hell");

export function useLagekarteThema(): Thema {
  return useContext(ThemaKontext);
}
