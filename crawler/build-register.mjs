#!/usr/bin/env node
/**
 * Baut aus den Crawl-Ausgaben das Steuerrecht-Register:
 *
 *   data/register.js     – Metadaten aller Quellen (für die Offline-WebApp,
 *                          per <script src> auch unter file:// ladbar)
 *   data/register.json   – dieselben Daten als JSON (für Werkzeuge)
 *   data/corpus.jsonl.gz – Volltext-Chunks für das Server-Retrieval (BM25)
 *
 * Aufruf:
 *   node build-register.mjs --gii <gii-cache> \
 *     --sites "bmf=<bmf-cache>,bmjv=<bmjv-cache>" --out ../data
 * (--bmf <dir> bleibt als Kurzform für eine einzelne Seiten-Quelle erhalten)
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { StringDecoder } from 'node:string_decoder';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) =>
  a.startsWith('--') ? [a.slice(2), arr[i + 1]] : null).filter(Boolean));
const GII = args.gii ? path.resolve(args.gii) : null;
const SITES = [];
if (args.bmf) SITES.push({ name: 'bmf', dir: path.resolve(args.bmf) });
if (args.sites) {
  for (const pair of args.sites.split(',')) {
    const [name, dir] = pair.split('=');
    if (name && dir && !SITES.some((s) => s.name === name.trim())) SITES.push({ name: name.trim(), dir: path.resolve(dir.trim()) });
  }
}
const OUT = path.resolve(args.out || '../data');
fs.mkdirSync(OUT, { recursive: true });

const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };

// ---------- Thema/Rubrik: deterministisch aus der amtlichen URL-Struktur ----------
// (keine KI-Klassifikation – jede Zuordnung ist aus dem URL-Pfad belegbar)
const BMJV_THEMEN = {
  wirtschaft_finanzen: 'Wirtschaft & Finanzen', verbraucherschutz: 'Verbraucherschutz',
  gesellschaft_familie: 'Gesellschaft & Familie', digitales: 'Digitales',
  wege_zum_recht: 'Wege zum Recht', praevention_opferhilfe: 'Prävention & Opferhilfe',
  strafrecht: 'Strafrecht', zivilrecht: 'Zivilrecht', europa_internationales: 'Europa & Internationales',
};
const BMJV_RUBRIKEN = {
  Pressemitteilungen: 'Pressemitteilung', Reden: 'Rede', Interviews: 'Interview',
  Meldungen: 'Meldung', Publikationen: 'Publikation',
  Gesetzgebungsverfahren: 'Gesetzgebungsverfahren', Downloads: 'Download',
};
const prettySlug = (s) => decodeURIComponent(s).replace(/[_-]+/g, ' ').trim()
  .replace(/\b\w/g, (ch) => ch.toUpperCase());

function topicOf(u) {
  let path;
  try { path = new URL(u).pathname; } catch { return ''; }
  const host = hostOf(u);
  let m;
  if (host === 'bmjv.de') {
    if ((m = /^\/DE\/themen\/([^/]+)/i.exec(path))) return `BMJV · ${BMJV_THEMEN[m[1]] || prettySlug(m[1])}`;
    if ((m = /^\/SharedDocs\/([^/]+)/i.exec(path))) return `BMJV · ${BMJV_RUBRIKEN[m[1]] || prettySlug(m[1])}`;
    if (/^\/DE\/rechtsstaat_kompakt\//i.test(path)) return 'BMJV · Rechtsstaat kompakt';
    if (/^\/DE\/[Ss]ervice\//.test(path)) return 'BMJV · Service';
    if (/^\/DE\/ministerium\//i.test(path)) return 'BMJV · Ministerium';
    if (/^\/DE\/presse\//i.test(path)) return 'BMJV · Presse';
    if (/^\/DE\/gesetzgebung/i.test(path)) return 'BMJV · Gesetzgebung';
    return 'BMJV';
  }
  // Amtliche BMF-Handbücher (konsolidierte Richtlinien/Erlasse, eigene
  // Subdomains – gecrawlt lokal via crawl-handbuch-browser.mjs)
  const HANDBUCH = {
    ao: 'AO-Handbuch (AO · AEAO)', esth: 'Einkommensteuer-Handbuch (EStG · EStDV · EStR)',
    lsth: 'Lohnsteuer-Handbuch (LStR · LStDV)', ksth: 'Körperschaftsteuer-Handbuch (KStG · KStR)',
    gewsth: 'Gewerbesteuer-Handbuch (GewStG · GewStR)', usth: 'Umsatzsteuer-Handbuch (UStG · UStAE)',
    erbsth: 'Erbschaftsteuer-Handbuch (ErbStG · ErbStR)',
  };
  if ((m = /^([a-z]+)\.bundesfinanzministerium\.de$/.exec(host)) && HANDBUCH[m[1]]) {
    return `Amtliches Handbuch · ${HANDBUCH[m[1]]}`;
  }
  // Quellen-Ausbau (Betreiber 2026-07-16 „nimm alles auf"):
  // BZSt (DSFinV-K/Merkblätter), Bundes-VwV, BFH-Rechtsprechung, EU-Recht
  if (host === 'bzst.de') return 'BZSt · Bundeszentralamt für Steuern';
  if (host === 'verwaltungsvorschriften-im-internet.de') return 'Verwaltungsvorschriften des Bundes';
  if (host === 'bundesfinanzhof.de') return 'BFH · Rechtsprechung';
  if (host === 'rechtsprechung-im-internet.de') return 'Rechtsprechung des Bundes';
  if (host === 'eur-lex.europa.eu') return 'EU-Recht (EUR-Lex)';
  if (host === 'bundesfinanzministerium.de') {
    if ((m = /^\/Web\/DE\/Themen\/Steuern\/([^/]+)/i.exec(path))) {
      const map = {
        'Steuerverwaltungu-Steuerrecht': 'Steuerverwaltung & Steuerrecht',
        Steuerarten: 'Steuerarten', Steuerliche_Themengebiete: 'Steuerliche Themengebiete',
        Internationales_Steuerrecht: 'Internationales Steuerrecht',
      };
      return `BMF Steuern · ${map[m[1]] || prettySlug(m[1])}`;
    }
    if (/BMF[-_]?Schreiben/i.test(path)) return 'BMF Steuern · BMF-Schreiben';
    if (/^\/Content\/DE\/Downloads\//i.test(path)) return 'BMF Steuern · Download/Schreiben';
    return 'BMF Steuern';
  }
  return '';
}

// Gepuffertes, synchrones Zeilen-Lesen: die RII-pages.jsonl wächst auf > 1 GB
// (75k Urteile = 1,33 GB); ein readFileSync(...,'utf8') sprengt V8s
// String-Limit (~512 MB) und ließ den Register-Bau abstürzen (Fund
// 2026-07-17). Chunkweise lesen, Zeilen an '\n' trennen, Teilzeile im
// Puffer halten – so entsteht nie ein Riesen-String. Rückgabe bleibt ein
// Array (Aufrufer unverändert). Für kleine Dateien praktisch gleich schnell.
const readJsonl = (f) => {
  if (!f || !fs.existsSync(f)) return [];
  const out = [];
  const fd = fs.openSync(f, 'r');
  const decoder = new StringDecoder('utf8'); // puffert an Chunk-Grenzen
                                             // zerrissene UTF-8-Sequenzen
                                             // (Umlaute bleiben intakt)
  try {
    const CHUNK = 1 << 20; // 1 MiB
    const buf = Buffer.allocUnsafe(CHUNK);
    let rest = '';
    let bytes;
    while ((bytes = fs.readSync(fd, buf, 0, CHUNK, null)) > 0) {
      rest += decoder.write(buf.subarray(0, bytes));
      let nl;
      while ((nl = rest.indexOf('\n')) >= 0) {
        const line = rest.slice(0, nl);
        rest = rest.slice(nl + 1);
        if (line.trim()) { try { out.push(JSON.parse(line)); } catch { /* defekte Zeile überspringen */ } }
      }
    }
    rest += decoder.end();
    if (rest.trim()) { try { out.push(JSON.parse(rest)); } catch { /* unvollständige letzte Zeile */ } }
  } finally { fs.closeSync(fd); }
  return out;
};

