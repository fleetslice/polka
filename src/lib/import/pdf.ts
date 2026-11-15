import type { ParsedBook, ParsedChapter } from '../types';
import { detectHeadings, escapeHtml, joinWrapped } from './chapters';

type PdfJs = typeof import('pdfjs-dist');
let lib: Promise<PdfJs> | null = null;

export function loadPdfJs(): Promise<PdfJs> {
  lib ??= import('pdfjs-dist').then((m) => {
    m.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
    return m;
  });
  return lib;
}

interface Line { y: number; x: number; text: string; h: number; end: number }

/** Собирает элементы текстового слоя страницы в строки (по координате Y). */
export function itemsToLines(items: { str: string; transform: number[]; height: number; width?: number }[]): Line[] {
  const lines: Line[] = [];
  for (const it of items) {
    if (!it.str) continue;
    const y = it.transform[5] ?? 0;
    const x = it.transform[4] ?? 0;
    const h = it.height || Math.abs(it.transform[3] ?? 10) || 10;
    const last = lines[lines.length - 1];
    const end = x + (it.width ?? 0);
    if (last && Math.abs(last.y - y) < h * 0.5) {
      // Слова часто идут отдельными элементами без пробелов: заметный зазор между ними — это пробел.
      const gap = x - last.end;
      const needSpace = gap > h * 0.15 && !/\s$/.test(last.text) && !/^\s/.test(it.str);
      last.text += (needSpace ? ' ' : '') + it.str;
      last.end = Math.max(last.end, end);
    } else lines.push({ y, x, text: it.str, h, end });
  }
  return lines.map((l) => ({ ...l, text: l.text.replace(/\s+/g, ' ').trim() })).filter((l) => l.text);
}

