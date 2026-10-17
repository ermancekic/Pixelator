import { useState } from 'react';
import type { CSSProperties } from 'react';
import { Miniature } from './AssetPreview';
import { ResizablePanel } from './ResizablePanel';
import { tagHue, tagLanes, totalDuration } from './animation-helpers';
import type { LoopMode, OnionSettings } from './animation-helpers';
import { msg, useT } from './i18n';
import { Icon, IconButton } from './icons';
import type { AnimationTag, AnimationTagInput, PixelDocument, TagDirection } from '../src/types';

const CELL = 54;
const loopLabels: Record<LoopMode, string> = { once: msg('Einmal'), cycle: msg('Schleife'), pingpong: 'Ping-Pong' };
const directionLabels: Record<TagDirection, string> = { forward: msg('Vorwärts'), reverse: msg('Rückwärts'), pingpong: 'Ping-Pong' };

export interface TimelineProps {
  doc: PixelDocument; frameId: string; playingFrameId: string | null; editable: boolean;
  loop: LoopMode; onlyTag: boolean; onion: OnionSettings;
  onSelect: (frameId: string) => void; onTogglePlay: () => void; onLoop: (loop: LoopMode) => void; onOnlyTag: (value: boolean) => void; onOnion: (onion: OnionSettings) => void;
  onAdd: () => void; onDuplicate: () => void; onRemove: () => void; onMove: (delta: -1 | 1) => void; onDuration: (durationMs: number) => void; onEditTags: () => void;
}

