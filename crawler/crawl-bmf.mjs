#!/usr/bin/env node
/**
 * BMF-Crawler für das Steuerrecht-Register (Steuerberater KI) – rohe HTTP-Variante.
 *
 * Crawlt den Themenbereich Steuern des Bundesfinanzministeriums rekursiv:
 *   - HTML im Scope /Web/DE/Themen/Steuern/** (+ BMF-Schreiben-Bereiche)
 *   - verlinkte Inhaltsseiten unter /Content/DE/** (eine Ebene, kein Drift)
 *   - alle verlinkten PDFs (BMF-Schreiben etc.)
 *
 * Höflich: sequentiell, konfigurierbare Pause zwischen Abrufen, ehrlicher
 * User-Agent, respektiert die Disallow-Pfade der robots.txt. Resumierbar
 * über state.json.
 *
 * ⚠️ Das BMF nutzt Radware Bot-Management: Diese HTTP-Variante wird nach
 * einigen Dutzend Seiten geblockt (Umleitung auf validate.perfdrive.com) und
 * bricht dann sauber ab. Für den vollständigen Crawl crawl-bmf-browser.mjs
 * verwenden – es setzt denselben State fort.
 *
 * Aufruf: node crawl-bmf.mjs --out <dir> [--delay 1500] [--max 5000]
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { HOST, classify, normalize, extract } from './bmf-lib.mjs';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) =>
  a.startsWith('--') ? [a.slice(2), arr[i + 1]] : null).filter(Boolean));
// --ua chrome: Browser-Kennung statt Crawler-Kennung (wenn der Bot-Schutz die
// ehrliche Kennung trotz robots-konformem, gedrosseltem Lesen aussperrt).
const UA = args.ua === 'chrome'
  ? 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
  : 'SteuerRegister-Crawler/1.0 (einmaliger privater Abruf fuer ein Quellenregister; Kontakt: perschkramon@gmail.com)';
const OUT = path.resolve(args.out || './bmf-cache');
const DELAY = Number(args.delay || 1500);
const MAX_PAGES = Number(args.max || 5000);
const MAX_PDF = Number(args.maxpdf || 2000);
const MAX_PDF_BYTES = 40 * 1024 * 1024;

fs.mkdirSync(path.join(OUT, 'pdfs'), { recursive: true });

const SEEDS = [
  'https://www.bundesfinanzministerium.de/Web/DE/Themen/Steuern/steuern.html',
  'https://www.bundesfinanzministerium.de/Web/DE/Themen/Steuern/Steuerverwaltungu-Steuerrecht/steuerverwaltung_und_steuerrecht.html',
];

// ---------- Crawl-Loop ----------
const stateFile = path.join(OUT, 'state.json');
let visited = new Set();
let queue = [];
if (fs.existsSync(stateFile)) {
  const s = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  visited = new Set(s.visited); queue = s.queue;
  console.log(`RESUME: ${visited.size} besucht, ${queue.length} in Queue`);
} else {
  queue = SEEDS.map((s) => ({ url: s, kind: 'steuern', from: '(seed)' }));
}
// --refresh-steuern true: alle Themen-/Listen-Seiten erneut holen (Update-Lauf:
// neue BMF-Schreiben werden auf den Listenseiten entdeckt; gecachte Inhalte
// bleiben, nur Neues wird zusätzlich geladen).
if (args['refresh-steuern'] === 'true') {
  let refreshed = 0;
  for (const u of [...visited]) {
    if (classify(u) === 'steuern') { visited.delete(u); queue.push({ url: u, kind: 'steuern', from: '(update)' }); refreshed++; }
  }
  console.log(`Update-Modus: ${refreshed} Themen-/Listenseiten erneut eingereiht`);
}
// Früher fehlgeschlagene URLs (BOTBLOCK/Netzfehler) erneut einreihen
const errFile = path.join(OUT, 'errors.jsonl');
if (fs.existsSync(errFile)) {
  const retry = [];
  for (const line of fs.readFileSync(errFile, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line);
      if (visited.has(e.url)) { visited.delete(e.url); retry.push({ url: e.url, from: e.from || '(retry)' }); }
    } catch { /* ignore */ }
  }
  if (retry.length) {
    queue.unshift(...retry);
    fs.renameSync(errFile, path.join(OUT, `errors-${Date.now()}.old.jsonl`));
    console.log(`${retry.length} fehlgeschlagene URLs erneut eingereiht`);
  }
}
function saveState() {
  fs.writeFileSync(stateFile, JSON.stringify({ visited: [...visited], queue }));
}
// Enqueue-Dedupe (gleiche Klasse wie crawl-site: Navigation reiht sonst
// dieselben URLs von jeder Seite erneut ein → Queue/State blähen auf)
const queued = new Set(queue.map((i) => normalize(i.url)).filter(Boolean));

