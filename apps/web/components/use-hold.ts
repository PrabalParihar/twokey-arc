'use client';

import { useRef } from 'react';

/**
 * Press-and-hold progress for a countersignature. Holding fills 0 → 1 over `ms`; letting go early drains it.
 * `onProgress` runs every frame (draw with it, not with state), `onDone` once when it reaches 1.
 */
export function useHold({ ms, onProgress, onDone }: { ms: number; onProgress: (p: number) => void; onDone: () => void }) {
  const h = useRef({ p: 0, holding: false, last: 0, raf: 0, doneAt: 0 });
  const cb = useRef({ onProgress, onDone });
  cb.current = { onProgress, onDone };

  function tick(now: number) {
    const s = h.current;
    const dt = now - s.last;
    s.last = now;
    s.p = Math.max(0, Math.min(1, s.p + (s.holding ? dt / ms : -dt / 400)));
    cb.current.onProgress(s.p);
    if (s.p >= 1) {
      s.holding = false;
      s.doneAt = performance.now();
      cb.current.onDone();
      return;
    }
    if (s.holding || s.p > 0) s.raf = requestAnimationFrame(tick);
  }

  return {
    start() {
      const s = h.current;
      s.holding = true;
      s.last = performance.now();
      cancelAnimationFrame(s.raf);
      s.raf = requestAnimationFrame(tick);
    },
    /** Returns true when the hold was let go before it completed. */
    end(): boolean {
      const s = h.current;
      const early = s.holding && s.p < 1;
      s.holding = false;
      return early;
    },
    reset() {
      cancelAnimationFrame(h.current.raf);
      h.current.p = 0;
      h.current.holding = false;
      cb.current.onProgress(0);
    },
    /** The finger that finished a signature is often still down; its release shouldn't count as a click. */
    justDone: (within = 600) => performance.now() - h.current.doneAt < within,
    progress: () => h.current.p,
  };
}
