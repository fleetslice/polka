import type { ParsedBook, ParsedChapter } from '../types';
import { escapeHtml } from './chapters';
import { decodeText } from './txt';

const text = (el: Element | null | undefined): string => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const kids = (el: Element, name?: string): Element[] =>
  [...el.children].filter((c) => !name || c.localName === name);
const hrefOf = (el: Element): string =>
  el.getAttribute('l:href') ?? el.getAttribute('xlink:href') ?? el.getAttribute('href') ?? '';

function inline(node: Node, images: Map<string, string>): string {
  if (node.nodeType === 3) return escapeHtml(node.nodeValue ?? '');
  if (node.nodeType !== 1) return '';
  const el = node as Element;
  const inner = (): string => [...el.childNodes].map((n) => inline(n, images)).join('');
  switch (el.localName) {
    case 'emphasis': return `<em>${inner()}</em>`;
    case 'strong': return `<strong>${inner()}</strong>`;
    case 'strikethrough': return `<s>${inner()}</s>`;
    case 'sub': return `<sub>${inner()}</sub>`;
    case 'sup': return `<sup>${inner()}</sup>`;
    case 'code': return `<code>${inner()}</code>`;
    case 'a': {
      const href = hrefOf(el);
      if (href.startsWith('#')) return `<a href="${escapeHtml(href)}" class="noteref">${inner()}</a>`;
      return `<a href="${escapeHtml(href)}">${inner()}</a>`;
    }
    case 'image': {
      const src = images.get(hrefOf(el).replace(/^#/, ''));
      return src ? `<img src="${src}" alt="">` : '';
    }
    default: return inner();
  }
}

function block(el: Element, images: Map<string, string>, depth: number): string {
  const each = (): string => kids(el).map((c) => block(c, images, depth)).join('\n');
  const id = el.getAttribute('id');
  const idAttr = id ? ` id="${escapeHtml(id)}"` : '';
  switch (el.localName) {
    case 'p': return `<p${idAttr}>${[...el.childNodes].map((n) => inline(n, images)).join('')}</p>`;
    case 'v': return `<p class="verse">${[...el.childNodes].map((n) => inline(n, images)).join('')}</p>`;
    case 'subtitle': return `<h4>${[...el.childNodes].map((n) => inline(n, images)).join('')}</h4>`;
    case 'title': {
      const tag = `h${Math.min(6, depth + 2)}`;
      return `<${tag}>${kids(el, 'p').map((p) => [...p.childNodes].map((n) => inline(n, images)).join('')).join('<br>')}</${tag}>`;
    }
    case 'epigraph': return `<blockquote class="epigraph">${each()}</blockquote>`;
    case 'cite': return `<blockquote>${each()}</blockquote>`;
    case 'poem': return `<div class="poem">${each()}</div>`;
    case 'stanza': return `<div class="stanza">${each()}</div>`;
    case 'text-author': return `<p class="text-author">${[...el.childNodes].map((n) => inline(n, images)).join('')}</p>`;
    case 'empty-line': return '<br>';
    case 'image': return inline(el, images);
    case 'annotation': return `<div class="annotation">${each()}</div>`;
    case 'table': return `<table>${kids(el, 'tr').map((tr) => `<tr>${kids(tr).map((td) => `<td>${[...td.childNodes].map((n) => inline(n, images)).join('')}</td>`).join('')}</tr>`).join('')}</table>`;
    case 'section': return `<section${idAttr}>${kids(el).map((c) => block(c, images, depth + 1)).join('\n')}</section>`;
    default: return '';
  }
}

function sectionTitle(section: Element): string {
  const t = kids(section, 'title')[0];
  return t ? kids(t, 'p').map(text).filter(Boolean).join('. ') || text(t) : '';
}

function walk(section: Element, level: number, images: Map<string, string>, out: ParsedChapter[], counter: { n: number }): void {
  const sub = kids(section, 'section');
  const title = sectionTitle(section);
  if (sub.length && level < 2) {
    // Раздел-контейнер (часть): собственный текст до вложенных глав остаётся в нём.
    const own = kids(section).filter((c) => c.localName !== 'section').map((c) => block(c, images, level)).join('\n');
    counter.n += 1;
    out.push({ title: title || `Часть ${counter.n}`, level, html: own });
    for (const s of sub) walk(s, level + 1, images, out, counter);
  } else {
    counter.n += 1;
    out.push({ title: title || `Глава ${counter.n}`, level, html: kids(section).map((c) => block(c, images, level)).join('\n') });
  }
}

export async function parseFb2(bytes: Uint8Array, fallbackTitle: string): Promise<ParsedBook> {
  // Кодировка объявлена в XML-прологе; по умолчанию UTF-8.
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 200));
  const declared = head.match(/encoding=["']([\w-]+)["']/i)?.[1]?.toLowerCase();
  let xml: string;
  try {
    xml = declared && declared !== 'utf-8' ? new TextDecoder(declared).decode(bytes) : (await decodeText(bytes)).text;
  } catch {
    xml = (await decodeText(bytes)).text;
  }
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) {
    throw new Error('Файл FB2 повреждён: XML не разбирается.');
  }
  const info = doc.getElementsByTagName('title-info')[0];
  const title = text(info?.getElementsByTagName('book-title')[0]) || fallbackTitle;
  const authorEl = info?.getElementsByTagName('author')[0];
  const author = authorEl
    ? ['first-name', 'middle-name', 'last-name'].map((n) => text(authorEl.getElementsByTagName(n)[0])).filter(Boolean).join(' ') || text(authorEl)
    : '';
  const lang = text(info?.getElementsByTagName('lang')[0]) || undefined;

  const images = new Map<string, string>();
  let cover: Blob | undefined;
  const coverHref = info?.getElementsByTagName('coverpage')[0]?.getElementsByTagName('image')[0];
  const coverId = coverHref ? hrefOf(coverHref).replace(/^#/, '') : '';
  for (const bin of [...doc.getElementsByTagName('binary')]) {
    const id = bin.getAttribute('id') ?? '';
    const type = bin.getAttribute('content-type') ?? 'image/jpeg';
    const b64 = (bin.textContent ?? '').replace(/\s+/g, '');
    if (!id || !/^image\//.test(type)) continue;
    images.set(id, `data:${type};base64,${b64}`);
    if (id === coverId) {
      try {
        const raw = atob(b64);
        const arr = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i += 1) arr[i] = raw.charCodeAt(i);
        cover = new Blob([arr], { type });
      } catch {
        /* битая обложка — пропускаем */
      }
    }
  }

  const chapters: ParsedChapter[] = [];
  const counter = { n: 0 };
  const bodies = [...doc.getElementsByTagName('body')];
  for (const body of bodies) {
    const isNotes = body.getAttribute('name') === 'notes';
    const sections = kids(body, 'section');
    if (isNotes) {
      chapters.push({ title: 'Примечания', level: 0, html: sections.map((s) => block(s, images, 0)).join('\n') });
      continue;
    }
    const pre = kids(body).filter((c) => c.localName !== 'section').map((c) => block(c, images, 0)).join('\n');
    if (!sections.length) {
      chapters.push({ title, level: 0, html: pre });
      continue;
    }
    const startIdx = chapters.length;
    for (const s of sections) walk(s, 0, images, chapters, counter);
    if (pre.trim() && chapters[startIdx]) chapters[startIdx]!.html = `${pre}\n${chapters[startIdx]!.html}`;
  }
  return { kind: 'text', title, author, lang, cover, sourceLabel: 'FB2', chapters };
}