const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
const snippet = (s, n) => { const c = clean(s); return c.length > n ? `${c.slice(0, n - 1)}…` : c; };

const entries = [];
const corpus = [];
let idSeq = 0;
const nextId = (p) => `${p}${++idSeq}`;

// Obergrenze Chunks je PDF – gekoppelt an extract-pdf.mjs MAX_CHARS (4 Mio.):
// 4.000.000 / 3.200 = 1250. Nur Backstop gegen Ausreißer, nie Normalfall.
const MAX_PDF_CHUNKS = 1250;

function chunkText(text, maxLen = 2800) {
  const parts = [];
  let cur = '';
  for (const para of String(text || '').split('\n')) {
    if (cur.length + para.length + 1 > maxLen && cur.length > 400) { parts.push(cur); cur = ''; }
    cur += (cur ? '\n' : '') + para;
    while (cur.length > maxLen * 1.5) { parts.push(cur.slice(0, maxLen)); cur = cur.slice(maxLen); }
  }
  if (cur.trim()) parts.push(cur);
  return parts;
}

// ---------- 1. Gesetzes-Vollindex (alle Bundesgesetze, klickbar) ----------
const lawsIndex = readJsonl(GII && path.join(GII, 'laws-index.jsonl'));
const dedupeLaw = new Set();
for (const law of lawsIndex) {
  if (dedupeLaw.has(law.slug)) continue;
  dedupeLaw.add(law.slug);
  entries.push({
    id: nextId('g'), kind: 'gesetz', source: 'gesetze-im-internet.de', amtlich: true,
    title: `${law.abbrev} – ${snippet(law.title, 160)}`, url: law.url,
    topic: 'Gesetze · alle Rechtsgebiete',
  });
}

