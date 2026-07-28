# Rechtsrahmen POS-/Kassensysteme (Deutschland + EU)

Kuratierte Landkarte aller **offiziellen** Gesetze, Verordnungen und amtlichen
Konkretisierungen, die für elektronische Kassen-/POS-Systeme gelten. Recherche
2026-07-23 (gegen das eigene Register + amtliche Quellen verprobt). Kein
Rechtsrat – Quellenauskunft; im Zweifel StB/Fachanwalt.

Spalte **Register**: ✓ = im durchsuchbaren Register vorhanden (Volltext),
❌ = bewusst nicht ingestiert (s. Fußnoten).

## A. Kern – Kassenführung & Manipulationsschutz (AO + Verordnungen)

| Norm | Inhalt für POS | Register |
|---|---|---|
| **Kassengesetz 2016** – Gesetz zum Schutz vor Manipulationen an digitalen Grundaufzeichnungen (22.12.2016, BGBl. I S. 3152) | Artikelgesetz, führte § 146a AO ein | Kontext (AEAO) |
| **§ 146 AO** | Einzelaufzeichnungspflicht, Kassensturzfähigkeit, tägliche Kassenberichte | ✓ |
| **§ 146a AO** | Pflicht zur **zertifizierten technischen Sicherheitseinrichtung (TSE)**, Belegausgabepflicht, Mitteilungspflicht (Abs. 4) | ✓ |
| **§ 146b AO** | **Kassen-Nachschau** (unangekündigt, außerhalb Außenprüfung) | ✓ |
| **§ 147 AO** | Aufbewahrung 10 Jahre, Datenzugriff Z1/Z2/Z3 | ✓ |
| **§ 379 AO** | Bußgeld (Steuergefährdung) bei Verstößen gegen § 146a – bis 25.000 € | ✓ |
| **§§ 145, 143, 144 AO** | Allgemeine Anforderungen an Buchführung; Aufzeichnung Warenein-/-ausgang | ✓ |
| **KassenSichV** (Kassensicherungsverordnung) | Konkretisiert § 146a: betroffene Systeme (§ 1), Anforderungen an die TSE mit Verweis auf die BSI-TR (§ 5), **Belegpflichtangaben (§ 6)**, DSFinV-K-Verweis (§ 4), Taxameter/Wegstreckenzähler (§ 8/§ 10) | ✓ |

## B. Amtliche Konkretisierung (untergesetzlich / technisch)

| Quelle | Inhalt | Register |
|---|---|---|
| **AEAO zu § 146a** (BMF-Anwendungserlass zur AO) | Verbindliche Verwaltungsauslegung: Belegausgabe, TSE-Ausfall-Dokumentation, Befreiungen | ✓ (AO-Handbuch + BZSt) |
| **DSFinV-K** – Digitale Schnittstelle der Finanzverwaltung für Kassensysteme (BZSt), aktuell **Version 2.5** (2026) | Einheitliches Datensatz-/Exportformat für Kassen-Nachschau/Außenprüfung (Z3). Rechtsgrundlage § 4 KassenSichV i.V.m. § 146a Abs. 1 S. 4 AO | ✓ (BZSt, Stand v2.4 – **v2.5-Update ausstehend**) |
| **DSFinV-TW** – analog für Taxameter/Wegstreckenzähler (BZSt) | Datensatzbeschreibung Taxameter | ✓ (BZSt) |
| **GoBD** (BMF-Schreiben) – Grundsätze zur ordnungsmäßigen Führung/Aufbewahrung von Büchern in elektronischer Form sowie zum Datenzugriff | Ordnungsmäßigkeit der DV-Buchführung, Unveränderbarkeit, Verfahrensdokumentation | ✓ (BMF-Schreiben-Korpus) |
| **BSI TR-03153** (+ **TR-03151** Secure-Element-API, **TR-03116-5** Krypto) | Die konkreten **technischen Anforderungen an die TSE** (auf die § 5 KassenSichV verweist) | ❌ ¹ |

## C. Beleg & Umsatzsteuer

| Norm | Inhalt | Register |
|---|---|---|
| **§ 6 KassenSichV** | Pflichtangaben auf dem (Kassen-)Beleg | ✓ |
| **§ 14 UStG** / **§ 33 UStDV** | Rechnung / Kleinbetragsrechnung | ✓ |
| **§ 14b UStG** | Aufbewahrung von Rechnungen | ✓ |
| **§ 22 UStG** | Aufzeichnungspflichten für die Umsatzsteuer | ✓ |

## D. Handelsrecht & angrenzende Pflichten

