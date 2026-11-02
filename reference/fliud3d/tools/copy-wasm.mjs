// web-ifc loads its WebAssembly at runtime from a URL, so the browser build
// needs the .wasm served next to the page. Copied on every install so the
// file always matches the installed web-ifc version.
import { copyFileSync, mkdirSync } from 'node:fs';

mkdirSync('public/wasm', { recursive: true });
copyFileSync('node_modules/web-ifc/web-ifc.wasm', 'public/wasm/web-ifc.wasm');
console.log('copied web-ifc.wasm -> public/wasm/');
