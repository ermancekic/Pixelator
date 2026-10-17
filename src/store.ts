import { DatabaseSync } from 'node:sqlite';
import { randomUUID, createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { EventEmitter } from 'node:events';
import * as schema from './contracts.js';
import { applyOperations, createDocument, STYLE_PRESETS, upgradeDocument, validateDocument } from './engine.js';
import type { ApplyRequest, ApplyResult, ArtistRun, Asset, AssetDetail, CreateAssetInput, PixelDiff, PixelDocument, Project, Revision, RevisionSummary } from './types.js';

export class AppError extends Error {
  constructor(public code: string, message: string, public status = 400) { super(message); }
}
const newId = (prefix: string) => `${prefix}_${randomUUID()}`;
const now = () => new Date().toISOString();
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, stable(v)]));
  return value;
}
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
// Revisions written before animation support are lifted on read; the database itself is never rewritten.
const upgradeRevision = (revision: Revision): Revision => ({ ...revision, document: upgradeDocument(revision.document) });
const upgradeStored = <T>(value: T): T => {
  const revision = (value as { revision?: Revision } | null)?.revision;
  return revision?.document ? { ...value, revision: upgradeRevision(revision) } : value;
};
const isBlank = (doc: PixelDocument) => doc.frames.every(frame => Object.values(frame.cels).every(pixels => pixels.every(index => index === 0)));

