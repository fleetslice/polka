import type { ParsedBook, ParsedChapter } from '../types';
import { paragraphsToHtml, splitIntoChapters } from './chapters';

/** Декодирует текст с автоопределением кодировки: BOM → UTF-8 → jschardet → cp1251. */
export async function decodeText(bytes: Uint8Array): Promise<{ text: string; encoding: string }> {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { text: new TextDecoder('utf-8').decode(bytes.subarray(3)), encoding: 'utf-8' };
  }
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return { text: new TextDecoder('utf-16le').decode(bytes.subarray(2)), encoding: 'utf-16le' };
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return { text: new TextDecoder('utf-16be').decode(bytes.subarray(2)), encoding: 'utf-16be' };
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: 'utf-8' };
  } catch {
    /* не UTF-8 — определяем дальше */
  }
  let encoding = 'windows-1251';
  try {
    const jschardet = (await import('jschardet')).default;
    const sample = bytes.subarray(0, 64 * 1024);
    let bin = '';
    for (let i = 0; i < sample.length; i += 1) bin += String.fromCharCode(sample[i]!);
    const guess = jschardet.detect(bin);
    if (guess?.encoding && guess.confidence > 0.5) encoding = guess.encoding.toLowerCase();
  } catch {
    /* оставляем cp1251 */
  }
  const label = ({ 'koi8-r': 'koi8-r', 'ibm866': 'ibm866', 'maccyrillic': 'x-mac-cyrillic', 'iso-8859-5': 'iso-8859-5' } as Record<string, string>)[encoding]
    ?? (/1251|1252|utf-16|koi8|866|8859/.test(encoding) ? encoding : 'windows-1251');
  try {
    return { text: new TextDecoder(label).decode(bytes), encoding: label };
  } catch {
    return { text: new TextDecoder('windows-1251').decode(bytes), encoding: 'windows-1251' };
  }
}

export function chaptersFromPlainText(text: string, title: string): ParsedChapter[] {
  return splitIntoChapters(text, title)
    .filter((c) => c.paragraphs.length > 0 || c.level === 0)
    .map((c) => ({ title: c.title, level: c.level, html: paragraphsToHtml(c.paragraphs) }));
}

export async function parseTxt(bytes: Uint8Array, title: string, author: string): Promise<ParsedBook> {
  const { text, encoding } = await decodeText(bytes);
  return {
    kind: 'text',
    title,
    author,
    sourceLabel: `TXT · ${encoding.toUpperCase()}`,
    chapters: chaptersFromPlainText(text, title),
  };
}
