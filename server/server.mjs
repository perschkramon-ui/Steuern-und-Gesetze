#!/usr/bin/env node
/**
 * Steuerberater KI – lokaler Abfrage-Server.
 *
 * Läuft komplett lokal (Standard: http://localhost:8787), ohne npm-Abhängigkeiten.
 *   node server/server.mjs          (aus dem Ordner steuerberater-ki heraus)
 *
 * Konfiguration in server/.env.local (NICHT einchecken – enthält den API-Key):
 *   PROVIDER=gemini            # gemini | claude | mock
 *   GEMINI_API_KEY=...         # für PROVIDER=gemini
 *   GEMINI_MODEL=gemini-2.5-flash
 *   ANTHROPIC_API_KEY=...      # für PROVIDER=claude
 *   CLAUDE_MODEL=claude-sonnet-5
 *   PORT=8787
 *
 * Genauigkeits-Architektur (der Kern des Werkzeugs):
 *   1. Retrieval ist deterministischer Code (BM25) – die KI sucht sich ihre
 *      Quellen nicht selbst, sie BEKOMMT die Fundstellen aus dem Register.
 *   2. Die KI darf ausschließlich aus den übergebenen Auszügen formulieren
 *      und mit [n] zitieren. URLs erfindet nicht das Modell: Die Links hängt
 *      DIESER Server aus dem Register an.
 *   3. Verifikation: Jede URL in der Modell-Antwort muss zu den übergebenen
 *      Quellen gehören, sonst wird sie entfernt und die Antwort markiert.
 *   4. Fail-closed: Ohne ausreichende Fundstellen wird der Provider gar nicht
 *      erst gefragt – die Antwort lautet dann ehrlich „keine Quelle im Register".
 */

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { providers } from './providers.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ---------- Konfiguration ----------
// HOST-Default: auf Railway (RAILWAY_PUBLIC_DOMAIN gesetzt) muss der Dienst
// auf 0.0.0.0 lauschen, lokal bleibt es bewusst 127.0.0.1.
const cfg = { PROVIDER: 'gemini', PORT: '8787', HOST: process.env.RAILWAY_PUBLIC_DOMAIN ? '0.0.0.0' : '127.0.0.1' };
const envFile = path.join(ROOT, 'server', '.env.local');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !line.trim().startsWith('#')) cfg[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
for (const k of ['PROVIDER', 'PORT', 'HOST', 'GEMINI_API_KEY', 'GEMINI_MODEL', 'ANTHROPIC_API_KEY', 'CLAUDE_MODEL', 'KI_ACCESS_CODE']) {
  if (process.env[k]) cfg[k] = process.env[k];
}
if (!providers[cfg.PROVIDER]) {
  console.error(`Unbekannter PROVIDER "${cfg.PROVIDER}" (erlaubt: ${Object.keys(providers).join(', ')})`);
  process.exit(1);
}

// ---------- Korpus laden ----------
// Seit dem Volltext-Vollausbau (alle Bundesgesetze) ist der Korpus in Shards
// abgelegt: corpus.jsonl.gz, corpus-2.jsonl.gz, … (GitHub-100-MB-Grenze).
// KI_CORPUS_SCOPE=steuern lädt nur den Steuer-Kern – ohne die Topics
// „Bundesrecht (§§)" und „Rechtsprechung des Bundes" (BGH/BVerwG/BAG/BSG/
// BVerfG/BPatG-Urteile; „BFH · Rechtsprechung" bleibt als Steuer-Kern drin)
// – für RAM-begrenzte Instanzen; Default: alles.
const corpusFiles = fs.existsSync(path.join(ROOT, 'data'))
  ? fs.readdirSync(path.join(ROOT, 'data')).filter((f) => /^corpus(-\d+)?\.jsonl\.gz$/.test(f)).sort()
  : [];
if (!corpusFiles.length) {
  console.error(`Korpus fehlt in ${path.join(ROOT, 'data')}\nErst das Register bauen (siehe README, build-register.mjs).`);
  process.exit(1);
}
const CORPUS_SCOPE = (process.env.KI_CORPUS_SCOPE || cfg.KI_CORPUS_SCOPE || 'alles').toLowerCase();
console.log(`Lade Korpus … (${corpusFiles.length} Shard(s), Scope: ${CORPUS_SCOPE})`);
const chunks = [];
for (const f of corpusFiles) {
  // Zeilenweise über den DEKOMPRIMIERTEN Buffer scannen statt
  // .toString().split('\n'): das Riesen-String+Zeilen-Array-Duo trieb die
  // RSS-Spitze um ~0,5 GB je Shard hoch (OOM-Risiko im POS-Prozess).
  const buf = zlib.gunzipSync(fs.readFileSync(path.join(ROOT, 'data', f)));
  let start = 0;
  while (start < buf.length) {
    let end = buf.indexOf(10, start);
    if (end === -1) end = buf.length;
    if (end > start) {
      const c = JSON.parse(buf.toString('utf8', start, end));
      if (CORPUS_SCOPE !== 'steuern' || (c.topic !== 'Bundesrecht (§§)' && c.topic !== 'Rechtsprechung des Bundes')) {
        // Text SOFORT in einen UTF-8-Buffer umziehen: sonst leben alle Texte
        // gleichzeitig als UTF-16-Strings im Heap.
        c._buf = Buffer.from(c.text || '', 'utf8');
        c.text = undefined;
        chunks.push(c);
      }
    }
    start = end + 1;
  }
}

// ---------- BM25-Index ----------
const fold = (s) => (s || '').toLowerCase()
  .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss');
const tokenize = (s) => fold(s).replace(/§\s*/g, '§').split(/[^a-z0-9§]+/).filter((t) => t.length > 1);

const SYNONYMS = {
  aufbewahrung: ['aufbewahrungsfrist', 'aufbewahren', 'aufzubewahren'],
  aufbewahrungsfrist: ['aufbewahrung', 'aufbewahrungsfristen'],
  beleg: ['belege', 'belegausgabe', 'kassenbeleg', 'bon', 'quittung'],
  bon: ['beleg', 'kassenbeleg', 'belegausgabe'],
  kasse: ['kassen', 'registrierkasse', 'kassensystem', 'aufzeichnungssystem'],
  tse: ['sicherheitseinrichtung', 'zertifizierte'],
  storno: ['stornierung', 'rueckgaengig'],
  rechnung: ['rechnungen', 'rechnungsangaben'],
  frist: ['fristen'],
  umsatzsteuer: ['mehrwertsteuer', 'ust'],
  mehrwertsteuer: ['umsatzsteuer', 'ust'],
  meldepflicht: ['mitteilungspflicht', 'melden', 'mitteilung'],
  kassennachschau: ['kassen-nachschau', 'nachschau'],
  trinkgeld: ['trinkgelder'],
  gutschein: ['gutscheine', 'einzweck', 'mehrzweck'],
};

console.log('Baue BM25-Index …');
// INVERTIERTER Index statt tf-Map je Dokument: Beim Volltext-Vollausbau
// (>200k Chunks) kosteten die per-Doc-Maps 3,4 GB RSS (Messung 2026-07-15)
// – im POS-Prozess ein OOM-Risiko. Postings-Arrays je Token (Int32Array:
// docIdx,tf-Paare) + Chunk-Text als UTF-8-Buffer (statt UTF-16-String,
// materialisiert nur für Top-Treffer) senken das auf einen Bruchteil.
// Nebeneffekt: bm25() läuft nur noch über die Postings der Suchwörter.
const df = new Map();
const postings = new Map();
const docLen = new Uint32Array(chunks.length);
const texts = new Array(chunks.length);
{
  const tf = new Map();
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i];
    // Text nur TRANSIENT als String (ein Dokument zur Zeit)
    const toks = tokenize(`${c.title} ${c._buf.toString('utf8')}`);
    docLen[i] = toks.length;
    tf.clear();
    for (const t of toks) tf.set(t, (tf.get(t) || 0) + 1);
    for (const [t, f] of tf) {
      df.set(t, (df.get(t) || 0) + 1);
      let arr = postings.get(t);
      if (!arr) { arr = []; postings.set(t, arr); }
      arr.push(i, f);
    }
    texts[i] = c._buf;
    delete c._buf;
  }
}
for (const [t, arr] of postings) postings.set(t, Int32Array.from(arr));
let lenSum = 0;
for (let i = 0; i < docLen.length; i++) lenSum += docLen[i];
const avgLen = lenSum / Math.max(1, chunks.length);
const N = chunks.length;
const K1 = 1.5, B = 0.75;

