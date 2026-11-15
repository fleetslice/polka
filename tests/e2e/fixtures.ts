import JSZip from 'jszip';

const sentence = (i: number): string => `Мальчик номер ${i} смотрел на белый пароход и думал о дороге, которая уходит за гору.`;
export const paragraph = (seed: number, n = 6): string => Array.from({ length: n }, (_, i) => sentence(seed * 100 + i)).join(' ');

/** Небольшой EPUB3 с оглавлением: часть и три главы. Собирается на лету — книги в репозитории не хранятся. */
export async function makeEpub(title = 'Белый пароход', author = 'Чингиз Айтматов'): Promise<Buffer> {
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  zip.file('META-INF/container.xml', `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`);
  const ids = ['c1', 'c2', 'c3'];
  zip.file('OEBPS/content.opf', `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">polka-test</dc:identifier><dc:title>${title}</dc:title><dc:creator>${author}</dc:creator><dc:language>ru</dc:language></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>${ids.map((i) => `<item id="${i}" href="${i}.xhtml" media-type="application/xhtml+xml"/>`).join('')}</manifest><spine>${ids.map((i) => `<itemref idref="${i}"/>`).join('')}</spine></package>`);
  zip.file('OEBPS/nav.xhtml', `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="toc"><ol>${ids.map((i, n) => `<li><a href="${i}.xhtml">Глава ${n + 1}</a></li>`).join('')}</ol></nav></body></html>`);
  ids.forEach((i, n) => {
    const body = Array.from({ length: 30 }, (_, p) => `<p>${paragraph(n * 50 + p)}</p>`).join('');
    const marker = n === 0 ? '<p>Особенная фраза про старый бинокль деда Момуна.</p>' : '';
    zip.file(`OEBPS/${i}.xhtml`, `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>${i}</title></head><body><h2>Глава ${n + 1}</h2>${marker}${body}</body></html>`);
  });
  return zip.generateAsync({ type: 'nodebuffer' });
}

export function makeTxt(): Buffer {
  const parts = ['Глава 1', paragraph(1, 20), 'Глава 2', paragraph(2, 20), 'Глава 3', paragraph(3, 20)];
  return Buffer.from(parts.join('\n\n'), 'utf8');
}
