#!/usr/bin/env node
/**
 * EU-Recht als Registereinträge: holt die KONSOLIDIERTEN deutschen Fassungen
 * ausgewählter EU-Rechtsakte (Steuer-Kern + für eine deutsche Kassen-/Shop-SaaS
 * einschlägige Rechtsakte: DSGVO/ePrivacy, Verbraucher-/Preis-/UGP-Recht, GPSR,
 * DSA/DMA, PSD2, AI Act – vollständige Liste im DOCS-Array unten). Nur
 * konsolidierte Fassungen (führende 0); Rechtsakte ohne abrufbare Konsolidierung
 * sind bewusst ausgelassen.
 *
 * EINZELABRUF statt Crawl (Preflight 2026-07-16, s. Rechtsquellen-Register):
 * eur-lex.europa.eu challenged JEDEN Bot-Abruf (AWS-WAF, HTTP 202) – die
 * amtlich identischen Inhalte liefert das Amt für Veröffentlichungen über
 * CELLAR (publications.europa.eu, robots: alles erlaubt, kein TDM-Vorbehalt):
 *   GET https://publications.europa.eu/resource/celex/<CELEX>-<STAND>
 *   Header: Accept: application/xhtml+xml + Accept-Language: deu
 * Das jeweils NEUESTE Konsolidierungsdatum liefert der SPARQL-Endpoint
 * (keine geratenen Daten). Als ANZEIGE-Link ins Register kommt die
 * EUR-Lex-URL (funktioniert im Browser), als Fetch-Quelle dient CELLAR.
 *
 * Aufruf:  node fetch-eu-recht.mjs [--out ../eu-cache]
 * Cloud:   NODE_USE_ENV_PROXY=1 voranstellen (Node-fetch nutzt den Proxy
 *          sonst nicht); lokal unnötig.
 * Idempotent: schreibt pages.jsonl komplett neu (3 Einträge je Lauf);
 * ältere Konsolidierungs-Stände bleiben über data/ + Restore erhalten.
 */

import fs from 'node:fs';
import path from 'node:path';
import { stripTags, pick } from './bmf-lib.mjs';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) =>
  a.startsWith('--') ? [a.slice(2), arr[i + 1]] : null).filter(Boolean));
const OUT = path.resolve(args.out || '../eu-cache');
fs.mkdirSync(OUT, { recursive: true });

// NUR KONSOLIDIERTE Fassungen (führende 0, ohne Datum) – fetchCellar prüft auf
// „Artikel 1"; Rechtsakte ohne abrufbare Konsolidierung (z. B. 2014/55/EU
// E-Rechnung, 2019/882 EAA → CELLAR 404) sind bewusst NICHT gelistet.
// Alle Einträge am 2026-07-23 live gegen CELLAR verprobt.
const DOCS = [
  // Steuer-Kern
  { stem: '02006L0112', kurz: 'MwStSystRL 2006/112/EG' },
  { stem: '02011R0282', kurz: 'MwSt-Durchführungsverordnung (EU) 282/2011' },
  { stem: '02020L0262', kurz: 'Verbrauchsteuer-Systemrichtlinie (EU) 2020/262' },
  // Datenschutz / elektronische Kommunikation
  { stem: '02016R0679', kurz: 'Datenschutz-Grundverordnung (DSGVO) 2016/679' },
  { stem: '02002L0058', kurz: 'ePrivacy-Richtlinie 2002/58/EG' },
  // Verbraucher- und Marktrecht (Kasse/Shop/Preisauszeichnung)
  { stem: '02011L0083', kurz: 'Verbraucherrechte-Richtlinie 2011/83/EU' },
  { stem: '01998L0006', kurz: 'Preisangaben-Richtlinie 98/6/EG' },
  { stem: '02005L0029', kurz: 'Richtlinie über unlautere Geschäftspraktiken 2005/29/EG' },
  { stem: '02023R0988', kurz: 'Allg. Produktsicherheitsverordnung (GPSR) 2023/988' },
  // Digitalmärkte / Zahlungen / KI
  { stem: '02022R2065', kurz: 'Digital Services Act (DSA) (EU) 2022/2065' },
  { stem: '02022R1925', kurz: 'Digital Markets Act (DMA) (EU) 2022/1925' },
  { stem: '02015L2366', kurz: 'Zahlungsdiensterichtlinie 2 (PSD2) 2015/2366' },
  { stem: '02024R1689', kurz: 'KI-Verordnung (AI Act) (EU) 2024/1689' },
];

