#!/usr/bin/env node
/**
 * Crawler für die Amtlichen BMF-Handbücher (ao/esth/lsth/ksth/gewsth/usth/
 * erbsth.bundesfinanzministerium.de) über einen echten Chromium-Browser
 * (Playwright) – NUR FÜR DEN LOKALEN PC.
 *
 * Hintergrund (Empirie 2026-07-16, s. Rechtsquellen-Register): Die Handbuch-
 * Subdomains erzwingen die Radware-JS-Challenge auf JEDEM Abruf (anders als
 * www.bundesfinanzministerium.de, wo rohe Abrufe zunächst durchgehen). Rohe
 * HTTP-Crawls sind dort also chancenlos, und in der Claude-Cloud-Sandbox ist
 * Chromium-NAVIGATION generell geblockt (ERR_CONNECTION_RESET) → dieses
 * Skript läuft nur lokal, wo Chromium normal ins Netz kommt. Es verhält sich
 * wie ein menschlicher Besucher: löst die Challenge einmal, behält Cookies,
 * ist höflich gedrosselt und respektiert robots.txt (inkl. Abbruch bei
 * KI-/TDM-Vorbehalt, Hausregel §44b UrhG).
 *
 * Die Handbücher tragen die KONSOLIDIERTEN Verwaltungsvorschriften (AEAO,
 * EStR, LStR, UStAE, KStR, GewStR, ErbStR + amtliche Hinweise), die es
 * nirgendwo sonst amtlich als Volltext gibt.
 *
 * Playwright wird NICHT mit eingecheckt – einmalig bereitstellen:
 *   npm install playwright --prefix <werkzeug-ordner>
 *
 * Aufruf (Beispiel AO-Handbuch, Ausgabe-Ordner frei wählbar):
 *   node crawl-handbuch-browser.mjs --host ao.bundesfinanzministerium.de \
 *     --out ../ao-handbuch-cache --playwright <werkzeug-ordner>/node_modules/playwright \
 *     [--edition 2026] [--prefix /ao/2026/] [--chromium <pfad>] [--delay 1800] [--max 4000]
 *
 * Ohne --edition/--prefix wird die AKTUELLE Ausgabe automatisch erkannt
 * (Startseite leitet in die neueste Jahres-Ausgabe bzw. verlinkt sie).
 * Resumierbar: state.json wie bei crawl-bmf-browser.mjs; Ausgabeformat
 * (pages.jsonl / pdfmeta.jsonl / pdfs/) ist build-register-kompatibel.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) =>
  a.startsWith('--') ? [a.slice(2), arr[i + 1]] : null).filter(Boolean));
if (!args.out || !args.playwright || !args.host) {
  console.error('Pflicht: --host <handbuch-subdomain> --out <cache-dir> --playwright <playwright-dir>');
  process.exit(1);
}
const HOST = String(args.host).toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
if (!/^[a-z]+\.bundesfinanzministerium\.de$/.test(HOST)) {
  console.error(`Unerwarteter Host: ${HOST} (erwartet <kürzel>.bundesfinanzministerium.de)`);
  process.exit(1);
}
const OUT = path.resolve(args.out);
const DELAY = Number(args.delay || 1800);
const MAX_PAGES = Number(args.max || 4000);
const MAX_PDF = Number(args.maxpdf || 300);
// Seiten-Text-Deckel: großzügig UND laut (Regel „keine stillen Deckel" –
// s. CLAUDE.md-Fehlerklasse „Stille Deckel in Ingest-Pipelines").
const MAX_PAGE_CHARS = Number(args.maxchars || 1000000);
fs.mkdirSync(path.join(OUT, 'pdfs'), { recursive: true });

const require = createRequire(import.meta.url);
const { chromium } = require(path.resolve(args.playwright));

// ---------- State (Format identisch zu crawl-bmf-browser.mjs) ----------
const stateFile = path.join(OUT, 'state.json');
let visited = new Set();
let queue = [];
if (fs.existsSync(stateFile)) {
  const s = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  visited = new Set(s.visited); queue = s.queue;
  console.log(`RESUME: ${visited.size} besucht, ${queue.length} in Queue`);
}
const errFile = path.join(OUT, 'errors.jsonl');
if (fs.existsSync(errFile)) {
  const retry = [];
  for (const line of fs.readFileSync(errFile, 'utf8').split(/\r?\n/)) {
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
// Enqueue-Dedupe: bisher wurde jede URL so oft eingereiht, wie sie verlinkt
// ist (Dedupe erst beim Pop) – bei den stark vernetzten Handbüchern wächst die
// Queue damit auf Hunderttausende Duplikate (Empirie ao 2026-07-16: 139k
// Einträge bei 219 besuchten Seiten) und macht state.json (synchroner
// Voll-Write alle 20 Seiten) und RAM unbrauchbar groß. Jede URL kommt jetzt
// höchstens EINMAL in die Queue; Bestands-Queues aus altem State werden beim
// Laden dedupliziert. (normalize ist als function declaration gehoisted.)
{
  const seen = new Set();
  queue = queue.filter((q) => {
    const n = normalize(q.url);
    if (!n || seen.has(n)) return false;
    seen.add(n);
    return true;
  });
}
const enqueued = new Set(queue.map((q) => normalize(q.url)));
const saveState = () => fs.writeFileSync(stateFile, JSON.stringify({ visited: [...visited], queue }));

// SYNCHRONE Appends statt WriteStreams: die Abbruch-Pfade (process.exit bei
// Bot-Block/TDM) würden gepufferte Stream-Writes verlieren; bei ≥1,8 s
// Drossel je Seite kostet appendFileSync nichts (Review-Fund 2026-07-16).
const pagesOut = { write: (s) => fs.appendFileSync(path.join(OUT, 'pages.jsonl'), s), end: () => {} };
const pdfOut = { write: (s) => fs.appendFileSync(path.join(OUT, 'pdfmeta.jsonl'), s), end: () => {} };
const errOut = { write: (s) => fs.appendFileSync(errFile, s), end: () => {} };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- URL-Regeln ----------
const KUERZEL = HOST.split('.')[0]; // ao/esth/lsth/… = erwarteter erster Pfadbaustein
let PREFIX = args.prefix || null; // wird ggf. auto-erkannt
if (!PREFIX && args.edition) PREFIX = `/${KUERZEL}/${args.edition}/`;
let robotsDisallow = []; // RegExp-Matcher aus robots.txt (User-agent: * + KI-Bots)

// robots-Pfadregel → RegExp ('*' = beliebig, '$' am Ende = Pfadende, sonst Präfix).
// startsWith wäre bei Wildcard-Regeln fail-open (Review-Fund 2026-07-16).
function robotsRuleToRegex(rulePath) {
  const anchored = rulePath.endsWith('$');
  const body = anchored ? rulePath.slice(0, -1) : rulePath;
  const esc = body.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${esc}${anchored ? '$' : ''}`);
}

function normalize(u, base) {
  let url;
  try { url = new URL(u, base); } catch { return null; }
  url.hash = '';
  url.hostname = url.hostname.toLowerCase();
  if (/\.pdf$/i.test(url.pathname)) {
    // __blob/v gehören zur kanonischen Download-URL des GSB-CMS – behalten
    // (bewährte Regel aus bmf-lib.normalize; Review-Fund 2026-07-16)
    const keep = new URLSearchParams();
    for (const [k, v] of url.searchParams) if (/^(__blob|v)$/i.test(k)) keep.set(k, v);
    url.search = keep.toString() ? `?${keep.toString()}` : '';
  } else {
    // Nur kurze Paginierungs-Parameter behalten (unverankert wie bmf-lib –
    // fängt GSB-Varianten wie cms_gtp), keine URL-tragenden Parameter
    // (Rekursions-/414-Falle)
    const keep = new URLSearchParams();
    for (const [k, v] of url.searchParams) {
      if (/gtp|page/i.test(k) && v.length <= 40 && !/https?%3a|https?:/i.test(v)) keep.set(k, v);
    }
    url.search = keep.toString() ? `?${keep.toString()}` : '';
  }
  return url.toString();
}

function classify(u) {
  let url;
  try { url = new URL(u); } catch { return null; }
  if (url.hostname !== HOST) return null;
  const p = url.pathname;
  if (robotsDisallow.some((re) => re.test(p))) return null;
  if (/\.pdf$/i.test(p)) return 'pdf';
  // Statische Assets nie anfragen
  if (/\.(css|js|mjs|png|jpe?g|gif|svg|ico|woff2?|ttf|eot|xml|json|zip|epub)$/i.test(p)) return null;
  // Ausgaben-Scope: HTML-Seiten nur innerhalb der erkannten/gesetzten Ausgabe
  if (PREFIX && !p.startsWith(PREFIX) && p !== '/' && p !== '') return null;
  return 'content';
}

// ---------- Browser ----------
const proxyServer = process.env.HTTPS_PROXY || process.env.https_proxy || '';
const browser = await chromium.launch({
  executablePath: args.chromium || process.env.BMF_CHROMIUM || undefined,
  proxy: proxyServer ? { server: proxyServer } : undefined,
});
// Radware führt je Browser-Session ein NUTZUNGS-BUDGET (Empirie 2026-07-16:
// drei unabhängige Sessions wurden alle nach ~70 Seiten / ~25 Min dauerhaft
// geflaggt; eine bloße Neu-Navigation mit denselben Cookies bleibt dann
// GEBLOCKT, während ein frischer Context die Challenge sofort wieder löst).
// Deshalb: echter Session-Reset (neuer Context = neue Cookies) statt
// Weiter-Navigieren – reaktiv nach einem BOTBLOCK UND proaktiv, BEVOR das
// Budget zuschlägt (SESSION_BUDGET_* in der Crawl-Schleife).
let context = null, page = null;
async function newSession() {
  if (context) await context.close().catch(() => {});
  context = await browser.newContext({
    ignoreHTTPSErrors: true,
    locale: 'de-DE',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    viewport: { width: 1366, height: 900 },
  });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });
  page = await context.newPage();
}
await newSession();

// Radware liefert die Challenge je nach Konfiguration auf DERSELBEN URL aus
// (Titel „Radware Page…", danach Loader „Loading <ziel-url>", der selbst auf
// die Zielseite weiternavigiert – empirisch auf den Handbuch-Subdomains) ODER
// als Redirect auf validate.perfdrive.com (empirisch auf der www-Hauptseite).
// WICHTIG (Empirie lokaler Lauf 2026-07-16): Der ShieldSquare-Tag
// (ssConf("cu","validate.perfdrive.com…")) steckt im <head> JEDER ECHTEN
// Handbuch-Seite – ein reiner Inhalts-Match auf radware/perfdrive ist dort
// also auf jeder Content-Seite ein False-Positive (der ao-Crawl brach damit
// sofort mit „blockt bereits die Startseite" ab, obwohl die Challenge längst
// gelöst war). Erkennung daher über URL + TITEL; der Inhalts-Match bleibt nur
// als Ersatz für titel-lose Challenge-Shells und zählt NUR, wenn die Seite
// praktisch leer ist (echte Handbuch-Seiten tragen hunderte Links).
const challengedNow = async () => {
  if (/perfdrive|validate\./i.test(page.url())) return true;
  const t = await page.title().catch(() => '');
  if (/radware|human verification|bot management|^loading\b/i.test(t)) return true;
  return page.evaluate(() => {
    if (document.querySelectorAll('a[href]').length > 3) return false;
    const h = document.documentElement ? document.documentElement.innerHTML : '';
    return /validate\.perfdrive|radware/i.test(h.slice(0, 20000));
  }).catch(() => false);
};

async function gotoWithChallenge(url) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  if (/perfdrive|validate\./i.test(page.url())) {
    // Redirect-Variante: auf die Rückleitung zum Host warten (wie crawl-bmf-browser)
    try { await page.waitForURL((u) => new URL(u).hostname === HOST, { timeout: 20000 }); } catch { /* bleibt geblockt */ }
  }
  // Same-URL-/Loader-Variante: Challenge-JS arbeiten lassen (setzt Cookie,
  // der Loader navigiert danach SELBST auf die Zielseite weiter – empirisch
  // ~4–8 s). Bis zur echten Seite pollen statt nur auf den Titel-Flip zu
  // warten: zwischen Challenge und Zielseite liegt der Loader-Zustand, ein
  // einzelner zu früher Check sieht sonst noch die alte Shell (Fund 2026-07-16).
  for (const t0 = Date.now(); Date.now() - t0 < 45000 && await challengedNow();) {
    await page.waitForTimeout(1000);
  }
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await page.waitForTimeout(400);
  return page.url();
}

