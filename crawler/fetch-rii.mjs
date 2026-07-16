#!/usr/bin/env node
/**
 * Rechtsprechung des Bundes: lädt Entscheidungen ALLER Bundesgerichte
 * (BGH, BFH, BVerwG, BPatG, BAG, BSG, BVerfG) über die Maschinen-
 * Schnittstelle von rechtsprechung-im-internet.de (BMJ/juris):
 *
 *   rii-toc.xml  – Gesamtindex (~83k Items: gericht, datum, az, link, modified)
 *   jb-<DOKNR>.zip – je Entscheidung ein ZIP mit strukturiertem juris-XML
 *                    (leitsatz/tenor/tatbestand/gründe + §-genaue Normverweise)
 *
 * FREIGABE: Die robots.txt des Portals sperrt Crawler generell
 * (Disallow: / + tdm-reservation-Header). Der Betreiber hat die Übernahme
 * am 2026-07-16 AUSDRÜCKLICH freigegeben („alles übernehmen, es geht nicht
 * mehr nur um Steuer sondern alles an Gesetzen") – Begründung: Inhalte sind
 * gemeinfreie amtliche Werke (§ 5 UrhG), rii-toc.xml ist die dafür
 * bereitgestellte Bulk-Schnittstelle (Muster gii-toc.xml), es werden KEINE
 * jportal-HTML-Seiten gecrawlt, moderate Rate. Dokumentiert im
 * Rechtsquellen-Register. NICHT auf andere robots-gesperrte Quellen
 * übertragen – jede braucht ihren eigenen Betreiber-Entscheid.
 *
 * Aufruf:
 *   node fetch-rii.mjs [--out ../rii-cache] [--delay 600] [--max 0]
 *     [--gericht BFH,BVerfG] [--since 2026-07-01] [--refresh-toc true]
 * Cloud: NODE_USE_ENV_PROXY=1 voranstellen. Resumierbar: bereits geladene
 * doknr werden übersprungen; --since lädt nur Items mit neuerem modified
 * (Delta für die Update-Routine). ZIPs werden NICHT gespeichert (nur Text).
 *
 * Anzeige-Links im Register: BFH → amtliche Detailseite bundesfinanzhof.de
 * (robots-erlaubt); übrige Gerichte → stabiler jlink des Portals.
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { stripTags } from './bmf-lib.mjs';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) =>
  a.startsWith('--') ? [a.slice(2), arr[i + 1]] : null).filter(Boolean));
const OUT = path.resolve(args.out || '../rii-cache');
const DELAY = Number(args.delay || 600);
const MAX = Number(args.max || 0);
const GERICHTE = args.gericht ? new Set(args.gericht.split(',').map((s) => s.trim().toUpperCase())) : null;
const SINCE = args.since ? new Date(args.since).getTime() : 0;
fs.mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36' };

// ---------- Mini-Unzip (zero-dep; ein ZIP = eine XML-Datei) ----------
// Geht bewusst über das Central Directory (EOCD), weil bei Bit 3 der
// General-Purpose-Flags die Größen NICHT im Local Header stehen.
function unzipSingle(buf) {
  // EOCD-Signatur 0x06054b50 rückwärts in den letzten 64 KB suchen
  const min = Math.max(0, buf.length - 65557);
  let eocd = -1;
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('kein ZIP (EOCD fehlt)');
  const cdOffset = buf.readUInt32LE(eocd + 16);
  // Erster Central-Directory-Eintrag
  if (buf.readUInt32LE(cdOffset) !== 0x02014b50) throw new Error('ZIP: CD-Signatur fehlt');
  const method = buf.readUInt16LE(cdOffset + 10);
  const compSize = buf.readUInt32LE(cdOffset + 20);
  const nameLen = buf.readUInt16LE(cdOffset + 28);
  const extraLen = buf.readUInt16LE(cdOffset + 30);
  const commentLen = buf.readUInt16LE(cdOffset + 32);
  const localOffset = buf.readUInt32LE(cdOffset + 42);
  void nameLen; void extraLen; void commentLen;
  // Local Header: eigene name/extra-Längen (können vom CD abweichen!)
  if (buf.readUInt32LE(localOffset) !== 0x04034b50) throw new Error('ZIP: Local-Header fehlt');
  const lNameLen = buf.readUInt16LE(localOffset + 26);
  const lExtraLen = buf.readUInt16LE(localOffset + 28);
  const dataStart = localOffset + 30 + lNameLen + lExtraLen;
  const data = buf.subarray(dataStart, dataStart + compSize);
  if (method === 8) return zlib.inflateRawSync(data).toString('utf8');
  if (method === 0) return data.toString('utf8');
  throw new Error(`ZIP: Kompressionsmethode ${method} nicht unterstützt`);
}

// ---------- juris-XML → Registertext ----------
const tag = (xml, name) => {
  const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i').exec(xml);
  return m ? m[1] : '';
};
const tagText = (xml, name) => stripTags(tag(xml, name)).trim();

function buildEntry(xml, tocItem) {
  const gertyp = tagText(xml, 'gertyp') || (tocItem.gericht || '').split(' ')[0];
  const spruch = tagText(xml, 'spruchkoerper');
  const az = tagText(xml, 'aktenzeichen') || tocItem.az;
  const doktyp = tagText(xml, 'doktyp') || 'Entscheidung';
  const ecli = tagText(xml, 'ecli');
  const doknr = tagText(xml, 'doknr') || tocItem.doknr;
  const d = tagText(xml, 'entsch-datum') || tocItem.datum || '';
  const datum = /^\d{8}$/.test(d) ? `${d.slice(6, 8)}.${d.slice(4, 6)}.${d.slice(0, 4)}` : d;
  const titelzeile = tagText(xml, 'titelzeile');
  const norm = tagText(xml, 'norm');
  const parts = [];
  parts.push(`${gertyp} ${spruch} · ${doktyp} vom ${datum} · Az. ${az}${ecli ? ` · ${ecli}` : ''}`);
  if (norm) parts.push(`Normen: ${norm}`);
  if (titelzeile) parts.push(titelzeile);
  for (const [label, name] of [
    ['Leitsatz', 'leitsatz'], ['Orientierungssatz', 'sonstosatz'], ['Tenor', 'tenor'],
    ['Tatbestand', 'tatbestand'], ['Entscheidungsgründe', 'entscheidungsgruende'],
    ['Gründe', 'gruende'], ['Abweichende Meinung', 'abwmeinung'],
  ]) {
    const t = tagText(xml, name);
    if (t) parts.push(`${label}:\n${t}`);
  }
  const text = parts.join('\n\n');
  const title = `${gertyp} ${az} – ${doktyp} vom ${datum}${titelzeile ? `: ${titelzeile.slice(0, 140)}` : ''}`;
  // Anzeige-Link: BFH-Entscheidungen haben eine robots-erlaubte amtliche
  // Detailseite; für die übrigen Gerichte ist der jlink der stabile Zitierweg.
  const url = gertyp === 'BFH'
    ? `https://www.bundesfinanzhof.de/de/entscheidung/entscheidungen-online/detail/${doknr}/`
    : `https://www.rechtsprechung-im-internet.de/jportal/?quelle=jlink&docid=${doknr}&psml=bsjrsprod.psml&max=true`;
  return {
    url, finalUrl: url, kind: 'urteil', doknr, ecli, from: '(rii-toc)',
    fetchedAt: new Date().toISOString(),
    title, h1: title,
    description: titelzeile.slice(0, 220),
    date: datum, gericht: `${gertyp} ${spruch}`.trim(), text,
  };
}

// ---------- Index laden ----------
const tocFile = path.join(OUT, 'rii-toc.xml');
if (!fs.existsSync(tocFile) || args['refresh-toc'] === 'true') {
  console.log('Lade rii-toc.xml (~23 MB) …');
  const r = await fetch('https://www.rechtsprechung-im-internet.de/rii-toc.xml', { headers: UA });
  if (!r.ok) { console.error(`toc HTTP ${r.status}`); process.exit(1); }
  fs.writeFileSync(tocFile, Buffer.from(await r.arrayBuffer()));
}
const toc = fs.readFileSync(tocFile, 'utf8');
const items = [];
const itemRe = /<item>([\s\S]*?)<\/item>/g;
let m;
while ((m = itemRe.exec(toc))) {
  const it = m[1];
  const pickT = (n) => ((new RegExp(`<${n}>([^<]*)</${n}>`).exec(it)) || [])[1] || '';
  const link = pickT('link').replace(/^http:/, 'https:'); // Port 80 ist im Proxy dicht
  const doknr = (/jb-([A-Z0-9]+)\.zip/i.exec(link) || [])[1];
  if (!doknr) continue;
  items.push({ gericht: pickT('gericht'), datum: pickT('entsch-datum'), az: pickT('aktenzeichen'), link, doknr, modified: pickT('modified') });
}
console.log(`Index: ${items.length} Entscheidungen`);

// Resume: bereits geladene doknr überspringen
const done = new Set();
const outFile = path.join(OUT, 'pages.jsonl');
if (fs.existsSync(outFile)) {
  for (const line of fs.readFileSync(outFile, 'utf8').split(/\r?\n/)) {
    if (!line.trim()) continue;
    try { done.add(JSON.parse(line).doknr); } catch { /* ignore */ }
  }
  console.log(`RESUME: ${done.size} bereits geladen`);
}

