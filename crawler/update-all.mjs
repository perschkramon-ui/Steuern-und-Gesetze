#!/usr/bin/env node
/**
 * Aktualisierungs-Automatik: arbeitet alle Quellen-Änderungen ins Register ein.
 *
 *   node crawler/update-all.mjs               (aus dem Ordner steuerberater-ki)
 *   Optionen: --skip-bmf true | --skip-bmjv true | --skip-gii true
 *             --pdfjs <dir>   (Default: ../node_modules/pdfjs-dist im Repo)
 *
 * Ablauf:
 *   1. GII: kompletter Neuabruf (amtliche XML-Gesamtausgaben sind klein) –
 *      liefert neue/geänderte Gesetze, §§-Normen UND die amtlichen
 *      Standangaben inkl. KOMMENDER Änderungen (mit "mWv"-Wirkungsdatum).
 *   2. BMJV: Sitemap-Delta – nur Seiten mit lastmod NEUER als der letzte
 *      Register-Build werden erneut geholt; neue PDFs werden entdeckt.
 *   3. BMF: Themen-/Listenseiten auffrischen – neue BMF-Schreiben werden dort
 *      entdeckt und geladen; Bestand bleibt gecacht.
 *   4. PDF-Texte extrahieren (nur Neues, resumierbar).
 *   5. Register neu bauen → data/ (register.js/json, corpus.jsonl.gz) inkl.
 *      Änderungs-Changelog (data/changelog.json, "Was ist neu" in der WebApp)
 *      + Offline-Bundle.
 *
 * In der Claude-Cloud NODE_USE_ENV_PROXY=1 setzen; lokal unnötig.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) =>
  a.startsWith('--') ? [a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : 'true'] : null).filter(Boolean));

const PDFJS = args.pdfjs || path.join(ROOT, '..', 'node_modules', 'pdfjs-dist');
const run = (script, ...a) => {
  console.log(`\n=== ${script} ${a.join(' ')} ===`);
  execFileSync(process.execPath, [path.join(ROOT, 'crawler', script), ...a], { stdio: 'inherit', cwd: path.join(ROOT, 'crawler') });
};

// Letzter Build-Zeitpunkt = Delta-Anker für BMJV
let since = '1970-01-01';
try { since = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'register.json'), 'utf8')).meta.built.slice(0, 10); } catch { /* Erstlauf */ }
console.log(`Update-Anker (letzter Build): ${since}`);

// 0. Fehlende Bestands-Caches aus dem committeten data/ rekonstruieren.
//    Frische Container/Clones haben KEINE *-cache/-Ordner (gitignored) – ohne
//    diesen Schritt würde der Build unten alle nicht neu gecrawlten Quellen
//    STILL aus dem Register werfen. Besonders kritisch für die Amtlichen
//    Handbücher (AEAO/EStR/LStR/…): die sind NUR vom lokalen PC crawlbar
//    (Radware, s. docs/claude-memory/kassensystem-handbuch-crawl-auftrag.md) –
//    die Cloud-Routine kennt sie ausschließlich über dieses Restore.
//    (Review-Fund 2026-07-16: hartkodierte 5-Quellen-Liste hätte die
//    Handbuch-Inhalte beim nächsten Wochen-Update wieder gelöscht.)
const HANDBUCH_KUERZEL = ['ao', 'esth', 'lsth', 'ksth', 'gewsth', 'usth', 'erbsth'];
// Quellen-Ausbau (Betreiber 2026-07-16): einmal aufgenommene Quellen bleiben
// über das Restore erhalten, auch wenn ihr Crawl-Cache im Container fehlt.
const AUSBAU_QUELLEN = [
  ['bzst.de', 'bzst'],
  ['verwaltungsvorschriften-im-internet.de', 'vwv'],
  ['bundesfinanzhof.de', 'bfh'],
  ['rechtsprechung-im-internet.de', 'rii'],
  ['eur-lex.europa.eu', 'eu'],
];
const RESTORE = [
  ['bundesfinanzministerium.de', 'bmf-restored-cache'],
  ['bmjv.de', 'bmjv-restored-cache'],
  ...HANDBUCH_KUERZEL.map((k) => [`${k}.bundesfinanzministerium.de`, `${k}-handbuch-restored-cache`]),
  ...AUSBAU_QUELLEN.map(([host, k]) => [host, `${k}-restored-cache`]),
];
for (const [host, dir] of RESTORE) {
  if (!fs.existsSync(path.join(ROOT, dir))) {
    run('restore-cache-from-register.mjs', '--data', '../data', '--host', host, '--out', `../${dir}`);
  }
}

