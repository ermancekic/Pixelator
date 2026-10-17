import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { AppError, Store } from '../src/store.js';
import type { ApplyRequest, AssetDetail } from '../src/types.js';

const stores = new Set<Store>();
const folders: string[] = [];
const open = (path = ':memory:') => { const store = new Store(path); stores.add(store); return store; };
const close = (store: Store) => { store.close(); stores.delete(store); };
const request = (detail: AssetDetail, requestId: string, extra: Partial<ApplyRequest> = {}): ApplyRequest => ({
  expectedRevision: detail.revision.id, requestId, actor: 'agent', label: requestId,
  editScope: { layerIds: ['body'] },
  operations: [{ op: 'pixels', layerId: 'body', points: [[1, 1, 1], [2, 1, 1]] }],
  ...extra,
});
const setup = (store = open()) => {
  const project = store.createProject({ name: 'Dark Fantasy' });
  const detail = store.createAsset({ projectId: project.id, name: 'Skeleton', type: 'character', width: 8, height: 8 });
  return { store, project, detail };
};
function appError(action: () => unknown, code: string, status = 400) {
  let failure: unknown;
  try { action(); } catch (error) { failure = error; }
  expect(failure).toBeInstanceOf(AppError);
  expect(failure).toMatchObject({ code, status });
}

afterEach(() => {
  for (const store of stores) store.close();
  stores.clear();
  for (const folder of folders.splice(0)) {
    if (dirname(folder) !== resolve(tmpdir()) || !basename(folder).startsWith('pixelator-store-')) throw new Error('Unexpected temporary test path');
    rmSync(folder, { recursive: true, force: true });
  }
});

describe('durable revisions and request replay', () => {
  it('reloads exact documents, history and requests while interrupting an unfinished run', () => {
    const folder = mkdtempSync(join(tmpdir(), 'pixelator-store-')); folders.push(folder);
    const path = join(folder, 'project.sqlite');
    const { store, project, detail } = setup(open(path));
    const run = store.startRun({ projectId: project.id, assetId: detail.asset.id, prompt: 'Draw the skeleton' });
    const edit = request(detail, 'durable-paint', { runId: run.id });
    const painted = store.apply(detail.asset.id, edit);
    store.inspected(run.id, detail.asset.id, painted.revision.id);
    store.recordReview(run.id, { revisionId: painted.revision.id, observations: 'The body is visible; the sword is unfinished.', issues: ['Add sword'] });
    const history = store.listRevisions(detail.asset.id);
    close(store);

    const reopened = open(path);
    expect(reopened.getProject(project.id)).toEqual(project);
    expect(reopened.getAsset(detail.asset.id)).toEqual({ asset: painted.asset, revision: painted.revision });
    expect(reopened.listRevisions(detail.asset.id)).toEqual(history);
    expect(reopened.getRun(run.id)).toMatchObject({ status: 'interrupted', batchCount: 1, reviews: [{ revisionId: painted.revision.id, issues: ['Add sword'] }] });
    expect(reopened.apply(detail.asset.id, edit)).toEqual(painted);
    expect(reopened.getRun(run.id).batchCount).toBe(1);
    expect(reopened.resumeRun(run.id)).toMatchObject({ status: 'active', inspectedRevisionId: undefined });
  });

  it('replays a successful request before checking its now-stale revision and rejects changed payloads', () => {
    const { store, detail } = setup();
    const firstRequest = request(detail, 'first');
    const first = store.apply(detail.asset.id, firstRequest);
    const second = store.apply(detail.asset.id, request(first, 'second', {
      operations: [{ op: 'pixels', layerId: 'body', points: [[3, 1, 2]] }],
    }));
    expect(store.apply(detail.asset.id, firstRequest)).toEqual(first);
    expect(store.getAsset(detail.asset.id).revision.id).toBe(second.revision.id);
    expect(store.listRevisions(detail.asset.id)).toHaveLength(3);
    appError(() => store.apply(detail.asset.id, { ...firstRequest, label: 'altered payload' }), 'IDEMPOTENCY_CONFLICT', 409);
    appError(() => store.apply(detail.asset.id, request(detail, 'new-but-stale')), 'REVISION_CONFLICT', 409);
    expect(store.getAsset(detail.asset.id).revision.id).toBe(second.revision.id);
  });
});