const pagesOut = fs.createWriteStream(path.join(OUT, 'pages.jsonl'), { flags: 'a' });
const pdfOut = fs.createWriteStream(path.join(OUT, 'pdfmeta.jsonl'), { flags: 'a' });
const errOut = fs.createWriteStream(path.join(OUT, 'errors.jsonl'), { flags: 'a' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let nHtml = 0, nPdf = 0, nErr = 0, botBlocks = 0;

async function fetchWithTimeout(url, asBuffer, attempt = 1) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 45000);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'de' }, signal: ctl.signal, redirect: 'follow' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const finalUrl = res.url || url;
    const finalHost = new URL(finalUrl).hostname;
    if (/perfdrive|validate\./i.test(finalHost)) throw new Error(`BOTBLOCK: ${finalHost}`);
    if (finalHost !== HOST) throw new Error(`redirect off-host: ${finalUrl}`);
    return asBuffer ? { body: Buffer.from(await res.arrayBuffer()), finalUrl } : { body: await res.text(), finalUrl };
  } catch (e) {
    if (attempt >= 3 || /off-host|BOTBLOCK|zu groß/.test(String(e && e.message))) throw e;
    await sleep(2500 * attempt);
    return fetchWithTimeout(url, asBuffer, attempt + 1);
  } finally { clearTimeout(t); }
}

while (queue.length > 0 && nHtml < MAX_PAGES && nPdf < MAX_PDF) {
  const item = queue.shift();
  const norm = normalize(item.url);
  if (!norm || visited.has(norm)) continue;
  visited.add(norm);
  const kind = classify(norm);
  if (!kind) continue;

  try {
    if (kind === 'pdf') {
      const { body, finalUrl } = await fetchWithTimeout(norm, true);
      if (body.length > MAX_PDF_BYTES) throw new Error(`zu groß: ${body.length}`);
      const sha = crypto.createHash('sha1').update(norm).digest('hex').slice(0, 16);
      const file = `pdfs/${sha}.pdf`;
      fs.writeFileSync(path.join(OUT, file), body);
      pdfOut.write(JSON.stringify({ url: norm, finalUrl, file, bytes: body.length, from: item.from, linkText: item.linkText || '', fetchedAt: new Date().toISOString() }) + '\n');
      nPdf++;
    } else {
      const { body: html, finalUrl } = await fetchWithTimeout(norm, false);
      const ex = extract(html, norm);
      pagesOut.write(JSON.stringify({ url: norm, finalUrl, kind, from: item.from, fetchedAt: new Date().toISOString(), title: ex.title, h1: ex.h1, description: ex.description, date: ex.date, text: ex.text }) + '\n');
      nHtml++;
      for (const raw of ex.links) {
        const child = normalize(raw, ex.baseHref || finalUrl);
        if (!child || visited.has(child) || queued.has(child)) continue;
        const childKind = classify(child);
        if (!childKind) continue;
        // Von Content-Seiten aus keinen weiteren Content-HTML-Ketten folgen (Drift-Schutz)
        if (kind === 'content' && childKind === 'content') continue;
        queued.add(child);
        queue.push({ url: child, kind: childKind, from: norm, linkText: '' });
      }
    }
    botBlocks = 0;
  } catch (e) {
    nErr++;
    const msg = String(e && e.message || e);
    errOut.write(JSON.stringify({ url: norm, from: item.from, error: msg }) + '\n');
    if (/BOTBLOCK/.test(msg)) {
      botBlocks++;
      if (botBlocks >= 15) {
        // Bot-Schutz greift dauerhaft: sauber anhalten statt weiter anzuklopfen.
        visited.delete(norm); queue.unshift(item); saveState();
        console.log('ABBRUCH: Radware-Bot-Schutz blockt dauerhaft. State gesichert – mit crawl-bmf-browser.mjs fortsetzen.');
        process.exit(2);
      }
      await sleep(20000); // nach einem Block deutlich länger warten
    }
  }

  if ((nHtml + nPdf) % 20 === 0) saveState();
  if ((nHtml + nPdf) % 10 === 0) console.log(`[bmf] html=${nHtml} pdf=${nPdf} err=${nErr} queue=${queue.length}`);
  await sleep(DELAY + Math.floor(Math.random() * 400));
}

saveState();
console.log(`FERTIG: html=${nHtml} pdf=${nPdf} err=${nErr} queue-rest=${queue.length}`);
pagesOut.end(); pdfOut.end(); errOut.end();
