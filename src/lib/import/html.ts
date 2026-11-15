import type { ParsedBook, ParsedChapter } from '../types';
import { decodeText } from './txt';

/** Делит HTML на главы по заголовкам h1/h2 (если их нет — по h3). */
export function chaptersFromHtml(html: string, fallbackTitle: string): ParsedChapter[] {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const body = doc.body;
  body.querySelectorAll('script, style, nav, header, footer, form, noscript, iframe').forEach((e) => e.remove());
  const root = body.querySelector('article, main') ?? body;
  // Поднимаем содержимое обёрток, чтобы заголовки оказались на верхнем уровне.
  let container: Element = root;
  while (container.children.length === 1 && /^(DIV|SECTION|ARTICLE|MAIN)$/.test(container.children[0]!.tagName)) {
    container = container.children[0]!;
  }
  const tags = container.querySelector(':scope > h1, :scope > h2') ? ['H1', 'H2'] : ['H3'];
  const out: ParsedChapter[] = [];
  let cur: ParsedChapter = { title: fallbackTitle, level: 0, html: '' };
  const hasH1 = container.querySelectorAll(':scope > h1').length > 1;
  for (const node of [...container.childNodes]) {
    const el = node.nodeType === 1 ? (node as Element) : null;
    if (el && tags.includes(el.tagName)) {
      if (cur.html.replace(/<[^>]+>/g, '').trim().length > 0 || out.length > 0) out.push(cur);
      cur = {
        title: (el.textContent ?? '').replace(/\s+/g, ' ').trim() || `Раздел ${out.length + 1}`,
        level: hasH1 && el.tagName === 'H2' ? 1 : 0,
        html: '',
      };
    } else if (el) cur.html += el.outerHTML;
    else if (node.nodeType === 3 && node.nodeValue?.trim()) cur.html += `<p>${node.nodeValue}</p>`;
  }
  out.push(cur);
  return out.filter((c, i) => i > 0 || c.html.replace(/<[^>]+>/g, '').trim().length > 0 || out.length === 1);
}

export async function parseHtml(bytes: Uint8Array, fallbackTitle: string, author: string): Promise<ParsedBook> {
  const { text } = await decodeText(bytes);
  const doc = new DOMParser().parseFromString(text, 'text/html');
  const title = (doc.querySelector('meta[property="og:title"]')?.getAttribute('content') ?? doc.title ?? '').trim() || fallbackTitle;
  const metaAuthor = doc.querySelector('meta[name="author"]')?.getAttribute('content')?.trim();
  return { kind: 'text', title, author: metaAuthor || author, sourceLabel: 'HTML', chapters: chaptersFromHtml(text, title) };
}

export async function parseDocx(buf: ArrayBuffer, title: string, author: string): Promise<ParsedBook> {
  const mammoth = await import('mammoth');
  const convert = mammoth.convertToHtml ?? (mammoth as unknown as { default: typeof mammoth }).default.convertToHtml;
  const { value } = await convert({ arrayBuffer: buf });
  return { kind: 'text', title, author, sourceLabel: 'DOCX', chapters: chaptersFromHtml(value, title) };
}

export async function parseOdt(buf: ArrayBuffer, title: string, author: string): Promise<ParsedBook> {
  const { default: JSZip } = await import('jszip');
  const zip = await JSZip.loadAsync(buf);
  const raw = await zip.file('content.xml')?.async('string');
  if (!raw) throw new Error('Файл ODT повреждён: нет content.xml.');
  const doc = new DOMParser().parseFromString(raw, 'application/xml');
  const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  let html = '';
  for (const el of [...doc.getElementsByTagName('*')]) {
    if (el.localName === 'h') {
      const lvl = Math.min(3, Number(el.getAttribute('text:outline-level') ?? 1));
      html += `<h${lvl}>${esc(el.textContent ?? '')}</h${lvl}>`;
    } else if (el.localName === 'p' && !el.parentElement?.closest('p, h')) {
      const t = el.textContent ?? '';
      if (t.trim()) html += `<p>${esc(t)}</p>`;
    }
  }
  return { kind: 'text', title, author, sourceLabel: 'ODT', chapters: chaptersFromHtml(html, title) };
}
