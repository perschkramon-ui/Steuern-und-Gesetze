#!/usr/bin/env node
/**
 * Landesrecht als Registereinträge: holt die GELTENDEN Fassungen der für eine
 * deutsche Kassen-/Gastro-SaaS einschlägigen Landesnormen (Ladenöffnung,
 * Gaststättenrecht, Nichtraucherschutz). Ergänzt das Bundesrecht: Ladenschluss-
 * und Gaststättenrecht sind seit der Föderalismusreform Landesrecht und damit
 * über gesetze-im-internet.de NICHT erreichbar.
 *
 * ABDECKUNG (Stand 2026-07-28): Bayern, Nordrhein-Westfalen, Sachsen,
 * Brandenburg.
 * Alle 16 Landesportale wurden einzeln auf robots.txt geprüft – die Grenze ist
 * NICHT technischer Aufwand:
 *
 *   GESPERRT (10) – juris-Plattform, alle mit identischer robots.txt
 *   (Whitelist für Googlebot/Bingbot/Applebot/CCBot & Co., danach
 *   „User-agent: * / Disallow: /"): landesrecht-bw.de, gesetze.berlin.de,
 *   landesrecht-hamburg.de, rv.hessenrecht.hessen.de, landesrecht-mv.de,
 *   landesrecht.rlp.de, recht.saarland.de, landesrecht.sachsen-anhalt.de,
 *   gesetze-rechtsprechung.sh.juris.de, landesrecht.thueringen.de.
 *
 *   ERLAUBT, aber OHNE stabile Direkt-URLs (2) – hier fehlt nicht die
 *   Erlaubnis, sondern ein verlässlicher Anker; Discovery ginge nur über
 *   Session-/JS-Handling, das ein schlanker Crawler nicht tragen sollte:
 *     nds-voris.de – kein robots.txt (= erlaubt), aber keine Sitemap;
 *       /search und /browse laufen ins 404 (clientseitige Wolters-Kluwer-App).
 *     transparenz.bremen.de – leeres robots.txt (= erlaubt), Vorschriften nur
 *       über sixcms-Suchparameter erreichbar, Übersichtsseite ohne gsid-Links.
 *   Für diese zwei und die gesperrten zehn bleibt der Ausweichweg über die
 *   Gesetz- und Verordnungsblätter (PDF auf landeseigenen Servern) oder
 *   Link-only-Einträge – bewusst als eigener Schritt, nicht hier.
 *
 * Vor jeder Erweiterung die robots.txt des Ziel-Portals einzeln prüfen.
 *
 * DREI ZUGRIFFSMUSTER, alle 2026-07-28 live verprobt:
 *   Bayern  gesetze-bayern.de – robots.txt „Allow: /", KEINE Sitemap.
 *           Stabile Dokument-URL /Content/Document/<Kürzel>. Die Seite trägt
 *           immer die geltende Fassung, das Kürzel ändert sich bei Novellen
 *           nicht → Kürzel kuratieren, Crawler verifiziert je Lauf.
 *   NRW     recht.nrw.de – robots.txt erlaubt (nur /admin/, /user/login … aus).
 *           Die Sitemap enthält auch HISTORISCHE Fassungen (LÖG NRW steht dort
 *           dreimal: 2006, 2013, 2018) → Datums-Slugs sind als Anker UNTAUGLICH.
 *           Jede Fassungsseite verlinkt aber „Link zur aktuellsten Fassung" auf
 *           /taxonomy/term/<id>; diese ID ist novellenfest und liefert per
 *           Meta-Refresh die jeweils geltende Fassung → ID kuratieren, Crawler
 *           löst je Lauf auf.
 *   Sachsen revosax.sachsen.de – robots.txt vollständig auskommentiert (also
 *           erlaubt) + Sitemap mit 6315 URLs. Stabile Vorschriften-URL
 *           /vorschrift/<id>-<Name>; die Seite trägt die rechtsbereinigte
 *           Fassung („Rechtsbereinigt mit Stand vom …"). Achtung: revosax
 *           liefert KEIN <title>-Element – der Name steht nur im <h1>.
 *
 *   BB      bravors.brandenburg.de – robots erlaubt, aber mit „Crawl-delay: 20"
 *           (wird eingehalten, s. delayMs). Stabile URL /gesetze/<kürzel>,
 *           Kürzel kleingeschrieben ohne Umlaute (bbgloeg, bbggastg,
 *           bbgnirschg). ACHTUNG: das Portal antwortet auf JEDE geratene URL
 *           mit HTTP 200 – ein „404" kommt als 37-Byte-Stub. Der Status ist
 *           dort wertlos, geprüft wird über Titel und Textlänge.
 *
 * Schreibt <root>/lr-by-cache, lr-nw-cache, lr-sn-cache, lr-bb-cache.
 *
 * Rechtlich: Landesgesetze und -verordnungen sind amtliche Werke (§ 5 UrhG),
 * gemeinfrei. Als Anzeige-Link kommt die amtliche Portal-URL ins Register.
 *
 * Aufruf:  node fetch-landesrecht.mjs [--root ..] [--delay 1500]
 * Schreibt je Quelle <root>/<key>-cache/pages.jsonl (lr-by, lr-nw), passend zu
 * AUSBAU_QUELLEN in update-all.mjs.
 * Idempotent: schreibt die pages.jsonl je Quelle komplett neu.
 */