// ---------- 2. Normen (§-genau) ----------
// Steuergesetz-Normen werden REGISTEREINTRÄGE (+Korpus). Alle übrigen
// Bundesgesetz-Normen (Betreiber 2026-07-15: „die nicht-steuer gesetze auch
// mit volltext aufnehmen") gehen NUR in den Suchkorpus (Topic
// „Bundesrecht (§§)") – sonst wächst register.js um ~100k Einträge und die
// Offline-WebApp wird unbenutzbar; das Gesetz selbst bleibt als klickbarer
// Registereintrag, die KI zitiert die §-URL aus dem Korpus.
const taxLawSlugs = new Set();
try {
  for (const l of JSON.parse(fs.readFileSync(path.join(GII, 'tax-laws.json'), 'utf8'))) taxLawSlugs.add(l.slug);
} catch { /* fehlt die Datei, gilt der Alt-Zustand: alles steuerlich */ }
const norms = readJsonl(GII && path.join(GII, 'norms.jsonl'));
const isDba = (t) => /doppelbesteuerung/i.test(t || '');
const dedupeNorm = new Set();
// §-Karteikarten für ALLE Gesetze (Betreiber 2026-07-15 „ist mir für alle
// wichtig"): Normen, die keine direkten Registereinträge werden (Nicht-Steuer
// + DBA), landen als KOMPAKTE Einträge im Lazy-Blob normen-register.js
// (gzip+base64; die WebApp entpackt ihn im Browser bei Bedarf). So bleibt
// register.js klein UND jeder § ist als Karteikarte such-/klickbar.
const lazyNorms = [];
let nNormEntries = 0, nKorpusOnly = 0;
for (const n of norms) {
  const key = `${n.lawSlug}|${n.enbez}|${n.titel}`;
  if (dedupeNorm.has(key)) continue;
  dedupeNorm.add(key);
  if (!n.text && !n.titel) continue;
  const isTaxLaw = taxLawSlugs.size === 0 || taxLawSlugs.has(n.lawSlug);
  const dba = isDba(n.lawTitle);
  const topic = isTaxLaw ? 'Steuergesetze (§§)' : 'Bundesrecht (§§)';
  const title = clean(`${n.law} ${n.enbez} – ${n.titel || n.lawTitle}`);
  const id = nextId('n');
  if (!dba && isTaxLaw) {
    entries.push({
      id, kind: 'norm', source: 'gesetze-im-internet.de', amtlich: true,
      title: snippet(title, 200), url: n.url, law: n.law, stand: snippet(n.stand, 120),
      summary: snippet(n.text, 180), topic,
    });
    nNormEntries++;
  } else {
    lazyNorms.push({ kind: 'norm', source: 'gesetze-im-internet.de', amtlich: true, title: snippet(title, 160), url: n.url, law: n.law, topic });
    nKorpusOnly++;
  }
  for (const [pi, part] of chunkText(n.text).entries()) {
    corpus.push({ id: `${id}.${pi}`, title, url: n.url, source: 'gesetze-im-internet.de', amtlich: true, stand: clean(n.stand), topic, text: part });
  }
}

