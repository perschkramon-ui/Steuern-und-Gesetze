#!/usr/bin/env node
/**
 * Gesetze-im-Internet-Crawler für das Steuerrecht-Register (Steuerberater KI).
 *
 * 1. Holt ALLE Teillisten (A–Z, 1–9) → kompletter Index aller Bundesgesetze
 *    und -verordnungen (Kürzel, Titel, Link) – jedes Gesetz wird klickbar.
 * 2. Lädt für STEUERRELEVANTE Gesetze (Filterliste unten) die amtliche
 *    XML-Gesamtausgabe (juris-Format) und extrahiert jede Norm (§) einzeln
 *    mit Titel, Text und direkter §-URL.
 *
 * robots.txt von gesetze-im-internet.de: alles erlaubt (Disallow leer).
 * Trotzdem höflich sequentiell mit Pause.
 *
 * Aufruf: node crawl-gii.mjs --out <dir> [--delay 700]
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const BASE = 'https://www.gesetze-im-internet.de';
const UA = 'SteuerRegister-Crawler/1.0 (einmaliger privater Abruf fuer ein Quellenregister; Kontakt: perschkramon@gmail.com)';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) =>
  a.startsWith('--') ? [a.slice(2), arr[i + 1]] : null).filter(Boolean));
const OUT = path.resolve(args.out || './gii-cache');
const DELAY = Number(args.delay || 700);
fs.mkdirSync(OUT, { recursive: true });

// Steuerrelevanz-Filter: Titel ODER Kürzel (kleingeschrieben) enthält eines davon.
const TAX_PATTERNS = [
  'steuer',              // *steuergesetz, *StDV, Kirchensteuer, Steuerberatung, …
  'abgabenordnung',      // AO + EGAO
  'kassensich',          // KassenSichV
  'doppelbesteuerung',   // DBA-Zustimmungsgesetze
  'finanzgericht',       // FGO
  'bewertungsgesetz',    // BewG
  'solidaritätszuschlag',// SolZG (enthält kein "steuer")
  'finanzverwaltung',    // FVG
  'eigenheimzulage', 'investitionszulage', 'wohnungsbau-prämien', 'vermögensbildung',
  'zollverwaltung', 'zollkodex',
];
// Ausschlüsse gegen offensichtliche Fehltreffer des breiten "steuer"-Musters:
const TAX_EXCLUDE = [/steuermann/i, /steuerrad/i, /besteuerungsverfahren.*schiff/i];

const isTaxRelevant = (title, abbrev) => {
  const hay = `${title} ${abbrev}`.toLowerCase();
  if (TAX_EXCLUDE.some((re) => re.test(hay))) return false;
  return TAX_PATTERNS.some((p) => hay.includes(p));
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchRaw(url, asBuffer, attempt = 1) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 60000);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: ctl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} für ${url}`);
    return Buffer.from(await res.arrayBuffer());
  } catch (e) {
    if (attempt >= 4) throw e;
    const wait = 2000 * 2 ** (attempt - 1);
    console.log(`Retry ${attempt} in ${wait} ms: ${url} (${e && e.message || e})`);
    await sleep(wait);
    return fetchRaw(url, asBuffer, attempt + 1);
  } finally { clearTimeout(t); }
}

// Teillisten sind ISO-8859-1
const latin1 = (buf) => buf.toString('latin1');

function decodeEntities(s) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ');
}

// ---------- Schritt 1: Vollindex über alle Teillisten ----------
async function buildIndex() {
  const indexFile = path.join(OUT, 'laws-index.jsonl');
  if (fs.existsSync(indexFile) && fs.statSync(indexFile).size > 100000) {
    console.log('Index existiert bereits – überspringe (Datei löschen für Neuaufbau).');
    return fs.readFileSync(indexFile, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  }
  const home = latin1(await fetchRaw(`${BASE}/aktuell.html`));
  const listPages = [...new Set([...home.matchAll(/href="(?:\.\/)?(Teilliste_[^"]+\.html)"/g)].map((m) => m[1]))]
    .filter((p) => p !== 'Teilliste_translations.html'); // engl. Übersetzungsliste: anderes Format, nicht Teil des Registers
  console.log(`Teillisten gefunden: ${listPages.length}`);
  const laws = [];
  for (const page of listPages) {
    await sleep(DELAY);
    const html = latin1(await fetchRaw(`${BASE}/${page}`));
    const re = /<a href="\.\/([^/"]+)\/index\.html"><abbr title="([^"]*)">\s*([^<]+?)\s*<\/abbr>/g;
    let m, n = 0;
    while ((m = re.exec(html)) !== null) {
      laws.push({ slug: m[1], title: decodeEntities(m[2]).trim(), abbrev: decodeEntities(m[3]).trim(), url: `${BASE}/${m[1]}/` });
      n++;
    }
    console.log(`${page}: ${n} Einträge`);
  }
  // Dedupe über slug
  const seen = new Set();
  const unique = laws.filter((l) => !seen.has(l.slug) && seen.add(l.slug));
  fs.writeFileSync(indexFile, unique.map((l) => JSON.stringify(l)).join('\n') + '\n');
  console.log(`Vollindex: ${unique.length} Gesetze/Verordnungen`);
  return unique;
}

// ---------- Schritt 2: XML-Gesamtausgaben der Steuergesetze ----------
// Minimaler ZIP-Reader (stored/deflate) – dependency-frei über zlib.
function unzipFirstXml(buf) {
  // Central Directory suchen (EOCD)
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error('kein ZIP-EOCD');
  const cdOffset = buf.readUInt32LE(eocd + 16);
  const count = buf.readUInt16LE(eocd + 10);
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('CD-Signatur fehlt');
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    if (name.toLowerCase().endsWith('.xml')) {
      const lnameLen = buf.readUInt16LE(localOffset + 26);
      const lextraLen = buf.readUInt16LE(localOffset + 28);
      const dataStart = localOffset + 30 + lnameLen + lextraLen;
      const data = buf.subarray(dataStart, dataStart + compSize);
      return method === 0 ? data.toString('utf8') : zlib.inflateRawSync(data).toString('utf8');
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error('keine XML im ZIP');
}

function stripXmlTags(s) {
  return decodeEntities(
    s.replace(/<BR\s*\/?>/gi, '\n')
      .replace(/<\/(P|ABSATZ|absatz|Row|row|entry|LA|la|DL|DT|DD|dl|dt|dd)>/g, '\n')
      .replace(/<[^>]+>/g, ' ')
  ).replace(/[ \t]+/g, ' ').replace(/ *\n+ */g, '\n').replace(/\n{2,}/g, '\n').trim();
}