import fs from 'node:fs';
import path from 'node:path';
import { stripTags, pick } from './bmf-lib.mjs';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) =>
  a.startsWith('--') ? [a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : 'true'] : null).filter(Boolean));
const ROOT = path.resolve(args.root || '..');
const DELAY = Number(args.delay || 1500);
const UA = 'SteuerRegister-Crawler/1.0 (privates Quellenregister; Kontakt: perschkramon@gmail.com)';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// gesetze-bayern.de ist ASP.NET WebForms: die GANZE Seite liegt in einem
// einzigen <form> (gemessen 2026-07-28: Position 773–53716 von 54568 Zeichen).
// bmf-lib.stripTags wirft <form>…</form> samt Inhalt weg – für die BMF-Seiten
// richtig, hier bleiben davon 134 statt 24440 Zeichen übrig. Deshalb vorher nur
// die form-TAGS neutralisieren, nicht deren Inhalt. bmf-lib bleibt unverändert,
// damit die BMF-Crawler ihr Verhalten behalten.
const zuText = (html) => stripTags(html.replace(/<\/?form[^>]*>/gi, ' '));

// Kuratierte Liste. Je Eintrag: quelle (by|nw), id (Bayern: Dokument-Kürzel,
// NRW: taxonomy-Term-ID der aktuellsten Fassung), kurz = Anzeigename.
// Alle Einträge am 2026-07-28 live gegen das jeweilige Portal verprobt.
const DOCS = [
  // --- Bayern (Kürzel stabil über Novellen hinweg) ---
  // pruef = Abkürzung, wie sie der Seitentitel führt. Weicht vom URL-Kürzel ab
  // (BayGSG wird als „GSG" geführt) – deshalb eigenes Feld statt Ableitung.
  { quelle: 'by', id: 'BayLadSchlG', pruef: 'BayLadSchlG', kurz: 'Bayerisches Ladenschlussgesetz (BayLadSchlG)' },
  { quelle: 'by', id: 'BayGastV', pruef: 'BayGastV', kurz: 'Bayerische Gaststättenverordnung (BayGastV)' },
  { quelle: 'by', id: 'BayGSG', pruef: 'GSG', kurz: 'Gesundheitsschutzgesetz Bayern – Nichtraucherschutz (GSG)' },
  // --- Nordrhein-Westfalen (taxonomy-ID = novellenfester Anker) ---
  { quelle: 'nw', id: '29216', kurz: 'Ladenöffnungsgesetz NRW (LÖG NRW)' },
  { quelle: 'nw', id: '26759', kurz: 'Gaststättenverordnung NRW (GastV NRW)' },
  { quelle: 'nw', id: '29454', kurz: 'Nichtraucherschutzgesetz NRW (NiSchG NRW)' },
  // --- Sachsen (Vorschriften-ID; Seite trägt die rechtsbereinigte Fassung) ---
  { quelle: 'sn', id: '11548-Saechsisches-Ladenoeffnungsgesetz', pruef: 'Ladenöffnungsgesetz', kurz: 'Sächsisches Ladenöffnungsgesetz (SächsLadÖffG)' },
  { quelle: 'sn', id: '12033-Saechsisches-Gaststaettengesetz', pruef: 'Gaststättengesetz', kurz: 'Sächsisches Gaststättengesetz (SächsGastG)' },
  { quelle: 'sn', id: '9706-Saechsisches-Nichtraucherschutzgesetz', pruef: 'Nichtraucherschutzgesetz', kurz: 'Sächsisches Nichtraucherschutzgesetz (SächsNSG)' },
  // --- Brandenburg (Kürzel kleingeschrieben ohne Umlaute im Pfad) ---
  { quelle: 'bb', id: 'bbgloeg', pruef: 'Ladenöffnungsgesetz', kurz: 'Brandenburgisches Ladenöffnungsgesetz (BbgLöG)' },
  { quelle: 'bb', id: 'bbggastg', pruef: 'Gaststättengesetz', kurz: 'Brandenburgisches Gaststättengesetz (BbgGastG)' },
  { quelle: 'bb', id: 'bbgnirschg', pruef: 'Passivrauchen', kurz: 'Brandenburgisches Nichtraucherschutzgesetz (BbgNiRSchG)' },
];