/** Строки страницы → абзацы: новый абзац при увеличенном интервале или красной строке. */
export function linesToParagraphs(lines: Line[]): string[] {
  if (!lines.length) return [];
  const minX = Math.min(...lines.map((l) => l.x));
  const out: string[] = [];
  let cur: string[] = [];
  lines.forEach((l, i) => {
    const prev = lines[i - 1];
    const gap = prev ? Math.abs(prev.y - l.y) : 0;
    const newPara = !prev || gap > prev.h * 1.9 || (l.x - minX > 6 && l.x - minX < 80 && /[.!?…:»"”]$/.test(prev.text));
    if (newPara && cur.length) {
      out.push(joinWrapped(cur));
      cur = [];
    }
    cur.push(l.text);
  });
  if (cur.length) out.push(joinWrapped(cur));
  return out;
}

interface OutlineNode { title: string; dest: unknown; items?: OutlineNode[] }

export async function parsePdf(
  buf: ArrayBuffer,
  fallbackTitle: string,
  fallbackAuthor: string,
  onProgress?: (done: number, total: number) => void,
): Promise<ParsedBook> {
  const pdfjs = await loadPdfJs();
  let pdf;
  try {
    pdf = await pdfjs.getDocument({ data: new Uint8Array(buf.slice(0)) }).promise;
  } catch (e) {
    const name = (e as { name?: string }).name;
    throw new Error(name === 'PasswordException' ? 'PDF закрыт паролем — сними защиту и загрузи снова.' : 'Файл PDF повреждён и не открывается.');
  }
  const total = pdf.numPages;
  const info = (await pdf.getMetadata().catch(() => null))?.info as { Title?: string; Author?: string } | undefined;
  const title = info?.Title?.trim() && info.Title.trim().length > 2 ? info.Title.trim() : fallbackTitle;
  const author = info?.Author?.trim() || fallbackAuthor;

  const pages: string[][] = [];
  let chars = 0;
  for (let n = 1; n <= total; n += 1) {
    const page = await pdf.getPage(n);
    const content = await page.getTextContent();
    const items = content.items.filter((i): i is typeof i & { str: string } => 'str' in i) as unknown as { str: string; transform: number[]; height: number; width: number }[];
    const paragraphs = linesToParagraphs(itemsToLines(items));
    chars += paragraphs.reduce((s, p) => s + p.length, 0);
    pages.push(paragraphs);
    page.cleanup();
    onProgress?.(n, total);
  }

  let cover: Blob | undefined;
  try {
    const page = await pdf.getPage(1);
    const viewport = page.getViewport({ scale: 1 });
    const scale = 360 / viewport.width;
    const vp = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(vp.width);
    canvas.height = Math.ceil(vp.height);
    const ctx = canvas.getContext('2d');
    if (ctx) {
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      cover = await new Promise<Blob | undefined>((res) => canvas.toBlob((b) => res(b ?? undefined), 'image/jpeg', 0.8));
    }
  } catch {
    /* обложка необязательна */
  }

  // Оглавление PDF (outline) → номера страниц.
  const marks: { title: string; level: number; page: number }[] = [];
  try {
    const outline = (await pdf.getOutline()) as OutlineNode[] | null;
    const walk = async (nodes: OutlineNode[], level: number): Promise<void> => {
      for (const node of nodes) {
        let dest = node.dest;
        if (typeof dest === 'string') dest = await pdf.getDestination(dest);
        if (Array.isArray(dest) && dest[0]) {
          const idx = await pdf.getPageIndex(dest[0] as Parameters<typeof pdf.getPageIndex>[0]).catch(() => -1);
          if (idx >= 0) marks.push({ title: node.title.replace(/\s+/g, ' ').trim(), level, page: idx + 1 });
        }
        if (node.items?.length && level < 1) await walk(node.items, level + 1);
      }
    };
    if (outline) await walk(outline, 0);
  } catch {
    /* без оглавления — эвристики ниже */
  }
  marks.sort((a, b) => a.page - b.page);

  // Мало текста — это скан: постраничный режим, текст появится после OCR.
  if (chars / Math.max(1, total) < 40) {
    const chapters: ParsedChapter[] = (marks.length ? marks : [{ title, level: 0, page: 1 }]).map((m, i, arr) => ({
      title: m.title, level: m.level, html: '', startPage: m.page, endPage: (arr[i + 1]?.page ?? total + 1) - 1,
    }));
    await pdf.destroy();
    return { kind: 'pages', title, author, cover, pages: total, sourceLabel: 'PDF · СКАН', chapters };
  }

  const pageHtml = (n: number): string =>
    `<span class="pg" data-page="${n}"></span>` + (pages[n - 1] ?? []).map((p) => `<p>${escapeHtml(p)}</p>`).join('\n');

  let chapters: ParsedChapter[] = [];
  if (marks.length >= 2) {
    if (marks[0]!.page > 1) marks.unshift({ title: 'Начало', level: 0, page: 1 });
    // Несколько пунктов оглавления на одной странице — оставляем первый.
    const uniq = marks.filter((m, i) => i === 0 || m.page !== marks[i - 1]!.page);
    chapters = uniq.map((m, i) => {
      const end = (uniq[i + 1]?.page ?? total + 1) - 1;
      let html = '';
      for (let n = m.page; n <= end; n += 1) html += pageHtml(n);
      return { title: m.title, level: m.level, html, startPage: m.page, endPage: end };
    });
  } else {
    // Заголовки ищем эвристиками по строкам: каждая страница — блок, абзацы разделены пустой строкой.
    const flat: { text: string; page: number }[] = [];
    pages.forEach((ps, i) => ps.forEach((p) => {
      flat.push({ text: p, page: i + 1 }, { text: '', page: i + 1 });
    }));
    const headings = detectHeadings(flat.map((f) => f.text));
    // Заголовкам верим, только если главы получаются похожими на главы (в среднем от 1500 символов).
    if (headings.length >= 2 && chars / headings.length >= 1500) {
      const bounds = [...(headings[0]!.line > 0 ? [{ line: 0, title: 'Начало', level: 0, synthetic: true }] : []), ...headings.map((h) => ({ ...h, synthetic: false }))];
      chapters = bounds.map((h, i) => {
        const endLine = bounds[i + 1]?.line ?? flat.length;
        let html = '';
        let lastPage = 0;
        for (let l = h.synthetic ? h.line : h.line + 1; l < endLine; l += 1) {
          const f = flat[l]!;
          if (!f.text) continue;
          if (f.page !== lastPage) {
            html += `<span class="pg" data-page="${f.page}"></span>`;
            lastPage = f.page;
          }
          html += `<p>${escapeHtml(f.text)}</p>\n`;
        }
        return { title: h.title, level: h.level, html, startPage: flat[h.line]?.page ?? 1, endPage: flat[endLine - 1]?.page ?? total };
      });
    } else {
      const step = Math.max(10, Math.ceil(total / Math.max(1, Math.round(total / 20))));
      for (let from = 1; from <= total; from += step) {
        const to = Math.min(total, from + step - 1);
        let html = '';
        for (let n = from; n <= to; n += 1) html += pageHtml(n);
        chapters.push({ title: total <= step ? title : `Стр. ${from}–${to}`, level: 0, html, startPage: from, endPage: to });
      }
    }
  }
  await pdf.destroy();
  return { kind: 'text', title, author, cover, pages: total, sourceLabel: 'PDF → ТЕКСТОВЫЙ СЛОЙ', chapters };
}