function enbezToFile(enbez) {
  // "§ 146a" -> "__146a.html"; "§§ 1 bis 3" u. ä. -> null; "Art 97" -> "art_97.html"
  let m = /^§\s*([0-9]+[a-z]?)$/i.exec(enbez);
  if (m) return `__${m[1].toLowerCase()}.html`;
  m = /^Art(?:ikel)?\.?\s+([0-9]+[a-z]?)$/i.exec(enbez);
  if (m) return `art_${m[1].toLowerCase()}.html`;
  return null;
}

function parseNorms(xml, law) {
  const norms = [];
  const re = /<norm[\s>][\s\S]*?<\/norm>/g;
  let m;
  // ALLE amtlichen Standangaben erfassen: "Stand" (eingearbeitet) UND
  // "Hinweis"-Typen wie "Änderung durch … noch nicht berücksichtigt"
  // (= KOMMENDE Änderung; Wirkungsdatum steckt oft als "mWv TT.MM.JJJJ" im Text).
  const staende = [];
  const standRe = /<standangabe[^>]*>\s*<standtyp>([^<]*)<\/standtyp>\s*<standkommentar>([\s\S]*?)<\/standkommentar>\s*<\/standangabe>/g;
  let sm;
  while ((sm = standRe.exec(xml)) !== null) {
    const text = stripXmlTags(sm[2]);
    const mwv = (/mWv\.?\s+(\d{1,2}\.\s?\d{1,2}\.\s?\d{4})/.exec(text) || [])[1] || '';
    staende.push({ typ: sm[1].trim(), text, mwv });
  }
  const stand = (staende.find((s) => s.typ === 'Stand') || {}).text || '';
  const ausfM = /<ausfertigung-datum[^>]*>([^<]+)</.exec(xml);
  const ausf = ausfM ? ausfM[1] : '';
  const orphanTexts = [];
  while ((m = re.exec(xml)) !== null) {
    const block = m[0];
    const enbez = (/<enbez>([\s\S]*?)<\/enbez>/.exec(block) || [])[1] || '';
    const titel = stripXmlTags((/<titel[^>]*>([\s\S]*?)<\/titel>/.exec(block) || ['', ''])[1]);
    const contentM = /<textdaten>[\s\S]*?<text[^>]*>([\s\S]*?)<\/text>/.exec(block);
    const text = contentM ? stripXmlTags(contentM[1]) : '';
    if (!enbez && !titel) { if (text) orphanTexts.push(text); continue; }
    if (!text && !titel) continue;
    const file = enbezToFile(decodeEntities(enbez));
    norms.push({
      law: law.abbrev, lawSlug: law.slug, lawTitle: law.title,
      enbez: decodeEntities(enbez).trim(), titel, text: text.slice(0, 60000),
      url: file ? `${BASE}/${law.slug}/${file}` : `${BASE}/${law.slug}/`,
      stand, ausfertigung: ausf,
    });
  }
  // Artikelgesetze/alte Abkommen (z. B. ErbStRG, BierStGemBY/BAG, DBA Taipeh):
  // juris-XML führt Norm-Blöcke OHNE enbez/titel – der Text darf nicht
  // verworfen werden, sonst fehlt der komplette Volltext im Korpus
  // (Audit-Fund 2026-07-15: 8 von 244 Steuergesetzen betroffen). Fallback:
  // ein aggregierter Gesamttext-Eintrag am Gesetz.
  if (norms.length === 0 && orphanTexts.length) {
    norms.push({
      law: law.abbrev, lawSlug: law.slug, lawTitle: law.title,
      enbez: '', titel: 'Gesamttext', text: orphanTexts.join('\n\n').slice(0, 60000),
      url: `${BASE}/${law.slug}/`, stand, ausfertigung: ausf,
    });
  }
  return { norms, staende, ausf };
}