const QUELLEN = {
  by: { key: 'lr-by', host: 'gesetze-bayern.de', land: 'Bayern' },
  nw: { key: 'lr-nw', host: 'recht.nrw.de', land: 'Nordrhein-Westfalen' },
  sn: { key: 'lr-sn', host: 'revosax.sachsen.de', land: 'Sachsen' },
  // Brandenburg schreibt in seiner robots.txt „Crawl-delay: 20" – die halten
  // wir ein (delayMs), auch wenn es den Lauf um gut eine Minute verlängert.
  bb: { key: 'lr-bb', host: 'bravors.brandenburg.de', land: 'Brandenburg', delayMs: 20000 },
};

async function get(url) {
  const ctl = new AbortController();
  let t = setTimeout(() => ctl.abort(), 60000);
  // Stillstands-Timeout statt Gesamtdauer (Fehlerklasse „stiller Deckel",
  // s. crawl-gii.mjs): der Timer wird je empfangenem Datenblock neu gestellt,
  // sonst kippen große Dokumente reproduzierbar in den Abbruch.
  const bump = () => { clearTimeout(t); t = setTimeout(() => ctl.abort(), 60000); };
  try {
    const r = await fetch(url, {
      redirect: 'follow',
      headers: { 'User-Agent': UA, 'Accept-Language': 'de' },
      signal: ctl.signal,
    });
    if (!r.ok) throw new Error(`HTTP ${r.status} für ${url}`);
    const chunks = [];
    for await (const c of r.body) { chunks.push(Buffer.from(c)); bump(); }
    return { html: Buffer.concat(chunks).toString('utf8'), finalUrl: r.url || url };
  } finally { clearTimeout(t); }
}

