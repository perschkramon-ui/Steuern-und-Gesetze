# Steuerberater KI – Steuerrecht-Register mit KI-Abfrage

Eigenständiges Werkzeug (unabhängig vom Kassensystem): ein durchsuchbares
Register amtlicher Steuerrechts-Quellen plus eine KI-Abfrage, die **jede
Antwort mit klickbaren Quellen-Links belegt**.

> Eigenes Repo seit 2026-07-16 (zuvor Ordner `steuerberater-ki/` im
> Kassensystem-Repo). In sich geschlossen, braucht nur Node.js – keine
> npm-Installation; kann 1:1 kopiert werden (z. B. `Dokumente\Projekte\Steuerberater KI`).

## Sofort loslegen

**Nur suchen (offline, ohne Server):**
`webapp/index.html` doppelklicken. Die Suche findet Gesetze, §§-Normen,
BMF-Seiten und BMF-Schreiben und verlinkt direkt auf die Originalquelle.

**KI-Fragen (lokaler Server):**
1. Einmalig `server/.env.local` anlegen (liegt NIE im Repo):
   ```
   PROVIDER=gemini
   GEMINI_API_KEY=dein-schluessel
   ```
2. Starten (im Repo-Root):
   ```
   node server/server.mjs
   ```
3. Browser: <http://localhost:8787> – dort funktionieren Suche **und** KI-Frage.

## Warum die Antworten belegt sind (Genauigkeits-Architektur)

Kein Sprachmodell garantiert von sich aus 100 % – die Garantie kommt hier aus
der Konstruktion:

1. **Retrieval ist Code, keine KI:** Eine BM25-Suche wählt die Fundstellen aus
   dem Register aus. Das Modell bekommt NUR diese Auszüge.
2. **Strikte Quellenbindung:** Das Modell darf ausschließlich aus den Auszügen
   formulieren und mit `[n]` zitieren – eigenes Wissen ist per Prompt verboten.
3. **Links kommen vom Server, nie vom Modell:** Die Quellen-Links unter jeder
   Antwort stammen aus dem Register. Jede URL, die das Modell selbst in den
   Text schreibt, wird gegen das Register geprüft und sonst entfernt.
4. **Fail-closed:** Findet das Retrieval nichts Brauchbares, wird das Modell
   gar nicht erst gefragt – die Antwort lautet dann ehrlich
   „keine Quelle im Register".

Der Provider ist austauschbar (`PROVIDER=gemini|claude|mock` in
`server/.env.local` bzw. als Env-Variablen) – für Claude zusätzlich
`ANTHROPIC_API_KEY` (Key von console.anthropic.com, Guthaben-basiert)
und optional `CLAUDE_MODEL` setzen (Default `claude-opus-4-8`;
günstigere Alternative `claude-sonnet-5`). Auf Railway: die drei
Variablen am Steuerwissen-Service setzen, der Gemini-Key kann bleiben
(wird bei PROVIDER=claude nicht benutzt).
`mock` antwortet deterministisch ohne API-Schlüssel (zum Testen).

## Quellen im Register

