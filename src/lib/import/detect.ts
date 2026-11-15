import type { BookFormat } from '../types';

export const MAX_FILE_SIZE = 2 * 1024 * 1024 * 1024;

const EXT: Record<string, BookFormat> = {
  epub: 'epub', fb2: 'fb2', pdf: 'pdf', mobi: 'mobi', prc: 'mobi', azw: 'azw3', azw3: 'azw3', djvu: 'djvu', djv: 'djvu',
  docx: 'docx', doc: 'doc', odt: 'odt', rtf: 'rtf', txt: 'txt', md: 'txt', cbz: 'cbz', cbr: 'cbr',
  html: 'html', htm: 'html', xhtml: 'html', mp3: 'mp3', m4b: 'm4b', m4a: 'm4b',
};

/** Форматы, которые открываются прямо в браузере. Остальным нужен серверный конвертер (Calibre). */
export const BROWSER_FORMATS: BookFormat[] = ['epub', 'fb2', 'pdf', 'docx', 'odt', 'rtf', 'txt', 'cbz', 'html', 'mp3', 'm4b'];

export function formatFromName(name: string): BookFormat | null {
  const lower = name.toLowerCase();
  if (lower.endsWith('.fb2.zip') || lower.endsWith('.fbz')) return 'fb2';
  const ext = lower.split('.').pop() ?? '';
  return EXT[ext] ?? null;
}

/** Определение по сигнатуре: расширению нельзя верить. */
export function sniffFormat(head: Uint8Array, name: string): BookFormat | null {
  const byName = formatFromName(name);
  const ascii = String.fromCharCode(...head.slice(0, 16));
  if (ascii.startsWith('%PDF')) return 'pdf';
  if (ascii.startsWith('AT&TFORM')) return 'djvu';
  if (ascii.startsWith('{\\rtf')) return 'rtf';
  if (ascii.startsWith('Rar!')) return 'cbr';
  if (head[0] === 0x50 && head[1] === 0x4b) {
    // zip-контейнер: epub / docx / odt / cbz / fb2.zip — различаем по имени
    return byName && ['epub', 'docx', 'odt', 'cbz', 'fb2'].includes(byName) ? byName : byName === null ? null : byName;
  }
  if (head[0] === 0xd0 && head[1] === 0xcf) return 'doc';
  return byName;
}

export function titleFromFileName(name: string): { title: string; author: string } {
  const base = name.replace(/\.(fb2\.zip|[a-z0-9]{2,5})$/i, '').replace(/[_]+/g, ' ').trim();
  const m = base.match(/^(.{2,60}?)\s+[-–—]\s+(.{2,})$/);
  if (m) return { author: m[1]!.trim(), title: m[2]!.trim() };
  return { title: base || 'Без названия', author: '' };
}

export async function sha256(buf: ArrayBuffer): Promise<string> {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    // Для больших файлов хешируем начало, конец и размер — этого достаточно для поиска дубликатов.
    const LIMIT = 8 * 1024 * 1024;
    let data: ArrayBuffer = buf;
    if (buf.byteLength > LIMIT * 2) {
      const merged = new Uint8Array(LIMIT * 2 + 8);
      merged.set(new Uint8Array(buf, 0, LIMIT), 0);
      merged.set(new Uint8Array(buf, buf.byteLength - LIMIT, LIMIT), LIMIT);
      new DataView(merged.buffer).setFloat64(LIMIT * 2, buf.byteLength);
      data = merged.buffer;
    }
    const digest = await crypto.subtle.digest('SHA-256', data);
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  return `len-${buf.byteLength}`;
}
