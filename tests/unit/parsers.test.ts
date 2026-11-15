import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { detectHeadings, splitIntoChapters } from '@/lib/import/chapters';
import { decodeText, parseTxt } from '@/lib/import/txt';
import { parseFb2 } from '@/lib/import/fb2';
import { parseEpub, resolvePath } from '@/lib/import/epub';
import { chaptersFromHtml } from '@/lib/import/html';
import { rtfToText } from '@/lib/import/rtf';
import { formatFromName, sniffFormat, titleFromFileName } from '@/lib/import/detect';
import { sanitizeBookHtml } from '@/lib/import/sanitize';
import { buildRecords } from '@/lib/import';
import { buildIndex, chunkText, searchIndex, stem } from '@/lib/search';

const enc = new TextEncoder();
const para = (n: number): string => Array.from({ length: n }, (_, i) => `Предложение номер ${i} идёт по тексту дальше.`).join(' ');

describe('определение формата', () => {
  it('по имени и сигнатуре', () => {
    expect(formatFromName('Книга.FB2.ZIP')).toBe('fb2');
    expect(formatFromName('a.djv')).toBe('djvu');
    expect(sniffFormat(enc.encode('%PDF-1.7 ....'), 'book.txt')).toBe('pdf');
    expect(sniffFormat(enc.encode('{\\rtf1\\ansi'), 'x.doc')).toBe('rtf');
    expect(sniffFormat(enc.encode('просто текст'), 'x.xyz')).toBeNull();
  });
  it('автор и название из имени файла', () => {
    expect(titleFromFileName('Айтматов - Белый пароход.epub')).toEqual({ author: 'Айтматов', title: 'Белый пароход' });
    expect(titleFromFileName('Дюна.fb2.zip')).toEqual({ author: '', title: 'Дюна' });
  });
});

describe('TXT', () => {
  it('распознаёт cp1251', async () => {
    // «Глава» в windows-1251
    const bytes = new Uint8Array([0xc3, 0xeb, 0xe0, 0xe2, 0xe0, 0x20, 0xef, 0xe5, 0xf0, 0xe2, 0xe0, 0xff]);
    const { text } = await decodeText(bytes);
    expect(text).toBe('Глава первая');
  });
  it('делит на главы по заголовкам, части — верхний уровень', async () => {
    const src = `ЧАСТЬ ПЕРВАЯ\n\nГлава 1\n\n${para(5)}\n\nГлава 2\n\n${para(5)}\n\nЧАСТЬ ВТОРАЯ\n\nГлава 3\n\n${para(5)}\n`;
    const book = await parseTxt(enc.encode(src), 'Книга', '');
    expect(book.chapters.map((c) => [c.title, c.level])).toEqual([
      ['ЧАСТЬ ПЕРВАЯ', 0], ['Глава 1', 1], ['Глава 2', 1], ['ЧАСТЬ ВТОРАЯ', 0], ['Глава 3', 1],
    ]);
  });
  it('без заголовков режет длинный текст на равные части', () => {
    const text = Array.from({ length: 400 }, () => para(4)).join('\n');
    const parts = splitIntoChapters(text, 'Книга');
    expect(parts.length).toBeGreaterThan(2);
    expect(parts.every((p) => p.auto)).toBe(true);
    expect(parts[0]!.title).toBe('Часть 1');
  });
  it('обычная строка с точкой в конце — не заголовок', () => {
    expect(detectHeadings(['', 'Он вышел из дома.', '', 'II', '', 'Текст'])).toEqual([{ line: 3, title: 'II', level: 0 }]);
  });
});

describe('FB2', () => {
  const fb2 = `<?xml version="1.0" encoding="utf-8"?>
<FictionBook xmlns="http://www.gribuedov.ru/xml/fictionbook/2.0" xmlns:l="http://www.w3.org/1999/xlink">
<description><title-info><author><first-name>Чингиз</first-name><last-name>Айтматов</last-name></author>
<book-title>Белый пароход</book-title><lang>ru</lang></title-info></description>
<body>
<section><title><p>Часть первая</p></title>
  <section><title><p>Глава 1</p></title><p>У него были <emphasis>две сказки</emphasis>.<a l:href="#n1" type="note">[1]</a></p></section>
  <section><title><p>Глава 2</p></title><p>Вторая глава.</p></section>
</section>
</body>
<body name="notes"><section id="n1"><p>Сноска один.</p></section></body>
</FictionBook>`;
  it('метаданные, вложенные главы и сноски', async () => {
    const book = await parseFb2(enc.encode(fb2), 'x');
    expect(book.title).toBe('Белый пароход');
    expect(book.author).toBe('Чингиз Айтматов');
    expect(book.chapters.map((c) => [c.title, c.level])).toEqual([
      ['Часть первая', 0], ['Глава 1', 1], ['Глава 2', 1], ['Примечания', 0],
    ]);
    expect(book.chapters[1]!.html).toContain('<em>две сказки</em>');
    expect(book.chapters[1]!.html).toContain('href="#n1"');
    expect(book.chapters[3]!.html).toContain('id="n1"');
  });
  it('битый XML даёт понятную ошибку', async () => {
    await expect(parseFb2(enc.encode('<FictionBook><body>'), 'x')).rejects.toThrow(/повреждён/);
  });
});