// ---------- 2b. Kommende Änderungen (amtliche Standangaben der Gesetze) ----------
// juris-XML führt je Gesetz "Hinweis"-Standangaben wie "Änderung durch Art. …
// noch nicht berücksichtigt" – das ist die amtliche Vorschau MIT Wirkungsdatum
// (mWv). Daraus entstehen eigene ⏳-Registereinträge.
const lawStands = readJsonl(GII && path.join(GII, 'laws-stand.jsonl'));
const dedupeStand = new Set();
let nKommend = 0;
for (const ls of lawStands) {
  if (dedupeStand.has(ls.slug)) continue;
  dedupeStand.add(ls.slug);
  for (const s of ls.staende || []) {
    // Zwei amtliche „Kommend"-Fälle:
    //  a) Hinweis: Änderung „noch nicht berücksichtigt" / „textlich nachgewiesen,
    //     dokumentarisch noch nicht abschließend bearbeitet" = angekündigt,
    //     aber noch nicht eingearbeitet
    //  b) Aufh: künftiges Außerkrafttreten („tritt … mWv TT.MM.JJJJ außer Kraft")
    const pendingChange = /noch nicht (berücksichtigt|abschließend bearbeitet)/i.test(s.text);
    const aufhebung = s.typ === 'Aufh' && /außer kraft/i.test(s.text);
    if (s.typ === 'Stand' || (!pendingChange && !aufhebung)) continue;
    entries.push({
      id: nextId('k'), kind: 'kommend', source: 'gesetze-im-internet.de', amtlich: true,
      title: `⏳ ${ls.abbrev}: ${snippet(s.text, 170)}`,
      url: ls.url, date: s.mwv || '', topic: 'Kommende Änderungen',
      summary: aufhebung
        ? (s.mwv ? `Tritt mit Wirkung vom ${s.mwv} außer Kraft (amtliche Standangabe).` : 'Künftiges Außerkrafttreten (amtliche Standangabe, Datum siehe Hinweistext).')
        : (s.mwv
          ? `Wirksam ab ${s.mwv} – amtlicher Hinweis: Änderung ist im Gesetzestext noch nicht abschließend eingearbeitet.`
          : 'Amtlicher Hinweis: Änderung ist im Gesetzestext noch nicht abschließend eingearbeitet (Datum siehe Hinweistext).'),
    });
    nKommend++;
  }
}