// ---------- Main ----------
const laws = await buildIndex();
const taxLaws = laws.filter((l) => isTaxRelevant(l.title, l.abbrev));
console.log(`Steuerrelevant: ${taxLaws.length} von ${laws.length}`);
fs.writeFileSync(path.join(OUT, 'tax-laws.json'), JSON.stringify(taxLaws, null, 2));
// --all-norms (Betreiber 2026-07-15: „die nicht-steuer gesetze auch mit
// volltext aufnehmen"): Volltexte ALLER Gesetze laden, nicht nur der
// steuerrelevanten. tax-laws.json bleibt das Steuer-Kennzeichen für
// build-register (Steuer-Normen = Registereinträge, übrige = Korpus).
const crawlLaws = args['all-norms'] === 'true' ? laws : taxLaws;
console.log(`Volltext-Lauf über ${crawlLaws.length} Gesetze (all-norms=${args['all-norms'] === 'true'})`);

const normsFile = path.join(OUT, 'norms.jsonl');
const doneFile = path.join(OUT, 'norms-done.json');
const standFile = path.join(OUT, 'laws-stand.jsonl');
const done = new Set(fs.existsSync(doneFile) ? JSON.parse(fs.readFileSync(doneFile, 'utf8')) : []);
const normsOut = fs.createWriteStream(normsFile, { flags: 'a' });
const standOut = fs.createWriteStream(standFile, { flags: 'a' });
let nNorms = 0, nErr = 0, i = 0;
for (const law of crawlLaws) {
  i++;
  if (done.has(law.slug)) continue;
  await sleep(DELAY);
  try {
    const zip = await fetchRaw(`${BASE}/${law.slug}/xml.zip`, true);
    const xml = unzipFirstXml(zip);
    const { norms, staende, ausf } = parseNorms(xml, law);
    for (const n of norms) normsOut.write(JSON.stringify(n) + '\n');
    standOut.write(JSON.stringify({ slug: law.slug, abbrev: law.abbrev, title: law.title, url: law.url, ausfertigung: ausf, staende, fetchedAt: new Date().toISOString() }) + '\n');
    nNorms += norms.length;
    done.add(law.slug);
    if (i % 10 === 0) {
      fs.writeFileSync(doneFile, JSON.stringify([...done]));
      console.log(`[gii] ${i}/${crawlLaws.length} Gesetze, ${nNorms} Normen, err=${nErr}`);
    }
  } catch (e) {
    nErr++;
    console.log(`FEHLER ${law.slug}: ${e && e.message || e}`);
  }
}
fs.writeFileSync(doneFile, JSON.stringify([...done]));
console.log(`FERTIG: ${done.size}/${crawlLaws.length} Gesetze, ${nNorms} neue Normen, err=${nErr}`);
normsOut.end(); standOut.end();
