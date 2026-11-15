import { db, uid } from '../db';
import { queue, stamp } from '../device';
import { pagesFromChars } from '../progress';
import type { Book, BookFormat, Chapter, ChapterContent, ImportJob, JobStage, ParsedBook } from '../types';
import { BROWSER_FORMATS, MAX_FILE_SIZE, sha256, sniffFormat, titleFromFileName } from './detect';
import { htmlToText, sanitizeBookHtml } from './sanitize';

export const SPINE_COLORS = ['#2B2466', '#E8E2D5', '#8E1F23', '#F2B33D', '#C8562A', '#3A3833', '#B7B2A5', '#1F4E5F', '#0E4A3A', '#6B4E9B', '#D9C7A3', '#22303C'];

export function colorFor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return SPINE_COLORS[h % SPINE_COLORS.length]!;
}

/** Уменьшает обложку до 360px и берёт её средний цвет для корешка. */
async function processCover(blob: Blob): Promise<{ cover: string; color: string } | null> {
  try {
    const bmp = await createImageBitmap(blob);
    const scale = Math.min(1, 360 / bmp.width);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bmp.width * scale));
    canvas.height = Math.max(1, Math.round(bmp.height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const cover = canvas.toDataURL('image/jpeg', 0.82);
    const px = document.createElement('canvas');
    px.width = 1;
    px.height = 1;
    const pctx = px.getContext('2d');
    pctx?.drawImage(bmp, 0, 0, 1, 1);
    const d = pctx?.getImageData(0, 0, 1, 1).data;
    const color = d ? `#${[d[0]!, d[1]!, d[2]!].map((v) => v.toString(16).padStart(2, '0')).join('')}` : '';
    return { cover, color };
  } catch {
    return null;
  }
}

async function parse(format: BookFormat, buf: ArrayBuffer, file: File, onProgress: (m: string, p: number) => void): Promise<ParsedBook> {
  const { title, author } = titleFromFileName(file.name);
  const bytes = new Uint8Array(buf);
  switch (format) {
    case 'epub': return (await import('./epub')).parseEpub(buf, title);
    case 'fb2': {
      let data: Uint8Array = bytes;
      if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
        const { default: JSZip } = await import('jszip');
        const zip = await JSZip.loadAsync(buf);
        const entry = Object.values(zip.files).find((f) => /\.fb2$/i.test(f.name));
        if (!entry) throw new Error('В архиве нет файла .fb2.');
        data = await entry.async('uint8array');
      }
      return (await import('./fb2')).parseFb2(data, title);
    }
    case 'txt': return (await import('./txt')).parseTxt(bytes, title, author);
    case 'rtf': {
      const { rtfToText } = await import('./rtf');
      const { chaptersFromPlainText } = await import('./txt');
      const text = rtfToText(new TextDecoder('latin1').decode(bytes));
      return { kind: 'text', title, author, sourceLabel: 'RTF', chapters: chaptersFromPlainText(text, title) };
    }
    case 'html': return (await import('./html')).parseHtml(bytes, title, author);
    case 'docx': return (await import('./html')).parseDocx(buf, title, author);
    case 'odt': return (await import('./html')).parseOdt(buf, title, author);
    case 'pdf':
      return (await import('./pdf')).parsePdf(buf, title, author, (n, total) =>
        onProgress(`Читаю текстовый слой · стр. ${n} / ${total}`, n / total));
    case 'cbz': {
      const { default: JSZip } = await import('jszip');
      const zip = await JSZip.loadAsync(buf);
      const names = Object.values(zip.files).filter((f) => !f.dir && /\.(jpe?g|png|gif|webp)$/i.test(f.name)).map((f) => f.name)
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
      if (!names.length) throw new Error('В архиве CBZ нет картинок.');
      const first = await zip.file(names[0]!)!.async('arraybuffer');
      return {
        kind: 'pages', title, author, pages: names.length, sourceLabel: 'CBZ · КОМИКС', cover: new Blob([first]),
        chapters: [{ title, level: 0, html: '', startPage: 1, endPage: names.length }],
      };
    }
    case 'mp3':
    case 'm4b': {
      const seconds = await new Promise<number>((res) => {
        const a = new Audio();
        const url = URL.createObjectURL(file);
        a.onloadedmetadata = () => { URL.revokeObjectURL(url); res(Number.isFinite(a.duration) ? a.duration : 0); };
        a.onerror = () => { URL.revokeObjectURL(url); res(0); };
        a.src = url;
      });
      return {
        kind: 'audio', title, author, pages: Math.max(1, Math.round(seconds)), sourceLabel: 'АУДИОКНИГА',
        chapters: [{ title, level: 0, html: '', startPage: 1, endPage: Math.max(1, Math.round(seconds)) }],
      };
    }
    default:
      throw new Error(`Формат ${format.toUpperCase()} конвертируется на сервере (Calibre), а конвертер ещё не подключён. Сохрани книгу в EPUB или FB2 и загрузи снова.`);
  }
}