async function makeEpub(): Promise<ArrayBuffer> {
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip');
  zip.file('META-INF/container.xml', `<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`);
  zip.file('OEBPS/content.opf', `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Дюна</dc:title><dc:creator>Фрэнк Герберт</dc:creator><dc:language>ru</dc:language></metadata>
<manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="c1" href="text/c1.xhtml" media-type="application/xhtml+xml"/><item id="c1b" href="text/c1b.xhtml" media-type="application/xhtml+xml"/><item id="c2" href="text/c2.xhtml" media-type="application/xhtml+xml"/></manifest>
<spine><itemref idref="c1"/><itemref idref="c1b"/><itemref idref="c2"/></spine></package>`);
  zip.file('OEBPS/nav.xhtml', `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="toc"><ol><li><a href="text/c1.xhtml">Книга первая</a><ol><li><a href="text/c2.xhtml#top">Глава 2</a></li></ol></li></ol></nav></body></html>`);
  const page = (body: string): string => `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title></head><body>${body}</body></html>`;
  zip.file('OEBPS/text/c1.xhtml', page('<h1>Книга первая</h1><p>Начало.</p><script>alert(1)</script>'));
  zip.file('OEBPS/text/c1b.xhtml', page('<p>Продолжение первой.</p><img src="http://evil.example/x.png"/>'));
  zip.file('OEBPS/text/c2.xhtml', page('<p id="top" onclick="x()">Вторая.</p>'));
  return zip.generateAsync({ type: 'arraybuffer' });
}

describe('EPUB', () => {
  it('пути', () => {
    expect(resolvePath('OEBPS/content.opf', 'text/c1.xhtml#a')).toBe('OEBPS/text/c1.xhtml');
    expect(resolvePath('OEBPS/text/c1.xhtml', '../img/a%20b.png')).toBe('OEBPS/img/a b.png');
  });
  it('оглавление nav, склейка файлов без пункта оглавления, уровни', async () => {
    const book = await parseEpub(await makeEpub(), 'x');
    expect(book.title).toBe('Дюна');
    expect(book.author).toBe('Фрэнк Герберт');
    expect(book.chapters.map((c) => [c.title, c.level])).toEqual([['Книга первая', 0], ['Глава 2', 1]]);
    expect(book.chapters[0]!.html).toContain('Продолжение первой');
  });
  it('импорт → записи: санитизация, длины и смещения глав', async () => {
    const book = await parseEpub(await makeEpub(), 'x');
    const rec = buildRecords(book, 'b1');
    expect(rec.contents[0]!.html).not.toMatch(/script|evil\.example/);
    expect(rec.contents[1]!.html).not.toContain('onclick');
    expect(rec.chapters[1]!.parentId).toBe('b1:0');
    expect(rec.chapters[1]!.start).toBe(rec.chapters[0]!.lengthChars);
    expect(rec.lengthChars).toBe(rec.contents.reduce((s, c) => s + c.text.length, 0));
  });
  it('не архив — понятная ошибка', async () => {
    await expect(parseEpub(enc.encode('not a zip').buffer as ArrayBuffer, 'x')).rejects.toThrow(/повреждён/);
  });
});

describe('HTML и RTF', () => {
  it('главы по h1/h2', () => {
    const ch = chaptersFromHtml('<div><h1>Один</h1><p>а</p><h2>Один-а</h2><p>б</p><h1>Два</h1><p>в</p></div>', 'Док');
    expect(ch.map((c) => [c.title, c.level])).toEqual([['Один', 0], ['Один-а', 1], ['Два', 0]]);
  });
  it('RTF: кириллица в \\\'hh и \\u', () => {
    const rtf = "{\\rtf1\\ansi\\ansicpg1251{\\fonttbl{\\f0 Arial;}}\\'cf\\'f0\\'e8\\'e2\\'e5\\'f2\\par \\u1052?\\u1080?\\u1088?}";
    expect(rtfToText(rtf).split('\n').filter(Boolean)).toEqual(['Привет', 'Мир']);
  });
  it('санитайзер режет опасное и внешние картинки', () => {
    const out = sanitizeBookHtml('<p onclick="x">ок<img src="https://a/b.png"><img src="data:image/png;base64,AA=="><a href="javascript:alert(1)">l</a><iframe src="x"></iframe></p>');
    expect(out).not.toMatch(/onclick|https:\/\/a|javascript|iframe/);
    expect(out).toContain('data:image/png');
  });
});

describe('поиск', () => {
  it('стемминг сводит формы слова', () => {
    expect(stem('трусости')).toBe(stem('трусость'));
  });
  it('BM25 ставит релевантный фрагмент первым', () => {
    const idx = buildIndex([
      { text: 'Трусость — самый страшный порок, сказал Пилат.', ref: 1 },
      { text: 'Мальчик смотрел на белый пароход в бинокль.', ref: 2 },
      { text: 'Система важнее цели: привычки складываются.', ref: 3 },
    ]);
    expect(searchIndex(idx, 'что говорится о трусости')[0]!.ref).toBe(1);
    expect(searchIndex(idx, 'пароход')[0]!.ref).toBe(2);
    expect(searchIndex(idx, 'квантовая физика')).toEqual([]);
  });
  it('фрагменты покрывают текст без потерь', () => {
    const text = Array.from({ length: 300 }, (_, i) => `Фраза ${i} про что-то.`).join(' ');
    const chunks = chunkText(text, 500);
    expect(chunks.map((c) => c.text).join('')).toBe(text);
    expect(chunks.every((c) => text.slice(c.start, c.start + c.text.length) === c.text)).toBe(true);
  });
});
