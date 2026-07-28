# AUFTRAG (lokale Session): EU-Recht live ins Register bringen

**Für eine frische LOKALE Claude-Session am PC des Betreibers.** Diese Datei ist
das vollständige Briefing — du brauchst keinen weiteren Kontext. Lies zusätzlich
`CLAUDE.md` (Regeln) und die letzten Zeilen `docs/SESSION-LOG.md`.

## Warum lokal (nicht Cloud)

Das EU-Recht (13 Rechtsakte: DSGVO, AI Act, PSD2, DSA/DMA, Verbraucher-/Preis-/
UGP-Recht, GPSR, ePrivacy, MwStSystRL …) ist **crawlerseitig bereits fertig** in
`main` (`crawler/fetch-eu-recht.mjs`, PR #7). Es fehlt nur der **Register-Rebuild**,
damit die Daten live gehen. Der Rebuild macht einen **vollen GII-Neu-Crawl**
(~6.500 Normen) plus Restore aller Großquellen aus dem 918k-Chunk-Register — das
**überschreitet in der Cloud das Session-Zeitlimit** (zwei Läufe am 27.07. sind
nach 3–5 h ohne Ergebnis geblieben). Der lokale PC hat **kein Session-Limit** →
hier läuft er sauber durch. Der Betreiber hat diesen Weg gewählt.

## Vorbedingungen (einmal prüfen)

```bash
node -v            # Node 22+ (node:sqlite/FTS5 wird beim Server-Boot gebraucht)
git remote -v      # origin = perschkramon-ui/Steuern-und-Gesetze
```
- Abhängigkeiten vorhanden? Sonst `npm ci` (oder `npm install`).
- `node_modules/pdfjs-dist` muss existieren (für die PDF-Textextraktion).
- Netzzugang zu `gesetze-im-internet.de` (GII) und `publications.europa.eu`
  (CELLAR/EUR-Lex) nötig. **Lokal KEIN Proxy** — `NODE_USE_ENV_PROXY` NICHT setzen
  (das ist nur die Cloud-Krücke).

## Ablauf

### 1. Auf aktuellen `main` (enthält EU-Crawler + POS-Doku)
```bash
git checkout main && git fetch origin && git pull --ff-only origin main
```

### 2. Referenz-Zähler VORHER festhalten (Baseline für den Gate)
```bash
node -e "console.log(require('./data/register.json').meta.counts)"
```
Erwartete Baseline (Stand 2026-07-18, `korpusChunks 917943`):
`gesetzeIndex 6123 · normen 4997 · normenNurKorpus 102583 · seiten 8908 ·
pdfs 7424 · urteile 83497 · kommend 220 · korpusChunks 917943`.
EU-Chunks (Quelle `eur-lex.europa.eu`) bisher **~270** — die müssen steigen.

### 3. Rebuild starten (der lange Teil, ~1,5–2 h GII-Crawl)
```bash
NODE_OPTIONS=--max-old-space-size=6144 node crawler/update-all.mjs --skip-bmf true --skip-bmjv true
```
- **Regel 5 (nicht verhandelbar):** Rebuild NUR über `update-all.mjs`. Kein
  händischer Teil-`build-register` — der würde nicht neu gecrawlte Quellen still
  aus dem Register werfen.
- `--skip-bmf --skip-bmjv` = BMF/BMJV kommen aus dem Restore (unverändert) statt
  aus einem frischen Crawl → spart die langsamste Phase. Für „nur EU dazu" reicht
  das. **GII wird trotzdem voll neu gecrawlt** (kein Restore-Pfad dafür) — das ist
  gewollt und der Grund für die Laufzeit.
- Willst du zusätzlich BMF/BMJV-Deltas mitnehmen: beide `--skip`-Flags weglassen
  (dauert länger, lokal egal).
- Fehlt pdfjs: `--pdfjs ./node_modules/pdfjs-dist` anhängen.
- Auf `FERTIG` / `Register gebaut` warten. Log ggf. mit `| tee /tmp/update-all.log`
  mitschreiben.

### 4. ZÄHLER-GATE prüfen (VOR dem Push — kein Wert darf sinken)
```bash
node -e "const c=require('./data/register.json').meta.counts; const ref={gesetzeIndex:6123,normen:4997,normenNurKorpus:102583,seiten:8908,pdfs:7424,urteile:83497,kommend:220,korpusChunks:917943}; let ok=true; for(const k in ref){const good=c[k]>=ref[k]; if(!good)ok=false; console.log((good?'OK ':'!! ')+k+': '+c[k]+' (ref '+ref[k]+')');} console.log(ok?'>>> GATE GRÜN':'>>> GATE ROT - NICHT pushen');"
```
- **GATE ROT / irgendein `!!`** → NICHT pushen. Ursache diagnostizieren
  (meist: eine Quelle wurde nicht restauriert/gecrawlt → fehlt im Build). Dem
  Betreiber die Ausgabe + Diagnose melden. `changelog.json` „entfallen“ prüfen
  (sollte ≈ 0 sein).
- Zusätzlich EU-Wachstum grob prüfen (muss > ~270 sein):
```bash
zcat data/corpus*.jsonl.gz 2>/dev/null | grep -c 'eur-lex.europa.eu' || echo '(corpus gesharded/anders benannt - grob egal, Hauptsache Changelog zeigt die 13 EU-Rechtsakte als neu)'
```

### 5. Committen + pushen (nur bei GATE GRÜN)
```bash
git checkout -B claude/eu-recht-ingest
git add -A data/
```
Eine Zeile oben in `docs/SESSION-LOG.md` ergänzen (Muster):
`- 2026-07-28 · local · EU-Recht live via update-all --skip-bmf --skip-bmjv: 13 Rechtsakte (DSGVO/AI Act/PSD2/…) ins Register, EU-Chunks ~270→<NEU>, alle Zähler ≥ Referenz (korpusChunks 917943→<NEU>). · PR #<n>`
```bash
git add docs/SESSION-LOG.md
git commit -m "EU-Recht live: DSGVO & Co. (13 Rechtsakte) ins Register ingestiert"
git push -u origin claude/eu-recht-ingest
```

### 6. Danach — zwei Wege, beide ok
- **Automatisch:** Die Cloud-Session hat einen Backstop armiert, der den Branch
  erkennt, den Gate nochmal am Branch prüft, den PR öffnet + **squash-merged**
  (der Betreiber hat „Feuer frei" gegeben), auf den Railway-Deploy wartet und
  **live** verifiziert (DSGVO/AI Act/PSD2 auffindbar, §146a AO/§615 BGB
  unversehrt). Du musst dann nichts weiter tun.
- **Oder selbst:** PR erstellen (Titel „EU-Recht live: DSGVO & Co. (13 Rechtsakte)
  ins Register ingestiert“, Body mit `meta.counts` vorher→nachher). Merge nur mit
  ausdrücklichem „mergen" bzw. dem bereits erteilten „Feuer frei". Nach dem
  Railway-Deploy live gegenprüfen.

## Merksätze
- **Kein Merge, wenn ein Zähler sinkt.** Der Gate ist die Korrektheits-Garantie
  („hauptsache am Ende ist alles korrekt drinnen").
- **Secrets** (z. B. Railway-Token) niemals committen/loggen.
- **Session-Ende:** SESSION-LOG-Zeile + Push (Regel 6, Multi-Umgebung).
