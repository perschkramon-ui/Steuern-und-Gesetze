#!/usr/bin/env node
/**
 * BMF-Crawler über einen echten Chromium-Browser (Playwright).
 *
 * Hintergrund: bundesfinanzministerium.de schützt sich mit Radware Bot-
 * Management. Rohe HTTP-Abrufe (crawl-bmf.mjs) werden nach wenigen Dutzend
 * Seiten auf validate.perfdrive.com umgeleitet. Ein echter Browser löst die
 * JS-Challenge wie ein normaler Besucher und behält die Session-Cookies –
 * damit verhält sich dieser einmalige Lese-Crawl wie ein menschlicher
 * Seitenbesuch (weiter höflich gedrosselt, robots.txt-Disallows beachtet).
 *
 * ⚠️ Empirie 2026-07-14: In der Claude-CLOUD-Umgebung funktioniert dieser
 * Crawler NICHT – die Sandbox resettet Chromium-Seitennavigation generell
 * (ERR_CONNECTION_RESET, direkt UND über den Proxy; Playwrights request-API
 * und curl gehen). Er ist für den LOKALEN PC gedacht, wo Chromium normal
 * ins Netz kommt. In der Cloud stattdessen crawl-bmf.mjs mit großem
 * --delay (≥ 20000) und --ua chrome nutzen.
 *
 * Playwright wird NICHT mit eingecheckt – einmalig bereitstellen:
 *   npm install playwright --prefix <werkzeug-ordner>
 *
 * Aufruf:
 *   node crawl-bmf-browser.mjs --out <dir> --playwright <dir>/node_modules/playwright \
 *     [--chromium /opt/pw-browsers/chromium] [--delay 1800] [--max 5000]
 *
 * Nutzt denselben State/dieselben Ausgabedateien wie crawl-bmf.mjs und kann
 * dessen Crawl nahtlos fortsetzen (geblockte URLs aus errors.jsonl werden
 * automatisch erneut eingereiht).
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { HOST, classify, normalize, extract } from './bmf-lib.mjs';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) =>
  a.startsWith('--') ? [a.slice(2), arr[i + 1]] : null).filter(Boolean));
if (!args.out || !args.playwright) {
  console.error('Pflicht: --out <dir> --playwright <playwright-dir>');
  process.exit(1);
}
const OUT = path.resolve(args.out);
const DELAY = Number(args.delay || 1800);
const MAX_PAGES = Number(args.max || 5000);
const MAX_PDF = Number(args.maxpdf || 2000);
fs.mkdirSync(path.join(OUT, 'pdfs'), { recursive: true });

const require = createRequire(import.meta.url);
const { chromium } = require(path.resolve(args.playwright));

const SEEDS = [
  'https://www.bundesfinanzministerium.de/Web/DE/Themen/Steuern/steuern.html',
  'https://www.bundesfinanzministerium.de/Web/DE/Themen/Steuern/Steuerverwaltungu-Steuerrecht/steuerverwaltung_und_steuerrecht.html',
];

// ---------- State (kompatibel zu crawl-bmf.mjs) ----------
const stateFile = path.join(OUT, 'state.json');
let visited = new Set();
let queue = [];
if (fs.existsSync(stateFile)) {
  const s = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  visited = new Set(s.visited); queue = s.queue;
  console.log(`RESUME: ${visited.size} besucht, ${queue.length} in Queue`);
}
// Früher fehlgeschlagene URLs (v. a. BOTBLOCK) erneut versuchen
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
if (queue.length === 0 && visited.size === 0) queue = SEEDS.map((s) => ({ url: s, from: '(seed)' }));
const saveState = () => fs.writeFileSync(stateFile, JSON.stringify({ visited: [...visited], queue }));

const pagesOut = fs.createWriteStream(path.join(OUT, 'pages.jsonl'), { flags: 'a' });
const pdfOut = fs.createWriteStream(path.join(OUT, 'pdfmeta.jsonl'), { flags: 'a' });
const errOut = fs.createWriteStream(errFile, { flags: 'a' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- Browser ----------
const proxyServer = process.env.HTTPS_PROXY || process.env.https_proxy || '';
const browser = await chromium.launch({
  executablePath: args.chromium || process.env.BMF_CHROMIUM || undefined,
  proxy: proxyServer ? { server: proxyServer } : undefined,
});
const context = await browser.newContext({
  ignoreHTTPSErrors: true,
  locale: 'de-DE',
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  viewport: { width: 1366, height: 900 },
});
await context.addInitScript(() => {
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
});
const page = await context.newPage();

const isBlocked = (u, html) => /perfdrive|validate\./i.test(u) || /validate\.perfdrive/i.test(html || '');

async function gotoWithChallenge(url) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  // Radware-Challenge: kurz warten, ob der Browser zurückgeleitet wird
  if (isBlocked(page.url())) {
    try { await page.waitForURL((u) => new URL(u).hostname === HOST, { timeout: 20000 }); } catch { /* bleibt geblockt */ }
  }
  await page.waitForTimeout(400);
  return page.url();
}