function bm25(queryTokens) {
  const scores = new Float64Array(chunks.length);
  for (const q of queryTokens) {
    const post = postings.get(q);
    if (!post) continue;
    const n = df.get(q);
    const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
    for (let j = 0; j < post.length; j += 2) {
      const i = post[j], f = post[j + 1];
      scores[i] += idf * (f * (K1 + 1)) / (f + K1 * (1 - B + B * docLen[i] / avgLen));
    }
  }
  return scores;
}

function retrieve(question, topK = 10) {
  const qTokens = [...new Set(tokenize(question).flatMap((t) => [t, ...(SYNONYMS[t] || [])]))];
  const scores = bm25(qTokens);
  const order = [...scores.keys()].sort((a, b) => scores[b] - scores[a]);
  const picked = [];
  const perUrl = new Map();
  for (const i of order) {
    if (scores[i] <= 0) break;
    const c = chunks[i];
    const cnt = perUrl.get(c.url) || 0;
    if (cnt >= 2) continue; // Quellen-Vielfalt statt 10 Chunks derselben Seite
    perUrl.set(c.url, cnt + 1);
    // Text erst hier materialisieren (nur für die Top-Treffer)
    picked.push({ score: scores[i], c: Object.assign({}, c, { text: texts[i].toString('utf8') }) });
    if (picked.length >= topK) break;
  }
  return picked;
}

