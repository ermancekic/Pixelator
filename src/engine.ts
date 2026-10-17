import type {
  EditScope, Issue, Operation, PixelDiff, PixelDocument, PixelLayer, PixelStyle,
  ProjectStyle, Rect, ValidationReport,
} from './types.js';

export const DEFAULT_PALETTE = [
  '#00000000', '#140C1C', '#442434', '#30346D', '#4E4A4E', '#854C30', '#346524',
  '#D04648', '#757161', '#597DCE', '#D27D2C', '#8595A1', '#6DAA2C', '#D2AA99',
  '#6DC2CA', '#DAD45E', '#DEEED6',
];

function preset(preset: PixelStyle, palette: string[]): ProjectStyle {
  return {
    preset, palette, maxColors: palette.length - 1, paletteLocked: false,
    width: 32, height: 32, perspective: 'side', lighting: 'upper-left',
    outline: 'single-pixel', theme: 'neutral',
  };
}

export const STYLE_PRESETS: Record<PixelStyle, ProjectStyle> = {
  '1-bit': preset('1-bit', ['#00000000', '#171820', '#F4F4DC']),
  'game-boy': preset('game-boy', ['#00000000', '#0F380F', '#306230', '#8BAC0F', '#9BBC0F']),
  '8-bit': preset('8-bit', [...DEFAULT_PALETTE]),
  '16-bit': preset('16-bit', [...DEFAULT_PALETTE]),
};

const MAX_LAYERS = 32;
const MAX_OPERATIONS = 512;
const MAX_POINTS = 4096;
const integer = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value);
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const identifier = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value);
const name = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= 160;
const inside = (rect: Rect, x: number, y: number) => x >= rect.x && y >= rect.y && x < rect.x + rect.width && y < rect.y + rect.height;

function fail(code: string, message: string): never { throw new Error(`${code}: ${message}`); }
function requireValue(condition: unknown, code: string, message: string): asserts condition {
  if (!condition) fail(code, message);
}