/** Превращает разобранную книгу в записи базы. Чистая часть конвейера — покрыта тестами. */
export function buildRecords(parsed: ParsedBook, bookId: string): { chapters: Chapter[]; contents: ChapterContent[]; lengthChars: number; pages: number } {
  const chapters: Chapter[] = [];
  const contents: ChapterContent[] = [];
  const stack: (string | null)[] = [];
  let offset = 0;
  parsed.chapters.forEach((c, order) => {
    const id = `${bookId}:${order}`;
    let lengthChars: number;
    if (parsed.kind === 'text') {
      const html = sanitizeBookHtml(c.html);
      const text = htmlToText(html);
      lengthChars = text.length;
      contents.push({ bookId, order, html, text });
    } else {
      lengthChars = Math.max(1, (c.endPage ?? 1) - (c.startPage ?? 1) + 1);
    }
    const level = Math.max(0, Math.min(2, c.level));
    stack.length = level + 1;
    stack[level] = id;
    const startPage = parsed.kind === 'text' ? c.startPage ?? Math.floor(offset / 1800) + 1 : c.startPage ?? 1;
    const endPage = parsed.kind === 'text' ? c.endPage ?? Math.max(startPage, Math.ceil((offset + lengthChars) / 1800)) : c.endPage ?? startPage;
    chapters.push({
      id, bookId, order, level, title: c.title.slice(0, 200) || `Глава ${order + 1}`,
      parentId: level > 0 ? stack[level - 1] ?? null : null,
      start: offset, lengthChars, startPage, endPage,
    });
    offset += lengthChars;
  });
  const pages = parsed.pages ?? pagesFromChars(offset);
  return { chapters, contents, lengthChars: offset, pages };
}

export interface ImportResult { bookId?: string; duplicateOf?: string; error?: string }

async function setJob(job: ImportJob, stage: JobStage, message: string, progress: number, extra: Partial<ImportJob> = {}): Promise<void> {
  Object.assign(job, { stage, message, progress, ...extra });
  await db.jobs.put({ ...job });
}

