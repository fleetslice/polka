/** Полнотекстовый поиск BM25 по фрагментам книг и заметкам. Работает локально, без сервера. */

const ENDINGS = /(иями|ями|ами|ого|его|ому|ему|ыми|ими|ией|ий|ый|ой|ая|яя|ое|ее|ые|ие|ов|ев|ей|ам|ям|ах|ях|ом|ем|ую|юю|ing|ed|es|ly|а|я|о|е|ы|и|у|ю|ь|s)$/;

/** Грубый стеммер: срезает окончание, оставляя основу не короче 3 букв. */
export function stem(word: string): string {
  const w = word.toLowerCase().replace(/ё/g, 'е');
  if (w.length <= 4) return w;
  const cut = w.replace(ENDINGS, '');
  return cut.length >= 3 ? cut : w;
}

export function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-zа-яё0-9]+/gi) ?? []).filter((t) => t.length > 1).map(stem);
}

export interface SearchDoc<T> { tokens: string[]; ref: T }
export interface SearchIndex<T> { docs: SearchDoc<T>[]; df: Map<string, number>; avgLen: number }

export function buildIndex<T>(items: { text: string; ref: T }[]): SearchIndex<T> {
  const docs = items.map((i) => ({ tokens: tokenize(i.text), ref: i.ref }));
  const df = new Map<string, number>();
  for (const d of docs) for (const t of new Set(d.tokens)) df.set(t, (df.get(t) ?? 0) + 1);
  const avgLen = docs.reduce((s, d) => s + d.tokens.length, 0) / Math.max(1, docs.length);
  return { docs, df, avgLen };
}

export function searchIndex<T>(index: SearchIndex<T>, query: string, limit = 8): { ref: T; score: number }[] {
  const q = [...new Set(tokenize(query))];
  if (q.length === 0) return [];
  const N = index.docs.length;
  const k1 = 1.4;
  const b = 0.75;
  const out: { ref: T; score: number }[] = [];
  for (const d of index.docs) {
    let score = 0;
    for (const term of q) {
      let tf = 0;
      for (const t of d.tokens) if (t === term) tf += 1;
      if (!tf) continue;
      const n = index.df.get(term) ?? 0;
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
      score += (idf * tf * (k1 + 1)) / (tf + k1 * (1 - b + (b * d.tokens.length) / (index.avgLen || 1)));
    }
    if (score > 0) out.push({ ref: d.ref, score });
  }
  return out.sort((a, b2) => b2.score - a.score).slice(0, limit);
}

/** Режет текст главы на фрагменты ~800 токенов (≈3200 символов) по границам абзацев и предложений. */
export function chunkText(text: string, size = 3200): { start: number; text: string }[] {
  const out: { start: number; text: string }[] = [];
  let pos = 0;
  while (pos < text.length) {
    let end = Math.min(text.length, pos + size);
    if (end < text.length) {
      const window = text.slice(pos, end);
      const cut = Math.max(window.lastIndexOf('\n'), window.lastIndexOf('. '), window.lastIndexOf('! '), window.lastIndexOf('? '));
      if (cut > size * 0.5) end = pos + cut + 1;
    }
    const piece = text.slice(pos, end);
    if (piece.trim()) out.push({ start: pos, text: piece });
    pos = end;
  }
  return out;
}

/** Фрагмент вокруг первого совпадения — для выдачи поиска. */
export function snippet(text: string, query: string, radius = 90): string {
  const terms = tokenize(query);
  const lower = text.toLowerCase().replace(/ё/g, 'е');
  let at = -1;
  for (const t of terms) {
    at = lower.indexOf(t);
    if (at >= 0) break;
  }
  if (at < 0) return text.slice(0, radius * 2).trim();
  const from = Math.max(0, at - radius);
  const to = Math.min(text.length, at + radius);
  return `${from > 0 ? '…' : ''}${text.slice(from, to).replace(/\s+/g, ' ').trim()}${to < text.length ? '…' : ''}`;
}