function paletteIssues(palette: unknown, maxColors: number): Issue[] {
  const issue = (message: string): Issue[] => [{ code: 'INVALID_PALETTE', severity: 'error', message }];
  if (!Array.isArray(palette) || palette.length < 2 || palette.length > maxColors + 1) return issue('Palette must contain transparency and 1..maxColors opaque colors.');
  if (palette[0] !== '#00000000') return issue('Palette index 0 must be #00000000.');
  if (Array.from(palette.slice(1)).some(color => typeof color !== 'string' || !/^#[0-9a-f]{6}$/i.test(color))) return issue('Opaque palette colors must be #RRGGBB.');
  if (new Set(palette.map(color => color.toUpperCase())).size !== palette.length) return issue('Palette colors must be unique.');
  return [];
}

function renderUnchecked(doc: PixelDocument): Uint8Array {
  const result = new Uint8Array(doc.width * doc.height * 4);
  const palette = doc.palette.map((color, index) => index === 0 ? [0, 0, 0, 0] : [
    parseInt(color.slice(1, 3), 16), parseInt(color.slice(3, 5), 16), parseInt(color.slice(5, 7), 16), 255,
  ]);
  for (const layer of doc.layers) {
    if (!layer.visible) continue;
    for (let i = 0; i < layer.pixels.length; i++) {
      if (layer.pixels[i] !== 0) result.set(palette[layer.pixels[i]], i * 4);
    }
  }
  return result;
}

function bounds(indices: Iterable<number>, width: number): Rect | null {
  let x0 = Infinity; let y0 = Infinity; let x1 = -1; let y1 = -1;
  for (const i of indices) {
    const x = i % width; const y = Math.floor(i / width);
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  }
  return x1 < 0 ? null : { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
}

export function validateDocument(doc: PixelDocument): ValidationReport {
  const issues: Issue[] = [];
  const error = (code: string, message: string, layerId?: string) => issues.push({ code, severity: 'error', message, ...(layerId ? { layerId } : {}) });
  const report: ValidationReport = { valid: false, issues, colorCount: 0, opaquePixels: 0, boundingBox: null, isolatedPixels: 0 };
  if (!object(doc)) { error('INVALID_DOCUMENT', 'Document must be an object.'); return report; }
  if (doc.schemaVersion !== 1) error('INVALID_SCHEMA', 'schemaVersion must be 1.');
  if (!integer(doc.width) || doc.width < 1 || doc.width > 64 || !integer(doc.height) || doc.height < 1 || doc.height > 64) error('INVALID_SIZE', 'Canvas dimensions must be integers in 1..64.');
  if (!integer(doc.maxColors) || doc.maxColors < 1 || doc.maxColors > 32) error('INVALID_COLOR_LIMIT', 'maxColors must be an integer in 1..32.');
  issues.push(...paletteIssues(doc.palette, integer(doc.maxColors) ? doc.maxColors : 32));
  if (typeof doc.paletteLocked !== 'boolean') error('INVALID_DOCUMENT', 'paletteLocked must be boolean.');
  if (!object(doc.pivot) || typeof doc.pivot.x !== 'number' || !Number.isFinite(doc.pivot.x) || doc.pivot.x < 0 || doc.pivot.x > doc.width || typeof doc.pivot.y !== 'number' || !Number.isFinite(doc.pivot.y) || doc.pivot.y < 0 || doc.pivot.y > doc.height) error('INVALID_PIVOT', 'Pivot must use pixel coordinates inside the canvas edges.');
  if (!Array.isArray(doc.layers) || doc.layers.length < 1 || doc.layers.length > MAX_LAYERS) {
    error('INVALID_LAYERS', `Document must contain 1..${MAX_LAYERS} layers.`);
    return report;
  }
  const ids = new Set<string>();
  for (const layer of doc.layers) {
    if (!object(layer)) { error('INVALID_LAYER', 'Each layer must be an object.'); continue; }
    if (!identifier(layer.id) || ids.has(layer.id)) error('INVALID_LAYER_ID', 'Layer IDs must be unique identifiers.');
    else ids.add(layer.id);
    if (!name(layer.name) || typeof layer.visible !== 'boolean' || typeof layer.locked !== 'boolean') error('INVALID_LAYER', 'Layer name, visibility or lock is invalid.', layer.id);
    if (!Array.isArray(layer.pixels) || layer.pixels.length !== doc.width * doc.height || Array.from(layer.pixels).some(pixel => !integer(pixel) || pixel < 0 || !Array.isArray(doc.palette) || pixel >= doc.palette.length)) error('INVALID_PIXELS', 'Pixels must contain exactly one valid palette index per canvas cell.', layer.id);
  }
  if (issues.some(issue => issue.severity === 'error')) return report;
  const rgba = renderUnchecked(doc);
  const occupied: number[] = []; const colors = new Set<string>();
  for (let i = 0; i < doc.width * doc.height; i++) {
    if (!rgba[i * 4 + 3]) continue;
    occupied.push(i); colors.add(`${rgba[i * 4]},${rgba[i * 4 + 1]},${rgba[i * 4 + 2]}`);
    const x = i % doc.width; const y = Math.floor(i / doc.width);
    let neighbor = false;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if ((dx || dy) && x + dx >= 0 && x + dx < doc.width && y + dy >= 0 && y + dy < doc.height && rgba[((y + dy) * doc.width + x + dx) * 4 + 3]) neighbor = true;
    }
    if (!neighbor) report.isolatedPixels++;
  }
  report.valid = true; report.colorCount = colors.size; report.opaquePixels = occupied.length; report.boundingBox = bounds(occupied, doc.width);
  if (!occupied.length) issues.push({ code: 'EMPTY_ASSET', severity: 'warning', message: 'Asset has no visible pixels.' });
  if (report.isolatedPixels) issues.push({ code: 'ISOLATED_PIXELS', severity: 'warning', message: `${report.isolatedPixels} visible pixels have no opaque neighbor.` });
  return report;
}

function assertDocument(doc: PixelDocument): void {
  const report = validateDocument(doc);
  const error = report.issues.find(issue => issue.severity === 'error');
  if (error) fail(error.code, error.message);
}

export function createDocument(input: {
  width: number; height: number; palette?: string[]; maxColors?: number; paletteLocked?: boolean;
  layers?: { id: string; name: string }[]; pivot?: { x: number; y: number };
}): PixelDocument {
  requireValue(object(input), 'INVALID_DOCUMENT', 'Document options must be an object.');
  requireValue(integer(input.width) && input.width >= 1 && input.width <= 64 && integer(input.height) && input.height >= 1 && input.height <= 64, 'INVALID_SIZE', 'Canvas dimensions must be integers in 1..64.');
  const palette = input.palette ?? DEFAULT_PALETTE;
  requireValue(Array.isArray(palette), 'INVALID_PALETTE', 'Palette must be an array.');
  const layerOptions = input.layers ?? [{ id: 'base', name: 'Base' }];
  requireValue(Array.isArray(layerOptions) && layerOptions.length >= 1 && layerOptions.length <= MAX_LAYERS, 'INVALID_LAYERS', 'Invalid layer list.');
  requireValue(Array.from(layerOptions).every(layer => object(layer)), 'INVALID_LAYER', 'Layer options must be objects.');
  const doc: PixelDocument = {
    schemaVersion: 1, width: input.width, height: input.height,
    palette: [...palette], maxColors: input.maxColors ?? palette.length - 1, paletteLocked: input.paletteLocked ?? false,
    layers: layerOptions.map(layer => ({ id: layer.id, name: layer.name, visible: true, locked: false, pixels: new Array(input.width * input.height).fill(0) })),
    pivot: input.pivot ? { ...input.pivot } : { x: input.width / 2, y: input.height / 2 },
  };
  assertDocument(doc);
  return doc;
}

export function composite(doc: PixelDocument): Uint8Array {
  assertDocument(doc);
  return renderUnchecked(doc);
}

export function applyOperations(original: PixelDocument, operations: Operation[], editScope: EditScope): {
  document: PixelDocument; diff: PixelDiff; validation: ValidationReport;
} {
  assertDocument(original);
  requireValue(Array.isArray(operations) && operations.length >= 1 && operations.length <= MAX_OPERATIONS, 'INVALID_BATCH', `A batch must contain 1..${MAX_OPERATIONS} operations.`);
  requireValue(object(editScope) && Array.isArray(editScope.layerIds) && editScope.layerIds.length > 0 && editScope.layerIds.length <= MAX_LAYERS && Array.from(editScope.layerIds).every(identifier) && new Set(editScope.layerIds).size === editScope.layerIds.length, 'INVALID_SCOPE', 'Scope must contain unique layer IDs.');
  requireValue(editScope.allowLayerChanges === undefined || typeof editScope.allowLayerChanges === 'boolean', 'INVALID_SCOPE', 'allowLayerChanges must be boolean.');
  requireValue(editScope.allowPaletteChanges === undefined || typeof editScope.allowPaletteChanges === 'boolean', 'INVALID_SCOPE', 'allowPaletteChanges must be boolean.');
  const doc = structuredClone(original);
  const canvas: Rect = { x: 0, y: 0, width: doc.width, height: doc.height };
  const rect = (value: unknown): Rect => {
    requireValue(object(value) && integer(value.x) && integer(value.y) && integer(value.width) && integer(value.height) && value.width >= 1 && value.height >= 1 && value.x >= 0 && value.y >= 0 && value.x + value.width <= doc.width && value.y + value.height <= doc.height, 'INVALID_RECT', 'Rectangle must have positive integer dimensions inside the canvas.');
    return value as unknown as Rect;
  };
  const scopeRect = editScope.rect === undefined ? undefined : rect(editScope.rect);
  const allowedLayers = new Set(editScope.layerIds);
  requireValue(editScope.layerIds.every(id => doc.layers.some(layer => layer.id === id)), 'INVALID_SCOPE', 'Scope contains an unknown layer.');
  const fullScope = !scopeRect && doc.layers.every(layer => allowedLayers.has(layer.id));
  const requireLayerChanges = () => requireValue(fullScope && editScope.allowLayerChanges === true, 'LAYER_CHANGE_FORBIDDEN', 'Layer and document metadata changes require full scope and allowLayerChanges.');
  const layerFor = (id: unknown, writable = true): PixelLayer => {
    requireValue(typeof id === 'string', 'INVALID_LAYER_ID', 'layerId must be a string.');
    const layer = doc.layers.find(layer => layer.id === id);
    requireValue(layer, 'UNKNOWN_LAYER', `Unknown layer: ${id}.`);
    requireValue(allowedLayers.has(id), 'SCOPE_VIOLATION', `Layer ${id} is outside the edit scope.`);
    if (writable) requireValue(!layer.locked, 'LAYER_LOCKED', `Layer ${id} is locked.`);
    return layer;
  };
  const color = (value: unknown): number => {
    requireValue(integer(value) && value >= 0 && value < doc.palette.length, 'INVALID_COLOR', 'Color must be an existing palette index.');
    return value;
  };
  const coordinate = (value: unknown): number => {
    requireValue(integer(value) && value >= -4096 && value <= 4096, 'INVALID_COORDINATE', 'Coordinates must be bounded integers.');
    return value;
  };
  const write = (layer: PixelLayer, x: number, y: number, value: number) => {
    if (!inside(canvas, x, y)) {
      if (value !== 0) fail('OUT_OF_BOUNDS', 'Operation would clip an opaque pixel.');
      return;
    }
    const index = y * doc.width + x;
    if (layer.pixels[index] === value) return;
    requireValue(!scopeRect || inside(scopeRect, x, y), 'SCOPE_VIOLATION', 'Operation changes pixels outside the edit rectangle.');
    layer.pixels[index] = value;
  };
  const line = (layer: PixelLayer, x1: number, y1: number, x2: number, y2: number, value: number) => {
    const dx = Math.abs(x2 - x1); const dy = -Math.abs(y2 - y1);
    const sx = x1 < x2 ? 1 : -1; const sy = y1 < y2 ? 1 : -1;
    let error = dx + dy;
    for (;;) {
      write(layer, x1, y1, value);
      if (x1 === x2 && y1 === y2) break;
      const twice = 2 * error;
      if (twice >= dy) { error += dy; x1 += sx; }
      if (twice <= dx) { error += dx; y1 += sy; }
    }
  };

  for (const operation of operations) {
    requireValue(object(operation) && typeof operation.op === 'string', 'INVALID_OPERATION', 'Operation must be a named object.');
    switch (operation.op) {
      case 'pixels': {
        const layer = layerFor(operation.layerId);
        requireValue(Array.isArray(operation.points) && operation.points.length <= MAX_POINTS, 'INVALID_POINTS', `Pixel batches are limited to ${MAX_POINTS} points.`);
        for (const point of operation.points) {
          requireValue(Array.isArray(point) && point.length === 3, 'INVALID_POINTS', 'A pixel point must contain x, y, color.');
          write(layer, coordinate(point[0]), coordinate(point[1]), color(point[2]));
        }
        break;
      }
      case 'patch': {
        const layer = layerFor(operation.layerId);
        const area = rect(operation);
        requireValue(Array.isArray(operation.pixels) && operation.pixels.length === area.width * area.height, 'INVALID_PATCH', 'Patch pixels must match its dimensions.');
        for (let i = 0; i < operation.pixels.length; i++) write(layer, area.x + i % area.width, area.y + Math.floor(i / area.width), color(operation.pixels[i]));
        break;
      }
      case 'line': {
        line(layerFor(operation.layerId), coordinate(operation.x1), coordinate(operation.y1), coordinate(operation.x2), coordinate(operation.y2), color(operation.color));
        break;
      }
      case 'rect': case 'ellipse': {
        const layer = layerFor(operation.layerId); const area = rect(operation); const value = color(operation.color);
        requireValue(operation.filled === undefined || typeof operation.filled === 'boolean', 'INVALID_OPERATION', 'filled must be boolean.');
        const filled = operation.filled ?? true;
        const ellipseInside = (x: number, y: number) => {
          const dx = 2 * x + 1 - area.width; const dy = 2 * y + 1 - area.height;
          return dx * dx * area.height * area.height + dy * dy * area.width * area.width <= area.width * area.width * area.height * area.height;
        };
        for (let y = 0; y < area.height; y++) for (let x = 0; x < area.width; x++) {
          const selected = operation.op === 'rect'
            ? filled || x === 0 || y === 0 || x === area.width - 1 || y === area.height - 1
            : ellipseInside(x, y) && (filled || !ellipseInside(x - 1, y) || !ellipseInside(x + 1, y) || !ellipseInside(x, y - 1) || !ellipseInside(x, y + 1));
          if (selected) write(layer, area.x + x, area.y + y, value);
        }
        break;
      }
      case 'polygon': {
        const layer = layerFor(operation.layerId); const value = color(operation.color);
        requireValue(Array.isArray(operation.points) && operation.points.length >= 3 && operation.points.length <= 128, 'INVALID_POINTS', 'Polygons need 3..128 vertices.');
        const points = Array.from(operation.points, point => {
          requireValue(Array.isArray(point) && point.length === 2, 'INVALID_POINTS', 'A polygon vertex must contain x, y.');
          const x = coordinate(point[0]); const y = coordinate(point[1]);
          requireValue(inside(canvas, x, y), 'OUT_OF_BOUNDS', 'Polygon vertices must be inside the canvas.');
          return [x, y];
        });
        for (let y = 0; y < doc.height; y++) for (let x = 0; x < doc.width; x++) {
          let selected = false;
          for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
            const [xi, yi] = points[i]; const [xj, yj] = points[j];
            if ((yi > y + 0.5) !== (yj > y + 0.5) && x + 0.5 < (xj - xi) * (y + 0.5 - yi) / (yj - yi) + xi) selected = !selected;
          }
          if (selected) write(layer, x, y, value);
        }
        for (let i = 0; i < points.length; i++) {
          const next = points[(i + 1) % points.length];
          line(layer, points[i][0], points[i][1], next[0], next[1], value);
        }
        break;
      }
      case 'fill': {
        const layer = layerFor(operation.layerId); const value = color(operation.color);
        const x = coordinate(operation.x); const y = coordinate(operation.y);
        requireValue(inside(canvas, x, y), 'OUT_OF_BOUNDS', 'Fill start must be inside the canvas.');
        requireValue(!scopeRect || inside(scopeRect, x, y), 'SCOPE_VIOLATION', 'Fill start must be inside the edit rectangle.');
        const from = layer.pixels[y * doc.width + x];
        if (from === value) break;
        const queue = [y * doc.width + x]; const seen = new Set<number>();
        for (let i = 0; i < queue.length; i++) {
          const position = queue[i];
          if (seen.has(position) || layer.pixels[position] !== from) continue;
          seen.add(position);
          const px = position % doc.width; const py = Math.floor(position / doc.width);
          if (scopeRect && !inside(scopeRect, px, py)) continue;
          write(layer, px, py, value);
          if (px > 0) queue.push(position - 1);
          if (px + 1 < doc.width) queue.push(position + 1);
          if (py > 0) queue.push(position - doc.width);
          if (py + 1 < doc.height) queue.push(position + doc.width);
        }
        break;
      }
      case 'move': case 'copy': case 'flip': case 'rotate': {
        const layer = layerFor(operation.layerId); const area = operation.rect === undefined ? canvas : rect(operation.rect);
        const source = layer.pixels.slice();
        let dx = 0; let dy = 0;
        if (operation.op === 'move' || operation.op === 'copy') { dx = coordinate(operation.dx); dy = coordinate(operation.dy); }
        if (operation.op === 'flip') requireValue(operation.axis === 'x' || operation.axis === 'y', 'INVALID_OPERATION', 'Flip axis must be x or y.');
        if (operation.op === 'rotate') requireValue(operation.turns === 1 || operation.turns === 2 || operation.turns === 3, 'INVALID_OPERATION', 'Rotation turns must be 1, 2 or 3 clockwise quarter turns.');
        if (operation.op !== 'copy') for (let y = area.y; y < area.y + area.height; y++) for (let x = area.x; x < area.x + area.width; x++) write(layer, x, y, 0);
        for (let y = 0; y < area.height; y++) for (let x = 0; x < area.width; x++) {
          let tx = x + dx; let ty = y + dy;
          if (operation.op === 'flip') { tx = operation.axis === 'x' ? area.width - 1 - x : x; ty = operation.axis === 'y' ? area.height - 1 - y : y; }
          if (operation.op === 'rotate') {
            if (operation.turns === 1) { tx = area.height - 1 - y; ty = x; }
            if (operation.turns === 2) { tx = area.width - 1 - x; ty = area.height - 1 - y; }
            if (operation.turns === 3) { tx = y; ty = area.width - 1 - x; }
          }
          write(layer, area.x + tx, area.y + ty, source[(area.y + y) * doc.width + area.x + x]);
        }
        break;
      }
      case 'replace': {
        const layer = layerFor(operation.layerId); const from = color(operation.from); const to = color(operation.to);
        const area = operation.rect === undefined ? scopeRect ?? canvas : rect(operation.rect);
        for (let y = area.y; y < area.y + area.height; y++) for (let x = area.x; x < area.x + area.width; x++) {
          if (layer.pixels[y * doc.width + x] === from) write(layer, x, y, to);
        }
        break;
      }
      case 'outline': {
        const layer = layerFor(operation.layerId); const value = color(operation.color); const source = layer.pixels.slice();
        requireValue(value !== 0, 'INVALID_COLOR', 'Outline must use an opaque color.');
        for (let y = 0; y < doc.height; y++) for (let x = 0; x < doc.width; x++) {
          if (source[y * doc.width + x]) continue;
          let neighbor = false;
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
            if (inside(canvas, x + dx, y + dy) && source[(y + dy) * doc.width + x + dx]) neighbor = true;
          }
          if (neighbor) write(layer, x, y, value);
        }
        break;
      }
      case 'add_layer': {
        requireLayerChanges();
        requireValue(identifier(operation.id) && name(operation.name), 'INVALID_LAYER', 'New layer needs a valid ID and name.');
        requireValue(doc.layers.length < MAX_LAYERS && !doc.layers.some(layer => layer.id === operation.id), 'INVALID_LAYERS', 'Layer limit exceeded or ID already exists.');
        doc.layers.push({ id: operation.id, name: operation.name, visible: true, locked: false, pixels: new Array(doc.width * doc.height).fill(0) });
        allowedLayers.add(operation.id);
        break;
      }
      case 'remove_layer': {
        requireLayerChanges(); layerFor(operation.layerId);
        requireValue(doc.layers.length > 1, 'INVALID_LAYERS', 'Cannot remove the last layer.');
        doc.layers = doc.layers.filter(layer => layer.id !== operation.layerId);
        break;
      }
      case 'update_layer': {
        requireLayerChanges(); const layer = layerFor(operation.layerId, false);
        if (operation.name !== undefined) { requireValue(name(operation.name), 'INVALID_LAYER', 'Invalid layer name.'); layer.name = operation.name; }
        if (operation.visible !== undefined) { requireValue(typeof operation.visible === 'boolean', 'INVALID_LAYER', 'visible must be boolean.'); layer.visible = operation.visible; }
        if (operation.locked !== undefined) { requireValue(typeof operation.locked === 'boolean', 'INVALID_LAYER', 'locked must be boolean.'); layer.locked = operation.locked; }
        break;
      }
      case 'reorder_layers': {
        requireLayerChanges();
        requireValue(Array.isArray(operation.layerIds) && operation.layerIds.length === doc.layers.length && new Set(operation.layerIds).size === doc.layers.length && operation.layerIds.every(id => doc.layers.some(layer => layer.id === id)), 'INVALID_LAYERS', 'Reorder must contain every layer exactly once.');
        doc.layers = operation.layerIds.map(id => doc.layers.find(layer => layer.id === id)!);
        break;
      }
      case 'palette': {
        requireValue(fullScope && editScope.allowPaletteChanges === true, 'PALETTE_CHANGE_FORBIDDEN', 'Palette changes require full scope and allowPaletteChanges.');
        requireValue(!doc.paletteLocked, 'PALETTE_LOCKED', 'This asset palette is locked.');
        const issues = paletteIssues(operation.colors, doc.maxColors);
        requireValue(!issues.length, 'INVALID_PALETTE', issues[0]?.message ?? 'Invalid palette.');
        for (const layer of doc.layers) {
          requireValue(!layer.locked || layer.pixels.every(index => doc.palette[index].toUpperCase() === operation.colors[index]?.toUpperCase()), 'LAYER_LOCKED', `Palette would change locked layer ${layer.id}.`);
        }
        doc.palette = [...operation.colors];
        break;
      }
      case 'pivot': {
        requireLayerChanges();
        requireValue(typeof operation.x === 'number' && Number.isFinite(operation.x) && operation.x >= 0 && operation.x <= doc.width && typeof operation.y === 'number' && Number.isFinite(operation.y) && operation.y >= 0 && operation.y <= doc.height, 'INVALID_PIVOT', 'Pivot must lie within canvas edges.');
        doc.pivot = { x: operation.x, y: operation.y };
        break;
      }
      default: fail('UNKNOWN_OPERATION', `Unknown operation: ${(operation as { op: string }).op}.`);
    }
  }

  const validation = validateDocument(doc);
  requireValue(validation.valid, validation.issues[0]?.code ?? 'INVALID_DOCUMENT', validation.issues[0]?.message ?? 'Invalid operation result.');
  const before = renderUnchecked(original); const after = renderUnchecked(doc);
  const changedPositions = new Set<number>(); const changedLayers: string[] = [];
  for (let i = 0; i < doc.width * doc.height; i++) {
    const rgbaChanged = before.subarray(i * 4, i * 4 + 4).some((value, channel) => value !== after[i * 4 + channel]);
    if (rgbaChanged) {
      requireValue(!scopeRect || inside(scopeRect, i % doc.width, Math.floor(i / doc.width)), 'SCOPE_VIOLATION', 'Rendered pixels changed outside the edit rectangle.');
      changedPositions.add(i);
    }
  }
  const ids = new Set([...original.layers.map(layer => layer.id), ...doc.layers.map(layer => layer.id)]);
  for (const id of ids) {
    const oldLayer = original.layers.find(layer => layer.id === id); const newLayer = doc.layers.find(layer => layer.id === id);
    let changed = !oldLayer || !newLayer || oldLayer.name !== newLayer.name || oldLayer.visible !== newLayer.visible || oldLayer.locked !== newLayer.locked || original.layers.indexOf(oldLayer) !== doc.layers.indexOf(newLayer);
    for (let i = 0; i < doc.width * doc.height; i++) {
      const a = oldLayer?.pixels[i] ?? 0; const b = newLayer?.pixels[i] ?? 0;
      if (a !== b || original.palette[a] !== doc.palette[b]) {
        changed = true; changedPositions.add(i);
        requireValue(allowedLayers.has(id) && (!scopeRect || inside(scopeRect, i % doc.width, Math.floor(i / doc.width))), 'SCOPE_VIOLATION', 'Stored pixels changed outside the edit scope.');
      }
    }
    if (changed) changedLayers.push(id);
  }
  return { document: doc, diff: { changedPixels: changedPositions.size, changedLayers, boundingBox: bounds(changedPositions, doc.width) }, validation };
}