// ---------- robots.txt (Hausregel: VOR dem Crawl prüfen, TDM = Abbruch) ----------
async function checkRobots() {
  // Erst die Startseite besuchen → Challenge lösen, Cookies etablieren;
  // robots.txt danach im Seitenkontext holen (trägt die Session mit).
  await gotoWithChallenge(`https://${HOST}/`);
  if (await challengedNow()) {
    console.error('ABBRUCH: Bot-Schutz blockt bereits die Startseite dauerhaft.');
    await browser.close(); process.exit(2);
  }
  let txt = await page.evaluate(async () => {
    try {
      const r = await fetch('/robots.txt', { credentials: 'include' });
      if (!r.ok) return '';
      return await r.text();
    } catch { return ''; }
  });
  if (!txt || /<html/i.test(txt)) {
    // Zweiter Versuch: direkt ansteuern (text/plain landet in einem <pre>)
    try {
      await page.goto(`https://${HOST}/robots.txt`, { waitUntil: 'domcontentloaded', timeout: 30000 });
      txt = await page.evaluate(() => (document.body ? document.body.innerText : ''));
    } catch { txt = ''; }
    await gotoWithChallenge(`https://${HOST}/`).catch(() => {});
  }
  if (!txt || /<html/i.test(txt) || /radware page/i.test(txt)) {
    console.log('robots.txt nicht lesbar/leer – weiter mit voller Höflichkeit (Drossel bleibt).');
    return;
  }
  // Gruppenweise parsen: User-agent-Zeilen sammeln bis Disallow/Allow-Block endet
  const groups = []; let agents = [], rules = [], sawRule = false;
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase(), val = m[2].trim();
    if (key === 'user-agent') {
      if (sawRule) { groups.push({ agents, rules }); agents = []; rules = []; sawRule = false; }
      agents.push(val.toLowerCase());
    } else if (key === 'disallow' || key === 'allow') {
      rules.push({ type: key, path: val }); sawRule = true;
    }
  }
  if (agents.length || rules.length) groups.push({ agents, rules });
  const AI_BOTS = ['claudebot', 'anthropic-ai', 'gptbot', 'ccbot', 'google-extended', 'claude-web'];
  const rawRules = [];
  for (const g of groups) {
    const isAiGroup = g.agents.some((a) => AI_BOTS.includes(a));
    if (isAiGroup && g.rules.some((r) => r.type === 'disallow' && r.path === '/')) {
      console.error('ABBRUCH: robots.txt trägt einen KI-/TDM-Vorbehalt (§44b Abs. 3 UrhG) – ' +
        `KI-Bots (${g.agents.join(', ')}) sind ausgesperrt. Quelle NICHT übernehmen, nur verlinken ` +
        '(Hausregel, Präzedenz smartsteuer – s. Rechtsquellen-Register).');
      await browser.close(); process.exit(3);
    }
    // Regeln der '*'-Gruppe gelten uns sowieso; TEIL-Sperren einer KI-Gruppe
    // beachten wir konservativ mit (und sagen es laut).
    if (g.agents.includes('*') || isAiGroup) {
      for (const r of g.rules) {
        if (r.type !== 'disallow' || !r.path) continue;
        rawRules.push(r.path);
        if (isAiGroup) console.warn(`⚠️ robots.txt: KI-spezifische Teil-Sperre wird mit beachtet: Disallow ${r.path} (${g.agents.join(', ')})`);
      }
    }
  }
  robotsDisallow = rawRules.map(robotsRuleToRegex);
  if (robotsDisallow.some((re) => re.test('/'))) {
    console.error('ABBRUCH: robots.txt sperrt den gesamten Host (Disallow: /) für alle Crawler – ' +
      'Quelle respektieren und NICHT crawlen (nur verlinken).');
    await browser.close(); process.exit(3);
  }
  if (rawRules.length) console.log(`robots.txt: ${rawRules.length} Disallow-Regeln werden beachtet: ${rawRules.join(' ')}`);
}