// 1. GII komplett neu (Cache leeren, damit geänderte Gesetze neu geholt werden)
if (args['skip-gii'] !== 'true') {
  fs.rmSync(path.join(ROOT, 'gii-cache'), { recursive: true, force: true });
  run('crawl-gii.mjs', '--out', '../gii-cache', '--delay', '600', '--all-norms', 'true');
}

// 2. BMJV Sitemap-Delta (+ Fehler-Requeue früherer Läufe)
if (args['skip-bmjv'] !== 'true') {
  run('crawl-site.mjs', '--host', 'www.bmjv.de',
    '--sitemap-index', 'https://www.bmjv.de/Sitemap_Index.xml',
    '--follow-html', 'true', '--deny', '/SiteGlobals/|/DE/[Ss]ervice/|/EN/',
    '--maxpdf', '5000', '--since', since, '--out', '../bmjv-cache', '--delay', '2500');
}

// 3. BMF Listen-Refresh (entdeckt neue BMF-Schreiben)
if (args['skip-bmf'] !== 'true') {
  run('crawl-bmf.mjs', '--out', '../bmf-cache', '--delay', '7000', '--ua', 'chrome', '--refresh-steuern', 'true');
}

// 3b. Quellen-Ausbau-Deltas (best-effort: ein Netzfehler bricht die Routine
//     nicht – der Bestand bleibt über den Restore-Schritt erhalten).
//     EU: 4 kleine Abrufe (SPARQL + 3 Dokumente); neuer Konsolidierungsstand
//     erscheint automatisch im Changelog. RII: nur seit dem letzten Build
//     geänderte Entscheidungen (modified-Feld der rii-toc.xml).
try { run('fetch-eu-recht.mjs', '--out', '../eu-cache'); }
catch (e) { console.warn('EU-Refresh übersprungen:', e.message); }
try { run('fetch-rii.mjs', '--out', '../rii-cache', '--refresh-toc', 'true', '--since', since); }
catch (e) { console.warn('RII-Delta übersprungen:', e.message); }

// 4. PDF-Texte (nur Neues – extract-pdf ist resumierbar). ALLE frischen
//    Crawl-Caches mit pdfmeta.jsonl abdecken – die frühere Fest-Liste
//    (bmf/bmjv/bmjv-service) hätte Handbuch- und BZSt-PDFs ohne Volltext ins
//    Register laufen lassen („PDF – Text nicht extrahiert"; Fehlerklasse
//    „stille Deckel", Fund lokale Session 2026-07-16). Restore-Caches sind
//    ausgenommen: sie tragen pdftexts.jsonl bereits fertig, aber keine
//    pdfs/-Dateien zum Extrahieren.
for (const dir of fs.readdirSync(ROOT)) {
  if (!/-cache$/.test(dir) || /-restored-cache$/.test(dir)) continue;
  if (fs.existsSync(path.join(ROOT, dir, 'pdfmeta.jsonl'))) {
    run('extract-pdf.mjs', '--cache', `../${dir}`, '--pdfjs', PDFJS);
  }
}

// 5. Register + Bundle (inkl. Changelog-Diff gegen den vorherigen Stand).
//    Je Handbuch: frischer Crawl-Cache (nur lokal vorhanden) VOR dem
//    Restore-Cache – die URL-Dedupe in build-register bevorzugt den frischen.
const sites = ['bmf=../bmf-cache', 'bmf-alt=../bmf-restored-cache', 'bmjv=../bmjv-cache', 'bmjv-alt=../bmjv-restored-cache', 'bmjv-service=../bmjv-service-cache',
  ...HANDBUCH_KUERZEL.flatMap((k) => [`hb-${k}=../${k}-handbuch-cache`, `hb-${k}-alt=../${k}-handbuch-restored-cache`]),
  ...AUSBAU_QUELLEN.flatMap(([, k]) => [`${k}=../${k}-cache`, `${k}-alt=../${k}-restored-cache`])]
  .filter((p) => fs.existsSync(path.join(ROOT, p.split('=')[1].replace('../', ''))));
run('build-register.mjs', '--gii', '../gii-cache', '--sites', sites.join(','), '--out', '../data');
run('bundle-offline.mjs');

console.log('\nUpdate abgeschlossen. Änderungsübersicht: data/changelog.json');
