import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import type { Project, ProjectOverview } from '../src/types';
import { Icon, IconButton } from './icons';

const changedAt = (iso: string) => {
  const date = new Date(iso); const today = new Date(); const yesterday = new Date(); yesterday.setDate(today.getDate() - 1);
  const time = date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  if (date.toDateString() === today.toDateString()) return `Heute, ${time}`;
  if (date.toDateString() === yesterday.toDateString()) return `Gestern, ${time}`;
  return date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

/** Project switcher: cards with a preview of the latest assets, the style palette and recent activity. */
export function ProjectBrowser({ projects, currentId, busy, onSelect, onCreate, onImport, onClose }: {
  projects: Project[]; currentId: string; busy: boolean;
  onSelect: (id: string) => void; onCreate: () => void; onImport: () => void; onClose: () => void;
}) {
  const [overview, setOverview] = useState<ProjectOverview[] | null>(null); const [error, setError] = useState(''); const [query, setQuery] = useState('');
  const gridRef = useRef<HTMLDivElement>(null);
  // Reload when the editor's project list changes, e.g. after an import or a change by an agent.
  useEffect(() => {
    let cancelled = false;
    fetch('/api/projects/overview').then(async response => { if (!response.ok) throw new Error(); return response.json() as Promise<ProjectOverview[]>; })
      .then(list => { if (!cancelled) { setOverview(list); setError(''); } })
      .catch(() => { if (!cancelled) setError('Die Projektübersicht konnte nicht geladen werden.'); });
    return () => { cancelled = true; };
  }, [projects]);
  const shown = useMemo(() => {
    const words = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
    return (overview ?? []).filter(item => words.every(word => `${item.name} ${item.style.preset}`.toLocaleLowerCase().includes(word))).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }, [overview, query]);
  // Arrow keys move between cards row by row, like a file browser.
  const navigate = (event: KeyboardEvent<HTMLDivElement>) => {
    const cards = [...(gridRef.current?.querySelectorAll<HTMLButtonElement>('.project-card') ?? [])]; const index = cards.indexOf(window.document.activeElement as HTMLButtonElement);
    if (index < 0 || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    const columns = Math.max(1, cards.filter(card => card.offsetTop === cards[0].offsetTop).length);
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -columns, ArrowDown: columns }[event.key]!;
    const next = cards[Math.max(0, Math.min(cards.length - 1, index + step))];
    event.preventDefault(); next.focus();
  };
  return <>
    <div className="projects-heading"><div><h2 id="projects-title">Projekte</h2><p>{overview ? `${overview.length} ${overview.length === 1 ? 'Projekt' : 'Projekte'}` : 'Wird geladen …'}</p></div><IconButton icon="close" label="Projektfenster schließen" onClick={onClose}/></div>
    <div className="projects-toolbar">
      <label className="search-field"><Icon name="search" size={16}/><input autoFocus placeholder="Projekte durchsuchen …" aria-label="Projekte durchsuchen" value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'ArrowDown') { event.preventDefault(); gridRef.current?.querySelector<HTMLButtonElement>('.project-card')?.focus(); } if (event.key === 'Enter' && shown[0] && !busy) { event.preventDefault(); onSelect(shown[0].id); } }}/></label>
      <button className="button" onClick={onImport} disabled={busy}><Icon name="import" size={15}/> Importieren</button>
      <button className="button primary" onClick={onCreate} disabled={busy}><Icon name="plus" size={16}/> Neues Projekt</button>
    </div>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div ref={gridRef} className="project-grid" role="list" onKeyDown={navigate}>
      {!overview && !error && Array.from({ length: Math.min(6, Math.max(1, projects.length)) }, (_, i) => <div key={i} className="project-card skeleton" aria-hidden="true"><span className="project-preview"/><span/><span/></div>)}
      {overview && !shown.length && <p className="projects-empty">{query ? `Kein Projekt passt zu „${query}“.` : 'Noch keine Projekte. Lege eines an oder importiere eine Projektdatei.'}</p>}
      {shown.map(item => {
        const current = item.id === currentId;
        return <div role="listitem" key={item.id}><button className={`project-card${current ? ' current' : ''}`} disabled={busy} aria-current={current || undefined} onClick={() => onSelect(item.id)}>
          <span className={`project-preview checker count-${Math.min(item.previews.length, 4)}`}>
            {item.previews.length ? item.previews.map(asset => <img key={asset.id} src={`/api/assets/${asset.id}/thumbnail?revisionId=${asset.headRevisionId}`} alt={asset.name} title={asset.name} loading="lazy" decoding="async"/>) : <span className="project-preview-empty"><Icon name="layers" size={26}/>Noch keine Assets</span>}
            {current && <span className="project-current">Geöffnet</span>}
          </span>
          <span className="project-card-body">
            <strong>{item.name}</strong>
            <span className="project-meta"><span className="preset-badge">{item.style.preset}</span><span>{item.assetCount} {item.assetCount === 1 ? 'Asset' : 'Assets'}</span><i/><span className="project-changed" title={new Date(item.updatedAt).toLocaleString('de-DE')}>{changedAt(item.updatedAt)}</span></span>
            <span className="project-palette" aria-label={`Palette mit ${item.style.palette.length - 1} Farben`}>{item.style.palette.slice(1, 17).map((color, i) => <span key={i} style={{ background: color }}/>)}</span>
          </span>
        </button></div>;
      })}
    </div>
  </>;
}
