'use client';

import { useEffect, useRef } from 'react';
import { useHold } from './use-hold';

/**
 * The lime pill you press and hold to countersign. Letting go early drains it; `onEarly` says so.
 * Mount a fresh one (a new `key`) for each signature: a finished hold stays full.
 */
export function HoldButton(props: { ms?: number; label?: string; disabled?: boolean; onStart?: () => void; onEarly?: () => void; onDone: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  const hold = useHold({ ms: props.ms ?? 1400, onProgress: (p) => ref.current?.style.setProperty('--p', p.toFixed(3)), onDone: props.onDone });

  // The knob rides the fill, so it needs the button's width.
  useEffect(() => {
    const b = ref.current;
    if (!b) return;
    const set = () => b.style.setProperty('--w', `${b.offsetWidth}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(b);
    return () => ro.disconnect();
  }, []);

  const start = () => {
    hold.start();
    props.onStart?.();
  };
  const end = () => {
    if (hold.end()) props.onEarly?.();
  };
  return (
    <button
      ref={ref}
      type="button"
      className="hold"
      disabled={props.disabled}
      onPointerDown={(e) => {
        e.preventDefault();
        start();
      }}
      onPointerUp={end}
      onPointerLeave={() => hold.end()}
      onPointerCancel={() => hold.end()}
      onKeyDown={(e) => {
        if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) {
          e.preventDefault();
          start();
        }
      }}
      onKeyUp={end}
    >
      <span className="knob" aria-hidden="true">
        ✓
      </span>
      <span className="lbl">{props.label ?? 'Hold to countersign'}</span>
    </button>
  );
}