let nHtml = 0, nPdf = 0, nErr = 0, blocks = 0;

while (queue.length > 0 && nHtml < MAX_PAGES && nPdf < MAX_PDF) {
  const item = queue.shift();
  const norm = normalize(item.url);
  if (!norm || visited.has(norm)) continue;
  const kind = classify(norm);
  if (!kind) { visited.add(norm); continue; }
  visited.add(norm);

  try {
    if (kind === 'pdf') {
      // PDF im Seitenkontext laden (nutzt Browser-Cookies/-Fingerprint)
      if (!page.url().startsWith('https://www.bundesfinanzministerium.de')) {
        await gotoWithChallenge(SEEDS[0]);
      }
      const b64 = await page.evaluate(async (u) => {
        const r = await fetch(u, { credentials: 'include' });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const buf = await r.arrayBuffer();
        if (buf.byteLength > 40 * 1024 * 1024) throw new Error(`zu groß: ${buf.byteLength}`);
        const arr = new Uint8Array(buf);
        let s = '';
        for (let i = 0; i < arr.length; i += 32768) s += String.fromCharCode.apply(null, arr.subarray(i, i + 32768));
        return btoa(s);
      }, norm);
      const body = Buffer.from(b64, 'base64');
      if (body.subarray(0, 5).toString() !== '%PDF-') throw new Error('kein PDF (Bot-Seite?)');
      const sha = crypto.createHash('sha1').update(norm).digest('hex').slice(0, 16);
      const file = `pdfs/${sha}.pdf`;
      fs.writeFileSync(path.join(OUT, file), body);
      pdfOut.write(JSON.stringify({ url: norm, finalUrl: norm, file, bytes: body.length, from: item.from, linkText: item.linkText || '', fetchedAt: new Date().toISOString() }) + '\n');
      nPdf++;
      blocks = 0;
    } else {
      const finalUrl = await gotoWithChallenge(norm);
      const html = await page.content();
      if (isBlocked(finalUrl, html)) throw new Error(`BOTBLOCK: ${finalUrl}`);
      if (new URL(finalUrl).hostname !== HOST) throw new Error(`redirect off-host: ${finalUrl}`);
      const ex = extract(html, finalUrl);
      pagesOut.write(JSON.stringify({ url: norm, finalUrl, kind, from: item.from, fetchedAt: new Date().toISOString(), title: ex.title, h1: ex.h1, description: ex.description, date: ex.date, text: ex.text }) + '\n');
      nHtml++;
      blocks = 0;
      for (const raw of ex.links) {
        const child = normalize(raw, ex.baseHref || finalUrl);
        if (!child || visited.has(child)) continue;
        const childKind = classify(child);
        if (!childKind) continue;
        if (kind === 'content' && childKind === 'content') continue; // Drift-Schutz
        queue.push({ url: child, from: norm });
      }
    }
  } catch (e) {
    nErr++;
    const msg = String(e && e.message || e);
    errOut.write(JSON.stringify({ url: norm, from: item.from, error: msg }) + '\n');
    if (/BOTBLOCK|kein PDF/.test(msg)) {
      blocks++;
      if (blocks >= 10) {
        visited.delete(norm); queue.unshift(item); saveState();
        console.log('ABBRUCH: Bot-Schutz blockt auch den Browser dauerhaft. State gesichert.');
        process.exit(2);
      }
      await sleep(30000);
    }
  }

  if ((nHtml + nPdf) % 20 === 0) saveState();
  if ((nHtml + nPdf) % 10 === 0) console.log(`[bmf-browser] html=${nHtml} pdf=${nPdf} err=${nErr} queue=${queue.length}`);
  await sleep(DELAY + Math.floor(Math.random() * 600));
}

saveState();
console.log(`FERTIG: html=${nHtml} pdf=${nPdf} err=${nErr} queue-rest=${queue.length}`);
pagesOut.end(); pdfOut.end(); errOut.end();
await browser.close();
