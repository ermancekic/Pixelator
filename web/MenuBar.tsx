import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { Icon } from './icons';

export type MenuEntry = { label: string; shortcut?: string; disabled?: boolean; checked?: boolean; action: () => void } | 'separator';
export interface Menu { id: string; label: string; items: MenuEntry[] }

/** An application menu bar like a desktop editor's: click opens, hover switches while open, arrow keys move, Escape closes. */
export function MenuBar({ menus, label }: { menus: Menu[]; label: string }) {
  const [open, setOpen] = useState<number | null>(null);
  const barRef = useRef<HTMLDivElement>(null); const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  useEffect(() => {
    if (open === null) return;
    const close = (event: PointerEvent) => { if (!barRef.current?.contains(event.target as Node)) setOpen(null); };
    const blur = () => setOpen(null);
    window.addEventListener('pointerdown', close); window.addEventListener('blur', blur);
    return () => { window.removeEventListener('pointerdown', close); window.removeEventListener('blur', blur); };
  }, [open]);
  const items = (index: number) => [...(barRef.current?.querySelectorAll<HTMLButtonElement>(`[data-menu="${index}"] .menu-popup button:not(:disabled)`) ?? [])];
  const show = (index: number, focus: 'first' | 'last' | 'none' = 'none') => {
    const next = (index + menus.length) % menus.length; setOpen(next);
    if (focus !== 'none') requestAnimationFrame(() => { const list = items(next); (focus === 'first' ? list[0] : list.at(-1))?.focus(); });
    else buttons.current[next]?.focus();
  };
  const run = (entry: Exclude<MenuEntry, 'separator'>) => { setOpen(null); buttons.current[open ?? 0]?.blur(); entry.action(); };
  const keydown = (event: KeyboardEvent<HTMLDivElement>) => {
    const inMenu = !!(event.target as HTMLElement).closest('.menu-popup');
    const index = open ?? buttons.current.indexOf(event.target as HTMLButtonElement);
    if (index < 0) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpen(null); buttons.current[index]?.focus(); return; }
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') { event.preventDefault(); show(index + (event.key === 'ArrowRight' ? 1 : -1), open === null ? 'none' : 'first'); return; }
    if (!inMenu && (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); show(index, 'first'); return; }
    if (!inMenu && event.key === 'ArrowUp') { event.preventDefault(); show(index, 'last'); return; }
    if (inMenu && (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Home' || event.key === 'End')) {
      event.preventDefault(); const list = items(index); const at = list.indexOf(event.target as HTMLButtonElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? list.length - 1 : (at + (event.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length;
      list[next]?.focus();
    }
  };
  return <div ref={barRef} className="menu-bar" role="menubar" aria-label={label} onKeyDown={keydown}>
    {menus.map((menu, index) => <div key={menu.id} className="menu" data-menu={index}>
      <button ref={element => { buttons.current[index] = element; }} className={`menu-title${open === index ? ' open' : ''}`} role="menuitem" aria-haspopup="menu" aria-expanded={open === index}
        onPointerDown={event => { if (event.button === 0) { event.preventDefault(); if (open === index) setOpen(null); else show(index); } }} onPointerEnter={() => { if (open !== null && open !== index) show(index); }}
        onClick={event => { if (event.detail === 0) show(index, 'first'); }}>{menu.label}</button>
      {open === index && <div className="menu-popup" role="menu" aria-label={menu.label}>{menu.items.map((entry, i) => entry === 'separator'
        ? <div key={i} className="menu-separator" role="separator"/>
        : <button key={i} className="menu-item" role={entry.checked === undefined ? 'menuitem' : 'menuitemcheckbox'} aria-checked={entry.checked} aria-label={entry.label} disabled={entry.disabled} tabIndex={-1} onClick={() => run(entry)}>
          <span className="menu-check">{entry.checked && <Icon name="check" size={14}/>}</span><span>{entry.label}</span>{entry.shortcut && <kbd aria-hidden="true">{entry.shortcut}</kbd>}
        </button>)}</div>}
    </div>)}
  </div>;
}