// ---------- Ausgabe (Edition) automatisch erkennen ----------
async function detectPrefix() {
  if (PREFIX) { console.log(`Ausgabe-Scope (gesetzt): ${PREFIX}`); return; }
  // Fall 1: Startseite leitet direkt in die aktuelle Ausgabe (…/ao/2026/…)
  const landed = new URL(page.url());
  let m = /^\/([^/]+)\/((?:19|20)\d\d)\//.exec(landed.pathname);
  if (landed.hostname === HOST && m) {
    PREFIX = `/${m[1]}/${m[2]}/`;
    console.log(`Ausgabe-Scope (Weiterleitung): ${PREFIX}`);
    return;
  }
  // Fall 2: Startseite verlinkt die Jahres-Ausgaben → höchstes Jahr nehmen.
  // Dabei Pfade mit dem EIGENEN Kürzel bevorzugen – Handbuch-Seiten können
  // fremde Handbuch-Pfade verlinken (Review-Fund: sonst gewinnt ggf. die
  // neueste FREMDE Ausgabe und der Scope läuft ins Leere).
  const hrefs = await page.evaluate(() =>
    Array.from(document.querySelectorAll('a[href]')).map((a) => a.href));
  let best = null, bestAny = null;
  for (const h of hrefs) {
    try {
      const u = new URL(h, `https://${HOST}/`);
      if (u.hostname !== HOST) continue;
      const mm = /^\/([^/]+)\/((?:19|20)\d\d)\//.exec(u.pathname);
      if (!mm) continue;
      const cand = { seg: mm[1], year: Number(mm[2]) };
      if (mm[1].toLowerCase() === KUERZEL && (!best || cand.year > best.year)) best = cand;
      if (!bestAny || cand.year > bestAny.year) bestAny = cand;
    } catch { /* ignore */ }
  }
  if (!best && bestAny) {
    console.warn(`⚠️ Kein /${KUERZEL}/<jahr>/-Pfad verlinkt – nehme ersatzweise /${bestAny.seg}/${bestAny.year}/ (prüfen!).`);
    best = bestAny;
  }
  if (best) {
    PREFIX = `/${best.seg}/${best.year}/`;
    console.log(`Ausgabe-Scope (verlinkt, neueste): ${PREFIX}`);
    return;
  }
  console.warn('⚠️ Keine Jahres-Ausgabe erkennbar – crawle den GANZEN Host (Deckel --max greift). ' +
    'Besser: --prefix /kürzel/JAHR/ explizit setzen.');
}

