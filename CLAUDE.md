# CLAUDE.md – Steuern und Gesetze (Register + KI-Abfrage)

Leitfaden für Claude-Sessions in DIESEM Repo: ein durchsuchbares Register
amtlicher Rechtsquellen (alle Bundesgesetze §-genau, BMF-Schreiben, BMJV,
Verwaltungsvorschriften, EU-Recht, Rechtsprechung der Bundesgerichte) mit
strikt quellengebundener KI-Abfrage. Kein Kassen-/Fiskalcode – das ist ein
eigenständiges Werkzeug des Betreibers („es ist für mich, nicht für andere").

## Repo-Trennung (Betreiber 2026-07-16 – DAUERHAFT)

Dieses Repo wurde am 2026-07-16 aus `perschkramon-ui/Kassensystem`
(Ordner `steuerberater-ki/`, Stand 9353449) herausgelöst – **bewusst ohne
Git-Historie** (die alten Daten-Revisionen hätten hunderte MB Ballast
mitgebracht; Historie bleibt im Kassen-Repo einsehbar). Regeln:

- **Zuständigkeit:** Gesetze-/Register-Arbeit läuft NUR hier. Das
  Kassensystem (POS, TSE, Fiskal) läuft NUR im Kassensystem-Repo – dort
  gelten dessen CLAUDE.md-Regeln, die beiden Stränge kollidieren nie mehr
  auf einem gemeinsamen main.
- **Sessions:** Der Betreiber fährt getrennte Sessions je Repo (Cloud und
  lokal). Eine Session in diesem Repo fasst NIE Kassensystem-Dateien an
  und umgekehrt. Lokale Gesetze-Session = im Klon DIESES Repos starten.
- `origin/main` ist die einzige Quelle der Wahrheit; Branch + PR pro
  Aufgabe; NIE mergen, solange die CI des exakten Head-Commits nicht grün
  ist; gemergt wird nur auf ausdrückliches „mergen" des Betreibers.
  **Ausnahme (Betreiber-Entscheid 2026-07-18):** die **Wochen-Routine**
  mergt ihren eigenen PR selbst, sobald das `meta.counts`-Gate besteht
  (kein Zähler unter Referenz); fällt ein Zähler → Draft-PR stehen lassen
  und den Betreiber anpingen (nicht mergen). Für alle übrigen Sessions
  gilt die Merge-Regel unverändert.
- Session-Ende: eine Zeile an `docs/SESSION-LOG.md` anhängen.

## Was hier liegt (Landkarte)

- `server/server.mjs` – zero-dep Web-Dienst: WebApp + Register + KI-Abfrage
  (`/api/ask`, `KI_ACCESS_CODE`-Gate) + **MCP-Connector** (`/mcp/<code>`,
  stateless Streamable HTTP; Tools register_suchen/quelle_lesen/
  kommende_aenderungen). **SUCHE = SQLite-FTS5 AUF PLATTE (Umbau 2026-07-23,
  `node:sqlite`, zero-dep):** Der Index liegt nicht mehr im RAM (das OOMte bei
  918k Chunks), sondern als DB-Datei `data/register-fts.db` (ephemer,
  gitignored, beim Boot aus den Korpus-Shards gebaut – Fingerabdruck aus
  Shard-Größen überspringt den Bau bei unverändertem Korpus). Messung: Bau ~2 min
  / ~0,6 GB RAM, Suche ~0,05 GB / ~60 ms, Datei ~4 GB. **Damit ist der VOLLE
  Korpus inkl. ALLER Rechtsprechung (BGH/BAG/BSG/BVerwG/BVerfG) live** – auf dem
  8-GB-Plan, 0 €. **`KI_CORPUS_SCOPE` ist GEGENSTANDSLOS** (wird nur für einen
  Deprecation-Hinweis gelesen; der ganze Korpus wird immer indexiert – die
  frühere RAM-Bremse/Scope-Logik entfällt). `retrieve()`: FTS5-`bm25` (Titel 10×)
  über 80 Kandidaten → JS-Nachsortierung mit **Primärquellen-Boost** (Gesetze
  ×1,25; exakt zitierter „§ N GESETZ" zusätzlich ×1,8) + **Dedup je URL** (max 2);
  A/B gegen den alten RAM-BM25 verprobt (2026-07-23): §-Antworten bleiben Rang 1,
  Rechtsprechung kommt zusätzlich. `/api/ask`-Fail-closed jetzt Score-Schwelle 15
  (FTS5-Skala; der eigentliche Off-Topic-Wächter ist der strikte Prompt). Disk:
  Dienst braucht ~5 GB (Korpus 0,6 + Index 4).
  Provider `gemini|claude|mock` (`server/providers.mjs`; Default `gemini-2.5-pro`
  für Genauigkeit, `maxOutputTokens` 8192 wg. Thinking; claude OHNE
  Sampling-Parameter – Opus 4.7+/Sonnet 5 lehnen temperature mit 400 ab).
  **`verifyAnswer` Paragrafen-Wächter** (2026-07-23): jede §-Nummer der Antwort
  muss in den Quellen vorkommen, sonst `verified=false` + Warnhinweis.
- `webapp/index.html` – Offline-Suche (file://-fähig); Lazy-Blob
  `data/normen-register.js` (gzip+base64, DecompressionStream) trägt die
  §-Karteikarten ALLER Gesetze + die Urteils-Karten (Chip „⚖️ Urteile").
- `crawler/` – alle Quellen-Werkzeuge:
  - `crawl-gii.mjs` (gesetze-im-internet, `--all-norms true` = alle ~6.100
    Gesetze), `crawl-bmf.mjs`/`crawl-bmf-browser.mjs` (BMF; Browser-Variante
    NUR lokal – Cloud-Chromium-Navigation ist gesperrt), `crawl-site.mjs`
    (generisch, sitemap/BFS, charset-korrekt), `crawl-handbuch-browser.mjs`
    (die 7 Amtlichen Handbücher = AEAO/EStR/LStR/KStR/GewStR/UStAE/ErbStR;
    NUR lokal, Radware), `fetch-eu-recht.mjs` (EUR-Lex ist WAF-dicht →
    CELLAR+SPARQL), `fetch-rii.mjs` (Rechtsprechung ALLER Bundesgerichte,
    83.454 Entscheidungen ab 2010; Betreiber-Freigabe trotz robots-Vorbehalt
    – Entscheid + Grenzen im Skript-Kopf; NICHT auf andere Quellen
    übertragen), `import-pdf-dir.mjs` (ZIP-/Ordner-Import, z. B. DSFinV-K),
    `extract-pdf.mjs` (Deckel 3000 Seiten/4 Mio. Zeichen, truncated-Flag),
    `build-register.mjs` (Register+Korpus-Shards+Lazy-Blob; Urteile werden
    KEINE register.js-Einträge), `bundle-offline.mjs`,
    `restore-cache-from-register.mjs` (rekonstruiert Caches aus data/,
    inkl. Korpus-only-Inhalten), `update-all.mjs` (die EINE
    Aktualisierungs-/Neubau-Route – s. u.).
- `data/` – committete Wahrheit: register.js/json, normen-register.js,
  corpus*.jsonl.gz (Shards ≤200 MB roh), Offline-Bundle, changelog.json.
- `docs/AUFTRAG-lokale-session.md` – der offene Auftrag für die LOKALE
  Session (Handbücher + Quellen-Ausbau + RII-Voll-Lauf); Status dort pflegen.
- `docs/SESSION-LOG.md` – eine Zeile je Session.

## Nicht verhandelbare Regeln

1. **Nur amtliche Quellen, strikt quellengebunden:** Jede KI-Antwort stützt
   sich ausschließlich auf Register-Fundstellen; Links verifiziert der
   Server, nie das Modell. Fail-closed ohne Fundstelle.
2. **Zitier-Regel:** Eine URL wird nur als Beleg genannt, wenn ihr Inhalt in
   derselben Session tatsächlich gelesen wurde. WebSearch-Treffer sind
   Hinweisgeber, keine Belege.
3. **robots/TDM:** Vor JEDER neuen Quelle robots.txt auf KI-/TDM-Vorbehalte
   (§ 44b Abs. 3 UrhG) prüfen. Vorbehalt → nicht übernehmen, nur verlinken
   (Präzedenz smartsteuer). Ausnahmen NUR per dokumentiertem
   Betreiber-Entscheid (bisher einzig: RII, 2026-07-16).
4. **Keine stillen Deckel:** Jedes Limit in der Ingest-Pipeline meldet sich
   laut (Warnung) oder markiert die Kürzung im Datensatz (`truncated`).
   Deckel über Pipeline-Stufen hinweg konsistent dimensionieren
   (extract-pdf 4 Mio. Zeichen ↔ build-register 1250 Chunks/PDF).
5. **Register neu bauen NUR über `update-all.mjs`:** Schritt 0 rekonstruiert
   fehlende Bestands-Caches aus data/ (Handbücher + Ausbau-Quellen sind NUR
   so vor Verlust geschützt). Hand-Builds mit Teil-Quellenlisten weiden das
   Register still aus. Erfolgskontrolle: meta.counts dürfen nie sinken.
6. **Secrets** (`server/.env.local*`, `KI_ACCESS_CODE`, API-Keys) nie
   committen/loggen; die Connector-URL enthält den Code → wie ein Passwort
   behandeln.

## Betrieb

- **Railway-Dienst „steuernundgesetze"** (steuernundgesetze.up.railway.app):
  deployt dieses Repo, Config `railway.json` (Root), Start
  `node server/server.mjs`; Railway injiziert PORT, HOST auto-0.0.0.0.
  Env: Provider-Key, `KI_ACCESS_CODE`, `NODE_OPTIONS=--max-old-space-size=…`
  (nach dem Urteils-Vollausbau 6144 empfohlen; Notbremse
  `KI_CORPUS_SCOPE=steuern`).
- **MCP-Connector in der Claude-App:** URL `…/mcp/<KI_ACCESS_CODE>`
  (README „Als Connector in der Claude-App").
- **Wochen-Routine** (Mo 03:30 UTC, Trigger `trig_01NTbZ6VJYqZn7wjQDgpxcmE`,
  zeigt auf DIESES Repo): frische Cloud-Session führt `crawler/update-all.mjs`
  aus (GII-Neuabruf, BMJV-Delta, BMF-Refresh, EU-/RII-Deltas, Restore, Build,
  Offline-Bundle), öffnet einen PR und **mergt ihn selbst, sobald das
  `meta.counts`-Gate besteht** (Auto-Merge, Betreiber-Entscheid 2026-07-18;
  bei Zähler-Rückgang Draft-PR + Push statt Merge). Der Merge löst den
  Railway-Deploy aus. Details/Referenzzähler: docs/WOCHEN-ROUTINE-TODO.md.
- **Cloud-Grenzen:** Radware-Hosts (BMF-Handbücher) + Chromium-Navigation
  nur lokal; Node-fetch braucht in der Cloud `NODE_USE_ENV_PROXY=1`;
  Port-80-Ziele sind im Proxy dicht (http→https umschreiben).

## Arbeitsweise

- Änderungen klein und überprüfbar; jede neue Quelle/Pipeline-Stufe mit
  Live-Probe verifizieren (ein Werkzeug, das hier nicht laufen kann, wird
  adversarial reviewt UND in der Anleitung als ungetestet gekennzeichnet).
- Gedächtnis-Pflege: diese Datei + README bei jeder Aufgabe mitführen
  (Landkarte aktuell halten); Betreiber-Entscheide mit Datum festhalten.
- Der Betreiber ist Einzelnutzer: keine Mehrbenutzer-/RBAC-Logik nötig,
  aber Zugangscode-Schutz für das KI-Kontingent beibehalten.