// ---------- Prompt + Verifikation ----------
function buildPrompt(question, picked) {
  const src = picked.map((p, i) =>
    `[${i + 1}] ${p.c.title}${p.c.topic ? ` [${p.c.topic}]` : ''}${p.c.stand ? ` (${p.c.stand})` : ''}${p.c.date ? ` (${p.c.date})` : ''} — ${p.c.url}\n${p.c.text}`
  ).join('\n---\n');
  return `Du bist ein Rechercheassistent für deutsches Steuerrecht. Beantworte die FRAGE ausschließlich mit Informationen aus den nummerierten QUELLEN.

Strikte Regeln:
1. Nutze NUR die QUELLEN unten. Kein eigenes Wissen, keine Vermutungen, keine Rechtsberatung.
2. Belege JEDE Aussage mit Quellenverweisen in eckigen Klammern, z. B. [1] oder [2][3].
3. Beantworten die Quellen die Frage nicht oder nur teilweise, sage das ausdrücklich: "Dazu enthält das Register keine ausreichende Quelle." Rate NIEMALS.
4. Erfinde keine URLs, Paragraphen oder Daten. Zitiere §§ nur, wenn sie wörtlich in den Quellen stehen.
5. Antworte auf Deutsch, präzise und knapp.

FRAGE: ${question}

QUELLEN:
${src}`;
}

function verifyAnswer(answer, picked) {
  const allowed = new Set(picked.map((p) => p.c.url));
  let verified = true;
  const cleaned = answer.replace(/https?:\/\/[^\s)\]>"']+/g, (u) => {
    const trimmed = u.replace(/[.,;:]+$/, '');
    if (allowed.has(trimmed)) return u;
    verified = false;
    return '[Link entfernt – nicht im Register]';
  });
  return { cleaned, verified };
}

// ---------- MCP-Connector (Claude-App/Desktop: „Eigener Connector") ----------
// Model Context Protocol über Streamable HTTP (JSON-RPC 2.0 per POST /mcp,
// Antwort als application/json – laut Spez. zulässig; kein SSE nötig, da jede
// Anfrage genau eine Antwort hat). Stateless (keine Mcp-Session-Id). Auth:
// Zugangscode steckt im PFAD (/mcp/<code>) ODER im x-ki-code-Header – die
// Claude-Apps erlauben bei eigenen Connectoren keine freien Header, deshalb
// ist die URL selbst das Geheimnis (wie bei Webhook-URLs; im README dokumentiert).
const MCP_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
let registerCache = null; // lazy: register.json nur bei Bedarf (kommende_aenderungen)
function loadRegister() {
  if (!registerCache) {
    registerCache = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'register.json'), 'utf8'));
  }
  return registerCache;
}