describe('transaction boundaries', () => {
  it('rolls back raster, history and run bookkeeping when a late database write fails', () => {
    const { store, project, detail } = setup();
    const run = store.startRun({ projectId: project.id, assetId: detail.asset.id, prompt: 'Draw body' });
    store.inspected(run.id, detail.asset.id, detail.revision.id);
    const beforeRun = store.getRun(run.id);
    const edit = request(detail, 'late-write', { runId: run.id });
    store.db.exec("CREATE TRIGGER fail_request BEFORE INSERT ON requests BEGIN SELECT RAISE(ABORT, 'simulated storage failure'); END;");

    expect(() => store.apply(detail.asset.id, edit)).toThrow('simulated storage failure');
    expect(store.getAsset(detail.asset.id)).toEqual(detail);
    expect(store.listRevisions(detail.asset.id)).toEqual([detail.revision]);
    expect(store.getRun(run.id)).toEqual(beforeRun);

    store.db.exec('DROP TRIGGER fail_request');
    const result = store.apply(detail.asset.id, edit);
    expect(result.revision.document.layers[0].pixels[9]).toBe(1);
    expect(store.getRun(run.id).batchCount).toBe(1);
    expect(store.getRun(run.id).inspectedRevisionId).toBeUndefined();
    expect(store.listRevisions(detail.asset.id)).toHaveLength(2);
  });

  it('does not leave an asset or update a run when creation uses another project\'s run', () => {
    const { store, project } = setup();
    const other = store.createProject({ name: 'Another project' });
    const run = store.startRun({ projectId: other.id, prompt: 'Other task' });
    const before = store.listAssets(project.id);
    appError(() => store.createAsset({ projectId: project.id, name: 'Must roll back', type: 'item', runId: run.id }), 'RUN_ASSET');
    expect(store.listAssets(project.id)).toEqual(before);
    expect(store.getRun(run.id)).toEqual(run);
  });
});

