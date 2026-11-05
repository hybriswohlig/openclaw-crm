'use client';

import { createContext, useContext, useLayoutEffect } from 'react';
import type { RefObject } from 'react';

export type GlassSceneRegistry = {
  elements: ReadonlySet<HTMLElement>;
  register: (element: HTMLElement) => () => void;
  subscribe: (listener: () => void) => () => void;
};

// The registry exists before any effect runs, because children register in
// their effects and those run before the scene's own effect.
export function createGlassSceneRegistry(): GlassSceneRegistry {
  const elements = new Set<HTMLElement>();
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((listener) => listener());

  return {
    elements,
    register(element) {
      elements.add(element);
      notify();

      return () => {
        elements.delete(element);
        notify();
      };
    },
    subscribe(listener) {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export const GlassSceneContext = createContext<GlassSceneRegistry | null>(null);

/**
 * Lets a glass element hand its material to the nearest GlassScene. Outside a
 * scene it does nothing. It registers before paint, so glass that mounts into
 * a live scene never shows its CSS material first.
 */
export function useGlassScenePane(ref: RefObject<HTMLElement | null>, enabled = true) {
  const registry = useContext(GlassSceneContext);

  useLayoutEffect(() => {
    const element = ref.current;

    if (!registry || !enabled || !element) return;

    return registry.register(element);
  }, [enabled, ref, registry]);
}