const MCP_TOOLS = [
  {
    name: 'register_suchen',
    description: 'Durchsucht das amtliche deutsche Rechts-Register (alle ~6.100 Bundesgesetze paragrafengenau, BMF-Schreiben, BMJV-Seiten/PDFs, Gesetzgebungsverfahren). Liefert die relevantesten Fundstellen mit Titel, amtlichem Link, Stand und Textauszug. IMMER zuerst aufrufen, bevor eine steuer-/rechtsbezogene Frage beantwortet wird; Antworten nur auf die gefundenen Quellen stützen und die Links zitieren.',
    inputSchema: {
      type: 'object',
      properties: {
        suchbegriffe: { type: 'string', description: 'Suchbegriffe oder Frage – Fachbegriffe/§-Angaben verbessern die Treffer (z. B. "Aufbewahrungsfrist Kassenbelege § 147 AO")' },
        anzahl: { type: 'integer', description: 'Anzahl Fundstellen (1–20, Standard 8)' },
      },
      required: ['suchbegriffe'],
    },
  },
  {
    name: 'quelle_lesen',
    description: 'Liest den vollständigen im Register gespeicherten Text einer Quelle (URL aus register_suchen) – z. B. den kompletten Paragrafen, das ganze BMF-Schreiben oder die BMJV-Seite. Für Detailfragen nach einer Suche.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Die exakte Quell-URL aus einem register_suchen-Treffer' },
        teil: { type: 'integer', description: 'Fortsetzungsteil bei sehr langen Quellen (Standard 1)' },
      },
      required: ['url'],
    },
  },
  {
    name: 'kommende_aenderungen',
    description: 'Listet amtlich angekündigte, noch nicht in Kraft getretene Gesetzesänderungen (⏳) mit Wirkungsdatum (mWv) – alle Rechtsgebiete. Optional nach Begriff gefiltert.',
    inputSchema: {
      type: 'object',
      properties: {
        suchbegriff: { type: 'string', description: 'Optionaler Filter (z. B. "Umsatzsteuer", "BGB")' },
        limit: { type: 'integer', description: 'Maximal zurückgegebene Einträge (Standard 20)' },
      },
    },
  },
];

