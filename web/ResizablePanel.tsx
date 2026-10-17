import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent, PointerEvent, ReactNode } from 'react';
import { useT } from './i18n';
import { PANELS_RESET } from './settings';

interface ResizablePanelProps {
  id: string;
  label: string;
  className: string;
  as?: 'aside' | 'section';
  edge: 'left' | 'right' | 'top' | 'bottom';
  minSize: number;
  flexiblePanel?: string;
  children: ReactNode;
}

export function ResizablePanel({ id, label, className, as: Tag = 'section', edge, minSize, flexiblePanel, children }: ResizablePanelProps) {
  const t = useT();
  const dimension = edge === 'left' || edge === 'right' ? 'width' : 'height';
  const direction = edge === 'left' || edge === 'top' ? -1 : 1;
  const storageKey = `pixelator.panel.${id}`;
  const panelRef = useRef<HTMLElement>(null);
  const handleRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ pointerId: number; start: number; size: number; moved: boolean } | null>(null);
  const [resizing, setResizing] = useState(false);
  const [preferredSize, setPreferredSize] = useState<number | null>(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      const size = saved === null ? NaN : Number(saved);
      return Number.isFinite(size) && size >= minSize ? size : null;
    } catch { return null; }
  });
  const [bounds, setBounds] = useState({ size: minSize, max: Number.MAX_SAFE_INTEGER });
  useEffect(() => {
    const reset = () => setPreferredSize(null);
    window.addEventListener(PANELS_RESET, reset); return () => window.removeEventListener(PANELS_RESET, reset);
  }, []);

  const measure = useCallback(() => {
    const panel = panelRef.current;
    const parent = panel?.parentElement;
    if (!panel || !parent || !panel.getClientRects().length || window.matchMedia('(max-width:650px)').matches) return;
    const flexible = flexiblePanel ? parent.querySelector<HTMLElement>(flexiblePanel) : null;
    let available = dimension === 'width' ? parent.clientWidth : parent.clientHeight;
    if (flexible) {
      for (const sibling of parent.children) {
        if (sibling !== panel && sibling !== flexible) available -= sibling.getBoundingClientRect()[dimension];
      }
      const style = getComputedStyle(flexible);
      available -= parseFloat(dimension === 'width' ? style.minWidth : style.minHeight) || 0;
    }
    const size = Math.round(panel.getBoundingClientRect()[dimension]);
    const max = Math.max(minSize, Math.floor(available));
    setBounds(previous => previous.size === size && previous.max === max ? previous : { size, max });
  }, [dimension, flexiblePanel, minSize]);

  useLayoutEffect(measure);
  useLayoutEffect(() => {
    const panel = panelRef.current;
    const parent = panel?.parentElement;
    if (!panel || !parent) return;
    const observer = new ResizeObserver(measure);
    observer.observe(parent);
    for (const child of parent.children) observer.observe(child);
    return () => observer.disconnect();
  }, [measure]);
  useEffect(() => {
    if (resizing) return;
    try {
      if (preferredSize === null) localStorage.removeItem(storageKey);
      else localStorage.setItem(storageKey, String(preferredSize));
    } catch { /* Resizing also works when browser storage is unavailable. */ }
  }, [preferredSize, resizing, storageKey]);
  useEffect(() => {
    const stop = () => {
      const current = drag.current;
      drag.current = null;
      setResizing(false);
      if (current && handleRef.current?.hasPointerCapture(current.pointerId)) handleRef.current.releasePointerCapture(current.pointerId);
    };
    window.addEventListener('blur', stop);
    return () => window.removeEventListener('blur', stop);
  }, []);

  const resize = (size: number) => setPreferredSize(Math.max(minSize, Math.min(bounds.max, Math.round(size))));
  const position = (event: PointerEvent) => dimension === 'width' ? event.clientX : event.clientY;
  const start = (event: PointerEvent<HTMLDivElement>) => {
    if (!event.isPrimary || event.button !== 0 || !panelRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    drag.current = { pointerId: event.pointerId, start: position(event), size: panelRef.current.getBoundingClientRect()[dimension], moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.focus({ preventScroll: true });
    setResizing(true);
  };
  const move = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (current?.pointerId !== event.pointerId) return;
    const delta = position(event) - current.start;
    if (!current.moved && delta === 0) return;
    current.moved = true;
    resize(current.size + delta * direction);
  };
  const stop = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null;
    setResizing(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const keydown = (event: KeyboardEvent<HTMLDivElement>) => {
    event.stopPropagation();
    const decrease = dimension === 'width' ? 'ArrowLeft' : 'ArrowUp';
    const increase = dimension === 'width' ? 'ArrowRight' : 'ArrowDown';
    if (event.key === decrease || event.key === increase) {
      event.preventDefault();
      resize(bounds.size + (event.key === increase ? 1 : -1) * direction * (event.shiftKey ? 40 : 10));
    } else if (event.key === 'Home' || event.key === 'End' || event.key === 'Enter') {
      event.preventDefault();
      if (event.key === 'Enter') setPreferredSize(null);
      else resize(event.key === 'Home' ? minSize : bounds.max);
    }
  };

  return <Tag id={id} ref={panelRef} className={`resizable-panel ${className}${preferredSize === null ? '' : ' has-panel-size'}`} aria-label={label} style={preferredSize === null ? undefined : { [dimension]: flexiblePanel ? preferredSize : Math.min(preferredSize, bounds.max) } as CSSProperties}>
    <div className="panel-content">{children}</div>
    <div ref={handleRef} className={`panel-resizer panel-resizer-${edge}${resizing ? ' is-resizing' : ''}`} role="separator" tabIndex={0} aria-label={t('{panel}: Größe ändern', { panel: label })} aria-controls={id} aria-orientation={dimension === 'width' ? 'vertical' : 'horizontal'} aria-valuemin={minSize} aria-valuemax={bounds.max} aria-valuenow={bounds.size} aria-valuetext={`${bounds.size} Pixel`} title={t('Ziehen zum Vergrößern oder Verkleinern · Doppelklick zum Zurücksetzen')} onPointerDown={start} onPointerMove={move} onPointerUp={event => { move(event); stop(event); }} onPointerCancel={stop} onLostPointerCapture={stop} onDoubleClick={() => setPreferredSize(null)} onKeyDown={keydown}/>
  </Tag>;
}
