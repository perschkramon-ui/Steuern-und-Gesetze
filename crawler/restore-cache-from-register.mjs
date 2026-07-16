#!/usr/bin/env node
/**
 * Rekonstruiert Crawl-Caches aus einem früher gebauten Register
 * (data/register.json + data/corpus.jsonl.gz) – für den Fall, dass die rohen
 * Cache-Dateien verloren gingen (z. B. Container-Neustart), die Inhalte aber
 * bereits committet sind. So muss KEINE Quelle erneut abgerufen werden.
 *
 * Erzeugt je Quell-Host synthetische pages.jsonl / pdfmeta.jsonl /
 * pdftexts.jsonl im Format der Crawler. build-register kann diese Caches als
 * zusätzliche --sites-Einträge NACH den frischen Caches einbinden – die
 * URL-Dedupe bevorzugt dann automatisch frisch gecrawlte Fassungen.
 *
 * Aufruf: node restore-cache-from-register.mjs --data ../data --host bmjv.de \
 *           --out ../bmjv-restored-cache
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) =>
  a.startsWith('--') ? [a.slice(2), arr[i + 1]] : null).filter(Boolean));
if (!args.data || !args.host || !args.out) {
  console.error('Pflicht: --data <data-dir> --host <host ohne www> --out <cache-dir>');
  process.exit(1);
}
const DATA = path.resolve(args.data);
const OUT = path.resolve(args.out);
fs.mkdirSync(OUT, { recursive: true });

const register = JSON.parse(fs.readFileSync(path.join(DATA, 'register.json'), 'utf8'));
// ALLE Korpus-Shards lesen (seit dem Volltext-Vollausbau ist der Korpus in
// corpus.jsonl.gz + corpus-N.jsonl.gz geteilt – nur den ersten zu lesen
// würde die Volltexte der übrigen Shards still verlieren, Review-Fund 2026-07-16)
const corpus = [];
const shardNames = fs.readdirSync(DATA).filter((n) => /^corpus(-\d+)?\.jsonl\.gz$/.test(n)).sort();
if (!shardNames.length) { console.error(`kein corpus*.jsonl.gz in ${DATA}`); process.exit(1); }
for (const n of shardNames) {
  for (const l of zlib.gunzipSync(fs.readFileSync(path.join(DATA, n))).toString('utf8').split('\n')) {
    if (l.trim()) corpus.push(JSON.parse(l));
  }
}
console.log(`Korpus geladen: ${corpus.length} Chunks aus ${shardNames.length} Shard(s)`);

// Volltexte je URL aus den Chunks wieder zusammensetzen (id = <entryId>.<part>)
// + Chunk-Metadaten (kind/title/date) je URL merken: KORPUS-ONLY-Inhalte
// (z. B. kind 'urteil' aus fetch-rii) haben KEINEN register.entries-Eintrag –
// ohne diesen Fallback würde das Restore sie verlieren und der nächste
// Routine-Build sie aus data/ werfen.
const textByUrl = new Map();
const metaByUrl = new Map();
for (const c of corpus) {
  if (c.source !== args.host) continue;
  const part = Number((c.id.split('.')[1]) || 0);
  if (!textByUrl.has(c.url)) textByUrl.set(c.url, []);
  textByUrl.get(c.url)[part] = c.text;
  if (!metaByUrl.has(c.url)) metaByUrl.set(c.url, { kind: c.kind || '', title: c.title || '', date: c.date || '' });
}
const joinText = (u) => (textByUrl.get(u) || []).filter(Boolean).join('\n');

const pages = fs.createWriteStream(path.join(OUT, 'pages.jsonl'));
const pdfMeta = fs.createWriteStream(path.join(OUT, 'pdfmeta.jsonl'));
const pdfTexts = fs.createWriteStream(path.join(OUT, 'pdftexts.jsonl'));
let nSeiten = 0, nPdf = 0, nKorpusOnly = 0;
const restoredUrls = new Set();
for (const e of register.entries) {
  if (e.source !== args.host) continue;
  restoredUrls.add(e.url);
  if (e.kind === 'seite') {
    pages.write(JSON.stringify({
      url: e.url, finalUrl: e.url, kind: 'seite', from: '(register-restore)',
      fetchedAt: register.meta.built, title: e.title, h1: e.title,
      description: e.summary || '', date: e.date || '', text: joinText(e.url),
    }) + '\n');
    nSeiten++;
  } else if (e.kind === 'pdf') {
    pdfMeta.write(JSON.stringify({
      url: e.url, finalUrl: e.url, file: '', bytes: 0, from: '(register-restore)',
      linkText: e.title, fetchedAt: register.meta.built,
    }) + '\n');
    const text = joinText(e.url);
    pdfTexts.write(JSON.stringify({
      url: e.url, file: '', pdfTitle: e.title, numPages: 0, text,
      fetchedAt: register.meta.built,
    }) + '\n');
    nPdf++;
  }
}
// Korpus-only-Inhalte ohne register-Eintrag (kind 'urteil' u. ä.)
for (const [u, meta] of metaByUrl) {
  if (restoredUrls.has(u)) continue;
  pages.write(JSON.stringify({
    url: u, finalUrl: u, kind: meta.kind || 'seite', from: '(register-restore)',
    fetchedAt: register.meta.built, title: meta.title, h1: meta.title,
    description: '', date: meta.date, text: joinText(u),
  }) + '\n');
  nKorpusOnly++;
}
pages.end(); pdfMeta.end(); pdfTexts.end();
console.log(`restauriert für ${args.host}: ${nSeiten} Seiten, ${nPdf} PDFs, ${nKorpusOnly} Korpus-only (Urteile u. ä.) → ${OUT}`);
