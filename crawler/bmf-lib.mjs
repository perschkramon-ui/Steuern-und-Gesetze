/**
 * Gemeinsame Logik der BMF-Crawler (Scope-Regeln, URL-Normalisierung,
 * HTML-Extraktion) – genutzt von crawl-bmf.mjs (roher HTTP-Crawl) und
 * crawl-bmf-browser.mjs (Playwright/Chromium, wenn der Bot-Schutz greift).
 */

export const HOST = 'www.bundesfinanzministerium.de';

// Disallow-Pfade der robots.txt (User-agent: *)
const ROBOTS_DISALLOW = [/\/SiteGlobals\//i, /\/SharedDocs\/ExterneLinks\//i, /\/Content\/FR\//i, /\/Web\/FR\//i];

export function classify(u) {
  let url;
  try { url = new URL(u); } catch { return null; }
  if (url.hostname !== HOST) return null;
  const p = url.pathname;
  if (ROBOTS_DISALLOW.some((re) => re.test(p))) return null;
  // Video-/Bilderstrecken-Seiten: kein Registerinhalt und empirisch die
  // aggressivsten Bot-Schutz-Auslöser → gar nicht erst anfragen.
  if (/\/Content\/DE\/(Video|Bilderstrecken)\//i.test(p)) return null;
  if (/\.pdf$/i.test(p)) return 'pdf';
  if (!/\.html?$/i.test(p) && !p.endsWith('/')) return null;
  if (/^\/Web\/DE\/Themen\/Steuern\//i.test(p)) return 'steuern';
  if (/BMF[-_]?Schreiben/i.test(p) && /^\/Web\/DE\//i.test(p)) return 'steuern';
  if (/^\/Content\/DE\//i.test(p)) return 'content';
  return null;
}

export function normalize(u, base) {
  let url;
  try { url = new URL(u, base); } catch { return null; }
  url.hash = '';
  if (/\.pdf$/i.test(url.pathname)) {
    // __blob/v gehören zur kanonischen Download-URL – behalten
    const keep = new URLSearchParams();
    for (const [k, v] of url.searchParams) if (/^(__blob|v)$/i.test(k)) keep.set(k, v);
    url.search = keep.toString() ? `?${keep.toString()}` : '';
  } else {
    // HTML: nur Paginierungs-Parameter behalten (gtp), Rest ist Navigation/Tracking.
    // Keine Parameter, die selbst URLs tragen (rekursives Wachstum → HTTP 414).
    const keep = new URLSearchParams();
    for (const [k, v] of url.searchParams) {
      if (/gtp|page/i.test(k) && v.length <= 40 && !/https?%3a|https?:/i.test(v)) keep.set(k, v);
    }
    url.search = keep.toString() ? `?${keep.toString()}` : '';
  }
  return url.toString();
}

// ---------- HTML-Extraktion (regex-basiert, dependency-frei) ----------
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', szlig: 'ß', auml: 'ä', ouml: 'ö', uuml: 'ü', Auml: 'Ä', Ouml: 'Ö', Uuml: 'Ü', sect: '§', euro: '€', ndash: '–', mdash: '—', hellip: '…', bdquo: '„', ldquo: '“', rdquo: '”', rsquo: '’', shy: '', zwnj: '', copy: '©' };
export function decodeEntities(s) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-zA-Z]+);/g, (m, name) => (name in ENTITIES ? ENTITIES[name] : m));
}
export function stripTags(html) {
  return decodeEntities(
    html
      .replace(/<(script|style|noscript|svg|iframe)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<(header|footer|nav|aside|form)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<br\s*\/?>(?=.)/gi, '\n')
      .replace(/<\/(p|div|li|h[1-6]|tr|table|section|article)>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
  )
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n+ */g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}
export function pick(re, s) { const m = re.exec(s); return m ? decodeEntities(m[1]).replace(/\s+/g, ' ').trim() : ''; }

export function extract(html, url) {
  const title = pick(/<title[^>]*>([\s\S]*?)<\/title>/i, html);
  const h1 = pick(/<h1[^>]*>([\s\S]*?)<\/h1>/i, html.replace(/<[^>]+>/g, (t) => (/^<\/?h1/i.test(t) ? t : ' ')));
  const description = pick(/<meta\s+name="description"\s+content="([^"]*)"/i, html) ||
    pick(/<meta\s+content="([^"]*)"\s+name="description"/i, html);
  const date = pick(/<meta\s+name="(?:dcterms\.modified|dcterms\.issued|date)"\s+content="([^"]*)"/i, html) ||
    pick(/datetime="([^"]+)"/i, html) ||
    pick(/\b(\d{1,2}\.\d{1,2}\.\d{4})\b/, html.slice(0, 20000));
  let main = html;
  const mainMatch = /<main[\s>][\s\S]*?<\/main>/i.exec(html);
  if (mainMatch) main = mainMatch[0];
  const text = stripTags(main).slice(0, 120000);
  // <base href> respektieren – BMF-Seiten nutzen es, sonst entstehen kaputte relative URLs
  const baseHref = pick(/<base\s+href="([^"]+)"/i, html) || url;
  const links = [];
  const re = /href="([^"#][^"]*)"/gi;
  let m;
  while ((m = re.exec(html)) !== null) links.push(m[1]);
  return { title, h1, description, date, text, links, baseHref };
}
