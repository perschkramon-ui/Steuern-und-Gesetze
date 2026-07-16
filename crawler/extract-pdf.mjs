#!/usr/bin/env node
/**
 * PDF-Textextraktion für gecrawlte BMF-PDFs (BMF-Schreiben, AEAO, Broschüren).
 *
 * Nutzt pdfjs-dist (nicht Teil dieses Repos – einmalig installieren, z. B.:
 *   npm install pdfjs-dist@4 --prefix <werkzeug-ordner>
 * und den Pfad per --pdfjs übergeben).
 *
 * Aufruf: node extract-pdf.mjs --cache <bmf-cache-dir> --pdfjs <dir>/node_modules/pdfjs-dist
 * Resumierbar: bereits extrahierte URLs werden übersprungen.
 */

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) =>
  a.startsWith('--') ? [a.slice(2), arr[i + 1]] : null).filter(Boolean));
if (!args.cache || !args.pdfjs) {
  console.error('Pflicht: --cache <bmf-cache-dir> --pdfjs <pdfjs-dist-dir>');
  process.exit(1);
}
const CACHE = path.resolve(args.cache);
// Deckel großzügig: die alten Defaults (200 Seiten / 250k Zeichen) haben
// GROSSE amtliche Texte STILL gekürzt (Betreiber-Fund 2026-07-16: der
// konsolidierte UStAE ~1.200 Seiten war nur zu ~15 % durchsuchbar; 95
// Dokumente betroffen). Kürzungen werden jetzt zusätzlich im Datensatz
// markiert (truncated:true) – Regel „keine stillen Deckel".
const MAX_PAGES = Number(args.maxpages || 3000);
const MAX_CHARS = Number(args.maxchars || 4000000);

const pdfjs = await import(pathToFileURL(path.join(path.resolve(args.pdfjs), 'legacy/build/pdf.mjs')).href);

const metaFile = path.join(CACHE, 'pdfmeta.jsonl');
const outFile = path.join(CACHE, 'pdftexts.jsonl');
if (!fs.existsSync(metaFile)) { console.error(`fehlt: ${metaFile}`); process.exit(1); }

const done = new Set();
if (fs.existsSync(outFile)) {
  for (const line of fs.readFileSync(outFile, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { done.add(JSON.parse(line).url); } catch { /* ignore */ }
  }
}
const out = fs.createWriteStream(outFile, { flags: 'a' });

const entries = fs.readFileSync(metaFile, 'utf8').trim().split('\n')
  .filter(Boolean).map((l) => JSON.parse(l));
// Dedupe über URL (Crawl-Neustarts können Doppel-Zeilen erzeugen)
const seen = new Set();
const todo = entries.filter((e) => !seen.has(e.url) && seen.add(e.url) && !done.has(e.url));
console.log(`PDFs gesamt: ${seen.size}, bereits extrahiert: ${done.size}, offen: ${todo.length}`);

let ok = 0, err = 0;
for (const e of todo) {
  const file = path.join(CACHE, e.file);
  try {
    const data = new Uint8Array(fs.readFileSync(file));
    const doc = await pdfjs.getDocument({ data, useSystemFonts: true, disableFontFace: true, verbosity: 0 }).promise;
    const meta = await doc.getMetadata().catch(() => null);
    const pdfTitle = (meta && meta.info && meta.info.Title || '').trim();
    let text = '';
    const pages = Math.min(doc.numPages, MAX_PAGES);
    for (let p = 1; p <= pages && text.length < MAX_CHARS; p++) {
      const page = await doc.getPage(p);
      const tc = await page.getTextContent();
      text += tc.items.map((it) => it.str).join(' ') + '\n';
    }
    await doc.destroy();
    text = text.replace(/[ \t]+/g, ' ').replace(/ *\n+ */g, '\n').trim();
    const wasTruncated = doc.numPages > MAX_PAGES || text.length > MAX_CHARS;
    text = text.slice(0, MAX_CHARS);
    out.write(JSON.stringify({ url: e.url, file: e.file, from: e.from, bytes: e.bytes, pdfTitle, numPages: doc.numPages, truncated: wasTruncated, text, fetchedAt: e.fetchedAt }) + '\n');
    ok++;
    if (ok % 25 === 0) console.log(`[pdf] ${ok}/${todo.length} extrahiert, err=${err}`);
  } catch (ex) {
    err++;
    out.write(JSON.stringify({ url: e.url, file: e.file, from: e.from, bytes: e.bytes, error: String(ex && ex.message || ex) }) + '\n');
  }
}
console.log(`FERTIG: ${ok} extrahiert, ${err} Fehler`);
out.end();
