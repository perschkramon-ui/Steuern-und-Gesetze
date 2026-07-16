#!/usr/bin/env node
/**
 * Importiert einen Ordner voller PDFs (z. B. den entpackten Inhalt eines
 * amtlichen ZIP-Downloads) in einen Crawl-Cache, damit extract-pdf.mjs und
 * build-register.mjs sie wie gecrawlte PDFs verarbeiten.
 *
 * Anlass (Preflight 2026-07-16): Die DSFinV-K-Dokumente liegen beim BZSt
 * NUR in ZIP-Archiven (dsfinv_k_v_2_4.zip) – crawl-site.mjs lädt nur PDFs.
 * Ablauf: ZIP von Hand laden + entpacken (PowerShell Expand-Archive /
 * unzip), dann diesen Importer auf den entpackten Ordner zeigen.
 *
 * Aufruf:
 *   node import-pdf-dir.mjs --dir <entpackter-ordner> --cache <cache-dir> \
 *     --source-url "<amtliche ZIP-URL>" [--from "(zip-import)"]
 *
 * Jedes PDF bekommt als Register-URL  <source-url>#<relativer-pfad>  – der
 * Anzeige-Link führt Menschen zum amtlichen ZIP-Download, das Fragment
 * benennt die Datei darin. Idempotent: bereits importierte URLs werden
 * übersprungen (Dedupe über pdfmeta.jsonl).
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) =>
  a.startsWith('--') ? [a.slice(2), arr[i + 1]] : null).filter(Boolean));
if (!args.dir || !args.cache || !args['source-url']) {
  console.error('Pflicht: --dir <pdf-ordner> --cache <cache-dir> --source-url "<amtliche-url>"');
  process.exit(1);
}
const DIR = path.resolve(args.dir);
const CACHE = path.resolve(args.cache);
const SRC = args['source-url'];
const FROM = args.from || '(zip-import)';
fs.mkdirSync(path.join(CACHE, 'pdfs'), { recursive: true });

const metaFile = path.join(CACHE, 'pdfmeta.jsonl');
const done = new Set();
if (fs.existsSync(metaFile)) {
  for (const line of fs.readFileSync(metaFile, 'utf8').split(/\r?\n/)) {
    if (!line.trim()) continue;
    try { done.add(JSON.parse(line).url); } catch { /* ignore */ }
  }
}

const pdfs = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.pdf$/i.test(e.name)) pdfs.push(p);
  }
})(DIR);
if (!pdfs.length) { console.error(`keine PDFs unter ${DIR}`); process.exit(1); }

let ok = 0, skip = 0;
for (const p of pdfs.sort()) {
  const rel = path.relative(DIR, p).replaceAll('\\', '/');
  const url = `${SRC}#${encodeURIComponent(rel)}`;
  if (done.has(url)) { skip++; continue; }
  const body = fs.readFileSync(p);
  if (body.subarray(0, 5).toString() !== '%PDF-') { console.warn(`übersprungen (kein PDF): ${rel}`); continue; }
  const sha = crypto.createHash('sha1').update(url).digest('hex').slice(0, 16);
  const file = `pdfs/${sha}.pdf`;
  fs.writeFileSync(path.join(CACHE, file), body);
  fs.appendFileSync(metaFile, JSON.stringify({
    url, finalUrl: url, file, bytes: body.length, from: FROM,
    linkText: path.basename(rel, path.extname(rel)).replace(/[_-]+/g, ' '),
    fetchedAt: new Date().toISOString(),
  }) + '\n');
  ok++;
}
console.log(`FERTIG: ${ok} PDFs importiert, ${skip} bereits vorhanden → ${CACHE}`);
console.log('Weiter mit: node extract-pdf.mjs --cache <cache-dir> --pdfjs <pdfjs-dist>');