await checkRobots();
await detectPrefix();

if (queue.length === 0 && visited.size === 0) {
  const seeds = [`https://${HOST}/`];
  if (PREFIX) seeds.unshift(`https://${HOST}${PREFIX}`);
  queue = seeds.map((s) => ({ url: s, from: '(seed)' }));
}

// ---------- Crawl-Schleife ----------
let nHtml = 0, nPdf = 0, nErr = 0, blocks = 0;
const deferredPdf = []; // über --maxpdf hinausgehende PDFs: zurückstellen statt
                        // den HTML-Crawl zu beenden; bleiben via State resümierbar

// Proaktives Session-Recycling UNTER dem Radware-Budget (~70 Seiten/~25 Min,
// s. newSession): Reset kostet nur die eine Challenge (~5–10 s) und verhindert
// den 10×30-s-Fehler-Spiral komplett.
const SESSION_BUDGET_PAGES = Number(args['session-pages'] || 45);
const SESSION_BUDGET_MS = Number(args['session-min'] || 10) * 60 * 1000;
let sessionPages = 0, sessionStart = Date.now();

while (queue.length > 0 && nHtml < MAX_PAGES) {
  const item = queue.shift();
  const norm = normalize(item.url);
  if (!norm || visited.has(norm)) continue;
  const kind = classify(norm);
  if (!kind) { visited.add(norm); continue; }
  if (kind === 'pdf' && nPdf >= MAX_PDF) { deferredPdf.push(item); continue; }
  visited.add(norm);

  if (sessionPages >= SESSION_BUDGET_PAGES || Date.now() - sessionStart > SESSION_BUDGET_MS) {
    console.log(`[${KUERZEL}] Session-Recycling nach ${sessionPages} Seiten (Radware-Budget)`);
    sessionPages = 0; sessionStart = Date.now();
    await newSession();
    await gotoWithChallenge(`https://${HOST}${PREFIX || '/'}`).catch(() => {});
  }

  try {
    if (kind === 'pdf') {
      // PDF im Seitenkontext laden (nutzt Browser-Cookies/-Fingerprint)
      if (!page.url().startsWith(`https://${HOST}`)) await gotoWithChallenge(`https://${HOST}/`);
      const b64 = await page.evaluate(async (u) => {
        const r = await fetch(u, { credentials: 'include' });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const buf = await r.arrayBuffer();
        if (buf.byteLength > 60 * 1024 * 1024) throw new Error(`zu groß: ${buf.byteLength}`);
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
      sessionPages++;
      blocks = 0;
    } else {
      const finalUrl = await gotoWithChallenge(norm);
      if (await challengedNow()) throw new Error(`BOTBLOCK: ${finalUrl}`);
      if (new URL(finalUrl).hostname !== HOST) throw new Error(`redirect off-host: ${finalUrl}`);
      // Zugeklappte Akkordeons im INHALTSBEREICH aufklappen: die Handbücher
      // verstecken die eigentlichen Verwaltungsvorschriften (AEAO/Richtlinien/
      // Hinweise/KassenSichV) hinter „aufklappen"-Toggles (a.toc-toggle,
      // aria-expanded=false) – innerText liest nur SICHTBARES, ohne diesen
      // Schritt fehlte genau der Erlass-Text (Fund 2026-07-16: §146a-Seite
      // 5k statt 94k Zeichen; Inhalt liegt komplett im DOM, kein Lazy-Load).
      // Jeder Toggle wird höchstens EINMAL geklickt (data-Guard, sonst würde
      // ein zweiter Klick wieder zuklappen); mehrere Runden nur für verschach-
      // telte Akkordeons. Nav-/Menü-Toggles sind ausgenommen (closest nav/…).
      for (let round = 0; round < 4; round++) {
        const clicked = await page.evaluate(() => {
          const root = document.querySelector('main') || document.querySelector('article')
            || document.querySelector('#content') || document.body;
          if (!root) return 0;
          // Die Toggles sind <a>-Anker MIT href (Progressive Enhancement):
          // el.click() folgt dem href und NAVIGIERT die Seite weg → die
          // Extraktion lief danach gegen ein Dokument ohne <body> und warf
          // „Cannot read properties of null" (Fund 2026-07-16: 26/50 §§-Seiten
          // je Handbuch verloren). Capture-Guard: die Default-Anker-Navigation
          // wird unterbunden, der JS-Handler des Akkordeons läuft weiter.
          if (!window.__hbGuard) {
            window.__hbGuard = true;
            document.addEventListener('click', (e) => {
              const a = e.target.closest && e.target.closest('a');
              if (!a) return;
              const href = a.getAttribute('href') || '';
              // NUR echte Seiten-Navigation unterbinden. Reine Fragment-Links
              // (href="#…") NICHT abfangen: manche Handbücher (UStH/UStAE)
              // klappen ihre `div.toc.collapse` über hashchange/:target auf –
              // ein preventDefault auf dem Fragment-Klick verhindert genau das
              // und ließ 90 % des UStAE-Texts verborgen (Fund 2026-07-16:
              // §15 sichtbar 10k von 313k Zeichen). AO expandiert per
              // JS-Handler → dort ist beides gleich; verifiziert §13c + §8 = 1.00.
              if (href && !href.startsWith('#')) e.preventDefault();
            }, true);
          }
          let n = 0;
          for (const el of root.querySelectorAll('[aria-expanded="false"], details:not([open]) summary')) {
            if (el.closest('nav, header, footer')) continue;
            if (el.dataset.hbClicked) continue;
            el.dataset.hbClicked = '1';
            el.click(); n++;
          }
          return n;
        }).catch(() => 0);
        if (!clicked) break;
        await page.waitForTimeout(350);
      }
      // Extraktion IM Browser (robust gegen unbekanntes Markup): Titel, H1,
      // Description, Datum, Haupttext (main > article > #content > body), Links.
      const ex = await page.evaluate(() => {
        const pickMeta = (sel) => (document.querySelector(sel) || {}).content || '';
        // ERST Links + H1 einsammeln (können in nav/header stehen – die werden gleich entfernt)
        const links = Array.from(document.querySelectorAll('a[href]')).map((a) => ({ href: a.href, txt: (a.innerText || '').trim().slice(0, 120) }));
        const h1 = ((document.querySelector('h1') || {}).innerText || '').trim();
        const root = document.querySelector('main') || document.querySelector('article')
          || document.querySelector('#content') || document.body;
        if (!root) return null; // Dokument mid-navigation → Aufrufer requeued
        // Störer im LIVE-DOM entfernen und innerText vom GERENDERTEN Knoten
        // lesen: innerText eines detached Clones fällt per HTML-Spec auf
        // textContent zurück und verliert alle Layout-Zeilenumbrüche –
        // Tabellenzellen kleben zusammen (Review-Fund 2026-07-16). Die Seite
        // wird danach ohnehin weiternavigiert, Mutation ist unschädlich.
        for (const kill of root.querySelectorAll('nav, header, footer, aside, script, style, noscript, form')) kill.remove();
        const text = (root.innerText || '').replace(/[ \t ]+/g, ' ').replace(/ *\n+ */g, '\n').trim();
        const date = pickMeta('meta[name="dcterms.modified"]') || pickMeta('meta[name="dcterms.issued"]')
          || pickMeta('meta[name="date"]') || ((/\b(\d{1,2}\.\d{1,2}\.\d{4})\b/.exec(text.slice(0, 4000)) || [])[1] || '');
        // tcLen = Textlänge INKLUSIVE versteckter Knoten – Wächter gegen
        // weiterhin zugeklappte Inhalte (Regel „keine stillen Deckel")
        const tcLen = (root.textContent || '').replace(/\s+/g, ' ').length;
        return { title: document.title || '', h1, description: pickMeta('meta[name="description"]'), date, text, links, tcLen };
      });
      // Dokument war mid-navigation (kein root) → als retriable behandeln:
      // requeuen und Session neu (wie BOTBLOCK), NIE die Seite still verlieren.
      if (!ex) throw new Error(`NOROOT: ${norm}`);
      if (ex.tcLen > 20000 && ex.text.length < ex.tcLen / 5) {
        console.warn(`⚠️ Versteckter Inhalt vermutet (sichtbar ${ex.text.length} von ~${ex.tcLen} Zeichen): ${norm}`);
      }
      const truncated = ex.text.length > MAX_PAGE_CHARS;
      if (truncated) console.warn(`⚠️ Seiten-Text-Deckel (${MAX_PAGE_CHARS}) greift: ${norm}`);
      pagesOut.write(JSON.stringify({
        url: norm, finalUrl, kind: 'content', from: item.from, fetchedAt: new Date().toISOString(),
        title: ex.title, h1: ex.h1, description: ex.description, date: ex.date,
        truncated: truncated || undefined, text: ex.text.slice(0, MAX_PAGE_CHARS),
        // domLen = DOM-Textlänge (mit versteckten Knoten) → erlaubt einen
        // beweisbaren Vollständigkeits-Audit nach dem Crawl (Regel „keine
        // stillen Deckel"): sichtbar ≪ domLen ⇒ Akkordeon nicht aufgeklappt.
        domLen: ex.tcLen,
      }) + '\n');
      nHtml++;
      sessionPages++;
      blocks = 0;
      for (const l of ex.links) {
        const child = normalize(l.href, finalUrl);
        if (!child || visited.has(child) || enqueued.has(child)) continue;
        if (!classify(child)) continue;
        enqueued.add(child);
        queue.push({ url: child, from: norm, linkText: l.txt });
      }
    }
  } catch (e) {
    nErr++;
    const msg = String(e && e.message || e);
    errOut.write(JSON.stringify({ url: norm, from: item.from, error: msg }) + '\n');
    // NOROOT / navigation-destroyed context / transiente evaluate-Fehler:
    // EINMAL sofort neu einreihen (kurze Pause), damit keine §§-Seite still
    // verloren geht (Fund 2026-07-16). Kein Session-Reset nötig – die
    // Challenge ist gelöst, nur der DOM war mid-navigation.
    if (/NOROOT|Execution context was destroyed|reading 'querySelectorAll'/.test(msg) && !item._retried) {
      visited.delete(norm);
      queue.unshift({ ...item, _retried: true });
      await sleep(1200);
    } else if (/BOTBLOCK|kein PDF/.test(msg)) {
      blocks++;
      if (blocks >= 10) {
        visited.delete(norm); queue.unshift(item, ...deferredPdf); saveState();
        console.log('ABBRUCH: Bot-Schutz blockt auch den Browser dauerhaft. State gesichert – später fortsetzen.');
        process.exit(2);
      }
      await sleep(30000);
      // ECHTER Session-Reset statt Weiter-Navigieren: eine geflaggte Session
      // bleibt mit ihren Cookies DAUERHAFT geblockt, erst ein frischer Context
      // löst die Challenge wieder (Empirie 2026-07-16, s. newSession). Die
      // geblockte URL wird sofort wieder eingereiht – die neue Session holt sie.
      sessionPages = 0; sessionStart = Date.now();
      await newSession();
      await gotoWithChallenge(`https://${HOST}${PREFIX || '/'}`).catch(() => {});
      visited.delete(norm);
      queue.unshift(item);
    }
  }

  if ((nHtml + nPdf) % 20 === 0) saveState();
  if ((nHtml + nPdf) % 10 === 0) console.log(`[${HOST.split('.')[0]}] html=${nHtml} pdf=${nPdf} err=${nErr} queue=${queue.length}`);
  await sleep(DELAY + Math.floor(Math.random() * 600));
}

// Zurückgestellte PDFs zurück in die Queue → State behält sie fürs Resume
if (deferredPdf.length) queue.unshift(...deferredPdf);
saveState();
// Deckel-Trips LAUT melden (Regel „keine stillen Deckel"): ein „FERTIG" ohne
// Warnung heißt wirklich vollständig (queue-rest=0).
if (nHtml >= MAX_PAGES) console.warn(`⚠️ Seiten-Deckel --max=${MAX_PAGES} erreicht – Crawl UNVOLLSTÄNDIG, erneut starten (Resume) oder --max erhöhen.`);
if (deferredPdf.length) console.warn(`⚠️ PDF-Deckel --maxpdf=${MAX_PDF} erreicht – ${deferredPdf.length} PDFs zurückgestellt (Resume lädt sie nach).`);
console.log(`FERTIG: html=${nHtml} pdf=${nPdf} err=${nErr} queue-rest=${queue.length}`);
pagesOut.end(); pdfOut.end(); errOut.end();
await browser.close();