/** Полный путь файла: загрузка → конвертация → разметка глав → индексация → на полке. */
export async function importFile(file: File, opts: { shelfId?: string | null; addedFrom?: string } = {}): Promise<ImportResult> {
  const job: ImportJob = { id: uid(), fileName: file.name, format: '', stage: 'upload', progress: 0, message: 'Загружаю файл', createdAt: Date.now() };
  await db.jobs.put({ ...job });
  try {
    if (file.size > MAX_FILE_SIZE) throw new Error('Файл больше 2 ГБ — такой не поместится.');
    if (file.size === 0) throw new Error('Файл пустой.');
    const buf = await file.arrayBuffer();
    const format = sniffFormat(new Uint8Array(buf, 0, Math.min(16, buf.byteLength)), file.name);
    if (!format) throw new Error('Не узнаю этот формат. Подойдут EPUB, FB2, PDF, DOCX, RTF, TXT, CBZ, HTML, MP3.');
    job.format = format;
    if (!BROWSER_FORMATS.includes(format)) {
      throw new Error(`Формат ${format.toUpperCase()} конвертируется на сервере (Calibre), а конвертер ещё не подключён. Сохрани книгу в EPUB или FB2 и загрузи снова.`);
    }
    await setJob(job, 'upload', 'Ищу дубликаты', 0.5);
    const hash = await sha256(buf);
    const dup = await db.books.where('hash').equals(hash).filter((b) => !b.deleted).first();
    // Книга пришла с другого устройства (есть запись, но нет файла) — прикрепляем файл к ней, прогресс сохраняется.
    const attachTo = dup && (await db.chapters.where('bookId').equals(dup.id).count()) === 0 ? dup : null;
    if (dup && !attachTo) {
      await setJob(job, 'done', `Уже на полке: «${dup.title}»`, 1, { bookId: dup.id });
      return { duplicateOf: dup.id, bookId: dup.id };
    }

    await setJob(job, 'convert', 'Разбираю файл', 0.1);
    const parsed = await parse(format, buf, file, (m, p) => {
      void setJob(job, 'convert', m, 0.1 + p * 0.8);
    });

    await setJob(job, 'chapters', 'Размечаю главы', 0.3);
    const bookId = attachTo?.id ?? uid();
    const rec = buildRecords(parsed, bookId);
    if (parsed.kind === 'text' && rec.lengthChars === 0) throw new Error('В файле не нашлось текста.');

    await setJob(job, 'index', 'Индексирую текст для поиска', 0.6);
    const coverInfo = parsed.cover ? await processCover(parsed.cover) : null;
    const now = Date.now();
    const book: Book = {
      id: bookId,
      title: parsed.title.slice(0, 300),
      author: parsed.author.slice(0, 200),
      format,
      kind: parsed.kind,
      sourceLabel: parsed.sourceLabel,
      cover: coverInfo?.cover,
      color: coverInfo?.color || colorFor(parsed.title),
      pages: rec.pages,
      size: file.size,
      lengthChars: rec.lengthChars,
      shelfId: attachTo?.shelfId ?? opts.shelfId ?? null,
      status: attachTo?.status ?? 'new',
      progress: attachTo?.progress ?? 0,
      lastReadAt: attachTo?.lastReadAt,
      addedFrom: attachTo?.addedFrom ?? opts.addedFrom ?? 'с этого устройства',
      hash,
      createdAt: attachTo?.createdAt ?? now,
      lang: parsed.lang,
      ...stamp(),
    };
    await db.transaction('rw', [db.books, db.files, db.chapters, db.contents, db.outbox], async () => {
      await db.books.put(book);
      await db.files.put({ bookId, name: file.name, type: file.type, blob: new Blob([buf], { type: file.type }) });
      await db.chapters.bulkPut(rec.chapters);
      await db.contents.bulkPut(rec.contents);
      await queue('books', bookId);
    });
    const shelf = book.shelfId ? await db.shelves.get(book.shelfId) : null;
    const scanNote = parsed.kind === 'pages' && format === 'pdf' ? ' · скан, текст не распознан' : '';
    await setJob(job, 'done', `Готово · ${shelf ? `на полке «${shelf.name}»` : 'на полке'}${scanNote}`, 1, { bookId });
    return { bookId };
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Не получилось открыть файл.';
    await setJob(job, 'error', message, 1, { error: message });
    return { error: message };
  }
}

export async function importFiles(files: File[], opts: { shelfId?: string | null; addedFrom?: string } = {}): Promise<ImportResult[]> {
  const out: ImportResult[] = [];
  for (const f of files) out.push(await importFile(f, opts)); // по очереди: память и порядок на полке
  return out;
}

/** Достаёт файлы из перетащенных папок (включая вложенные). */
export async function filesFromDrop(dt: DataTransfer): Promise<File[]> {
  const entries = [...dt.items].map((i) => (i.webkitGetAsEntry ? i.webkitGetAsEntry() : null));
  if (!entries.some((e) => e?.isDirectory)) return [...dt.files];
  const out: File[] = [];
  const walk = async (entry: FileSystemEntry): Promise<void> => {
    if (entry.isFile) {
      out.push(await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej)));
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej));
        if (!batch.length) break;
        for (const e of batch) await walk(e);
      }
    }
  };
  for (const e of entries) if (e) await walk(e);
  return out.filter((f) => !f.name.startsWith('.'));
}
