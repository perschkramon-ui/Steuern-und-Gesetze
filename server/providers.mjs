/**
 * KI-Provider für den Steuerberater-KI-Server – bewusst austauschbar.
 *
 * Jeder Provider bekommt einen fertigen, quellengebundenen Prompt und gibt
 * NUR Text zurück. Die Quellen-Links hängt der Server selbst an (das Modell
 * darf keine URLs erfinden – Verifikation in server.mjs).
 */

async function post(url, headers, body, timeoutMs = 60000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: ctl.signal,
    });
    const text = await res.text();
    if (!res.ok) {
      let msg = text.slice(0, 400);
      try { msg = JSON.parse(text).error?.message || msg; } catch { /* raw */ }
      throw new Error(`Provider HTTP ${res.status}: ${msg}`);
    }
    return JSON.parse(text);
  } finally { clearTimeout(t); }
}

export const providers = {
  async gemini(cfg, prompt) {
    if (!cfg.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY fehlt in server/.env.local');
    // Genauigkeits-Default: gemini-2.5-pro (stärkeres Reasoning als -flash) für
    // eine Rechts-KI. Override per GEMINI_MODEL. maxOutputTokens großzügig, weil
    // 2.5-pro adaptives „Thinking" mitlaufen lässt, das gegen das Limit zählt –
    // bei knappem Budget käme sonst eine leere Antwort (finishReason MAX_TOKENS).
    const model = cfg.GEMINI_MODEL || 'gemini-2.5-pro';
    const j = await post(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      { 'x-goog-api-key': cfg.GEMINI_API_KEY },
      {
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 8192 },
      },
    );
    const parts = j.candidates?.[0]?.content?.parts || [];
    const text = parts.map((p) => p.text || '').join('').trim();
    if (!text) throw new Error(`Gemini lieferte keine Antwort (finishReason: ${j.candidates?.[0]?.finishReason || 'unbekannt'})`);
    return text;
  },

  async claude(cfg, prompt) {
    if (!cfg.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY fehlt in server/.env.local');
    const model = cfg.CLAUDE_MODEL || 'claude-opus-4-8';
    // KEIN temperature/top_p: aktuelle Claude-Modelle (Opus 4.7+/Sonnet 5)
    // lehnen Sampling-Parameter mit 400 ab. max_tokens großzügig: bei
    // Sonnet 5 läuft adaptives Thinking mit und zählt gegen das Limit.
    const j = await post(
      'https://api.anthropic.com/v1/messages',
      { 'x-api-key': cfg.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      { model, max_tokens: 8000, messages: [{ role: 'user', content: prompt }] },
    );
    if (j.stop_reason === 'refusal') throw new Error('Claude hat die Anfrage abgelehnt (Sicherheitsfilter)');
    const text = (j.content || []).filter((b) => b.type === 'text').map((b) => b.text || '').join('').trim();
    if (!text) throw new Error('Claude lieferte keine Antwort');
    return text;
  },

  // Deterministischer Test-Provider ohne API-Schlüssel (für Tests/Demo):
  // beantwortet mit dem wörtlichen Anfang der besten Quelle.
  async mock(cfg, prompt) {
    const m = /\[1\]\s+([^\n]+)\n([\s\S]{0,400})/.exec(prompt.split('QUELLEN:')[1] || '');
    if (!m) return 'Dazu enthält das Register keine ausreichende Quelle.';
    return `Laut [1] (${m[1].split('—')[0].trim()}): ${m[2].replace(/\s+/g, ' ').slice(0, 260).trim()}…`;
  },
};
