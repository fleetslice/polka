import type JSZip from 'jszip';
import type { ParsedBook, ParsedChapter } from '../types';

const MIME: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml' };
const MAX_INLINE_IMAGE = 3 * 1024 * 1024;

export function resolvePath(base: string, rel: string): string {
  const clean = decodeURIComponent(rel.split('#')[0] ?? '');
  if (clean.startsWith('/')) return clean.slice(1);
  const parts = base.split('/').slice(0, -1);
  for (const seg of clean.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg && seg !== '.') parts.push(seg);
  }
  return parts.join('/');
}

const xml = (s: string, type: DOMParserSupportedType = 'application/xml'): Document => new DOMParser().parseFromString(s, type);
const byTag = (root: Document | Element, name: string): Element[] =>
  [...root.getElementsByTagName('*')].filter((e) => e.localName === name);

interface TocEntry { path: string; title: string; level: number }

function tocFromNav(doc: Document, navPath: string): TocEntry[] {
  const navs = byTag(doc, 'nav');
  const nav = navs.find((n) => (n.getAttribute('epub:type') ?? n.getAttribute('type') ?? '').includes('toc')) ?? navs[0];
  const out: TocEntry[] = [];
  const walk = (ol: Element, level: number): void => {
    for (const li of [...ol.children].filter((c) => c.localName === 'li')) {
      const a = [...li.children].find((c) => c.localName === 'a' || c.localName === 'span');
      const href = a?.getAttribute('href');
      if (a && href) out.push({ path: resolvePath(navPath, href), title: (a.textContent ?? '').replace(/\s+/g, ' ').trim(), level });
      const sub = [...li.children].find((c) => c.localName === 'ol');
      if (sub) walk(sub, level + 1);
    }
  };
  const ol = nav && [...nav.children].find((c) => c.localName === 'ol');
  if (ol) walk(ol, 0);
  return out;
}

function tocFromNcx(doc: Document, ncxPath: string): TocEntry[] {
  const out: TocEntry[] = [];
  const walk = (parent: Element, level: number): void => {
    for (const np of [...parent.children].filter((c) => c.localName === 'navPoint')) {
      const label = byTag(np, 'text')[0]?.textContent ?? '';
      const src = [...np.children].find((c) => c.localName === 'content')?.getAttribute('src');
      if (src) out.push({ path: resolvePath(ncxPath, src), title: label.replace(/\s+/g, ' ').trim(), level });
      walk(np, level + 1);
    }
  };
  const map = byTag(doc, 'navMap')[0];
  if (map) walk(map, 0);
  return out;
}

async function dataUrl(zip: JSZip, path: string): Promise<string | null> {
  const file = zip.file(path);
  if (!file) return null;
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  const mime = MIME[ext];
  if (!mime) return null;
  const b64 = await file.async('base64');
  if (b64.length > MAX_INLINE_IMAGE * 1.37) return null;
  return `data:${mime};base64,${b64}`;
}

/** Тело XHTML-документа с картинками, встроенными как data:, и внутренними ссылками вида #id. */
async function bodyHtml(zip: JSZip, path: string, raw: string): Promise<{ html: string; heading: string }> {
  let doc = xml(raw, 'application/xhtml+xml');
  if (doc.getElementsByTagName('parsererror').length || !doc.body) doc = xml(raw, 'text/html');
  const body = doc.body ?? doc.documentElement;
  for (const img of byTag(body, 'img')) {
    const src = img.getAttribute('src');
    const url = src && !/^data:/.test(src) ? await dataUrl(zip, resolvePath(path, src)) : null;
    if (url) img.setAttribute('src', url);
    else if (!src?.startsWith('data:')) img.remove();
  }
  for (const im of byTag(body, 'image')) {
    const href = im.getAttribute('xlink:href') ?? im.getAttribute('href');
    const url = href ? await dataUrl(zip, resolvePath(path, href)) : null;
    const svg = im.closest('svg');
    if (url && svg) {
      const img = doc.createElement('img');
      img.setAttribute('src', url);
      img.setAttribute('alt', '');
      svg.replaceWith(img);
    }
  }
  for (const a of byTag(body, 'a')) {
    const href = a.getAttribute('href');
    if (!href || /^[a-z]+:/i.test(href)) continue;
    const frag = href.split('#')[1];
    if (frag) {
      a.setAttribute('href', `#${frag}`);
      const type = a.getAttribute('epub:type') ?? '';
      if (type.includes('noteref') || a.querySelector('sup') || a.closest('sup')) a.setAttribute('class', 'noteref');
    } else a.removeAttribute('href');
  }
  const heading = (body.querySelector('h1, h2, h3')?.textContent ?? '').replace(/\s+/g, ' ').trim();
  return { html: body.innerHTML, heading };
}

