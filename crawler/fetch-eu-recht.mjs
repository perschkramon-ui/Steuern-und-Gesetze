#!/usr/bin/env node
/**
 * EU-Umsatzsteuerrecht als Registereinträge: holt die KONSOLIDIERTEN
 * deutschen Fassungen von
 *   (a) MwStSystRL 2006/112/EG            (CELEX-Stamm 02006L0112)
 *   (b) MwSt-DVO (EU) 282/2011            (CELEX-Stamm 02011R0282)
 *   (c) Verbrauchsteuer-SystRL (EU) 2020/262 (CELEX-Stamm 02020L0262)
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

const DOCS = [
  { stem: '02006L0112', kurz: 'MwStSystRL 2006/112/EG' },
  { stem: '02011R0282', kurz: 'MwSt-Durchführungsverordnung (EU) 282/2011' },
  { stem: '02020L0262', kurz: 'Verbrauchsteuer-Systemrichtlinie (EU) 2020/262' },
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
for (const doc of DOCS) {
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
    description: `Amtliche konsolidierte Fassung (DE), Stand ${stand}, Quelle: Amt für Veröffentlichungen der EU (CELLAR)`,
    date: stand, text,
  });
  console.log(`OK ${celex} (${stand}): ${text.length} Zeichen — ${doc.kurz}`);
}

fs.writeFileSync(path.join(OUT, 'pages.jsonl'), out.map((e) => JSON.stringify(e)).join('\n') + '\n');
console.log(`FERTIG: ${out.length} EU-Dokumente → ${path.join(OUT, 'pages.jsonl')}`);
