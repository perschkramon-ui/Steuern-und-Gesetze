# Auftrag: Quellen-Ausbau Steuerregister – lokale Session

> **Seit 2026-07-16 eigenes Repo `perschkramon-ui/steuern-und-gesetze`** (aus dem
> Kassensystem herausgelöst). Die lokale Session für DIESEN Auftrag startet im
> Klon dieses Repos – NICHT im Kassensystem-Ordner. Alle Pfade sind relativ zum
> Repo-Root; Regeln in CLAUDE.md hier.

**Status: OFFEN** · Angelegt 2026-07-16, erweitert am selben Tag (Betreiber:
„nimm alles auf und bastle das in die Anweisung für die lokale Session").
**Diese Aufgabe gehört der LOKALEN Session** (Hausregel „Ein Fahrer pro
Aufgabe"). Nach Erledigung: Status hier auf ERLEDIGT setzen + SESSION-LOG-Zeile.
Alle Kommandos unten sind **PowerShell** (der PC ist Windows – keine
bash-Syntax verwenden).

Zwei Teile:
- **Teil 1 – Amtliche BMF-Handbücher** (AEAO + alle Richtlinien): NUR am
  lokalen PC möglich (Radware).
- **Teil 2 – Quellen-Ausbau** (BZSt, Bundes-VwV, EU-Recht, BFH): technisch
  auch aus der Cloud machbar, auf Betreiber-Anweisung Teil dieses Auftrags.
  Alle vier wurden am 2026-07-16 empirisch vorgeprüft (robots/TDM, Struktur,
  Umfang – Befunde stehen bei jedem Abschnitt; Werkzeuge sind gebaut und, wo
  aus der Cloud erreichbar, LIVE getestet).

## Warum (Register-Lücke, Klasse „konsolidierte Verwaltungsvorschriften")

Das Steuerregister (dieses Repo) enthält Gesetze (GII, paragrafengenau),
BMF-Schreiben und BMJV-Inhalte – aber **keine konsolidierten
Verwaltungsvorschriften außer dem UStAE**. Es fehlen: **AEAO, EStR, LStR, KStR,
GewStR, ErbStR + amtliche Hinweise** (geprüft 2026-07-16: nur Erwähnungen in
anderen Texten, keine Volltexte). Amtliche Quelle dafür sind die **Amtlichen
Handbücher online** des BMF – 7 Subdomains (Existenz geprüft):

| Subdomain | Inhalt |
|---|---|
| `ao.bundesfinanzministerium.de` | AO + **AEAO** (u. a. zu §§ 146/146a/146b – Kassen-Nachschau!) |
| `esth.bundesfinanzministerium.de` | EStG · EStDV · **EStR** + Hinweise |
| `lsth.bundesfinanzministerium.de` | **LStR** · LStDV + Hinweise |
| `ksth.bundesfinanzministerium.de` | KStG · **KStR** |
| `gewsth.bundesfinanzministerium.de` | GewStG · **GewStR** |
| `usth.bundesfinanzministerium.de` | UStG · UStAE (Redundanz zum PDF ok – Handbuch ist abschnittsgenau verlinkbar) |
| `erbsth.bundesfinanzministerium.de` | ErbStG · **ErbStR** |

**Warum nur lokal:** Diese Subdomains erzwingen die Radware-JS-Challenge auf
JEDEM Abruf (anders als www.bundesfinanzministerium.de). Rohe HTTP-Crawls sind
chancenlos; in der Claude-Cloud-Sandbox ist Chromium-Navigation generell
geblockt (ERR_CONNECTION_RESET, Empirie 2026-07-14) → **nur der lokale PC kann
das** (echter Chromium löst die Challenge wie ein normaler Besucher).
Details/Empirie: `Kassensystem-Repo: docs/claude-memory/kassensystem-rechtsquellen-register.md (historisch)`
(Abschnitt Zugriffs-Fallstricke). Ein konsolidierter AEAO als amtliches PDF
existiert NICHT (nur Änderungs-Schreiben, alte Einzel-URLs 404).

## Werkzeug

`crawler/crawl-handbuch-browser.mjs` – EIN generisches Skript
für alle 7 Handbücher (Muster: `crawl-bmf-browser.mjs`, das den lokalen
BMF-Crawl schon erfolgreich gefahren hat; adversarial reviewt 2026-07-16,
26 Funde gefixt). Eigenschaften:

- Playwright/Chromium, löst die Radware-Challenge (Same-URL- UND
  Redirect-Variante), behält Cookies; nach „kein PDF" wird die Session
  automatisch neu etabliert.
- **robots.txt-Prüfung eingebaut** (Hausregel): Disallow-Regeln (`User-agent: *`
  UND KI-Bot-Gruppen, inkl. `*`/`$`-Wildcards) werden beachtet; ein
  KI-/TDM-Vorbehalt (§ 44b Abs. 3 UrhG, z. B. claudebot mit `Disallow: /`)
  bricht mit Exit 3 ab → dann Quelle NICHT übernehmen, nur verlinken
  (Präzedenz smartsteuer). Komplett-Sperre für alle Crawler → ebenfalls Abbruch.
- Erkennt die **aktuelle Jahres-Ausgabe automatisch** (Weiterleitung oder
  höchstes verlinktes Jahr des EIGENEN Kürzels) und crawlt NUR diese
  (`--prefix /kürzel/jahr/` überschreibbar).
- Höflich gedrosselt (Default 1,8 s + Jitter), resumierbar (`state.json`),
  Fehler-Requeue, synchrone Writes (kein Datenverlust bei Abbruch).
- Ausgabeformat build-register-kompatibel (`pages.jsonl`, `pdfmeta.jsonl`,
  `pdfs/`); **alle Deckel melden sich LAUT** – ein `FERTIG` ohne ⚠️-Warnung und
  mit `queue-rest=0` heißt wirklich vollständig (Fehlerklasse „Stille Deckel",
  CLAUDE.md).

## Voraussetzungen (einmalig)

Werkzeug-Ordner mit Playwright + pdfjs: **erst prüfen, ob vom BMF-Crawl
(15.07.) schon einer existiert** (dort lag `node_modules/playwright`). Falls
nicht:

```powershell
$tools = "$env:USERPROFILE\kassenflow-werkzeuge"
mkdir $tools -Force
npm install playwright pdfjs-dist@4 --prefix $tools
& "$tools\node_modules\.bin\playwright.cmd" install chromium
```

## Durchführung

```powershell
cd <repo-steuern-und-gesetze>\crawler
$pw = "$env:USERPROFILE\kassenflow-werkzeuge\node_modules\playwright"  # ggf. vorhandenen Ordner nutzen

foreach ($hb in 'ao','esth','lsth','ksth','gewsth','usth','erbsth') {
  node crawl-handbuch-browser.mjs --host "$hb.bundesfinanzministerium.de" `
    --out "../$hb-handbuch-cache" --playwright $pw
}
```

Je Handbuch grob 15–60 Min (Drossel). **Nach jedem Lauf die Schlusszeilen
prüfen:** `FERTIG … queue-rest=0` und KEINE ⚠️-Deckel-Warnung → vollständig.
Sonst denselben Befehl erneut ausführen (Resume) bzw. `--max`/`--maxpdf`
erhöhen. `*-cache/` ist gitignored – Caches bleiben lokal.
Falls die Ausgaben-Erkennung nicht greift (Warnung „crawle den GANZEN Host"):
abbrechen und `--prefix /<kürzel>/<jahr>/` explizit setzen (im Browser
nachsehen, z. B. `/ao/2026/`).

## Danach: Register neu bauen – über update-all (der EINE Weg)

**NICHT** build-register von Hand mit einer Teil-Quellenliste aufrufen – dem
PC fehlen die Cloud-Caches (gii/bmf/bmjv), ein Hand-Build würde das Register
STILL ausweiden (Review-Fund 2026-07-16). `update-all.mjs` macht alles selbst:
rekonstruiert fehlende Bestands-Caches aus dem committeten `data/`
(Schritt 0, inkl. Handbuch-Restore), crawlt GII frisch (~1–2 h), holt
BMJV-Delta + BMF-Listen, extrahiert PDFs und baut Register + Shards +
Offline-Bundle mit ALLEN Quellen inkl. der frischen Handbuch-Caches:

```powershell
cd <repo-steuern-und-gesetze>
$env:NODE_OPTIONS = '--max-old-space-size=6144'
node crawler\update-all.mjs --pdfjs "$env:USERPROFILE\kassenflow-werkzeuge\node_modules\pdfjs-dist"
```

**Harte Erfolgskontrolle (Pflicht):** Die Zähler dürfen gegenüber dem
committeten Stand NICHT sinken (Stand vor den Handbüchern: gesetzeIndex 6122 ·
normen 4997 · normenNurKorpus 102538 · korpusChunks 215235; Chunks müssen
deutlich STEIGEN):

```powershell
node -e "console.log(JSON.parse(require('fs').readFileSync('data/register.json','utf8')).meta.counts)"
```

Sinkt ein Wert → NICHT committen, Ursache klären (fehlende Quelle im Build).

## Verifikation (Pflicht vor Commit)

Terminal 1:
```powershell
cd <repo-steuern-und-gesetze>\server
$env:PROVIDER = 'mock'; $env:PORT = '8791'
node server.mjs
```

Terminal 2 – Proben müssen Handbuch-Treffer („Amtliches Handbuch · …") mit
amtlichem Link liefern:
```powershell
$probe = @{ jsonrpc='2.0'; id=1; method='tools/call'; params=@{
  name='register_suchen'; arguments=@{ suchbegriffe='AEAO zu § 146b Kassen-Nachschau'; topK=5 } } } | ConvertTo-Json -Depth 6
Invoke-RestMethod -Uri 'http://127.0.0.1:8791/mcp' -Method Post -ContentType 'application/json; charset=utf-8' -Body $probe | ConvertTo-Json -Depth 8
```

Weitere Proben: „AEAO zu § 146a zertifizierte technische Sicherheitseinrichtung",
„R 4.10 EStR Bewirtung", „LStR Sachbezug Mahlzeiten".
**RAM im Blick:** ~215k Chunks ≈ ~1 GB Heap; +Handbücher grob +30–80k Chunks.
Nach dem Merge auf Railway `steuernundgesetze` Deploy-Log/`/api/health`
prüfen; wird der Heap knapp, `NODE_OPTIONS=--max-old-space-size=4096` als
Railway-Env setzen (Env-Register in `kassensystem-deployment.md` nachführen).

## Teil 2: Quellen-Ausbau (BZSt · Bundes-VwV · EU-Recht · BFH)

Reihenfolge-Empfehlung nach Aufwand: **EU (Minuten) → VwV (~25 Min) →
BZSt (~2,5 h, robots-Drossel) → BFH (nach Betreiber-Entscheid)**. Alle
Quellen sind in `update-all.mjs` bereits als Restore-geschützte Quellen
verdrahtet (AUSBAU_QUELLEN) – einmal in `data/` gemergt, überlebt jede
davon die Wochen-Routine. `build-register.mjs` kennt die Themen bereits.

### 2a. EU-Umsatzsteuerrecht (Skript fertig, LIVE getestet)

Preflight: eur-lex.europa.eu challenged JEDEN Bot-Abruf (AWS-WAF, HTTP 202,
sogar robots.txt). Amtlich identische Inhalte liefert **CELLAR**
(publications.europa.eu, robots: alles erlaubt, kein TDM-Vorbehalt).
`crawler/fetch-eu-recht.mjs` erledigt alles: SPARQL ermittelt den neuesten
Konsolidierungsstand (kein Raten), CELLAR liefert das deutsche XHTML,
Anzeige-Link im Register = EUR-Lex (für Menschen im Browser ok). Aus der
Cloud verifiziert: MwStSystRL 14.04.2025 (480k Zeichen) + MwSt-DVO 282/2011
(14.04.2025) + VerbrauchStSystRL 2020/262 (26.04.2022), Umlaute sauber.

```powershell
cd <repo-steuern-und-gesetze>\crawler
node fetch-eu-recht.mjs --out ../eu-cache
```

### 2b. Bundes-Verwaltungsvorschriften (verwaltungsvorschriften-im-internet.de)

Preflight: robots.txt = `User-agent: * / Disallow:` (leer = ALLES erlaubt,
sogar mit claudebot-UA gegengeprüft), kein TDM-Vorbehalt, kein Bot-Schutz,
statisches juris-Portal (Schwester von gesetze-im-internet). **789 VwV**
über 28 Ressort-Teillisten, Dokumente = `bsvwvbund_*.htm` mit Volltext im
HTML, KEINE PDFs. ⚠️ Kodierung iso-8859-1 – `crawl-site.mjs` dekodiert seit
2026-07-16 charset-korrekt (Fix ist im Repo). Ehrliche Einordnung: AEAO,
BpO, LStR/UStAE sind dort NICHT enthalten (verifiziert per Titel- und
Volltextsuche) – die Quelle ergänzt den allgemeinen Bundesrecht-Korpus,
ersetzt keine BMF-Quelle.

```powershell
node crawl-site.mjs --host www.verwaltungsvorschriften-im-internet.de `
  --seeds https://www.verwaltungsvorschriften-im-internet.de/erlassstellen.html `
  --follow-html true `
  --allow "/(erlassstellen\.html|Teilliste_.*\.html|bsvwvbund_.*\.htm)$" `
  --deny "/cgi-bin/" `
  --delay 1500 --out ../vwv-cache
```

(~820 Abrufe × 1,5 s ≈ 25 Min. FERTIG-Zeile prüfen: queue-rest=0.)

### 2c. BZSt (DSFinV-K + Merkblätter)

Preflight: robots-frei, KEIN TDM-Vorbehalt, aber **`Crawl-delay: 30`
Pflicht** (Sekunden!). Sitemap 326 URLs, davon 75 unter robots-gesperrtem
`/DE/Service/` → Deny-Regex unten MUSS bleiben. GSB-Portal, server-
gerendert, kein Radware. Effektiv ~251 Seiten × 30 s ≈ **2,1 h** (laufen
lassen, resumierbar).

```powershell
node crawl-site.mjs --host www.bzst.de `
  --sitemap-index https://www.bzst.de/Sitemap_Index.xml `
  --follow-html true `
  --deny "/SiteGlobals/|/DE/Service/|/EN/Service/|/SharedDocs/Downloads/Schuetzenswertes/" `
  --delay 30000 --out ../bzst-cache
```

**Danach die DSFinV-K-ZIPs** (die Spezifikation liegt NUR als ZIP vor;
Ablauf aus der Cloud End-zu-End getestet – DSFinV-K 2.4 = 130 Seiten/151k
Zeichen sauber extrahiert, im ZIP steckt auch der 2019er „Einführung und
Anwendungserlass §146a AO", der uns bisher fehlte):

```powershell
cd ..\bzst-cache
curl.exe -sSL -o dsfinvk24.zip "https://www.bzst.de/SharedDocs/Downloads/DE/Aussenpruefung/dsfinv_k_v_2_4.zip?__blob=publicationFile&v=19"
Expand-Archive dsfinvk24.zip -DestinationPath dsfinvk24 -Force
cd ..\crawler
node import-pdf-dir.mjs --dir ../bzst-cache/dsfinvk24 --cache ../bzst-cache `
  --source-url "https://www.bzst.de/SharedDocs/Downloads/DE/Aussenpruefung/dsfinv_k_v_2_4.zip?__blob=publicationFile&v=19"
node extract-pdf.mjs --cache ../bzst-cache --pdfjs "$env:USERPROFILE\kassenflow-werkzeuge\node_modules\pdfjs-dist"
```

### 2d. Rechtsprechung des Bundes — ALLE Bundesgerichte (FREIGEGEBEN)

**Betreiber-Entscheid 2026-07-16:** „alles übernehmen, es geht nicht mehr
nur noch um Steuer sondern alles an Gesetzen." Damit ist der RII-Weg trotz
des robots-Vorbehalts ausdrücklich freigegeben UND der Umfang erweitert:
nicht nur BFH, sondern **alle 83.454 Entscheidungen** der Bundesgerichte
ab 2010 (BGH 34,9k · BFH 11,6k · BVerwG 10,3k · BPatG 7,3k · BAG 7,2k ·
BSG 6,4k · BVerfG 5,7k). Begründung + Grenzen im Skript-Kopf und im
Rechtsquellen-Register dokumentiert (gemeinfreie amtliche Werke § 5 UrhG,
bereitgestellte Bulk-Schnittstelle, keine jportal-HTML-Crawls, moderate
Rate; NICHT auf andere robots-gesperrte Quellen übertragbar). Vor 2010
existiert nichts frei Verfügbares (nur BStBl/kommerziell) = bewusste,
dokumentierte Registerlücke.

Werkzeug **`crawler/fetch-rii.mjs`** (fertig, aus der Cloud live getestet:
25 gemischte + 2 BFH-Entscheidungen, 0 Fehler): lädt `rii-toc.xml`, holt je
Entscheidung das juris-XML-ZIP (zero-dep-Unzip), baut strukturierten Text
(Normen/Leitsatz/Tenor/Tatbestand/Gründe). Anzeige-Links: BFH → amtliche
bundesfinanzhof.de-Detailseite, übrige → stabiler jlink. Resumierbar
(doknr-Dedupe), `--since` für Deltas, `--gericht BFH,BVerfG` zum Filtern.

```powershell
node fetch-rii.mjs --out ../rii-cache
```

Erwartung: **~15–20 h** (83k Abrufe × ~0,7 s + Drossel; resumierbar –
einfach erneut starten), Cache ~0,5–1 GB. Die Register-Integration ist
fertig verdrahtet: Urteile werden KEINE register.js-Einträge (WebApp
bliebe sonst unbenutzbar), sondern Karteikarten im Lazy-Blob (WebApp-Chip
„⚖️ Urteile") + Volltext im KI-Korpus; das Restore rekonstruiert sie aus
den Korpus-Chunks (Round-Trip getestet). Die Wochen-Routine zieht künftige
Entscheidungen selbst nach (update-all Schritt 3b, `--since`-Delta).

⚠️ **Größen-Folgen (vor dem Commit bewusst machen):**
- Korpus wächst um grob **165–350k Chunks** → `data/`-Shards +150–350 MB
  → das Repo wird spürbar schwerer (jeder Cloud-Session-Clone lädt das mit).
- Railway `steuernundgesetze`: Heap steigt (Scope `alles`) auf grob
  2–3,5 GB → `NODE_OPTIONS=--max-old-space-size=6144` als Service-Env
  setzen und nach dem Deploy `/api/health` (chunks) + RAM-Graph prüfen;
  Notbremse: `KI_CORPUS_SCOPE=steuern` lässt die Nicht-BFH-Rechtsprechung
  weg (Filter ist verdrahtet).

### Teil-2-Abschluss

Register-Neubau wie in Teil 1 über `update-all.mjs` (nimmt eu-/vwv-/
bzst-cache automatisch mit, sobald die Ordner existieren). Verifikations-
Proben zusätzlich: „DSFinV-K GV_TYP Geschäftsvorfalltypen" (BZSt),
„VV-ZBR BHO" (VwV), „MwStSystRL Artikel 132 Steuerbefreiung" (EU).
README-Quellentabelle um die neuen Quellen ergänzen (mit robots-Verdikt
und Datum), Rechtsquellen-Register-Empirie ist bereits nachgetragen.

## Zusätzlich: lokalen Projekt-Ordner anlegen (Betreiber-Wunsch, noch NIE passiert)

Dieses Repo ist in sich geschlossen (Design vom
2026-07-14: „zum Kopieren nach `Dokumente\Projekte\Steuerberater KI`") – der
Kopier-Schritt auf den PC wurde aber nie ausgeführt (Cloud kann das nicht).
Nach dem Handbuch-Crawl + Register-Neubau bitte anlegen/aktualisieren
(Quelle = frisch gebauter Repo-Stand, Caches/Abhängigkeiten ausgenommen):

```powershell
$ziel = "$env:USERPROFILE\Dokumente\Projekte\Steuerberater KI"
foreach ($d in 'webapp','data','server','crawler') {
  robocopy "<repo-steuern-und-gesetze>\$d" "$ziel\$d" /MIR /XD node_modules
}
Copy-Item "<repo-steuern-und-gesetze>\README.md" $ziel -Force
```

(Bewusst nur die vier Nutz-Ordner + README – so bleiben sämtliche
`*-cache/`-Ordner automatisch draußen, egal wie viele Quellen dazukommen.)

Damit hat der Betreiber lokal: `webapp/index.html` (Offline-Suche, file://),
`data/SteuerberaterKI-offline.html` (Ein-Datei-Version), `server/` (lokaler
KI-Dienst) und die Crawler. Bei künftigen Register-Updates den robocopy
einfach wiederholen (`/MIR` spiegelt).

## Abschluss

1. FRISCHER Branch von origin/main (NIE auf gemergte Branches committen),
   committen: `data/`-Artefakte + diese MD (Status ERLEDIGT + Bilanz-Zeile je
   Handbuch: Seiten/PDFs/Chunks).
2. Draft-PR, CI des Head-Commits GRÜN abwarten, Betreiber merged.
3. SESSION-LOG-Zeile (Datum · local · was · PR).
4. `kassensystem-rechtsquellen-register.md`: den Handbuch-Eintrag unter
   Zugriffs-Fallstricke um „Volltexte seit <Datum> im Register (lokaler
   Handbuch-Crawl)" ergänzen; Q4-Zeile (AEAO zu §146a) auf die neue Quelle
   verweisen.
5. **Wochen-Routine:** nichts zu tun – `update-all.mjs` rekonstruiert die
   Handbuch-Caches ab dann selbst aus `data/` (Schritt 0) und nimmt sie in
   jeden Build. Ohne diesen Mechanismus hätte der nächste Routine-Lauf die
   Handbuch-Inhalte wieder gelöscht (Review-Fund 2026-07-16).