// NRW: /taxonomy/term/<id> antwortet mit einer Meta-Refresh-Seite auf die
// aktuell geltende Fassung. Wir folgen ihr bewusst selbst, statt die
// Datums-URL zu raten – so zeigt derselbe Eintrag nach einer Novelle
// automatisch auf die neue Fassung.
function metaRefreshTarget(html) {
  return pick(/<meta\s+http-equiv="refresh"\s+content="[^"]*?url=([^"]+)"/i, html);
}

async function fetchBy(doc) {
  // WICHTIG: /Content/Document/<Kürzel> ist nur das INHALTSVERZEICHNIS (~20 kB,
  // ohne Normtext, die Artikel liegen einzeln unter <Kürzel>-<n>). Die
  // Gesamtansicht mit allen Artikeln liefert der Suffix „/true" – ein Abruf
  // statt einem je Artikel.
  const url = `https://www.gesetze-bayern.de/Content/Document/${doc.id}/true`;
  const { html, finalUrl } = await get(url);
  const title = pick(/<title[^>]*>([\s\S]*?)<\/title>/i, html);
  // Gegenprobe: ein unbekanntes Kürzel liefert HTTP 404 (geprüft), ein
  // umbenanntes könnte aber still eine andere Norm zurückgeben.
  if (!new RegExp(`\\b${doc.pruef.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(title)) {
    throw new Error(`Titel nennt "${doc.pruef}" nicht – Kürzel geändert? (${title.slice(0, 90)})`);
  }
  return {
    url: finalUrl, title,
    stand: pick(/Vom\s+(\d{1,2}\.\s*\w+\s+\d{4})/i, title),
    text: zuText(html),
  };
}

async function fetchNw(doc) {
  const term = `https://recht.nrw.de/taxonomy/term/${doc.id}`;
  const stub = await get(term);
  const target = metaRefreshTarget(stub.html);
  if (!target) throw new Error(`keine Meta-Refresh-Weiterleitung unter ${term} – Portalstruktur geändert?`);
  await sleep(DELAY);
  const { html, finalUrl } = await get(target.endsWith('/') ? target : `${target}/`);
  const title = pick(/<title[^>]*>([\s\S]*?)<\/title>/i, html);
  return {
    url: finalUrl, title,
    // NRW stellt der Titelzeile das Datum der geltenden Fassung voran.
    stand: pick(/^\s*(\d{2}\.\d{2}\.\d{4})/, title),
    text: zuText(html),
  };
}

async function fetchSn(doc) {
  const url = `https://www.revosax.sachsen.de/vorschrift/${doc.id}`;
  const { html, finalUrl } = await get(url);
  // revosax liefert KEIN <title>-Element – der Name steht nur im <h1>.
  const title = pick(/<h1[^>]*>([\s\S]*?)<\/h1>/i, html);
  if (!new RegExp(doc.pruef.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(title)) {
    throw new Error(`h1 nennt "${doc.pruef}" nicht – ID zeigt auf etwas anderes? (${title.slice(0, 90)})`);
  }
  return {
    url: finalUrl, title,
    // „Rechtsbereinigt mit Stand vom …" = amtlicher Konsolidierungsstand.
    stand: pick(/Rechtsbereinigt mit Stand vom\s+([^<]{3,40})/i, html) ||
      pick(/Fassung gültig ab:\s*([^<]{3,40})/i, html),
    text: zuText(html),
  };
}

async function fetchBb(doc) {
  // BRAVORS liefert auf JEDE geratene URL HTTP 200 – ein 404 kommt als
  // 37-Byte-Stub, nicht als Fehlerstatus (gemessen 2026-07-28: /gesetze/
  // quatschunsinn123 → 200). Der Status ist hier also WERTLOS; die Prüfung
  // läuft ausschließlich über Titel und Textlänge.
  const url = `https://bravors.brandenburg.de/gesetze/${doc.id}`;
  const { html, finalUrl } = await get(url);
  const title = pick(/<title[^>]*>([\s\S]*?)<\/title>/i, html);
  if (!new RegExp(doc.pruef.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(title)) {
    throw new Error(`Titel nennt "${doc.pruef}" nicht – Kürzel geändert oder Stub? (${title.slice(0, 90)})`);
  }
  return {
    url: finalUrl, title,
    // BRAVORS nennt zuerst das Ausfertigungsdatum, danach „zuletzt geändert".
    stand: pick(/zuletzt geändert[\s\S]{0,200}?vom\s+(\d{1,2}\.\s*\w+\s+\d{4})/i, html) ||
      pick(/vom\s+(\d{1,2}\.\s*\w+\s+\d{4})/i, html),
    text: zuText(html),
  };
}

const HOLER = { by: fetchBy, nw: fetchNw, sn: fetchSn, bb: fetchBb };

const out = {};
let nErr = 0;
for (const doc of DOCS) {
  // Per-Dokument robust wie in fetch-eu-recht.mjs: ein einzelner Ausfall darf
  // die übrigen Länder nicht mitreißen; der Bestand bleibt über data/ + Restore.
  try {
    // Quellenspezifische Wartezeit: Brandenburg fordert in seiner robots.txt
    // „Crawl-delay: 20" – das halten wir ein, statt pauschal DELAY zu nehmen.
    await sleep(QUELLEN[doc.quelle].delayMs || DELAY);
    const r = await HOLER[doc.quelle](doc);
    if (r.text.length < 2000) throw new Error(`nur ${r.text.length} Zeichen Text – Fehlerseite statt Norm?`);
    const q = QUELLEN[doc.quelle];
    (out[doc.quelle] = out[doc.quelle] || []).push({
      url: r.url, finalUrl: r.url, kind: 'content', from: `(landesrecht/${q.key})`,
      fetchedAt: new Date().toISOString(),
      // build-register bevorzugt h1 VOR title (build-register.mjs:286) – der
      // kuratierte Name muss deshalb auch ins h1. Der rohe Portaltitel wäre
      // als Anzeige unbrauchbar („… - Bürgerservice", „30.03.2018 … |
      // RECHT.NRW.DE") und würde die Norm unter ihrem geläufigen Namen nicht
      // auffindbar machen; er bleibt zur Nachvollziehbarkeit in description.
      title: `${doc.kurz}${r.stand ? ` — Fassung ${r.stand}` : ''}`,
      h1: `${doc.kurz}${r.stand ? ` — Fassung ${r.stand}` : ''}`,
      description: `Amtliche geltende Fassung (${q.land}). Landesrecht — über ` +
        `gesetze-im-internet.de nicht erreichbar. Amtlicher Titel: ${r.title}. ` +
        `Quelle: ${q.host}. Amtliches Werk, § 5 UrhG.`,
      date: r.stand, text: r.text,
    });
    console.log(`OK ${q.land} ${doc.id}: ${r.text.length} Zeichen — ${doc.kurz}${r.stand ? ` (${r.stand})` : ''}`);
  } catch (e) {
    nErr++;
    console.warn(`ÜBERSPRUNGEN ${doc.quelle}/${doc.id} (${doc.kurz}): ${e && e.message || e}`);
  }
}

// Je Quelle nur schreiben, wenn dort etwas ankam – sonst bliebe eine leere
// pages.jsonl stehen und build-register würde den Bestand still ausdünnen.
let geschrieben = 0;
for (const [quelle, eintraege] of Object.entries(out)) {
  const dir = path.join(ROOT, `${QUELLEN[quelle].key}-cache`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'pages.jsonl'), eintraege.map((e) => JSON.stringify(e)).join('\n') + '\n');
  console.log(`  → ${eintraege.length} Einträge in ${path.join(dir, 'pages.jsonl')}`);
  geschrieben += eintraege.length;
}
if (!geschrieben) throw new Error('Kein einziges Landesrecht-Dokument abrufbar – Caches NICHT überschrieben.');
console.log(`FERTIG: ${geschrieben}/${DOCS.length} Landesnormen (${nErr} übersprungen)`);
