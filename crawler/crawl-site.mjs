#!/usr/bin/env node
/**
 * Generischer Site-Crawler für das Steuerrecht-Register – für neue amtliche
 * Quellen, die per XML-Sitemap oder Seed-URLs erschlossen werden.
 *
 * VOR der Aufnahme einer neuen Quelle IMMER die robots.txt prüfen:
 *   1. KI-/TDM-Nutzungsvorbehalt (§ 44b UrhG; eigene Disallow-Blöcke für
 *      GPTBot/CCBot/claudebot …)? → Quelle NICHT übernehmen, nur verlinken.
 *   2. Disallow-Pfade → hier per --deny nachbilden.
 *   3. Sitemap-Zeile → als --sitemap-index nutzen (beste, vollständige Quelle).
 *
 * Beispiel BMJV:
 *   node crawl-site.mjs --host www.bmjv.de \
 *     --sitemap-index https://www.bmjv.de/Sitemap_Index.xml \
 *     --deny "/SiteGlobals/|/DE/[Ss]ervice/|/EN/" \
 *     --out <cache-dir> --delay 1500
 *
 * Ausgabeformat identisch zu crawl-bmf.mjs (pages.jsonl, pdfmeta.jsonl,
 * errors.jsonl, state.json) → build-register.mjs versteht es direkt.
 * Von Seiten aus werden nur PDFs weiterverfolgt (die Sitemap liefert die
 * HTML-Vollständigkeit); --follow-html erweitert auf HTML-BFS im Scope.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { extract } from './bmf-lib.mjs';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) =>
  a.startsWith('--') ? [a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : 'true'] : null).filter(Boolean));
if (!args.host || !args.out || (!args['sitemap-index'] && !args.seeds)) {
  console.error('Pflicht: --host <host> --out <dir> und --sitemap-index <url> oder --seeds <url,url>');
  process.exit(1);
}
const HOST = args.host;
const OUT = path.resolve(args.out);
const DELAY = Number(args.delay || 1500);
const MAX_PAGES = Number(args.max || 8000);
const MAX_PDF = Number(args.maxpdf || 2000);
const MAX_PDF_BYTES = 40 * 1024 * 1024;
const DENY = args.deny ? new RegExp(args.deny, 'i') : null;
const ALLOW = args.allow ? new RegExp(args.allow, 'i') : null;
const FOLLOW_HTML = args['follow-html'] === 'true';
const UA = args.ua === 'chrome'
  ? 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
  : 'SteuerRegister-Crawler/1.0 (einmaliger privater Abruf fuer ein Quellenregister; Kontakt: perschkramon@gmail.com)';

fs.mkdirSync(path.join(OUT, 'pdfs'), { recursive: true });

function classify(u) {
  let url;
  try { url = new URL(u); } catch { return null; }
  if (url.hostname !== HOST) return null;
  const p = url.pathname;
  if (DENY && DENY.test(p)) return null;
  if (/\.pdf$/i.test(p)) return 'pdf';
  if (ALLOW && !ALLOW.test(p)) return null;
  if (!/\.html?$/i.test(p) && !p.endsWith('/')) return null;
  return 'seite';
}

function normalize(u, base) {
  let url;
  try { url = new URL(u, base); } catch { return null; }
  url.hash = '';
  const keep = new URLSearchParams();
  for (const [k, v] of url.searchParams) {
    if (/\.pdf$/i.test(url.pathname)) {
      if (/^(__blob|v)$/i.test(k)) keep.set(k, v);
    } else if (/gtp|page/i.test(k) && v.length <= 40 && !/https?%3a|https?:/i.test(v)) {
      // Paginierung ja – aber keine Parameter, die selbst URLs tragen
      // (z. B. „Barriere melden"?page=<Seiten-URL> → rekursives URL-Wachstum bis HTTP 414)
      keep.set(k, v);
    }
  }
  url.search = keep.toString() ? `?${keep.toString()}` : '';
  return url.toString();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchRaw(url, asBuffer, attempt = 1) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 45000);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'de' }, signal: ctl.signal, redirect: 'follow' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const finalUrl = res.url || url;
    const finalHost = new URL(finalUrl).hostname;
    if (/perfdrive|validate\./i.test(finalHost)) throw new Error(`BOTBLOCK: ${finalHost}`);
    if (finalHost !== HOST) throw new Error(`redirect off-host: ${finalUrl}`);
    if (asBuffer) return { body: Buffer.from(await res.arrayBuffer()), finalUrl };
    // Charset-korrekt dekodieren: res.text() nimmt IMMER UTF-8 an – Alt-Portale
    // (z. B. verwaltungsvorschriften-im-internet.de, XHTML in iso-8859-1)
    // würden sonst mit Umlaut-Müll im Register landen (Preflight 2026-07-16).
    const buf = Buffer.from(await res.arrayBuffer());
    const ct = res.headers.get('content-type') || '';
    let charset = (/charset=([\w-]+)/i.exec(ct) || [])[1];
    if (!charset) {
      const head = buf.subarray(0, 2048).toString('latin1');
      charset = (/charset=["']?([\w-]+)/i.exec(head) || [])[1];
    }
    const enc = (charset || 'utf-8').toLowerCase();
    const body = /^(iso-8859-1|latin1|windows-1252)$/.test(enc)
      ? new TextDecoder('windows-1252').decode(buf)
      : buf.toString('utf8');
    return { body, finalUrl };
  } catch (e) {
    if (attempt >= 3 || /off-host|BOTBLOCK|zu groß/.test(String(e && e.message))) throw e;
    await sleep(2500 * attempt);
    return fetchRaw(url, asBuffer, attempt + 1);
  } finally { clearTimeout(t); }
}

// ---------- Seeds: Sitemap-Index oder --seeds ----------
async function collectSeeds() {
  const seeds = new Map(); // url -> lastmod
  if (args.seeds) for (const s of args.seeds.split(',')) seeds.set(s.trim(), '');
  if (args['sitemap-index']) {
    const { body: idx } = await fetchRaw(args['sitemap-index']);
    const subs = [...idx.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1]);
    console.log(`Sitemap-Index: ${subs.length} Teil-Sitemaps`);
    for (const sub of subs) {
      await sleep(400);
      const { body } = await fetchRaw(sub);
      // urlset: <url><loc>…</loc><lastmod>…</lastmod></url>
      const re = /<url>([\s\S]*?)<\/url>/g;
      let m, n = 0;
      while ((m = re.exec(body)) !== null) {
        const loc = (/<loc>\s*([^<\s]+)\s*<\/loc>/.exec(m[1]) || [])[1];
        const lastmod = (/<lastmod>\s*([^<\s]+)\s*<\/lastmod>/.exec(m[1]) || [])[1] || '';
        if (loc) { seeds.set(loc, lastmod); n++; }
      }
      console.log(`${sub.split('/').pop()}: ${n} URLs`);
    }
  }
  return seeds;
}

// ---------- State ----------
const stateFile = path.join(OUT, 'state.json');
let visited = new Set();
let queue = [];
if (fs.existsSync(stateFile)) {
  const s = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  visited = new Set(s.visited); queue = s.queue;
  console.log(`RESUME: ${visited.size} besucht, ${queue.length} in Queue`);
} else {
  const seeds = await collectSeeds();
  queue = [...seeds.entries()].map(([url, lastmod]) => ({ url, from: '(sitemap)', lastmod }));
  console.log(`Seeds gesamt: ${queue.length}`);
}
// --since <ISO-Datum>: Seiten, deren Sitemap-lastmod NEUER ist, werden auch
// dann erneut geholt, wenn sie schon besucht wurden (Update-Lauf).
if (args.since) {
  const since = args.since;
  let refreshed = 0;
  const seeds = await collectSeeds();
  for (const [url, lastmod] of seeds) {
    const norm = normalize(url);
    if (norm && lastmod && lastmod > since && visited.has(norm)) {
      visited.delete(norm);
      queue.push({ url, from: '(update)', lastmod });
      refreshed++;
    }
  }
  console.log(`Update-Modus: ${refreshed} geänderte Seiten (lastmod > ${since}) erneut eingereiht`);
}
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
// Enqueue-Dedupe: ohne dieses Set landet dieselbe URL (Navigation!) von jeder
// Seite erneut in der Queue – Queue-Länge explodiert scheinbar, State bläht auf.
const queued = new Set(queue.map((i) => normalize(i.url)).filter(Boolean));
const saveState = () => fs.writeFileSync(stateFile, JSON.stringify({ visited: [...visited], queue }));

const pagesOut = fs.createWriteStream(path.join(OUT, 'pages.jsonl'), { flags: 'a' });
const pdfOut = fs.createWriteStream(path.join(OUT, 'pdfmeta.jsonl'), { flags: 'a' });
const errOut = fs.createWriteStream(errFile, { flags: 'a' });

let nHtml = 0, nPdf = 0, nErr = 0, botBlocks = 0;

while (queue.length > 0 && nHtml < MAX_PAGES && nPdf < MAX_PDF) {
  const item = queue.shift();
  const norm = normalize(item.url);
  if (!norm || visited.has(norm)) continue;
  visited.add(norm);
  const kind = classify(norm);
  if (!kind) continue;

  try {
    if (kind === 'pdf') {
      const { body, finalUrl } = await fetchRaw(norm, true);
      if (body.length > MAX_PDF_BYTES) throw new Error(`zu groß: ${body.length}`);
      const sha = crypto.createHash('sha1').update(norm).digest('hex').slice(0, 16);
      const file = `pdfs/${sha}.pdf`;
      fs.writeFileSync(path.join(OUT, file), body);
      pdfOut.write(JSON.stringify({ url: norm, finalUrl, file, bytes: body.length, from: item.from, linkText: item.linkText || '', fetchedAt: new Date().toISOString() }) + '\n');
      nPdf++;
    } else {
      const { body: html, finalUrl } = await fetchRaw(norm, false);
      const ex = extract(html, norm);
      pagesOut.write(JSON.stringify({ url: norm, finalUrl, kind: 'seite', from: item.from, fetchedAt: new Date().toISOString(), title: ex.title, h1: ex.h1, description: ex.description, date: ex.date || item.lastmod || '', text: ex.text }) + '\n');
      nHtml++;
      for (const raw of ex.links) {
        const child = normalize(raw, ex.baseHref || finalUrl);
        if (!child || visited.has(child) || queued.has(child)) continue;
        const childKind = classify(child);
        if (!childKind) continue;
        if (childKind === 'seite' && !FOLLOW_HTML) continue; // Sitemap ist die HTML-Vollständigkeit
        queued.add(child);
        queue.push({ url: child, from: norm });
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
        visited.delete(norm); queue.unshift(item); saveState();
        console.log('ABBRUCH: Bot-Schutz blockt dauerhaft. State gesichert – später mit größerem --delay fortsetzen.');
        process.exit(2);
      }
      await sleep(20000);
    }
  }

  if ((nHtml + nPdf) % 20 === 0) saveState();
  if ((nHtml + nPdf) % 25 === 0) console.log(`[${HOST}] html=${nHtml} pdf=${nPdf} err=${nErr} queue=${queue.length}`);
  await sleep(DELAY + Math.floor(Math.random() * 400));
}

saveState();
console.log(`FERTIG: html=${nHtml} pdf=${nPdf} err=${nErr} queue-rest=${queue.length}`);
pagesOut.end(); pdfOut.end(); errOut.end();