| Quelle | Inhalt | Status |
|---|---|---|
| bundesfinanzministerium.de | Themenbereich Steuern (rekursiv) + verlinkte BMF-Schreiben/PDFs | amtlich |
| gesetze-im-internet.de | Vollindex ALLER Bundesgesetze (klickbar) + Volltexte der steuerrelevanten Gesetze (§-genau, aus den amtlichen XML-Gesamtausgaben) | amtlich |
| bmjv.de | Gesamtauftritt: XML-Sitemap + Link-Verfolgung (Themen inkl. „node"-Übersichtsseiten, Gesetzgebungsverfahren, Publikationen, Presse) + verlinkte PDFs. robots.txt ohne KI-/TDM-Vorbehalt (geprüft 2026-07-14). Der Service-Bereich (`/DE/service/`) ist auf ausdrückliche Betreiber-Entscheidung enthalten (2026-07-14): Inhalte sind amtliche Werke (§ 5 UrhG), die robots-Regel `/DE/Service/` matcht das reale kleingeschriebene Pfadschema nicht und zielt erkennbar auf Suchindex-Hygiene; Crawl begrenzt (max. 400 Seiten). | amtlich |
| **Amtliche BMF-Handbücher** (ao/esth/lsth/ksth/gewsth/usth/erbsth `.bundesfinanzministerium.de`) | **Konsolidierte Verwaltungsvorschriften im Volltext: AEAO, EStR/EStH, LStR/LStH, KStR/KStH, GewStR/GewStH, UStAE, ErbStR/ErbStH + amtliche Hinweise** (2.925 Seiten + 59 PDFs). Nur vom lokalen PC crawlbar (Radware-Challenge auf jedem Abruf); robots-frei geprüft (2026-07-17). Akkordeon-Inhalte werden aufgeklappt (sonst fehlt der Erlass-Text). | amtlich |
| verwaltungsvorschriften-im-internet.de (Bundes-VwV) | 789 Verwaltungsvorschriften des Bundes (Volltext, `bsvwvbund_*.htm`) über 28 Ressort-Teillisten (818 Seiten + 916 PDFs). robots.txt = alles erlaubt, kein TDM-Vorbehalt (geprüft 2026-07-16, iso-8859-1). | amtlich |
| bzst.de (Bundeszentralamt für Steuern) | Merkblätter, Downloads, DSFinV-K-Bereich (~1.626 Seiten + 969 PDFs). robots-frei, **`Crawl-delay: 30` Pflicht**. Enthält den DSFinV-K-2.4-ZIP als Import (Spezifikation + „Einführung/Anwendungserlass §146a AO" 2019 + BSI-TR + AEAO §146). | amtlich |
| EUR-Lex / CELLAR (EU-Umsatzsteuerrecht) | MwStSystRL 2006/112/EG, MwSt-DVO 282/2011, VerbrauchStSystRL 2020/262 (konsolidiert, deutsch). Über CELLAR (`publications.europa.eu`, robots: alles erlaubt) statt EUR-Lex (WAF-dicht); Anzeige-Link = EUR-Lex. | amtlich |
| rechtsprechung-im-internet.de (RII, alle Bundesgerichte) | **83.497 Entscheidungen ab 2010** (BGH/BFH/BVerwG/BPatG/BAG/BSG/BVerfG). Betreiber-Freigabe 2026-07-16 trotz robots-Vorbehalt (gemeinfreie amtliche Werke § 5 UrhG, bereitgestellte Bulk-Schnittstelle, moderate Rate; **nicht auf andere robots-gesperrte Quellen übertragbar**). Urteile = Lazy-Blob-Karten + Korpus-Chunks, keine register.js-Einträge. | amtlich |
| smartsteuer.de/online/lexikon | **NICHT übernommen** – robots.txt erklärt einen maschinenlesbaren KI-/TDM-Nutzungsvorbehalt (§ 44b UrhG). Nur als externer Link in der WebApp. | Sekundärquelle |

Jeder Eintrag trägt Quelle, Stand (soweit angegeben) und Abrufdatum.

### Vollständigkeits-Audit (2026-07-15)

Drei Prüfungen gegen die Live-Quellen, Ergebnis: **vollständig** bis auf
dokumentierte Quellen-Grenzen:

- **GII-Gesetzesindex:** Live-Neuzählung aller Teillisten = 6.122 Gesetze,
  deckungsgleich mit dem Register (0 fehlend, 0 veraltet). Alle 244
  steuerrelevanten Gesetze verarbeitet. **Quellen-Grenze:** Bei 7 alten
  Abkommens-/Überleitungsgesetzen (dba_taipeh, dbaprot_taipeh,
  bierstgemby_bag, bierstgemw_g, rhistabkfindv, rhistabkitadv,
  rhistvtrswedv) enthält das amtliche juris-XML **keinen Normtext** (nur
  Metadaten; Volltext existiert nur im BGBl) – dort kann kein Crawler mehr
  holen; der Gesetzes-Eintrag mit Link ist die maximale Abdeckung.
  Artikelgesetze ohne `enbez` (z. B. ErbStRG) landen seit dem
  parseNorms-Fallback als „Gesamttext" im Korpus.
- **BMJV-Sitemaps:** Alle Sitemap-URLs im Crawl-Scope sind im Register;
  einzige Abweichungen waren am Audit-Tag neu veröffentlichte Seiten
  (lastmod = Audit-Datum), die die Wochen-Automatik per `--since` holt.
- **Fehler-Inventur:** Von 123 je aufgetretenen Fehler-URLs wurden 117 im
  weiteren Crawl-Verlauf nachgeholt; die 5 echten Lücken (4 BMF-PDFs, u. a.
  Gutachten doppelte Besteuerung, + 1 NKR-Jahresbericht) wurden per
  Einzelabruf geschlossen. Formular-Echo-URLs
  (`…?page=<kodierte-URL>`, CMS-Artefakte ohne Inhalt) filtert
  build-register seither klassenweit aus.

## Als eigener Web-Dienst (Link für jedes Gerät)

`server/server.mjs` ist ein vollständiger Web-Dienst (WebApp + Register +
KI-Abfrage) und läuft als **eigener Railway-Service** neben KassenFlow:

1. Railway → Projekt → **New Service → GitHub Repo** (`perschkramon-ui/steuern-und-gesetze`).
2. Settings → **Config-as-code / Railway Config File** auf
   **`railway.json`** (Repo-Root) stellen – Build `echo skip` + Start
   `node server/server.mjs`; Start/Build in der UI einzutragen ist unnötig.
   (Seit dem Repo-Umzug 2026-07-16 gibt es hier kein Kassen-Pre-Deploy mehr.)
3. Variables: `GEMINI_API_KEY` (oder `PROVIDER=claude` + `ANTHROPIC_API_KEY`),
   **`KI_ACCESS_CODE=<selbstgewählter Code>`** (schützt das KI-Kontingent;
   Register/Suche bleiben offen – amtliche Daten), `NODE_OPTIONS=--max-old-space-size=6144`
   und **`KI_CORPUS_SCOPE`**.
   ⚠️ **RAM-Realität seit dem Rechtsprechungs-Vollausbau (2026-07-17):** Der
   Vollkorpus (`scope=alles`) hat **~918.000 Chunks** (83k Urteile + alle
   Gesetzesnormen). Der BM25-Index-Bau braucht dafür **> 6 GB Heap** (lokaler
   Boot-OOM bei 6144 verifiziert) und bootet auf dem **8-GB-Hobby-Plan NICHT**.
   → Am Railway-Service **`KI_CORPUS_SCOPE=steuern`** setzen: das lässt die
   Topics „Bundesrecht (§§)" und „Rechtsprechung des Bundes" (Nicht-BFH-Urteile)
   weg, ergibt **~244.000 Chunks** (Steuer-Kern: BMF, alle Handbücher/AEAO/
   UStAE, BZSt/DSFinV-K, VwV, EU-Recht, BFH-Rechtsprechung) und bootet in ~85 s.
   Der VOLLE Stand bleibt im Repo + Offline-Bundle erhalten – nur die *live*
   durchsuchbare Menge ist der Steuer-Kern. Für den Vollkorpus live: Railway-Plan
   mit ≥ 16 GB RAM + `NODE_OPTIONS=--max-old-space-size=12288`, `scope=alles`.
3b. `HOST` ist auf Railway automatisch `0.0.0.0` (erkennt
   `RAILWAY_PUBLIC_DOMAIN`); `PORT` setzt Railway selbst.
4. Settings → Networking → **Generate Domain** → der Link (z. B.
   `steuerwissen-….up.railway.app`) funktioniert auf jedem Gerät.
   Beim ersten „Fragen" fragt die Seite einmal nach dem Zugangscode
   und merkt ihn sich auf dem Gerät.

Die frühere POS-Einbindung (Menüpunkt „Steuerwissen"/`/steuerwissen` im
Kassen-Server) wurde am 2026-07-15 auf Betreiber-Entscheidung ENTFERNT
(„für mich, nicht für andere") – dieser eigenständige Dienst plus die
Offline-Datei sind die einzigen Zugänge.

## Als Connector in der Claude-App (MCP)

Der Dienst spricht zusätzlich **MCP** (Model Context Protocol) – damit kann
die Claude-App (claude.ai, Desktop, Handy; Pro/Max-Abo) das Register **direkt
im normalen Chat** durchsuchen. Claude recherchiert dann mehrstufig selbst
(suchen → Volltext lesen → antworten mit amtlichen Links) und läuft über das
Claude-Abo statt über einen API-Key.

Einrichten (einmalig): claude.ai → Einstellungen → **Connectors** →
**„Eigenen Connector hinzufügen"** → Name z. B. „Steuerregister", URL:

```
https://steuernundgesetze.up.railway.app/mcp/<KI_ACCESS_CODE>
```

⚠️ Der Zugangscode steckt in der URL (die Claude-Apps erlauben bei eigenen
Connectoren keine Header) – die URL also wie ein Passwort behandeln.
Alternativ akzeptiert `/mcp` den Code im `x-ki-code`-Header (für Clients,
die Header können). Werkzeuge: `register_suchen` (BM25 über alle 202k
Chunks), `quelle_lesen` (Volltext einer URL, seitenweise), 
`kommende_aenderungen` (⏳ mit mWv-Datum). Stateless Streamable HTTP
(JSON-RPC per POST, Antwort als JSON), kein SSE nötig.

## Aktualisierungs-Automatik (Änderungen + „was kommt" + Gültigkeitsdatum)

**Ein Befehl arbeitet alle Quellen-Änderungen ein** (im Repo-Root):

```bash
node crawler/update-all.mjs
```

Das holt: GII komplett neu (inkl. der **amtlichen Standangaben** je Gesetz –
daraus entstehen **⏳-„Kommend"-Einträge** für Änderungen, die amtlich
angekündigt, aber noch nicht eingearbeitet sind, mit Wirkungsdatum „mWv …"),
BMJV per **Sitemap-Delta** (nur Seiten mit neuerem `lastmod`), BMF per
**Listen-Refresh** (neue BMF-Schreiben werden auf den Themen-/Listenseiten
entdeckt). Danach: PDF-Texte (nur Neues), Register-Neubau mit
**Änderungs-Changelog** (`data/changelog.json`; die WebApp zeigt „seit letzter
Aktualisierung: +N neu, M geändert") und frisches Offline-Bundle.

**Cloud-Routine:** In der Claude-Umgebung läuft das automatisch **jeden Montag
03:30 UTC** (Routine „Steuerregister-Update (wöchentlich)", legt einen
Draft-PR mit den Änderungszahlen an; der Betreiber mergt). Kommende Änderungen
sind in der WebApp über den Filter **„⏳ Kommend"** bzw. das Thema
„Kommende Änderungen" sichtbar; BMJV-**Gesetzgebungsverfahren** (= Vorschau auf
künftiges Recht) haben eine eigene Rubrik.

## Register aktualisieren / neue Quellen aufnehmen

Die Crawler liegen in `crawler/` (alle ohne npm-Abhängigkeiten):

```bash
# 1. BMF (dauert wegen höflicher Drosselung ~1–2 h; resumierbar)
node crawler/crawl-bmf.mjs --out /pfad/zum/cache/bmf --delay 1800

# 2. Gesetze im Internet (Vollindex + Steuergesetz-XMLs, ~20 Min)
node crawler/crawl-gii.mjs --out /pfad/zum/cache/gii --delay 600

# 3. Weitere amtliche Quellen: generischer Sitemap-Crawler (Beispiel BMJV).
#    VORHER robots.txt prüfen (KI-/TDM-Vorbehalt? Disallows? Sitemap-Zeile?)
node crawler/crawl-site.mjs --host www.bmjv.de \
  --sitemap-index https://www.bmjv.de/Sitemap_Index.xml \
  --deny "/SiteGlobals/|/DE/[Ss]ervice/|/EN/" \
  --out /pfad/zum/cache/bmjv --delay 1500

# 4. PDF-Texte extrahieren (braucht einmalig pdfjs-dist außerhalb des Repos):
#    npm install pdfjs-dist@4 --prefix /pfad/zu/werkzeugen
#    Deckel: 3000 Seiten / 4 Mio. Zeichen je PDF (--maxpages/--maxchars);
#    gekürzte Dokumente tragen truncated:true – nie still. build-register
#    deckelt passend dazu bei 1250 Chunks je PDF und warnt laut bei Trip.
node crawler/extract-pdf.mjs --cache /pfad/zum/cache/bmf --pdfjs /pfad/zu/werkzeugen/node_modules/pdfjs-dist
node crawler/extract-pdf.mjs --cache /pfad/zum/cache/bmjv --pdfjs /pfad/zu/werkzeugen/node_modules/pdfjs-dist

# 5. Register bauen (schreibt data/register.js, data/register.json, data/corpus.jsonl.gz + Offline-Bundle)
node crawler/build-register.mjs --gii /pfad/zum/cache/gii \
  --sites "bmf=/pfad/zum/cache/bmf,bmjv=/pfad/zum/cache/bmjv" --out data
node crawler/bundle-offline.mjs

# 6. Amtliche BMF-Handbücher (AEAO, EStR, LStR, KStR, GewStR, UStAE, ErbStR) –
#    NUR vom lokalen PC (Radware-Challenge auf jedem Abruf; Cloud-Chromium
#    gesperrt). Ein Skript für alle 7 Subdomains, Ausgabe-Erkennung automatisch,
#    robots-/TDM-Prüfung eingebaut. Anleitung:
#    docs/claude-memory/kassensystem-handbuch-crawl-auftrag.md
node crawler/crawl-handbuch-browser.mjs --host ao.bundesfinanzministerium.de \
  --out /pfad/zum/cache/ao-handbuch --playwright /pfad/zu/werkzeugen/node_modules/playwright
```

Hinweise:
- In der Claude-Cloud-Umgebung brauchen die Crawler `NODE_USE_ENV_PROXY=1`
  (Node-fetch nutzt den Sandbox-Proxy sonst nicht). Lokal ist das unnötig.
- BMF schützt sich mit Radware-Bot-Management. Die Crawler sind gedrosselt und
  brechen bei dauerhaften Blocks sauber ab (State bleibt erhalten, einfach
  später fortsetzen). Bei Blocks: 15 Min warten, dann mit `--delay 22000
  --ua chrome` fortsetzen – oder auf dem lokalen PC `crawl-bmf-browser.mjs`
  nutzen (echter Chromium löst die Challenge; braucht einmalig
  `npm install playwright --prefix <werkzeug-ordner>`).
  ⚠️ In der Claude-Cloud funktioniert `crawl-bmf-browser.mjs` NICHT
  (Sandbox resettet Chromium-Navigation) – nur lokal verwenden.
- Neue Quellen: erst robots.txt auf KI-/TDM-Vorbehalte prüfen (wie smartsteuer)
  – bei Vorbehalt nur verlinken, nie übernehmen.

## Rechtliches

- Alle übernommenen Inhalte sind amtliche Werke (§ 5 UrhG: Gesetze,
  BMF-Schreiben, amtliche Verlautbarungen).
- Dieses Werkzeug ist eine Recherche-Hilfe und **ersetzt keine Steuerberatung**;
  rechtsverbindlich sind allein die verlinkten Originalquellen.
- Für das Kassensystem gilt unverändert: Rechtliche Bewertungen laufen über das
  Rechtsrahmen-Gate (`CLAUDE.md`) und das Rechtsquellen-Register in
  `docs/claude-memory/kassensystem-rechtsquellen-register.md`.
