// Build script for Vercel (Root Directory = reference/fliud3d):
//   - Serves duplex-fire at / (https://lintel.billyashlet.com/)
//   - Serves duplex-overlay/data at /duplex-overlay/data (resolved by ../duplex-overlay/data)
//   - Preserves the earlier FZK-Haus VR prototype at /v1/
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(root, 'dist');
const interior = resolve(root, '../3d rebuilt scene/室内建筑');
const duplexFire = resolve(interior, 'duplex-fire');
const duplexData = resolve(interior, 'duplex-overlay/data');

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

// 1. Keep the earlier FZK-Haus VR demo under /v1/.
const viteBin = resolve(root, 'node_modules/vite/bin/vite.js');
execFileSync(process.execPath, [viteBin, 'build', '--base=/v1/', '--outDir', resolve(dist, 'v1')], {
  cwd: root,
  stdio: 'inherit',
});

// 2. Copy duplex-fire into dist/ root and converted house geometry into dist/duplex-overlay/data/.
cpSync(resolve(duplexFire, 'index.html'), resolve(dist, 'index.html'));
cpSync(resolve(duplexFire, 'src'), resolve(dist, 'src'), { recursive: true });
cpSync(resolve(duplexFire, 'vendor'), resolve(dist, 'vendor'), { recursive: true });
cpSync(duplexData, resolve(dist, 'duplex-overlay/data'), { recursive: true });

// 3. Sanity-check required runtime files before finishing.
for (const rel of [
  'index.html',
  'src/main.js',
  'src/flames.js',
  'src/firezone.js',
  'src/materials.json',
  'vendor/three.module.js',
  'vendor/three.core.js',
  'vendor/OrbitControls.js',
  'duplex-overlay/data/meta.json',
  'duplex-overlay/data/building.bin',
  'duplex-overlay/data/gas.bin',
  'duplex-overlay/data/water.bin',
  'duplex-overlay/data/heating.bin',
  'v1/index.html',
]) {
  if (!existsSync(resolve(dist, rel))) {
    throw new Error(`[build-vercel] missing expected output file: ${rel}`);
  }
}
console.log('[build-vercel] Ready: duplex-fire at / and FZK-Haus VR v1 at /v1/');