// ---------- 3. Amtliche Webseiten (BMF, BMJV, …) ----------
// Formular-Echo-URLs (z. B. barrieremelden_node.html?page=<kodierte-URL>) sind
// CMS-Navigations-Artefakte ohne eigenen Inhalt und blähten das Register
// rekursiv auf (Audit 2026-07-15: 336 solcher Einträge aus dem Alt-Crawl vor
// dem 414-Fix). Klassenweit ausfiltern: Query-Param, dessen Wert eine kodierte
// absolute URL ist.
const isFormEcho = (u) => /[?&][^#=]*=https?%3a/i.test(String(u || ''));
const dedupePage = new Set();
const dedupePdf = new Set();
let nSeiten = 0, nPdf = 0, nUrteile = 0;
for (const site of SITES) {
  const pages = readJsonl(path.join(site.dir, 'pages.jsonl'));
  for (const p of pages) {
    if (dedupePage.has(p.url)) continue;
    dedupePage.add(p.url);
    if (isFormEcho(p.url)) continue;
    const source = hostOf(p.url);
    // Urteile (fetch-rii.mjs, kind 'urteil'): KEINE register.js-Einträge –
    // 83k Entscheidungen würden die Offline-WebApp sprengen. Stattdessen wie
    // die Nicht-Steuer-§§: kompakte Karteikarte im Lazy-Blob + Volltext in
    // den Korpus. Die Chunks tragen kind/title/date, damit
    // restore-cache-from-register sie OHNE register-Eintrag rekonstruieren
    // kann (sonst würde die Update-Routine sie wieder verlieren).
    if (p.kind === 'urteil') {
      const uTitle = clean(p.title || p.h1);
      if (!uTitle && !p.text) continue;
      const id = nextId('u');
      lazyNorms.push({ kind: 'urteil', source, amtlich: true, title: snippet(uTitle, 160), url: p.url, topic: topicOf(p.url) });
      nUrteile++;
      for (const [pi, part] of chunkText(p.text).entries()) {
        corpus.push({ id: `${id}.${pi}`, kind: 'urteil', title: uTitle, url: p.url, source, amtlich: true, date: clean(p.date), topic: topicOf(p.url), text: part });
      }
      continue;
    }
    let title = clean(p.h1 || p.title || p.url).replace(/ \| .*(Bundesministerium|BMF|BMJV).*$/i, '').replace(/^BMF\s*-\s*/, '');
    // Handbuch-Subdomains: Site-Suffixe wie „… - AO-Handbuch" nur DORT strippen
    // (Bestandsquellen unberührt lassen – „…Handbuch" kann in BMJV-Titeln echt sein)
    if (/^[a-z]+\.bundesfinanzministerium\.de$/.test(source)) {
      title = title.replace(/\s*[|–—-]\s*[^|–—-]*Handbuch[^|–—-]*$/i, '').trim();
    }
    if (!title && !p.text) continue;
    const id = nextId('b');
    entries.push({
      id, kind: 'seite', source, amtlich: true,
      title: snippet(title, 200), url: p.url, date: clean(p.date),
      summary: snippet(p.description || p.text, 200), topic: topicOf(p.url),
    });
    nSeiten++;
    for (const [pi, part] of chunkText(p.text).entries()) {
      corpus.push({ id: `${id}.${pi}`, title, url: p.url, source, amtlich: true, date: clean(p.date), topic: topicOf(p.url), text: part });
    }
  }

  // ---------- 4. PDFs der Quelle (BMF-Schreiben, Publikationen, …) ----------
  const pdfTexts = readJsonl(path.join(site.dir, 'pdftexts.jsonl'));
  const pdfByUrl = new Map();
  for (const t of pdfTexts) if (!pdfByUrl.has(t.url)) pdfByUrl.set(t.url, t);
  const pdfMeta = readJsonl(path.join(site.dir, 'pdfmeta.jsonl'));
  for (const m of pdfMeta) {
    if (dedupePdf.has(m.url)) continue;
    dedupePdf.add(m.url);
    const source = hostOf(m.url);
    const t = pdfByUrl.get(m.url) || {};
    const fileName = decodeURIComponent((new URL(m.url)).pathname.split('/').pop() || '').replace(/\.pdf$/i, '').replace(/[-_]/g, ' ');
    const title = clean(t.pdfTitle || m.linkText || fileName);
    const head = clean(t.text || '').slice(0, 600);
    const vom = (/(?:vom|v\.)\s+(\d{1,2}\.\s?\d{1,2}\.\s?\d{4})/.exec(head) || [])[1] || '';
    const id = nextId('p');
    entries.push({
      id, kind: 'pdf', source, amtlich: true,
      title: snippet(title, 200), url: m.url, date: vom,
      summary: snippet(t.text, 200) || '(PDF – Text nicht extrahiert)',
      topic: topicOf(m.url),
    });
    nPdf++;
    if (t.text) {
      // Deckel je PDF passend zum Extraktor-Deckel (extract-pdf.mjs: 4 Mio.
      // Zeichen ≈ 1250 Chunks à 3200). Der alte stille Deckel (61 Chunks
      // ≈ 195k Zeichen) hat große amtliche Texte beim Ingest ABGESCHNITTEN,
      // obwohl der Volltext extrahiert war (Fund 2026-07-16: UStAE-Abschnitt
      // 10.3 fehlte im Korpus trotz vollständiger PDF-Extraktion). Regel
      // „keine stillen Deckel": ein Trip wird LAUT gemeldet, nie verschluckt.
      const parts = chunkText(t.text, 3200);
      if (parts.length > MAX_PDF_CHUNKS) {
        console.warn(`⚠️ PDF-Chunk-Deckel (${MAX_PDF_CHUNKS}) greift: ${m.url} – ${parts.length - MAX_PDF_CHUNKS} Chunks verworfen`);
      }
      for (const [pi, part] of parts.slice(0, MAX_PDF_CHUNKS).entries()) {
        corpus.push({ id: `${id}.${pi}`, title, url: m.url, source, amtlich: true, date: vom, topic: topicOf(m.url), text: part });
      }
    }
  }
}

// ---------- Änderungs-Changelog (Diff gegen das vorherige Register) ----------
let lastUpdate = null;
try {
  const prevFile = path.join(OUT, 'register.json');
  if (fs.existsSync(prevFile)) {
    const prev = JSON.parse(fs.readFileSync(prevFile, 'utf8'));
    const key = (e) => `${e.kind}|${e.url}`;
    const prevMap = new Map(prev.entries.map((e) => [key(e), e]));
    const curMap = new Map(entries.map((e) => [key(e), e]));
    const neu = [], geaendert = [];
    for (const [k, e] of curMap) {
      const p = prevMap.get(k);
      if (!p) neu.push(e);
      else if ((p.stand || '') !== (e.stand || '') || (p.date || '') !== (e.date || '') || p.title !== e.title) geaendert.push(e);
    }
    const entfallen = [...prevMap.keys()].filter((k) => !curMap.has(k)).length;
    lastUpdate = {
      date: new Date().toISOString(), neu: neu.length, geaendert: geaendert.length, entfallen,
      beispieleNeu: neu.slice(0, 25).map((e) => ({ title: e.title, url: e.url })),
      beispieleGeaendert: geaendert.slice(0, 25).map((e) => ({ title: e.title, url: e.url })),
    };
    const clFile = path.join(OUT, 'changelog.json');
    const cl = fs.existsSync(clFile) ? JSON.parse(fs.readFileSync(clFile, 'utf8')) : [];
    cl.unshift(lastUpdate);
    fs.writeFileSync(clFile, JSON.stringify(cl.slice(0, 20), null, 1));
  }
} catch (e) { console.log('Changelog-Diff übersprungen:', e.message); }

// ---------- Schreiben ----------
const meta = {
  built: new Date().toISOString(),
  hinweis: 'Alle Inhalte stammen aus amtlichen Quellen (BMF, gesetze-im-internet.de). ' +
    'smartsteuer-Lexikon wurde NICHT übernommen (maschinenlesbarer TDM-Vorbehalt §44b UrhG in robots.txt) – nur Verlinkung.',
  counts: {
    gesetzeIndex: dedupeLaw.size, normen: nNormEntries, normenNurKorpus: nKorpusOnly,
    seiten: nSeiten, pdfs: nPdf, urteile: nUrteile, kommend: nKommend, korpusChunks: corpus.length,
    quellen: SITES.map((s) => s.name),
  },
  lastUpdate,
};
const register = { meta, entries };
fs.writeFileSync(path.join(OUT, 'register.json'), JSON.stringify(register));
fs.writeFileSync(path.join(OUT, 'register.js'), `// Generiert von build-register.mjs – nicht von Hand bearbeiten.\nwindow.STEUER_REGISTER = ${JSON.stringify(register)};\n`);
// Lazy-Blob: base64(gzip(JSON)) enthält nur [A-Za-z0-9+/=] – keine
// HTML-Parser-Fallen, kann unverändert inline eingebettet werden.
fs.writeFileSync(path.join(OUT, 'normen-register.js'),
  `// Generiert von build-register.mjs – §-Karteikarten aller übrigen Gesetze (lazy).\nwindow.STEUER_NORMEN_B64 = "${zlib.gzipSync(JSON.stringify(lazyNorms), { level: 9 }).toString('base64')}";\nwindow.STEUER_NORMEN_COUNT = ${lazyNorms.length};\n`);
// Korpus in Shards schreiben (corpus.jsonl.gz, corpus-2.jsonl.gz, …):
// GitHub-Dateigrenze 100 MB UND V8-Stringgrenze (~512 MB join). Grenze pro
// Shard ~200 MB roh ≈ 40–55 MB gz. Alte Shards vorher entfernen, sonst lädt
// der Server verwaiste Reste.
for (const f of fs.readdirSync(OUT)) {
  if (/^corpus(-\d+)?\.jsonl\.gz$/.test(f)) fs.rmSync(path.join(OUT, f));
}
const SHARD_RAW_LIMIT = 200 * 1024 * 1024;
const shardName = (i) => (i === 0 ? 'corpus.jsonl.gz' : `corpus-${i + 1}.jsonl.gz`);
let shardLines = [], shardBytes = 0, shardIdx = 0;
const flushShard = () => {
  if (!shardLines.length) return;
  fs.writeFileSync(path.join(OUT, shardName(shardIdx)), zlib.gzipSync(shardLines.join('\n'), { level: 9 }));
  shardIdx++; shardLines = []; shardBytes = 0;
};
for (const c of corpus) {
  const line = JSON.stringify(c);
  shardLines.push(line);
  shardBytes += Buffer.byteLength(line) + 1;
  if (shardBytes >= SHARD_RAW_LIMIT) flushShard();
}
flushShard();

const mb = (f) => (fs.statSync(path.join(OUT, f)).size / 1024 / 1024).toFixed(1);
console.log('Register gebaut:', JSON.stringify(meta.counts));
const shardInfo = Array.from({ length: shardIdx }, (_, i) => `${shardName(i)}: ${mb(shardName(i))} MB`).join(' · ');
console.log(`register.js: ${mb('register.js')} MB · register.json: ${mb('register.json')} MB · normen-register.js: ${mb('normen-register.js')} MB · ${shardInfo}`);
