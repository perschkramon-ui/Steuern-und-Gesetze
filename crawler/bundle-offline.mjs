#!/usr/bin/env node
/**
 * Baut die Ein-Datei-Ausgabe: webapp/index.html + data/register.js in EINE
 * eigenständige HTML-Datei (Doppelklick genügt, kein Server, kein Ordner).
 * Die KI-Frage-Box funktioniert darin ebenfalls, sobald der lokale Server
 * läuft (http://localhost:8787).
 *
 * Aufruf: node crawler/bundle-offline.mjs   (aus dem Ordner steuerberater-ki)
 * Ausgabe: data/SteuerberaterKI-offline.html
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(ROOT, 'webapp', 'index.html'), 'utf8');
const register = fs.readFileSync(path.join(ROOT, 'data', 'register.js'), 'utf8');

const marker = '<script src="../data/register.js"></script>';
if (!html.includes(marker)) {
  console.error(`Marker nicht gefunden: ${marker}`);
  process.exit(1);
}
// §-Lazy-Blob (base64 = nur [A-Za-z0-9+/=], keine HTML-Parser-Fallen) –
// optional, damit der Bundle-Bau auch ohne Vollausbau-Daten funktioniert.
const normenMarker = '<script src="../data/normen-register.js"></script>';
const normenFile = path.join(ROOT, 'data', 'normen-register.js');
const normenInline = fs.existsSync(normenFile)
  ? `<script>\n${fs.readFileSync(normenFile, 'utf8')}\n</script>`
  : '';
// HTML-Parser-Fallen im Inline-Script escapen (alles steht in JSON-Strings,
// dort sind \/ und \uXXXX gültig): </script beendet das Script, <script und
// <!-- schalten den Parser in den „double escaped"-Zustand (Spec) – alle drei
// kamen mit den BMJV-Seitentexten real im Register vor.
const inline = `<script>\n${register
  .replace(/<\/script/gi, '<\\/script')
  .replace(/<script/gi, '<\\u0073cript')
  .replace(/<!--/g, '<\\u0021--')}\n</script>`;
// WICHTIG: Ersatz als FUNKTION – als String würde JS $-Muster ($', $`, $&)
// im Registerinhalt interpretieren und HTML mitten ins Script injizieren.
const out = html.replace(marker, () => inline).replace(normenMarker, () => normenInline);
const outFile = path.join(ROOT, 'data', 'SteuerberaterKI-offline.html');
fs.writeFileSync(outFile, out);
console.log(`geschrieben: ${outFile} (${(fs.statSync(outFile).size / 1024 / 1024).toFixed(1)} MB)`);