const todo = items.filter((it) =>
  !done.has(it.doknr) &&
  (!GERICHTE || GERICHTE.has((it.gericht || '').split(' ')[0].toUpperCase())) &&
  (!SINCE || new Date(it.modified).getTime() > SINCE));
console.log(`Offen: ${todo.length}${GERICHTE ? ` (Filter: ${[...GERICHTE].join(',')})` : ''}${SINCE ? ` (seit ${args.since})` : ''}`);

const errFile = path.join(OUT, 'errors.jsonl');
let ok = 0, err = 0;
for (const it of todo) {
  if (MAX && ok >= MAX) {
    console.warn(`⚠️ --max=${MAX} erreicht – ${todo.length - ok - err} Entscheidungen verbleiben (Resume lädt sie nach).`);
    break;
  }
  try {
    const r = await fetch(it.link, { headers: UA });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const xml = unzipSingle(Buffer.from(await r.arrayBuffer()));
    const entry = buildEntry(xml, it);
    fs.appendFileSync(outFile, JSON.stringify(entry) + '\n');
    done.add(it.doknr);
    ok++;
    if (ok % 100 === 0) console.log(`[rii] ${ok}/${todo.length} geladen, err=${err}`);
  } catch (e) {
    err++;
    fs.appendFileSync(errFile, JSON.stringify({ doknr: it.doknr, link: it.link, error: String(e && e.message || e) }) + '\n');
    if (err > 50 && err > ok) { console.error('ABBRUCH: zu viele Fehler in Folge – Netz/Schnittstelle prüfen, später fortsetzen.'); process.exit(2); }
  }
  await sleep(DELAY + Math.floor(Math.random() * 200));
}
console.log(`FERTIG: ${ok} geladen, ${err} Fehler, gesamt im Cache: ${done.size}`);
