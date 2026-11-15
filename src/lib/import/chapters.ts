/** Автоопределение глав по заголовкам в «плоском» тексте (TXT, RTF, PDF без оглавления). */

const KEYWORD =
  /^(глава|часть|книга|том|раздел|пролог|эпилог|предисловие|введение|вступление|заключение|послесловие|от автора|chapter|part|book|prologue|epilogue|introduction|preface|foreword|afterword)(?![a-zа-яё])/i;
const ROMAN = /^[IVXLCDM]{1,7}\.?$/;
const NUMBERED = /^\d{1,3}[.)]?(\s+\S.{0,70})?$/;
const PART = /^(часть|книга|том|part|book)(?![a-zа-яё])/i;

export interface FlatHeading { line: number; title: string; level: number }

export function isHeadingLine(line: string, prevBlank: boolean, nextBlank: boolean): boolean {
  const s = line.trim();
  if (!s || s.length > 90) return false;
  if (/[,;:]$/.test(s)) return false;
  if (KEYWORD.test(s)) return prevBlank || nextBlank;
  if (!(prevBlank && nextBlank)) return false;
  if (ROMAN.test(s)) return true;
  if (NUMBERED.test(s) && !/[.!?…]$/.test(s.replace(/^\d{1,3}[.)]?/, ''))) return true;
  // ЗАГОЛОВОК ПРОПИСНЫМИ
  return s.length >= 3 && s.length <= 60 && s === s.toUpperCase() && /[A-ZА-ЯЁ]{3}/.test(s) && !/[.!?…]$/.test(s);
}

export function detectHeadings(lines: string[]): FlatHeading[] {
  const out: FlatHeading[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const prevBlank = i === 0 || !lines[i - 1]!.trim();
    const nextBlank = i === lines.length - 1 || !lines[i + 1]!.trim();
    if (isHeadingLine(lines[i]!, prevBlank, nextBlank)) {
      out.push({ line: i, title: lines[i]!.trim(), level: 1 });
    }
  }
  // Если есть и «Части», и «Главы» — части становятся верхним уровнем.
  const hasParts = out.some((h) => PART.test(h.title));
  const hasOther = out.some((h) => !PART.test(h.title));
  if (hasParts && hasOther) for (const h of out) h.level = PART.test(h.title) ? 0 : 1;
  else for (const h of out) h.level = 0;
  return out;
}

export interface FlatChapter { title: string; level: number; paragraphs: string[]; auto: boolean }

const AUTO_PART = 20_000;

/** Делит текст на главы по найденным заголовкам; без заголовков — на равные части по ~20 тыс. символов. */
export function splitIntoChapters(text: string, fallbackTitle: string): FlatChapter[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const headings = detectHeadings(lines);
  const usable = headings.length >= 2 || (headings.length === 1 && headings[0]!.line < 40);

  if (!usable) {
    const paragraphs = toParagraphs(lines);
    const total = paragraphs.reduce((s, p) => s + p.length, 0);
    if (total <= AUTO_PART * 1.5) return [{ title: fallbackTitle, level: 0, paragraphs, auto: true }];
    const out: FlatChapter[] = [];
    let cur: string[] = [];
    let len = 0;
    for (const p of paragraphs) {
      cur.push(p);
      len += p.length;
      if (len >= AUTO_PART) {
        out.push({ title: `Часть ${out.length + 1}`, level: 0, paragraphs: cur, auto: true });
        cur = [];
        len = 0;
      }
    }
    if (cur.length) out.push({ title: `Часть ${out.length + 1}`, level: 0, paragraphs: cur, auto: true });
    return out;
  }

  const out: FlatChapter[] = [];
  const first = headings[0]!;
  if (first.line > 0) {
    const pre = toParagraphs(lines.slice(0, first.line));
    if (pre.join('').length > 200) out.push({ title: fallbackTitle, level: 0, paragraphs: pre, auto: false });
  }
  const headingLines = new Set(headings.map((h) => h.line));
  headings.forEach((h, i) => {
    const end = headings[i + 1]?.line ?? lines.length;
    let title = h.title;
    let from = h.line + 1;
    // «Глава 1» + следующая короткая строка-название
    const next = lines[from]?.trim() ?? '';
    const afterBlank = !next ? lines[from + 1]?.trim() ?? '' : next;
    const candidateLine = !next ? from + 1 : from;
    if (
      /^(глава|часть|chapter|part)\s+\S+\.?$/i.test(title) && afterBlank && afterBlank.length <= 70 &&
      !/[.!?…,;:]$/.test(afterBlank) && !(lines[candidateLine + 1] ?? '').trim() && candidateLine < end && !headingLines.has(candidateLine)
    ) {
      title = `${title.replace(/\.$/, '')}. ${afterBlank}`;
      from = candidateLine + 1;
    }
    out.push({ title, level: h.level, paragraphs: toParagraphs(lines.slice(from, end)), auto: false });
  });
  return out;
}

/** Абзацы: разделены пустой строкой либо каждая строка — абзац (если строки длинные / с красной строки). */
export function toParagraphs(lines: string[]): string[] {
  const nonEmpty = lines.filter((l) => l.trim());
  if (!nonEmpty.length) return [];
  const blank = lines.length - nonEmpty.length;
  const avg = nonEmpty.reduce((s, l) => s + l.length, 0) / nonEmpty.length;
  const hardWrapped = avg < 90 && blank > 0 && blank < nonEmpty.length / 2;
  if (!hardWrapped) return nonEmpty.map((l) => l.trim());
  const out: string[] = [];
  let cur: string[] = [];
  for (const l of lines) {
    if (!l.trim()) {
      if (cur.length) out.push(joinWrapped(cur));
      cur = [];
    } else if (/^\s{2,}\S/.test(l) && cur.length) {
      out.push(joinWrapped(cur));
      cur = [l.trim()];
    } else cur.push(l.trim());
  }
  if (cur.length) out.push(joinWrapped(cur));
  return out;
}

/** Склеивает строки абзаца, убирая переносы по дефису. */
export function joinWrapped(lines: string[]): string {
  return lines.reduce((acc, l) => {
    if (!acc) return l;
    if (/[a-zа-яё]-$/i.test(acc) && /^[a-zа-яё]/.test(l)) return acc.slice(0, -1) + l;
    return `${acc} ${l}`;
  }, '');
}

export const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const paragraphsToHtml = (ps: string[]): string => ps.map((p) => `<p>${escapeHtml(p)}</p>`).join('\n');