| Norm | Inhalt | Register |
|---|---|---|
| **§§ 238, 239, 257 HGB** | Buchführungs- und Aufbewahrungspflicht der Kaufleute | ✓ |
| **PAngV** (Preisangabenverordnung) | Preisauszeichnung (Verkaufs-/Grundpreis) | ✓ |
| **DSGVO** (VO (EU) 2016/679) / **BDSG** | Kundenkartei/Stammgäste, Auftragsverarbeitung, Betroffenenrechte | DSGVO ✓ ² · BDSG ✓ |
| **ZAG** (Zahlungsdiensteaufsichtsgesetz) | Nur falls eigener Zahlungsdienst – bei durchgeleiteter Kartenzahlung (Geld → Betriebskonto) i.d.R. NICHT einschlägig | ✓ |
| **MessEG / MessEV** (Eichrecht) | Nur bei Waagen an der Kasse | ✓ |

## E. Verfahren: Mitteilungspflicht § 146a Abs. 4 AO

Seit **01.01.2025** sind elektronische Aufzeichnungssysteme (Kassen) dem
Finanzamt **über ELSTER** zu melden (Anschaffung/Außerbetriebnahme):
- Bestandssysteme (vor 01.07.2025 angeschafft): Meldung bis **31.07.2025**.
- Ab 01.07.2025 angeschaffte/außer Betrieb genommene Systeme: **binnen 1 Monat**.
- Anzugeben u. a.: Art des Systems, Anzahl je Betriebsstätte, **Seriennummer**,
  Art der TSE, Anschaffungs-/Außerbetriebnahmedatum.

## F. EU-Ebene (mittelbar relevant)

| Rechtsakt | Bezug | Register |
|---|---|---|
| **MwStSystRL 2006/112/EG** + MwSt-DVO 282/2011 | EU-Grundlage der Umsatzsteuer | ✓ |
| **E-Rechnungs-RL 2014/55/EU** (Norm EN 16931) | Grundlage strukturierter E-Rechnung | Norm referenziert ³ |
| **DSGVO, ePrivacy, Verbraucherrechte-RL, Preisangaben-RL, UGP-RL, GPSR, PSD2, AI Act** | Datenschutz/Verbraucher/Zahlung/KI rund um die Kasse | ✓ ² |

## G. Landesrecht (unmittelbar betriebsrelevant)

Ladenschluss- und Gaststättenrecht sind seit der Föderalismusreform **Landesrecht**
und über `gesetze-im-internet.de` grundsätzlich **nicht** erreichbar — für den
Kassenbetrieb sind es aber die Normen des Alltags: Öffnungszeiten, verkaufsoffene
Sonntage, Sperrzeit, Rauchverbot in Gaststätten.

| Land | Ladenöffnung | Gaststätten | Nichtraucherschutz | Register |
|---|---|---|---|---|
| **Bayern** | BayLadSchlG (25.07.2025) | BayGastV (23.02.2016) | GSG (23.07.2010) | ✓ ⁴ |
| **Nordrhein-Westfalen** | LÖG NRW (30.03.2018) | GastV NRW (30.04.2005) | NiSchG NRW (01.05.2013) | ✓ ⁴ |
| **Sachsen** | SächsLadÖffG (01.12.2020) | SächsGastG (25.05.2018) | SächsNSG (26.07.2018) | ✓ ⁴ |
| **Brandenburg** | BbgLöG (25.04.2017) | BbgGastG (02.10.2008) | BbgNiRSchG (25.01.2016) | ✓ ⁴ |
| **übrige 12 Länder** | — | — | — | ❌ ⁵ |

**Feiertagsgesetze** (bestimmen, welche Tage Sonn-/Feiertage sind → steuern die Ladenöffnung): Bayern FTG (21.05.1980) ✓ · NRW Sonn- und Feiertage (01.01.2000) ✓ · Sachsen SächsSFG (07.05.2025) ✓ · Brandenburg ❌ (Kürzel nicht gefunden, s. ⁵).

---

### Fußnoten / Lücken & Stand

**¹ BSI TR-03153 / TR-03151 / TR-03116-5 – bewusst NICHT ingestiert (nur
verlinkt).** Die BSI-Nutzungsbedingungen erlauben die freie Nutzung nur für
**nicht-kommerzielle** Zwecke; eine **kommerzielle** Verwendung bedarf einer
Lizenzvereinbarung mit dem BSI, und die Inhalte dürfen **nur unverändert**
verwendet werden (ein Volltext-/Chunk-Index wäre eine Bearbeitung). Nach
Repo-Regel 3 (im Zweifel nicht übernehmen, nur verlinken – Präzedenz
smartsteuer) wird der BSI-TR-Volltext daher **nicht** ins Register
aufgenommen. Amtliche Fundstelle:
<https://www.bsi.bund.de/DE/Themen/Unternehmen-und-Organisationen/Standards-und-Zertifizierung/Technische-Richtlinien/TR-nach-Thema-sortiert/tr03153/tr03153_node.html>
(robots.txt des BSI erlaubt den Abruf; der Blocker ist die kommerzielle
Lizenzlage, nicht robots). Eine Volltext-Aufnahme wäre nur mit BSI-Lizenz
zulässig.