describe('project portability and revision ownership', () => {
  it('round-trips duplicate layers and extended fill operations without changing their source', () => {
    const { store, project, detail } = setup();
    const result = store.apply(detail.asset.id, request(detail, 'layer-copy-and-fill', {
      editScope: { layerIds: ['body'], allowLayerChanges: true },
      operations: [
        { op: 'pixels', layerId: 'body', points: [[1, 1, 1], [2, 1, 1]] },
        { op: 'duplicate_layer', layerId: 'body', id: 'copy', name: 'Body variation' },
        { op: 'fill', layerId: 'copy', x: 0, y: 0, color: 2, reference: 'composite', contiguous: false },
      ],
    }));
    expect(result.revision.document.layers[0].pixels.filter(Boolean)).toEqual([1, 1]);
    expect(result.revision.document.layers[1].pixels.filter(color => color === 2)).toHaveLength(62);
    const imported = store.importProject(store.exportProject(project.id));
    const copy = store.listAssets(imported.id)[0];
    const revision = store.getAsset(copy.id).revision;
    expect(revision.document).toEqual(result.revision.document);
    expect(revision.operations).toEqual(result.revision.operations);
  });

  it('can repeatedly import a project whose original name has the maximum length', () => {
    const store = open();
    let project = store.createProject({ name: 'x'.repeat(160) });
    for (let index = 0; index < 3; index++) {
      const previousId = project.id;
      project = store.importProject(store.exportProject(previousId));
      expect(project.id).not.toBe(previousId);
      expect(project.name.length).toBeLessThanOrEqual(160);
      expect(project.name.endsWith(' (Import)')).toBe(true);
      expect(store.getProject(project.id)).toEqual(project);
    }
    expect(store.listProjects()).toHaveLength(4);
  });

  it('round-trips exact layered rasters, newest-first history, lineage and source variants with new IDs', () => {
    const { store, project, detail } = setup();
    const drawn = store.apply(detail.asset.id, request(detail, 'Draw body and weapon', {
      editScope: { layerIds: ['body'], allowLayerChanges: true },
      operations: [
        { op: 'pixels', layerId: 'body', points: [[1, 1, 1], [2, 1, 2]] },
        { op: 'add_layer', id: 'sword', name: 'Sword' },
        { op: 'pixels', layerId: 'sword', points: [[3, 1, 3], [4, 1, 3]] },
      ],
    }));
    store.apply(detail.asset.id, request(drawn, 'Longer sword', {
      editScope: { layerIds: ['sword'], rect: { x: 3, y: 1, width: 3, height: 1 } },
      operations: [{ op: 'pixels', layerId: 'sword', points: [[5, 1, 3]] }],
    }));
    store.createVariant(detail.asset.id, 'Skeleton Elite');
    const bundle = store.exportProject(project.id);
    const imported = store.importProject(bundle);
    expect(imported.id).not.toBe(project.id);
    expect(imported.style).toEqual(project.style);
    const copies = store.listAssets(imported.id);
    expect(copies).toHaveLength(2);
    for (const original of bundle.assets) {
      const copy = copies.find(asset => asset.name === original.name)!;
      expect(copy.id).not.toBe(original.id);
      expect(copy.style).toEqual(original.style);
      const before = store.listRevisions(original.id);
      const after = store.listRevisions(copy.id);
      expect(after.map(revision => ({ document: revision.document, label: revision.label, operations: revision.operations, actor: revision.actor, createdAt: revision.createdAt })))
        .toEqual(before.map(revision => ({ document: revision.document, label: revision.label, operations: revision.operations, actor: revision.actor, createdAt: revision.createdAt })));
      expect(after[0].id).toBe(copy.headRevisionId);
      expect(after.map(revision => revision.parentId)).toEqual([...after.slice(1).map(revision => revision.id), null]);
    }
    expect(copies.find(asset => asset.name === 'Skeleton Elite')!.sourceAssetId).toBe(copies.find(asset => asset.name === 'Skeleton')!.id);
  });

  it('retains completed artist runs and remaps their reviewed revision IDs on project import', () => {
    const { store, project, detail } = setup();
    const run = store.startRun({ projectId: project.id, assetId: detail.asset.id, prompt: 'Draw skeleton' });
    const result = store.apply(detail.asset.id, request(detail, 'Reviewed body', { runId: run.id }));
    store.inspected(run.id, detail.asset.id, result.revision.id);
    store.recordReview(run.id, { revisionId: result.revision.id, observations: 'The silhouette is visible.', issues: [] });
    store.finishRun(run.id, 'completed');
    const imported = store.importProject(store.exportProject(project.id));
    const copy = store.listAssets(imported.id)[0];
    const importedRuns = store.exportProject(imported.id).runs;
    expect(importedRuns).toHaveLength(1);
    const importedRun = importedRuns[0];
    expect(importedRun.id).not.toBe(run.id);
    expect(importedRun).toMatchObject({
      projectId: imported.id, assetId: copy.id, prompt: run.prompt, status: 'completed', batchCount: 1,
      inspectedRevisionId: copy.headRevisionId,
      reviews: [{ revisionId: copy.headRevisionId, observations: 'The silhouette is visible.', issues: [] }],
    });
    expect(store.getAsset(copy.id).revision.runId).toBe(importedRun.id);
  });

  it('rejects foreign revision reads and restores without changing either asset', () => {
    const { store, project, detail } = setup();
    const foreign = store.createAsset({ projectId: project.id, name: 'Potion', type: 'item' });
    appError(() => store.getRevision(detail.asset.id, foreign.revision.id), 'WRONG_ASSET');
    appError(() => store.restore(detail.asset.id, { revisionId: foreign.revision.id, expectedRevision: detail.revision.id, requestId: 'foreign-restore' }), 'WRONG_ASSET');
    expect(store.getAsset(detail.asset.id)).toEqual(detail);
    expect(store.getAsset(foreign.asset.id)).toEqual(foreign);
  });

  it.each(['head', 'parent'] as const)('rejects an imported foreign %s revision atomically', target => {
    const { store, project, detail } = setup();
    const foreign = store.createAsset({ projectId: project.id, name: 'Potion', type: 'item' });
    const bundle = store.exportProject(project.id);
    if (target === 'head') bundle.assets.find(asset => asset.id === detail.asset.id)!.headRevisionId = foreign.revision.id;
    else bundle.revisions.find(revision => revision.id === detail.revision.id)!.parentId = foreign.revision.id;
    appError(() => store.importProject(bundle), 'INVALID_IMPORT');
    expect(store.listProjects()).toEqual([project]);
    expect(store.getAsset(detail.asset.id)).toEqual(detail);
  });
});