function mcpToolCall(name, args) {
  if (name === 'register_suchen') {
    const q = String(args?.suchbegriffe || '').trim();
    if (!q) return { error: 'suchbegriffe fehlt' };
    const topK = Math.max(1, Math.min(20, Number(args?.anzahl) || 8));
    const picked = retrieve(q, topK);
    if (!picked.length) return { text: 'Keine Fundstellen im Register. Andere Fachbegriffe oder §-Angaben versuchen.' };
    const lines = picked.map((p, i) => {
      const c = p.c;
      const meta = [c.topic, c.stand || c.date].filter(Boolean).join(' · ');
      return `[${i + 1}] ${c.title}${meta ? ` (${meta})` : ''}\n${c.url}\n${(c.text || '').replace(/\s+/g, ' ').slice(0, 700)}`;
    });
    return { text: `${picked.length} Fundstellen (amtliche Quellen):\n\n${lines.join('\n\n')}\n\nVolltext einer Quelle: quelle_lesen mit der URL aufrufen.` };
  }
  if (name === 'quelle_lesen') {
    const wanted = String(args?.url || '').trim();
    if (!wanted) return { error: 'url fehlt' };
    const parts = [];
    for (let i = 0; i < chunks.length; i++) {
      if (chunks[i].url === wanted) parts.push({ title: chunks[i].title, stand: chunks[i].stand || chunks[i].date || '', text: texts[i].toString('utf8') });
    }
    if (!parts.length) return { error: 'URL nicht im Register-Korpus. Exakte URL aus register_suchen verwenden.' };
    const full = parts.map((p) => p.text).join('\n');
    const PAGE = 24000;
    const teil = Math.max(1, Number(args?.teil) || 1);
    const start = (teil - 1) * PAGE;
    if (start >= full.length) return { error: `Quelle hat nur ${Math.ceil(full.length / PAGE)} Teil(e).` };
    const slice = full.slice(start, start + PAGE);
    const more = start + PAGE < full.length ? `\n\n[… gekürzt – weiter mit teil=${teil + 1} von ${Math.ceil(full.length / PAGE)}]` : '';
    return { text: `${parts[0].title}${parts[0].stand ? ` (${parts[0].stand})` : ''}\n${wanted}\n\n${slice}${more}` };
  }
  if (name === 'kommende_aenderungen') {
    const reg = loadRegister();
    const filter = String(args?.suchbegriff || '').toLowerCase();
    const limit = Math.max(1, Math.min(100, Number(args?.limit) || 20));
    const hits = (reg.entries || []).filter((e) => e.kind === 'kommend' &&
      (!filter || `${e.title} ${e.summary || ''}`.toLowerCase().includes(filter)));
    if (!hits.length) return { text: 'Keine angekündigten Änderungen zu diesem Filter im Register.' };
    const lines = hits.slice(0, limit).map((e) => `${e.title}${e.date ? ` – wirksam ab ${e.date}` : ''}\n${e.url}${e.summary ? `\n${e.summary}` : ''}`);
    return { text: `${hits.length} angekündigte Änderung(en)${filter ? ` zu „${args.suchbegriff}"` : ''} (amtliche Standangaben):\n\n${lines.join('\n\n')}` };
  }
  return { error: `Unbekanntes Tool: ${name}` };
}

function mcpHandle(msg) {
  if (!msg || typeof msg !== 'object' || msg.jsonrpc !== '2.0') {
    return { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request' } };
  }
  if (msg.id === undefined || msg.id === null) return null; // Notification → keine Antwort
  const reply = (result) => ({ jsonrpc: '2.0', id: msg.id, result });
  switch (msg.method) {
    case 'initialize': {
      const wanted = msg.params?.protocolVersion;
      return reply({
        protocolVersion: MCP_VERSIONS.includes(wanted) ? wanted : MCP_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'steuerregister', title: 'Steuern & Gesetze (amtliches Register)', version: '1.0.0' },
        instructions: 'Register mit allen deutschen Bundesgesetzen (paragrafengenau), BMF-Schreiben und BMJV-Inhalten. Für Steuer-/Rechtsfragen: IMMER zuerst register_suchen aufrufen, Antworten ausschließlich auf die Fundstellen stützen und jede Aussage mit dem amtlichen Link belegen. Details per quelle_lesen; angekündigte Gesetzesänderungen per kommende_aenderungen. Keine Rechts-/Steuerberatung – Quellenauskunft.',
      });
    }
    case 'ping': return reply({});
    case 'tools/list': return reply({ tools: MCP_TOOLS });
    case 'tools/call': {
      const r = mcpToolCall(msg.params?.name, msg.params?.arguments || {});
      return reply(r.error
        ? { content: [{ type: 'text', text: r.error }], isError: true }
        : { content: [{ type: 'text', text: r.text }], isError: false });
    }
    case 'resources/list': return reply({ resources: [] });
    case 'prompts/list': return reply({ prompts: [] });
    default:
      return { jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: `Method not found: ${msg.method}` } };
  }
}