**² DSGVO & weitere EU-Rechtsakte:** per `crawler/fetch-eu-recht.mjs`
ergänzt (2026-07-23), **live im Register seit dem Rebuild am 2026-07-28**
(13/13 Rechtsakte, EU-Chunks 270 → 959). Konsolidierungsstände: MwStSystRL
14.04.2025 · MwSt-DVO 282/2011 14.04.2025 · Verbrauchsteuer-SystRL 26.04.2022 ·
DSGVO 04.05.2016 · ePrivacy 19.12.2009 · Verbraucherrechte-RL 27.09.2026 ·
Preisangaben-RL 98/6/EG 28.05.2022 · UGP-RL 27.09.2026 · GPSR 29.05.2026 ·
DSA 27.10.2022 · DMA 12.10.2022 · PSD2 17.01.2025 · AI Act 12.07.2024.
Der Crawler zieht je Lauf den neuesten Stand über den SPARQL-Endpoint nach.

**³ E-Rechnungs-RL 2014/55/EU:** über EUR-Lex/CELLAR nur ohne abrufbare
konsolidierte Fassung (404) – daher (noch) nicht als Volltext ingestiert; die
maßgebliche Norm EN 16931 ist ohnehin eine (kostenpflichtige) DIN/CEN-Norm
außerhalb des amtlichen Korpus.

**⁴ Landesrecht – live im Register seit 2026-07-28** (`crawler/fetch-landesrecht.mjs`,
15 Normen aus 4 Ländern, inkl. Feiertagsgesetze). Die Anker sind novellenfest gewählt: Bayern über das
stabile Dokument-Kürzel (`/Content/Document/<Kürzel>/true` – ohne `/true` kommt
nur das Inhaltsverzeichnis), NRW über die taxonomy-ID hinter „Link zur
aktuellsten Fassung" (die Sitemap führt auch historische Fassungen), Sachsen
über die Vorschriften-ID (rechtsbereinigte Fassung), Brandenburg über
`/gesetze/<kürzel>`. Der Crawler verifiziert bei **jedem** Lauf Titel und
Textlänge – nötig, weil BRAVORS auf jede unbekannte URL HTTP 200 antwortet.

**⁵ Übrige 12 Länder – nicht ingestiert, Grund je Land geprüft (2026-07-28).**
**Zehn sperren generische Crawler per robots.txt** (juris-Plattform, identisches
Muster „Whitelist für Googlebot/Bingbot/CCBot & Co., danach `User-agent: * /
Disallow: /`"): Baden-Württemberg, Berlin, Hamburg, Hessen,
Mecklenburg-Vorpommern, Rheinland-Pfalz, Saarland, Sachsen-Anhalt,
Schleswig-Holstein, Thüringen. **Zwei erlauben das Crawlen, bieten aber keinen
stabilen Anker:** `nds-voris.de` (kein robots.txt = erlaubt, aber keine Sitemap,
`/search` und `/browse` laufen ins 404 – clientseitige App) und
`transparenz.bremen.de` (leeres robots.txt = erlaubt, Vorschriften nur über
sixcms-Suchparameter). Ausweichweg für alle zwölf: Gesetz- und
Verordnungsblätter der Länder (PDF auf landeseigenen Servern) oder
Link-only-Einträge – bislang **nicht** umgesetzt.

**Aktualität:** § 146a/§ 146b/§ 147 AO Stand 10.02.2026; KassenSichV Stand
14.01.2026; DSFinV-K amtlich v2.5 (Register: v2.4 – Update ausstehend).

### Quellen (amtlich)
- § 146a AO – https://www.gesetze-im-internet.de/ao_1977/__146a.html
- § 146b AO – https://www.gesetze-im-internet.de/ao_1977/__146b.html
- § 147 AO – https://www.gesetze-im-internet.de/ao_1977/__147.html
- KassenSichV – https://www.gesetze-im-internet.de/kassensichv/
- DSFinV-K (BZSt) – https://www.bzst.de/DE/Unternehmen/Aussenpruefungen/DigitaleSchnittstelleFinV/digitaleschnittstellefinv_node.html
- BSI TR-03153 – https://www.bsi.bund.de/DE/Themen/Unternehmen-und-Organisationen/Standards-und-Zertifizierung/Technische-Richtlinien/TR-nach-Thema-sortiert/tr03153/tr03153_node.html
- Mitteilungspflicht § 146a Abs. 4 AO (ELSTER) – https://www.elster.de/eportal/formulare-leistungen/alleformulare/aufzeichnung146a
