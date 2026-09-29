/**
 * Exporta los modelos de utilería de PropFactory a assets/models/props.glb
 *
 * Uso (desde la raíz del proyecto):
 *   npm install --no-save three@0.170.0
 *   node tools/build-props.mjs
 *
 * El juego NO necesita Node para ejecutarse: esto solo regenera el GLB.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { buildAllProps } from '../js/world/PropFactory.js';

// GLTFExporter usa FileReader (API de navegador); Node 18+ trae Blob pero no FileReader.
globalThis.FileReader ??= class {
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then((buf) => { this.result = buf; this.onloadend?.(); this.onload?.({ target: this }); });
  }
  readAsDataURL(blob) {
    blob.arrayBuffer().then((buf) => {
      this.result = `data:${blob.type || 'application/octet-stream'};base64,${Buffer.from(buf).toString('base64')}`;
      this.onloadend?.(); this.onload?.({ target: this });
    });
  }
};

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, '../assets/models/props.glb');
mkdirSync(dirname(out), { recursive: true });

const scene = buildAllProps();
new GLTFExporter().parse(
  scene,
  (glb) => {
    writeFileSync(out, Buffer.from(glb));
    console.log(`props.glb exportado (${(glb.byteLength / 1024).toFixed(1)} KB) ->`, out);
    console.log('Nodos:', scene.children.map((c) => c.name).join(', '));
  },
  (err) => { console.error(err); process.exit(1); },
  { binary: true, onlyVisible: true }
);
