// Make tools/flame-lab.html into one file you can double-click, offline:
//   node tools/flame-lab-standalone.mjs [out.html]
// A file:// page cannot import the files next to it, so everything goes in:
// vendor/ three.js (as text, turned into blob: modules by a small loader
// that then writes the import map), src/flames.js pasted into the page's own
// script (and src/firezone.js). A first version loaded three.js from a CDN instead; the CDN did not
// load in the app's browser, and the page then showed only its buttons.
// Default output: 进度/B/火焰演示.html (about 2 MB).
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = process.argv[2] ?? join(here, '../../进度/B/火焰演示.html');
const read = (p) => readFileSync(join(here, p), 'utf8');

let html = read('flame-lab.html');
let flames = read('../src/flames.js');
flames = flames.replace(/^import \* as THREE from 'three';\n/m, '').replace(/^export /gm, '');

const swap = (from, to) => {
  if (!html.includes(from)) throw new Error(`not found in flame-lab.html: ${from.slice(0, 60)}`);
  html = html.replace(from, () => to);
};
// Code kept as text must not end its <script> early.
const asText = (id, src) => {
  if (/<\/script/i.test(src)) throw new Error(`${id} contains </script`);
  return `<script type="text/plain" id="${id}">${src}</script>\n`;
};

// 1. The page's own module, with flames.js in it, becomes text too: it may
//    only run once the import map below exists.
const open = '<script type="module">\n';
const start = html.indexOf(open), end = html.indexOf('</script>', start);
if (start < 0 || end < 0) throw new Error('no module script in flame-lab.html');
let main = html.slice(start + open.length, end);
let firezone = read('../src/firezone.js');
firezone = firezone.replace(/^import \* as THREE from 'three';\n/m, '').replace(/^export /gm, '');
main = main.replace("import { makeFlames } from '../src/flames.js';", () => `// --- src/flames.js, pasted in by tools/flame-lab-standalone.mjs ---\n${flames}\n// --- end of src/flames.js ---`);
main = main.replace("import { makeZone, ZONE_GLSL, fadeForZone } from '../src/firezone.js';", () => `// --- src/firezone.js, pasted in ---\n${firezone}\n// --- end of src/firezone.js ---`);
if (main.includes('../src/')) throw new Error('a src/ import was not replaced');
html = html.slice(0, start) + asText('src-main', main) + html.slice(end + '</script>'.length + 1);

// 2. three.js as text, and the loader that makes modules of it.
const loader = `<script>
// Turn the three.js text below into modules (blob: URLs), write the import
// map, then run the page (flame-lab-standalone.mjs).
(() => {
  const text = (id) => document.getElementById(id).textContent;
  const url = (s) => URL.createObjectURL(new Blob([s], { type: 'text/javascript' }));
  const core = url(text('src-three-core'));
  const three = url(text('src-three').split("'./three.core.js'").join(JSON.stringify(core)));
  const map = document.createElement('script');
  map.type = 'importmap';
  map.textContent = JSON.stringify({ imports: { three, 'three/addons/OrbitControls.js': url(text('src-orbit')) } });
  document.head.appendChild(map);
  addEventListener('DOMContentLoaded', () => {
    const main = document.createElement('script');
    main.type = 'module';
    main.textContent = text('src-main');
    document.body.appendChild(main);
  });
})();
</script>
`;
swap(/<script type="importmap">.*<\/script>\n/.exec(html)[0],
  asText('src-three-core', read('../vendor/three.core.js')) + asText('src-three', read('../vendor/three.module.js')) +
  asText('src-orbit', read('../vendor/OrbitControls.js')) + loader);
writeFileSync(out, html);
console.log(`wrote ${out} (${(html.length / 1024 / 1024).toFixed(1)} MB)`);