const SPARQL = 'https://publications.europa.eu/webapi/rdf/sparql';

async function latestCelex(stem) {
  const q = `SELECT DISTINCT ?celex WHERE { ?w <http://publications.europa.eu/ontology/cdm#resource_legal_id_celex> ?celex . FILTER(STRSTARTS(STR(?celex), "${stem}-")) }`;
  const r = await fetch(`${SPARQL}?query=${encodeURIComponent(q)}&format=text/csv`, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
  });
  if (!r.ok) throw new Error(`SPARQL HTTP ${r.status} für ${stem}`);
  const dates = (await r.text()).split(/\r?\n/)
    .map((l) => (new RegExp(`^"?${stem}-(\\d{8})"?$`).exec(l.trim()) || [])[1])
    .filter(Boolean).sort();
  if (!dates.length) throw new Error(`SPARQL: kein Konsolidierungsstand für ${stem}`);
  return `${stem}-${dates[dates.length - 1]}`;
}

async function fetchCellar(celex) {
  const r = await fetch(`https://publications.europa.eu/resource/celex/${celex}`, {
    redirect: 'follow',
    headers: {
      'User-Agent': 'Mozilla/5.0',
      Accept: 'application/xhtml+xml',
      'Accept-Language': 'deu',
    },
  });
  if (!r.ok) throw new Error(`CELLAR HTTP ${r.status} für ${celex}`);
  const html = await r.text();
  if (!/Artikel\s+1/.test(html)) throw new Error(`CELLAR-Antwort für ${celex} enthält keinen Richtlinientext (WAF/Metadaten?)`);
  return html;
}

const out = [];
let nErr = 0;
for (const doc of DOCS) {
  // Per-Dokument robust: ein einzelner Ausfall (z. B. Konsolidierung temporär
  // nicht abrufbar) darf NICHT den ganzen EU-Lauf abbrechen – sonst risse ein
  // neu ergänzter Rechtsakt DSGVO & Co. mit runter. Best-effort wie die übrigen
  // Ausbau-Crawler; der Bestand bleibt über data/ + Restore erhalten.
  try {
    const celex = await latestCelex(doc.stem);
    const stand = celex.slice(-8).replace(/(\d{4})(\d{2})(\d{2})/, '$3.$2.$1');
    const html = await fetchCellar(celex);
    const title = pick(/<title[^>]*>([\s\S]*?)<\/title>/i, html) || `${doc.kurz} — konsolidiert ${stand}`;
    const text = stripTags(html);
    // Anzeige-Link = EUR-Lex (für Menschen im Browser erreichbar; Bots werden
    // dort gechallenged – deshalb NIE als Fetch-Quelle verwenden)
    const anzeigeUrl = `https://eur-lex.europa.eu/legal-content/DE/TXT/HTML/?uri=CELEX:${celex}`;
    out.push({
      url: anzeigeUrl, finalUrl: anzeigeUrl, kind: 'content', from: '(eu-recht/cellar)',
      fetchedAt: new Date().toISOString(),
      title: `${doc.kurz} — konsolidierte Fassung ${stand}`, h1: title,
      // Attribution (Beschluss 2011/833/EU Art. 4 / CC BY 4.0): Quelle nennen.
      description: `Amtliche konsolidierte Fassung (DE), Stand ${stand}. Quelle: Amt für Veröffentlichungen der EU (CELLAR); © European Union, https://eur-lex.europa.eu — Weiterverwendung gem. Beschluss 2011/833/EU.`,
      date: stand, text,
    });
    console.log(`OK ${celex} (${stand}): ${text.length} Zeichen — ${doc.kurz}`);
  } catch (e) {
    nErr++;
    console.warn(`ÜBERSPRUNGEN ${doc.stem} (${doc.kurz}): ${e && e.message || e}`);
  }
}

if (!out.length) throw new Error('Kein einziges EU-Dokument abrufbar – EU-Cache NICHT überschrieben.');
fs.writeFileSync(path.join(OUT, 'pages.jsonl'), out.map((e) => JSON.stringify(e)).join('\n') + '\n');
console.log(`FERTIG: ${out.length}/${DOCS.length} EU-Dokumente (${nErr} übersprungen) → ${path.join(OUT, 'pages.jsonl')}`);