export async function parseEpub(buf: ArrayBuffer, fallbackTitle: string): Promise<ParsedBook> {
  const { default: JSZipCtor } = await import('jszip');
  let zip: JSZip;
  try {
    zip = await JSZipCtor.loadAsync(buf);
  } catch {
    throw new Error('Файл EPUB повреждён: архив не открывается.');
  }
  if (zip.file('META-INF/encryption.xml') && zip.file('META-INF/rights.xml')) {
    throw new Error('Книга защищена DRM — такую открыть нельзя.');
  }
  const container = await zip.file('META-INF/container.xml')?.async('string');
  const opfPath = container ? byTag(xml(container), 'rootfile')[0]?.getAttribute('full-path') : null;
  const opfRaw = opfPath ? await zip.file(opfPath)?.async('string') : null;
  if (!opfPath || !opfRaw) throw new Error('В EPUB нет описания книги (content.opf).');
  const opf = xml(opfRaw);

  const meta = (name: string): string => (byTag(opf, name)[0]?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const manifest = new Map<string, { path: string; type: string; props: string }>();
  for (const item of byTag(opf, 'item')) {
    const id = item.getAttribute('id');
    const href = item.getAttribute('href');
    if (id && href) {
      manifest.set(id, { path: resolvePath(opfPath, href), type: item.getAttribute('media-type') ?? '', props: item.getAttribute('properties') ?? '' });
    }
  }
  const spineEl = byTag(opf, 'spine')[0];
  const spine = byTag(opf, 'itemref')
    .map((r) => manifest.get(r.getAttribute('idref') ?? ''))
    .filter((m): m is NonNullable<typeof m> => !!m && /html|xml/.test(m.type));

  let toc: TocEntry[] = [];
  const navItem = [...manifest.values()].find((m) => m.props.split(' ').includes('nav'));
  if (navItem) {
    const raw = await zip.file(navItem.path)?.async('string');
    if (raw) toc = tocFromNav(xml(raw, 'application/xhtml+xml'), navItem.path);
  }
  if (!toc.length) {
    const ncx = manifest.get(spineEl?.getAttribute('toc') ?? '') ?? [...manifest.values()].find((m) => m.type === 'application/x-dtbncx+xml');
    const raw = ncx ? await zip.file(ncx.path)?.async('string') : null;
    if (raw && ncx) toc = tocFromNcx(xml(raw), ncx.path);
  }
  const tocByPath = new Map<string, TocEntry>();
  for (const t of toc) if (!tocByPath.has(t.path)) tocByPath.set(t.path, t);

  const chapters: ParsedChapter[] = [];
  for (const item of spine) {
    if (navItem && item.path === navItem.path) continue;
    const raw = await zip.file(item.path)?.async('string');
    if (!raw) continue;
    const { html, heading } = await bodyHtml(zip, item.path, raw);
    const entry = tocByPath.get(item.path);
    const last = chapters[chapters.length - 1];
    if (entry || !last) {
      chapters.push({ title: entry?.title || heading || (chapters.length ? `Раздел ${chapters.length + 1}` : 'Начало'), level: Math.min(2, entry?.level ?? 0), html });
    } else if (!toc.length && heading) {
      chapters.push({ title: heading, level: 0, html });
    } else {
      last.html += `\n${html}`;
    }
  }
  if (!chapters.length) throw new Error('В EPUB не нашлось текста.');

  let cover: Blob | undefined;
  const coverId = byTag(opf, 'meta').find((m) => m.getAttribute('name') === 'cover')?.getAttribute('content');
  const coverItem = [...manifest.values()].find((m) => m.props.split(' ').includes('cover-image')) ?? (coverId ? manifest.get(coverId) : undefined);
  if (coverItem && /^image\//.test(coverItem.type)) {
    const data = await zip.file(coverItem.path)?.async('arraybuffer');
    if (data) cover = new Blob([data], { type: coverItem.type });
  }

  return {
    kind: 'text',
    title: meta('title') || fallbackTitle,
    author: meta('creator'),
    lang: meta('language') || undefined,
    cover,
    sourceLabel: 'EPUB',
    chapters,
  };
}