/** Frame strip with tag lanes, playback controls and frame commands; all edits go through the callbacks. */
export function Timeline({ doc, frameId, playingFrameId, editable, loop, onlyTag, onion, onSelect, onTogglePlay, onLoop, onOnlyTag, onOnion, onAdd, onDuplicate, onRemove, onMove, onDuration, onEditTags }: TimelineProps) {
  const t = useT();
  const index = Math.max(0, doc.frames.findIndex(frame => frame.id === frameId));
  const frame = doc.frames[index];
  const lanes = tagLanes(doc.tags); const laneCount = Math.max(0, ...lanes.map(item => item.lane + 1));
  const grid = { gridTemplateColumns: `repeat(${doc.frames.length}, ${CELL}px)` } as CSSProperties;
  const commitDuration = (value: string) => { const durationMs = Number(value); if (Number.isInteger(durationMs) && durationMs >= 10 && durationMs <= 60000 && durationMs !== frame.durationMs) onDuration(durationMs); };
  return <ResizablePanel id="timeline" label={t('Animationsleiste')} className="timeline" edge="top" minSize={105} flexiblePanel=".canvas-workspace">
    <div className="timeline-bar">
      <span className="timeline-title"><Icon name="film" size={14}/> Frame {index + 1}/{doc.frames.length}<span className="muted">{totalDuration(doc.frames)} ms</span></span>
      <IconButton icon={playingFrameId ? 'pause' : 'play'} label={playingFrameId ? t('Pause (K)') : t('Abspielen (K)')} active={!!playingFrameId} disabled={doc.frames.length < 2} onClick={onTogglePlay}/>
      <select aria-label={t('Wiedergabemodus')} value={loop} onChange={event => onLoop(event.target.value as LoopMode)}>{(Object.keys(loopLabels) as LoopMode[]).map(mode => <option key={mode} value={mode}>{t(loopLabels[mode])}</option>)}</select>
      <label className="inline-check" title={t('Nur den Tag des aktuellen Frames abspielen')}><input type="checkbox" checked={onlyTag} onChange={event => onOnlyTag(event.target.checked)}/> {t('Nur Tag')}</label>
      <span className="toolbar-divider"/>
      <span className="timeline-onion" title={t('Zwiebelhaut: vorherige Frames blau, folgende rot (Umschalt+O)')}><Icon name="onion" size={14}/>
        <select aria-label={t('Zwiebelhaut vorher')} value={onion.before} onChange={event => onOnion({ ...onion, before: Number(event.target.value) })}>{[0, 1, 2, 3].map(value => <option key={value} value={value}>−{value}</option>)}</select>
        <select aria-label={t('Zwiebelhaut nachher')} value={onion.after} onChange={event => onOnion({ ...onion, after: Number(event.target.value) })}>{[0, 1, 2, 3].map(value => <option key={value} value={value}>+{value}</option>)}</select>
      </span>
      <span className="toolbar-spacer"/>
      <label className="timeline-duration">{t('Dauer')}<input key={`${frame.id}-${frame.durationMs}`} type="number" aria-label={t('Frame-Dauer in Millisekunden')} min="10" max="60000" step="10" defaultValue={frame.durationMs} disabled={!editable} onBlur={event => commitDuration(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') commitDuration(event.currentTarget.value); }}/>ms</label>
      <IconButton icon="plus" label={t('Leeren Frame einfügen')} disabled={!editable || doc.frames.length >= 64} onClick={onAdd}/>
      <IconButton icon="copy" label={t('Frame duplizieren')} disabled={!editable || doc.frames.length >= 64} onClick={onDuplicate}/>
      <IconButton icon="chevron-left" label={t('Frame nach links (früher)')} disabled={!editable || index === 0} onClick={() => onMove(-1)}/>
      <IconButton icon="chevron-right" label={t('Frame nach rechts (später)')} disabled={!editable || index === doc.frames.length - 1} onClick={() => onMove(1)}/>
      <IconButton icon="trash" label={t('Frame löschen')} disabled={!editable || doc.frames.length < 2} onClick={onRemove}/>
      <IconButton icon="tag" label={t('Tags bearbeiten')} disabled={!editable} onClick={onEditTags}/>
    </div>
    <div className="timeline-track">
      {laneCount > 0 && <div className="timeline-tags" style={{ ...grid, gridTemplateRows: `repeat(${laneCount}, 15px)` }}>
        {lanes.map(({ tag, lane }) => <span key={tag.name} className="timeline-tag" title={`${tag.name}: ${t('Frame {from}–{to}', { from: tag.from + 1, to: tag.to + 1 })}, ${t(directionLabels[tag.direction])}${tag.loop ? `, ${t('Schleife')}` : ''}`} style={{ gridColumn: `${tag.from + 1} / ${tag.to + 2}`, gridRow: lane + 1, '--tag-hue': tagHue(tag.name) } as CSSProperties}>{tag.name}</span>)}
      </div>}
      <div className="timeline-frames" style={grid} role="listbox" aria-label="Frames">
        {doc.frames.map((item, i) => <button key={item.id} role="option" aria-selected={item.id === frameId} className={`timeline-frame${item.id === frameId ? ' selected' : ''}${item.id === playingFrameId ? ' playing' : ''}`} title={`${item.id} · ${item.durationMs} ms`} onClick={() => onSelect(item.id)}>
          <span className="timeline-thumb checker"><Miniature doc={doc} frameId={item.id} thumbnail/></span>
          <span className="timeline-frame-label">{i + 1}<small>{item.durationMs}</small></span>
        </button>)}
      </div>
    </div>
  </ResizablePanel>;
}

/** Editable copy of the tag list; frame numbers are shown one-based like the timeline. */
export function TagEditor({ doc, frameIndex, busy, onSave, onCancel }: { doc: PixelDocument; frameIndex: number; busy: boolean; onSave: (tags: AnimationTagInput[]) => void; onCancel: () => void }) {
  const t = useT();
  const [tags, setTags] = useState<AnimationTag[]>(() => doc.tags.map(tag => ({ ...tag })));
  const update = (index: number, change: Partial<AnimationTag>) => setTags(list => list.map((tag, i) => i === index ? { ...tag, ...change } : tag));
  const names = tags.map(tag => tag.name.trim());
  const invalid = names.some((name, i) => !name || names.indexOf(name) !== i) || tags.some(tag => tag.from > tag.to);
  const frameOptions = doc.frames.map((frame, i) => <option key={frame.id} value={i}>{i + 1}</option>);
  return <form onSubmit={event => { event.preventDefault(); if (!invalid) onSave(tags.map(tag => ({ ...tag, name: tag.name.trim() }))); }}>
    <p>{t('Tags benennen Frame-Bereiche, zum Beispiel idle oder walk. Sie erscheinen im Sprite-Sheet-JSON und als Unity-Clips.')}</p>
    <div className="tag-rows">
      {!tags.length && <p className="empty-small">{t('Noch keine Tags.')}</p>}
      {tags.map((tag, i) => <div className="tag-row" key={i} style={{ '--tag-hue': tagHue(tag.name) } as CSSProperties}>
        <input aria-label={t('Name von Tag {number}', { number: i + 1 })} value={tag.name} maxLength={160} onChange={event => update(i, { name: event.target.value })}/>
        <select aria-label={t('Erster Frame')} value={tag.from} onChange={event => update(i, { from: Number(event.target.value) })}>{frameOptions}</select>
        <span>–</span>
        <select aria-label={t('Letzter Frame')} value={tag.to} onChange={event => update(i, { to: Number(event.target.value) })}>{frameOptions}</select>
        <select aria-label={t('Richtung')} value={tag.direction} onChange={event => update(i, { direction: event.target.value as TagDirection })}>{(Object.keys(directionLabels) as TagDirection[]).map(direction => <option key={direction} value={direction}>{t(directionLabels[direction])}</option>)}</select>
        <label className="inline-check"><input type="checkbox" checked={tag.loop} onChange={event => update(i, { loop: event.target.checked })}/> {t('Schleife')}</label>
        <IconButton type="button" icon="trash" label={t('Tag {name} entfernen', { name: tag.name || i + 1 })} onClick={() => setTags(list => list.filter((_, j) => j !== i))}/>
      </div>)}
    </div>
    <button type="button" className="button small" disabled={tags.length >= 32} onClick={() => setTags(list => [...list, { name: `tag-${list.length + 1}`, from: frameIndex, to: frameIndex, direction: 'forward', loop: true }])}><Icon name="plus" size={14}/> {t('Tag für aktuellen Frame')}</button>
    {invalid && <p className="form-error" role="alert">{t('Jeder Tag braucht einen eindeutigen Namen und einen Bereich mit erstem ≤ letztem Frame.')}</p>}
    <div className="modal-actions"><button className="button" type="button" onClick={onCancel} disabled={busy}>{t('Abbrechen')}</button><button className="button primary" type="submit" disabled={busy || invalid}><Icon name="check" size={16}/>{t('Tags speichern')}</button></div>
  </form>;
}
