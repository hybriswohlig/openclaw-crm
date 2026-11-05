import type { Ref } from 'react';

export function mergeRefs<T>(...refs: Array<Ref<T> | undefined>) {
  return (node: T) => {
    for (const ref of refs) {
      if (!ref) continue;

      if ('current' in ref) {
        try {
          ref.current = node;
        } catch {
          // Read-only refs cannot be assigned.
        }
      } else {
        ref(node);
      }
    }
  };
}
