import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from './store.js';

// One-time maintenance: revisions written before packed storage stay plain JSON until this rewrites them.
// Stop the app first and keep a copy of the data folder; older Pixelator versions cannot read packed revisions.
const dataDir = resolve(process.env.PIXELATOR_DATA_DIR ?? join(fileURLToPath(new URL('..', import.meta.url)), 'data'));
const path = join(dataDir, 'pixelator.sqlite');
if (!existsSync(path)) { console.error(`No database at ${path}.`); process.exit(1); }
const megabytes = (bytes: number) => `${(bytes / 1048576).toFixed(1)} MB`;
const store = new Store(path);
try {
  const result = store.compact();
  console.log(`${path}: packed ${result.revisions} revisions, ${megabytes(result.bytesBefore)} -> ${megabytes(result.bytesAfter)}.`);
} finally { store.close(); }
