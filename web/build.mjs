#!/usr/bin/env node
// Builds the page from src/ into dist/:
//   dist/index.html     standalone page (what the collector serves)
//   dist/artifact.html  body-only version for publishing as a claude.ai artifact
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const src = f => fs.readFileSync(path.join(dir, 'src', f), 'utf8');
const ORDER = ['data.js', 'sim.js', 'k8s.js', 'scene.js', 'kscene.js', 'ui.js', 'kui.js', 'live.js', 'boot.js'];
const app = ORDER.map(src).join('\n');
const scripts = `<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>
<script>
function __repoYard() {
${app}
}
(function start() {
  if (window.THREE) return __repoYard();
  // CDN blocked (common on corporate networks): use the copy the collector serves
  var s = document.createElement('script');
  s.src = 'vendor/three.min.js';
  s.onload = function () { __repoYard(); };
  s.onerror = function () { document.getElementById('stage').insertAdjacentHTML('beforeend', '<div class="fatal">The 3D library did not load. Check your connection and reload the page.</div>'); };
  document.head.appendChild(s);
})();
</script>`;
const shell = src('shell.html');
fs.mkdirSync(path.join(dir, 'dist'), { recursive: true });
fs.writeFileSync(path.join(dir, 'dist', 'artifact.html'), `${shell}\n${scripts}\n`);
fs.writeFileSync(path.join(dir, 'dist', 'index.html'), `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<style>:root{color-scheme:light}body{margin:0}[hidden]{display:none!important}img{max-width:100%}</style></head>
<body>
${shell}
${scripts}
</body></html>
`);
console.log(`Built ${path.join(dir, 'dist')} (index.html, artifact.html)`);