export class Store extends EventEmitter {
  readonly db: DatabaseSync;
  constructor(path: string) {
    super();
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=3000;
      CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS assets (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS revisions (id TEXT PRIMARY KEY, asset_id TEXT NOT NULL REFERENCES assets(id), summary TEXT, data TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS asset_project ON assets(project_id);
      CREATE INDEX IF NOT EXISTS revision_asset ON revisions(asset_id);
      CREATE TABLE IF NOT EXISTS requests (id TEXT PRIMARY KEY, hash TEXT NOT NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, data TEXT NOT NULL);`);
    try {
      this.transaction(() => {
        const columns = this.db.prepare('PRAGMA table_info(revisions)').all() as { name: string }[];
        const hasSummary = columns.some(column => column.name === 'summary');
        const { user_version: version } = this.db.prepare('PRAGMA user_version').get() as { user_version: number };
        if (!hasSummary) this.db.exec('ALTER TABLE revisions ADD COLUMN summary TEXT');
        if (!hasSummary || version < 2) this.db.exec("UPDATE revisions SET summary=json_remove(data,'$.document','$.operations','$.validation','$.runId') WHERE summary IS NULL");
        // Migrated summaries follow large raster payloads; a covering index avoids reading their overflow pages.
        this.db.exec('CREATE INDEX IF NOT EXISTS revision_summary ON revisions(asset_id,summary)');
        this.db.exec('PRAGMA user_version=2');
      });
    } catch (error) { this.db.close(); throw error; }
    for (const run of this.listRuns()) {
      if (run.status === 'active') this.putRun({ ...run, status: 'interrupted', updatedAt: now() });
    }
  }
  close() { this.db.close(); }
  private transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  private read<T>(table: 'projects' | 'assets' | 'revisions' | 'runs', id: string): T {
    const row = this.db.prepare(`SELECT data FROM ${table} WHERE id=?`).get(id) as { data: string } | undefined;
    if (!row) throw new AppError('NOT_FOUND', `${table}: ${id} wurde nicht gefunden.`, 404);
    return JSON.parse(row.data) as T;
  }
  private putAsset(asset: Asset) { this.db.prepare('UPDATE assets SET data=? WHERE id=?').run(JSON.stringify(asset), asset.id); }
  private putRun(run: ArtistRun) { this.db.prepare('INSERT OR REPLACE INTO runs(id,data) VALUES(?,?)').run(run.id, JSON.stringify(run)); }
  private insertRevision(revision: Revision) {
    const { id, assetId, parentId, label, actor, createdAt } = revision;
    this.db.prepare('INSERT INTO revisions(id,asset_id,summary,data) VALUES(?,?,?,?)').run(id, assetId, JSON.stringify({ id, assetId, parentId, label, actor, createdAt }), JSON.stringify(revision));
  }
  private changed(type: string, projectId: string, assetId?: string) { this.emit('change', { type, projectId, assetId }); }
  listProjects(): Project[] { return (this.db.prepare('SELECT data FROM projects ORDER BY rowid').all() as { data: string }[]).map(row => JSON.parse(row.data)); }
  getProject(id: string): Project { return this.read('projects', id); }
  createProject(input: unknown): Project {
    const parsed = schema.projectInput.parse(input);
    const project: Project = { id: newId('project'), name: parsed.name, style: structuredClone(STYLE_PRESETS[parsed.preset ?? '16-bit']), createdAt: now() };
    this.db.prepare('INSERT INTO projects(id,data) VALUES(?,?)').run(project.id, JSON.stringify(project));
    this.changed('project', project.id);
    return project;
  }
  updateProject(id: string, input: unknown): Project {
    const changes = schema.projectUpdate.parse(input);
    const result = this.transaction(() => {
      const project = { ...this.getProject(id), ...changes };
      createDocument({ ...project.style, layers: [{ id: 'check', name: 'Check' }] });
      this.db.prepare('UPDATE projects SET data=? WHERE id=?').run(JSON.stringify(project), id);
      return project;
    });
    this.changed('project', id);
    return result;
  }
  deleteProject(id: string): { id: string } {
    this.transaction(() => {
      this.getProject(id);
      this.db.prepare("UPDATE assets SET data=json_remove(data,'$.sourceAssetId') WHERE json_extract(data,'$.sourceAssetId') IN (SELECT id FROM assets WHERE project_id=?)").run(id);
      this.db.prepare("DELETE FROM requests WHERE substr(id,1,instr(id,':')-1) IN (SELECT id FROM assets WHERE project_id=?)").run(id);
      this.db.prepare("DELETE FROM runs WHERE json_extract(data,'$.projectId')=?").run(id);
      this.db.prepare('DELETE FROM revisions WHERE asset_id IN (SELECT id FROM assets WHERE project_id=?)').run(id);
      this.db.prepare('DELETE FROM assets WHERE project_id=?').run(id);
      this.db.prepare('DELETE FROM projects WHERE id=?').run(id);
    });
    this.changed('project-deleted', id);
    return { id };
  }
  listAssets(projectId: string, q = '', type = ''): Asset[] {
    this.getProject(projectId);
    const words = q.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
    return (this.db.prepare('SELECT data FROM assets WHERE project_id=? ORDER BY rowid DESC').all(projectId) as { data: string }[])
      .map(row => JSON.parse(row.data) as Asset)
      .filter(asset => (!type || asset.type === type) && words.every(word => `${asset.name} ${asset.tags.join(' ')} ${asset.style.preset}`.toLocaleLowerCase().includes(word)));
  }
  getAsset(id: string): AssetDetail {
    const asset = this.read<Asset>('assets', id);
    return { asset, revision: this.getRevision(id, asset.headRevisionId) };
  }
  deleteAsset(id: string): { id: string; projectId: string } {
    const asset = this.transaction(() => {
      const asset = this.read<Asset>('assets', id);
      this.db.prepare("UPDATE assets SET data=json_remove(data,'$.sourceAssetId') WHERE json_extract(data,'$.sourceAssetId')=?").run(id);
      this.db.prepare("DELETE FROM requests WHERE substr(id,1,instr(id,':')-1)=?").run(id);
      this.db.prepare("DELETE FROM runs WHERE json_extract(data,'$.assetId')=?").run(id);
      this.db.prepare('DELETE FROM revisions WHERE asset_id=?').run(id);
      this.db.prepare('DELETE FROM assets WHERE id=?').run(id);
      return asset;
    });
    this.changed('asset-deleted', asset.projectId, id);
    return { id, projectId: asset.projectId };
  }
  getRevision(assetId: string, revisionId?: string): Revision {
    const id = revisionId ?? this.read<Asset>('assets', assetId).headRevisionId;
    const revision = this.read<Revision>('revisions', id);
    if (revision.assetId !== assetId) throw new AppError('WRONG_ASSET', 'Die Revision gehört zu einem anderen Asset.');
    return upgradeRevision(revision);
  }
  listRevisions(assetId: string): Revision[] {
    this.getAsset(assetId);
    return (this.db.prepare('SELECT data FROM revisions WHERE asset_id=? ORDER BY rowid DESC').all(assetId) as { data: string }[]).map(row => upgradeRevision(JSON.parse(row.data)));
  }
  listRevisionSummaries(assetId: string): RevisionSummary[] {
    this.read<Asset>('assets', assetId);
    return (this.db.prepare('SELECT summary FROM revisions INDEXED BY revision_summary WHERE asset_id=? ORDER BY rowid DESC').all(assetId) as { summary: string }[]).map(row => JSON.parse(row.summary));
  }
  private insertAsset(input: CreateAssetInput, document?: PixelDocument, actor: Revision['actor'] = 'human'): AssetDetail {
    const project = this.getProject(input.projectId);
    if (input.sourceAssetId) this.getAsset(input.sourceAssetId);
    if (input.palette && project.style.paletteLocked && input.palette.some((color, i) => i && !project.style.palette.map(c => c.toUpperCase()).includes(color.toUpperCase()))) {
      throw new AppError('PALETTE_LOCKED', 'Die Farben müssen in der gesperrten Projektpalette enthalten sein.');
    }
    const width = input.width ?? project.style.width;
    const height = input.height ?? project.style.height;
    const doc = document ?? createDocument({
      width, height, palette: input.palette ?? project.style.palette,
      maxColors: input.maxColors ?? project.style.maxColors, paletteLocked: project.style.paletteLocked,
      layers: input.layers ?? [{ id: 'body', name: input.type === 'character' ? 'Körper' : 'Basis' }],
      frames: input.frames, tags: input.animationTags,
      pivot: { x: width / 2, y: input.type === 'character' ? height : height / 2 },
    });
    const validation = validateDocument(doc);
    if (!validation.valid) throw new AppError('INVALID_DOCUMENT', validation.issues.filter(i => i.severity === 'error').map(i => i.message).join(' '));
    const timestamp = now();
    const asset: Asset = {
      id: newId('asset'), projectId: input.projectId, name: input.name, type: input.type,
      tags: input.tags ?? [], headRevisionId: newId('rev'), sourceAssetId: input.sourceAssetId,
      style: { ...structuredClone(project.style), width: doc.width, height: doc.height, palette: [...doc.palette], maxColors: doc.maxColors, perspective: input.type === 'character' ? project.style.perspective : 'front' },
      createdAt: timestamp, updatedAt: timestamp,
    };
    const revision: Revision = { id: asset.headRevisionId, assetId: asset.id, parentId: null, document: doc, label: actor === 'import' ? 'PNG importiert' : 'Asset angelegt', actor, runId: input.runId, operations: [], validation, createdAt: timestamp };
    this.db.prepare('INSERT INTO assets(id,project_id,data) VALUES(?,?,?)').run(asset.id, asset.projectId, JSON.stringify(asset));
    this.insertRevision(revision);
    if (input.runId) {
      const run = this.requireActiveRun(input.runId);
      if (run.projectId !== project.id || (run.assetId && run.assetId !== asset.id)) throw new AppError('RUN_ASSET', 'Der Auftrag gehört zu einem anderen Projekt oder Asset.');
      this.putRun({ ...run, assetId: asset.id, updatedAt: timestamp });
    }
    return { asset, revision };
  }
  createAsset(input: unknown): AssetDetail {
    const parsed = schema.createAssetInput.parse(input);
    if (parsed.sourceAssetId) throw new AppError('USE_VARIANT', 'Für Kopien bitte create_variant verwenden.');
    const result = this.transaction(() => this.insertAsset(parsed, undefined, parsed.runId ? 'agent' : 'human'));
    this.changed('asset', result.asset.projectId, result.asset.id);
    return result;
  }
  importDocument(input: CreateAssetInput, doc: PixelDocument): AssetDetail {
    const parsed = schema.createAssetInput.parse(input);
    schema.documentSchema.parse(doc);
    doc = upgradeDocument(doc);
    const project = this.getProject(parsed.projectId);
    if (project.style.paletteLocked && validateDocument(doc).valid && isBlank(doc)) {
      doc = { ...doc, palette: [...project.style.palette], maxColors: project.style.maxColors, paletteLocked: true };
    }
    if (doc.maxColors > project.style.maxColors || doc.palette.slice(1).some(c => project.style.paletteLocked && !project.style.palette.map(p => p.toUpperCase()).includes(c.toUpperCase()))) throw new AppError('PALETTE_LIMIT', 'Das Bild passt nicht zu den Farbregeln des Projekts.');
    const result = this.transaction(() => this.insertAsset(parsed, doc, 'import'));
    this.changed('asset', result.asset.projectId, result.asset.id);
    return result;
  }
  createVariant(assetId: string, name: string): AssetDetail {
    const base = this.getAsset(assetId);
    const input = schema.createAssetInput.parse({ projectId: base.asset.projectId, name, type: base.asset.type, tags: base.asset.tags, sourceAssetId: assetId });
    const result = this.transaction(() => {
      const detail = this.insertAsset(input, structuredClone(base.revision.document));
      detail.asset.style = structuredClone(base.asset.style);
      this.putAsset(detail.asset);
      return detail;
    });
    this.changed('asset', result.asset.projectId, result.asset.id);
    return result;
  }
  private replay<T>(assetId: string, requestId: string, payload: unknown): T | undefined {
    const row = this.db.prepare('SELECT hash,data FROM requests WHERE id=?').get(`${assetId}:${requestId}`) as { hash: string; data: string } | undefined;
    if (!row) return undefined;
    if (row.hash !== hash(payload)) throw new AppError('IDEMPOTENCY_CONFLICT', 'Diese requestId wurde bereits mit anderem Inhalt verwendet.', 409);
    const stored = JSON.parse(row.data) as { revisionId?: string; diff?: PixelDiff; revision?: Revision };
    if (stored.revision) return upgradeStored(stored as T);
    // Compact records point at the revision; the asset then had that revision as head, and nothing else on it changes.
    const revision = this.getRevision(assetId, stored.revisionId);
    const asset: Asset = { ...this.read<Asset>('assets', assetId), headRevisionId: revision.id, updatedAt: revision.createdAt };
    return { asset, revision, ...(stored.diff ? { diff: stored.diff } : {}) } as T;
  }
  private saveRequest(assetId: string, requestId: string, payload: unknown, result: { revision: Revision; diff?: PixelDiff }) {
    this.db.prepare('INSERT INTO requests(id,hash,data) VALUES(?,?,?)').run(`${assetId}:${requestId}`, hash(payload), JSON.stringify({ revisionId: result.revision.id, ...(result.diff ? { diff: result.diff } : {}) }));
  }
  private appendRevision(asset: Asset, revision: Revision) {
    this.insertRevision(revision);
    asset.headRevisionId = revision.id;
    asset.updatedAt = revision.createdAt;
    // The asset style records the current canvas size, which resize_canvas and restores can change.
    asset.style = { ...asset.style, width: revision.document.width, height: revision.document.height };
    this.putAsset(asset);
  }
  apply(assetId: string, input: unknown): ApplyResult {
    const request: ApplyRequest = schema.applyRequest.parse(input);
    const result = this.transaction(() => {
      const replay = this.replay<ApplyResult>(assetId, request.requestId, { method: 'apply', ...request });
      if (replay) return replay;
      const { asset, revision: base } = this.getAsset(assetId);
      if (base.id !== request.expectedRevision) throw new AppError('REVISION_CONFLICT', 'Das Asset wurde inzwischen geändert. Aktuelle Revision neu laden.', 409);
      let run: ArtistRun | undefined;
      if (request.runId) {
        run = this.requireActiveRun(request.runId);
        if (run.projectId !== asset.projectId || (run.assetId && run.assetId !== assetId)) throw new AppError('RUN_ASSET', 'Auftrag und Asset passen nicht zusammen.');
        if (run.batchCount >= 120 || run.reviews.length >= 4) throw new AppError('RUN_LIMIT', 'Das Korrekturbudget ist erreicht. Den vorhandenen Stand prüfen und abschließen.');
      }
      const applied = applyOperations(base.document, request.operations, request.editScope);
      const revision: Revision = {
        id: newId('rev'), assetId, parentId: base.id, document: applied.document,
        label: request.label ?? 'Pixel bearbeitet', actor: request.actor ?? 'human', runId: request.runId,
        operations: request.operations, validation: applied.validation, createdAt: now(),
      };
      this.appendRevision(asset, revision);
      const response: ApplyResult = { asset, revision, diff: applied.diff };
      if (run) this.putRun({ ...run, assetId, batchCount: run.batchCount + 1, inspectedRevisionId: undefined, inspectedFrameIds: undefined, updatedAt: revision.createdAt });
      this.saveRequest(assetId, request.requestId, { method: 'apply', ...request }, response);
      return response;
    });
    this.changed('asset', result.asset.projectId, assetId);
    return result;
  }
  restore(assetId: string, input: unknown): AssetDetail {
    const request = schema.restoreInput.parse(input);
    const payload = { method: 'restore', ...request };
    const result = this.transaction(() => {
      const replay = this.replay<AssetDetail>(assetId, request.requestId, payload);
      if (replay) return replay;
      const { asset, revision: current } = this.getAsset(assetId);
      if (current.id !== request.expectedRevision) throw new AppError('REVISION_CONFLICT', 'Die aktuelle Revision hat sich geändert.', 409);
      const source = this.getRevision(assetId, request.revisionId);
      const revision: Revision = { ...structuredClone(source), id: newId('rev'), parentId: current.id, actor: 'human', runId: undefined, label: request.label ?? `Wiederhergestellt: ${source.label}`, operations: [], createdAt: now() };
      this.appendRevision(asset, revision);
      const response = { asset, revision };
      this.saveRequest(assetId, request.requestId, payload, response);
      return response;
    });
    this.changed('asset', result.asset.projectId, assetId);
    return result;
  }
  listRuns(): ArtistRun[] { return (this.db.prepare('SELECT data FROM runs ORDER BY rowid DESC').all() as { data: string }[]).map(row => JSON.parse(row.data)); }
  getRun(id: string): ArtistRun { return this.read('runs', id); }
  startRun(input: unknown): ArtistRun {
    const parsed = schema.runInput.parse(input);
    this.getProject(parsed.projectId);
    if (parsed.assetId && this.getAsset(parsed.assetId).asset.projectId !== parsed.projectId) throw new AppError('RUN_ASSET', 'Asset und Projekt passen nicht zusammen.');
    const timestamp = now();
    const run: ArtistRun = { ...parsed, id: newId('run'), status: 'active', reviews: [], batchCount: 0, createdAt: timestamp, updatedAt: timestamp };
    this.putRun(run);
    this.changed('run', run.projectId, run.assetId);
    return run;
  }
  private requireActiveRun(id: string): ArtistRun {
    const run = this.getRun(id);
    if (run.status !== 'active') throw new AppError('RUN_INACTIVE', `Der Auftrag ist ${run.status}. Erst fortsetzen oder einen neuen Auftrag beginnen.`, 409);
    return run;
  }
  resumeRun(id: string): ArtistRun {
    return this.transaction(() => {
      const run = this.getRun(id);
      if (run.status !== 'interrupted') throw new AppError('RUN_STATUS', 'Nur unterbrochene Aufträge können fortgesetzt werden.');
      const resumed = { ...run, status: 'active' as const, inspectedRevisionId: undefined, inspectedFrameIds: undefined, updatedAt: now() };
      this.putRun(resumed);
      return resumed;
    });
  }
  inspected(runId: string, assetId: string, revisionId: string, frameIds?: string[]) {
    this.transaction(() => {
      const run = this.requireActiveRun(runId);
      if (run.assetId !== assetId) throw new AppError('RUN_ASSET', 'Das Bild gehört nicht zu diesem Auftrag.');
      const { revision } = this.getAsset(assetId);
      if (revision.id !== revisionId) throw new AppError('REVISION_CONFLICT', 'Nur die aktuelle Revision kann für den Abschluss inspiziert werden.', 409);
      this.putRun({ ...run, inspectedRevisionId: revisionId, inspectedFrameIds: frameIds ?? revision.document.frames.map(frame => frame.id), updatedAt: now() });
    });
  }
  recordReview(runId: string, input: unknown): ArtistRun {
    const parsed = schema.reviewInput.parse(input);
    const result = this.transaction(() => {
      const run = this.requireActiveRun(runId);
      if (run.inspectedRevisionId !== parsed.revisionId || !run.assetId || this.getAsset(run.assetId).revision.id !== parsed.revisionId) throw new AppError('INSPECTION_REQUIRED', 'Zuerst genau die aktuelle Revision mit inspect_asset ansehen.');
      if (run.reviews.length >= 4) throw new AppError('RUN_LIMIT', 'Maximal eine Erstprüfung und drei Korrekturrunden.');
      const updated = { ...run, reviews: [...run.reviews, { ...parsed, createdAt: now() }], updatedAt: now() };
      this.putRun(updated);
      return updated;
    });
    this.changed('run', result.projectId, result.assetId);
    return result;
  }
  finishRun(id: string, status: 'completed' | 'needs_review' | 'cancelled'): ArtistRun {
    const result = this.transaction(() => {
      const run = this.requireActiveRun(id);
      if (status === 'completed') {
        if (!run.assetId) throw new AppError('ASSET_REQUIRED', 'Dem Auftrag fehlt ein Asset.');
        const revision = this.getAsset(run.assetId).revision;
        const review = run.reviews.at(-1);
        if (run.inspectedRevisionId !== revision.id || review?.revisionId !== revision.id) throw new AppError('REVIEW_REQUIRED', 'Die Endrevision muss angesehen und bewertet werden.');
        // Older runs recorded no frame coverage; they predate animation and inspected their only frame.
        const shown = new Set(run.inspectedFrameIds ?? [revision.document.frames[0].id]);
        if (revision.document.frames.some(frame => !shown.has(frame.id))) throw new AppError('REVIEW_REQUIRED', 'Bei Animationen muss die letzte Inspektion alle Frames zeigen, zum Beispiel als Sprite-Sheet.');
        if (!revision.validation.valid || revision.validation.opaquePixels === 0 || review.issues.length) throw new AppError('NEEDS_REVIEW', 'Offene Probleme oder ein leeres Asset erlauben nur needs_review.');
      }
      const updated = { ...run, status, updatedAt: now() };
      this.putRun(updated);
      return updated;
    });
    this.changed('run', result.projectId, result.assetId);
    return result;
  }
  exportProject(id: string) {
    const assets = this.listAssets(id);
    return { kind: 'pixelator-project' as const, schemaVersion: 2 as const, project: this.getProject(id), assets, revisions: assets.flatMap(asset => this.listRevisions(asset.id)), runs: this.listRuns().filter(run => run.projectId === id) };
  }
  exportAsset(assetId: string) {
    const { asset } = this.getAsset(assetId);
    return { kind: 'pixelator-project' as const, schemaVersion: 2 as const, project: this.getProject(asset.projectId), assets: [asset], revisions: this.listRevisions(assetId), runs: this.listRuns().filter(run => run.assetId === assetId) };
  }
  importProject(input: unknown): Project {
    const parsed = schema.projectBundle.parse(input);
    const bundle = { ...parsed, revisions: parsed.revisions.map(revision => ({ ...revision, document: upgradeDocument(revision.document) })) };
    const assetIds = new Set(bundle.assets.map(asset => asset.id));
    const revisionIds = new Set(bundle.revisions.map(revision => revision.id));
    const runs = bundle.runs ?? [];
    const runIds = new Set(runs.map(run => run.id));
    if (assetIds.size !== bundle.assets.length || revisionIds.size !== bundle.revisions.length || runIds.size !== runs.length) throw new AppError('INVALID_IMPORT', 'Doppelte Asset-, Revisions- oder Auftrags-IDs.');
    const revisionMap = new Map(bundle.revisions.map(revision => [revision.id, revision]));
    createDocument({ ...bundle.project.style, layers: [{ id: 'check', name: 'Check' }] });
    for (const asset of bundle.assets) {
      if (asset.projectId !== bundle.project.id || !bundle.revisions.some(rev => rev.id === asset.headRevisionId && rev.assetId === asset.id)) throw new AppError('INVALID_IMPORT', 'Ein Asset hat keine gültige Endrevision.');
      createDocument({ ...asset.style, layers: [{ id: 'check', name: 'Check' }] });
    }
    for (const revision of bundle.revisions) {
      if (!assetIds.has(revision.assetId) || (revision.parentId && !bundle.revisions.some(parent => parent.id === revision.parentId && parent.assetId === revision.assetId))) throw new AppError('INVALID_IMPORT', 'Ungültige Revisionszuordnung.');
      const report = validateDocument(revision.document);
      if (!report.valid) throw new AppError('INVALID_IMPORT', 'Die Projektdatei enthält ungültige Rasterdaten.');
      if (revision.runId && !runs.some(run => run.id === revision.runId && run.assetId === revision.assetId)) throw new AppError('INVALID_IMPORT', 'Ungültige Auftragsreferenz einer Revision.');
    }
    const checked = new Set<string>();
    for (const revision of bundle.revisions) {
      const path = new Set<string>();
      let cursor: string | null = revision.id;
      while (cursor && !checked.has(cursor)) {
        if (path.has(cursor)) throw new AppError('INVALID_IMPORT', 'Der Revisionsverlauf enthält einen Zyklus.');
        path.add(cursor);
        cursor = revisionMap.get(cursor)!.parentId;
      }
      for (const item of path) checked.add(item);
    }
    for (const run of runs) {
      if (run.projectId !== bundle.project.id || (run.assetId && !assetIds.has(run.assetId))) throw new AppError('INVALID_IMPORT', 'Ungültige Projekt- oder Assetreferenz eines Auftrags.');
      const reviewIds = [...run.reviews.map(review => review.revisionId), ...(run.inspectedRevisionId ? [run.inspectedRevisionId] : [])];
      if (reviewIds.some(id => !run.assetId || revisionMap.get(id)?.assetId !== run.assetId)) throw new AppError('INVALID_IMPORT', 'Ungültige Review-Revision eines Auftrags.');
    }
    const project = this.transaction(() => {
      const project: Project = { ...bundle.project, id: newId('project'), name: `${bundle.project.name.slice(0, 151)} (Import)`, createdAt: now() };
      const assets = new Map(bundle.assets.map(asset => [asset.id, newId('asset')]));
      const revisions = new Map(bundle.revisions.map(revision => [revision.id, newId('rev')]));
      const runIds = new Map(runs.map(run => [run.id, newId('run')]));
      this.db.prepare('INSERT INTO projects(id,data) VALUES(?,?)').run(project.id, JSON.stringify(project));
      for (const source of [...bundle.assets].reverse()) {
        const asset: Asset = { ...source, id: assets.get(source.id)!, projectId: project.id, headRevisionId: revisions.get(source.headRevisionId)!, sourceAssetId: source.sourceAssetId ? assets.get(source.sourceAssetId) : undefined };
        this.db.prepare('INSERT INTO assets(id,project_id,data) VALUES(?,?,?)').run(asset.id, project.id, JSON.stringify(asset));
      }
      for (const source of [...bundle.revisions].reverse()) {
        const revision: Revision = { ...source, id: revisions.get(source.id)!, assetId: assets.get(source.assetId)!, parentId: source.parentId ? revisions.get(source.parentId)! : null, runId: source.runId ? runIds.get(source.runId) : undefined, validation: validateDocument(source.document) };
        this.insertRevision(revision);
      }
      for (const source of [...runs].reverse()) {
        const run: ArtistRun = { ...source, id: runIds.get(source.id)!, projectId: project.id, assetId: source.assetId ? assets.get(source.assetId) : undefined, status: source.status === 'active' ? 'interrupted' : source.status, inspectedRevisionId: source.inspectedRevisionId ? revisions.get(source.inspectedRevisionId) : undefined, reviews: source.reviews.map(review => ({ ...review, revisionId: revisions.get(review.revisionId)! })) };
        this.putRun(run);
      }
      return project;
    });
    this.changed('project', project.id);
    return project;
  }
}