describe('inspection and artist run completion', () => {
  it('requires inspection of the actual current revision and invalidates review after a manual edit', () => {
    const { store, project, detail } = setup();
    const run = store.startRun({ projectId: project.id, assetId: detail.asset.id, prompt: 'Draw and review' });
    const painted = store.apply(detail.asset.id, request(detail, 'paint', { runId: run.id }));
    const review = { revisionId: painted.revision.id, observations: 'Body is readable.', issues: [] };
    appError(() => store.recordReview(run.id, review), 'INSPECTION_REQUIRED');
    appError(() => store.inspected(run.id, detail.asset.id, detail.revision.id), 'REVISION_CONFLICT', 409);
    store.inspected(run.id, detail.asset.id, painted.revision.id);
    store.recordReview(run.id, review);
    const changed = store.apply(detail.asset.id, request(painted, 'manual-edit', { actor: 'human' }));
    appError(() => store.recordReview(run.id, review), 'INSPECTION_REQUIRED');
    appError(() => store.finishRun(run.id, 'completed'), 'REVIEW_REQUIRED');
    store.inspected(run.id, detail.asset.id, changed.revision.id);
    store.recordReview(run.id, { ...review, revisionId: changed.revision.id });
    expect(store.finishRun(run.id, 'completed').status).toBe('completed');
  });

  it('allows only needs_review when the final visual review has unresolved issues', () => {
    const { store, project, detail } = setup();
    const run = store.startRun({ projectId: project.id, assetId: detail.asset.id, prompt: 'Draw body' });
    const painted = store.apply(detail.asset.id, request(detail, 'paint', { runId: run.id }));
    store.inspected(run.id, detail.asset.id, painted.revision.id);
    store.recordReview(run.id, { revisionId: painted.revision.id, observations: 'The body is present but equipment is missing.', issues: ['Missing sword'] });
    appError(() => store.finishRun(run.id, 'completed'), 'NEEDS_REVIEW');
    expect(store.finishRun(run.id, 'needs_review').status).toBe('needs_review');
  });

  it('does not complete a technically valid but empty asset', () => {
    const { store, project, detail } = setup();
    const run = store.startRun({ projectId: project.id, assetId: detail.asset.id, prompt: 'Empty draft' });
    store.inspected(run.id, detail.asset.id, detail.revision.id);
    store.recordReview(run.id, { revisionId: detail.revision.id, observations: 'The canvas is transparent.', issues: [] });
    appError(() => store.finishRun(run.id, 'completed'), 'NEEDS_REVIEW');
    expect(store.finishRun(run.id, 'needs_review').status).toBe('needs_review');
  });
});
