#!/bin/sh
# Concatenates src/ into a single self-contained index.html.
cd "$(dirname "$0")"
{
  echo '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">'
  echo '<style>:root{color-scheme:light}body{margin:0}[hidden]{display:none!important}</style></head><body>'
  cat src/shell.html
  echo '<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>'
  echo '<script>'
  echo '(function () {'
  echo "if (!window.THREE) { document.getElementById('stage').insertAdjacentHTML('beforeend', '<div class=\"fatal\">The 3D library did not load. Check your connection and reload the page.</div>'); return; }"
  cat src/data.js src/sim.js src/scene.js src/ui.js src/boot.js
  echo '})();'
  echo '</script></body></html>'
} > index.html
