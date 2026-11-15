import { db } from './db';
import { importFile } from './import';
import { supabase } from './sync';
import type { Book } from './types';

/**
 * Файлы книг в Supabase Storage (приватный бакет «books», папка = id владельца).
 * Путь строится из хеша файла: любое устройство владельца найдёт файл по записи книги, пришедшей синхронизацией.
 */
const BUCKET = 'books';
/** Лимит Supabase на один файл (бесплатный тариф — 50 МБ). */
export const CLOUD_FILE_LIMIT = 50 * 1024 * 1024;

const pathFor = (userId: string, book: Pick<Book, 'hash'>): string => `${userId}/${book.hash}`;

async function session(): Promise<{ sb: NonNullable<Awaited<ReturnType<typeof supabase>>>; userId: string } | null> {
  const sb = await supabase();
  if (!sb) return null;
  const { data } = await sb.auth.getSession();
  return data.session ? { sb, userId: data.session.user.id } : null;
}

export type UploadResult = 'uploaded' | 'already' | 'too-big' | 'no-file' | 'no-session' | 'error';
/** Текст последней ошибки облака — показывается на экране, чтобы было видно причину. */
export let lastCloudError = '';

/** Понятное объяснение ошибки Supabase Storage. */
export function explainStorageError(message: string): string {
  if (/bucket not found/i.test(message)) return 'В Supabase нет хранилища «books»: выполни SQL для хранилища книг в SQL Editor.';
  if (/row-level security|unauthorized|403/i.test(message)) return 'Supabase не пускает к хранилищу: выполни SQL для хранилища книг (правило «books: своя папка») в SQL Editor.';
  if (/not found|404|object/i.test(message)) return 'В облаке этой книги нет. Открой сайт на ноутбуке, обнови страницу и нажми «Синхронизировать сейчас» — книга загрузится.';
  if (/payload too large|maximum allowed size|413/i.test(message)) return 'Файл больше 50 МБ — бесплатное облако Supabase его не принимает.';
  return `Облако ответило ошибкой: ${message}`;
}

export async function uploadBook(book: Book): Promise<UploadResult> {
  const mark = `cloud:${book.hash}`;
  if (await db.meta.get(mark)) return 'already';
  const s = await session();
  if (!s) return 'no-session';
  const file = await db.files.get(book.id);
  if (!file) return 'no-file';
  if (file.blob.size > CLOUD_FILE_LIMIT) return 'too-big';
  const { error } = await s.sb.storage.from(BUCKET).upload(pathFor(s.userId, book), file.blob, {
    upsert: true, contentType: 'application/octet-stream',
  });
  if (error && !/exists|duplicate/i.test(error.message)) {
    lastCloudError = explainStorageError(error.message);
    return /too large|maximum allowed size|413/i.test(error.message) ? 'too-big' : 'error';
  }
  await db.meta.put({ key: mark, value: Date.now() });
  return 'uploaded';
}

/** Загружает в облако все книги, у которых файл есть на этом устройстве. По одной, чтобы не забить сеть. */
let running = false;
export async function uploadAll(onProgress?: (done: number, total: number) => void): Promise<{ uploaded: number; tooBig: string[]; failed: number }> {
  const out = { uploaded: 0, tooBig: [] as string[], failed: 0 };
  if (running) return out;
  running = true;
  try {
    const books = (await db.books.toArray()).filter((b) => !b.deleted);
    const local = new Set((await db.files.toCollection().primaryKeys()) as string[]);
    const todo: Book[] = [];
    for (const b of books) if (local.has(b.id) && !(await db.meta.get(`cloud:${b.hash}`))) todo.push(b);
    for (const [i, b] of todo.entries()) {
      const r = await uploadBook(b);
      if (r === 'uploaded') out.uploaded += 1;
      else if (r === 'too-big') out.tooBig.push(b.title);
      else if (r === 'no-session') break;
      else if (r === 'error') out.failed += 1;
      onProgress?.(i + 1, todo.length);
    }
  } finally {
    running = false;
  }
  return out;
}

const EXT: Record<string, string> = { fb2: 'fb2', m4b: 'm4b' };

/** Скачивает файл книги из облака и прикрепляет к уже существующей записи (прогресс и заметки сохраняются). */
export async function downloadBook(book: Book): Promise<string | null> {
  const s = await session();
  if (!s) return 'Войди в аккаунт на экране «Облако», чтобы скачать книгу.';
  const { data, error } = await s.sb.storage.from(BUCKET).download(pathFor(s.userId, book));
  if (error || !data) {
    if (book.size > CLOUD_FILE_LIMIT) return 'Файл больше 50 МБ — в бесплатное облако Supabase он не помещается. Закинь его на это устройство вручную.';
    // У ошибки скачивания Supabase часто пустой текст, а код — в originalError.status.
    const e = error as (Error & { status?: number; statusCode?: string; originalError?: { status?: number } }) | null;
    const status = e?.originalError?.status ?? e?.status ?? Number(e?.statusCode);
    const text = [e?.message, status ? String(status) : ''].filter(Boolean).join(' ');
    return explainStorageError(status === 400 || status === 404 ? 'not found' : text || 'нет ответа');
  }
  const name = `${book.title}.${EXT[book.format] ?? book.format}`;
  const res = await importFile(new File([data], name), { addedFrom: book.addedFrom });
  if (res.error) return res.error;
  await db.meta.put({ key: `cloud:${book.hash}`, value: Date.now() });
  return null;
}