// ---------- HTTP-Server ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8' };
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function send(res, code, body, headers = {}) {
  res.writeHead(code, { ...cors, ...headers });
  res.end(body);
}
const sendJson = (res, code, obj) => send(res, code, JSON.stringify(obj), { 'Content-Type': 'application/json; charset=utf-8' });

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (req.method === 'OPTIONS') return send(res, 204, '');

  // MCP-Endpoint: /mcp (Code im x-ki-code-Header) oder /mcp/<code> (Code im Pfad)
  const mcpMatch = /^\/mcp(?:\/([^/]+))?$/.exec(url.pathname);
  if (mcpMatch) {
    if (cfg.KI_ACCESS_CODE) {
      const given = mcpMatch[1] || req.headers['x-ki-code'] || '';
      if (given !== cfg.KI_ACCESS_CODE) return sendJson(res, 401, { error: 'ACCESS_CODE_REQUIRED' });
    }
    if (req.method !== 'POST') return send(res, 405, 'Method not allowed', { Allow: 'POST' });
    let body = '';
    req.on('data', (d) => { body += d; if (body.length > 200000) req.destroy(); });
    req.on('end', () => {
      try {
        const parsed = JSON.parse(body || '{}');
        const out = Array.isArray(parsed)
          ? parsed.map(mcpHandle).filter(Boolean)
          : mcpHandle(parsed);
        if (out === null || (Array.isArray(out) && out.length === 0)) return send(res, 202, '');
        return sendJson(res, 200, out);
      } catch {
        return sendJson(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
      }
    });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/health') {
    return sendJson(res, 200, { ok: true, provider: cfg.PROVIDER, chunks: chunks.length, scope: CORPUS_SCOPE });
  }

  if (req.method === 'POST' && url.pathname === '/api/ask') {
    // Zugangscode-Gate (öffentlich erreichbarer Dienst): schützt das
    // Provider-Kontingent. Register/WebApp bleiben offen (amtliche Daten).
    if (cfg.KI_ACCESS_CODE && req.headers['x-ki-code'] !== cfg.KI_ACCESS_CODE) {
      return sendJson(res, 401, { error: 'ACCESS_CODE_REQUIRED' });
    }
    let body = '';
    req.on('data', (d) => { body += d; if (body.length > 100000) req.destroy(); });
    req.on('end', async () => {
      try {
        const { question } = JSON.parse(body || '{}');
        if (!question || typeof question !== 'string' || !question.trim()) {
          return sendJson(res, 400, { error: 'Feld "question" fehlt.' });
        }
        const picked = retrieve(question.trim());
        // Fail-closed: ohne brauchbare Fundstellen wird gar nicht erst formuliert.
        if (picked.length === 0 || picked[0].score < 2.0) {
          return sendJson(res, 200, {
            answer: 'Dazu enthält das Register keine ausreichende Quelle. Bitte formuliere die Frage anders oder ergänze die passende amtliche Quelle im Register.',
            sources: [], provider: cfg.PROVIDER, verified: true,
          });
        }
        const prompt = buildPrompt(question.trim(), picked);
        const raw = await providers[cfg.PROVIDER](cfg, prompt);
        const { cleaned, verified } = verifyAnswer(raw, picked);
        // Quellen-Links kommen aus dem Register (Server-Wahrheit), nie vom Modell:
        const sources = picked.map((p, i) => ({
          n: i + 1, title: p.c.title, url: p.c.url, amtlich: !!p.c.amtlich,
          stand: p.c.stand || p.c.date || '',
        }));
        // Nur Quellen ausweisen, die die Antwort tatsächlich zitiert (Rest weglassen);
        // zitiert das Modell gar nicht, alle Fundstellen zeigen (Transparenz).
        const cited = new Set([...cleaned.matchAll(/\[(\d{1,2})\]/g)].map((m) => Number(m[1])));
        const usedSources = cited.size ? sources.filter((s) => cited.has(s.n)) : sources;
        sendJson(res, 200, { answer: cleaned, sources: usedSources, provider: cfg.PROVIDER, verified });
      } catch (e) {
        sendJson(res, 502, { error: String(e && e.message || e) });
      }
    });
    return;
  }

  // Statische Auslieferung der WebApp + Registerdaten
  if (req.method === 'GET') {
    let p = url.pathname === '/' ? '/webapp/index.html' : url.pathname;
    if (p === '/index.html') p = '/webapp/index.html';
    if (p === '/data/register.js' || p === '/webapp/index.html' || p === '/data/register.json' || p === '/data/normen-register.js') {
      const file = path.join(ROOT, p);
      if (fs.existsSync(file)) {
        return send(res, 200, fs.readFileSync(file), { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      }
    }
    return send(res, 404, 'Not found');
  }
  send(res, 405, 'Method not allowed');
});

if (!process.env.KI_NO_LISTEN) {
  server.listen(Number(cfg.PORT), cfg.HOST, () => {
    console.log(`Steuerberater KI läuft: http://${cfg.HOST}:${cfg.PORT}  (Provider: ${cfg.PROVIDER}, ${chunks.length} Korpus-Chunks, Scope: ${CORPUS_SCOPE})`);
  });
}

// Für Tests (KI_NO_LISTEN=1): Kernfunktionen prüfbar machen, ohne Port zu öffnen.
export { retrieve, buildPrompt, verifyAnswer };
