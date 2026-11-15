import { describe, expect, it } from 'vitest';
import { PolkaDB } from '@/lib/db';
import { keyOf, remoteWins } from '@/lib/sync';
import { bookNotesMarkdown, safeName } from '@/lib/export';
import { parseTags } from '@/lib/actions';
import type { Book, Note } from '@/lib/types';

describe('last-write-wins', () => {
  it('новее побеждает, при равном времени — больший deviceId', () => {
    expect(remoteWins(undefined, { updatedAt: 1, deviceId: 'a' })).toBe(true);
    expect(remoteWins({ updatedAt: 5, deviceId: 'a' }, { updatedAt: 6, deviceId: 'a' })).toBe(true);
    expect(remoteWins({ updatedAt: 6, deviceId: 'a' }, { updatedAt: 5, deviceId: 'z' })).toBe(false);
    expect(remoteWins({ updatedAt: 5, deviceId: 'a' }, { updatedAt: 5, deviceId: 'b' })).toBe(true);
    expect(remoteWins({ updatedAt: 5, deviceId: 'b' }, { updatedAt: 5, deviceId: 'a' })).toBe(false);
    // запись не «побеждает» саму себя — нет бесконечного эха между устройствами
    expect(remoteWins({ updatedAt: 5, deviceId: 'a' }, { updatedAt: 5, deviceId: 'a' })).toBe(false);
  });
  it('составные ключи', () => {
    expect(keyOf('positions', { bookId: 'b', deviceId: 'd' })).toBe('b|d');
    expect(keyOf('chapterProgress', { bookId: 'b', chapterId: 'b:3' })).toBe('b|b:3');
    expect(keyOf('notes', { id: 'n1' })).toBe('n1');
  });
  it('схема IndexedDB открывается', async () => {
    const db = new PolkaDB('polka-test');
    await db.shelves.put({ id: 's', name: 'Проза', color: '', order: 1, updatedAt: 1, deviceId: 'a' });
    expect((await db.shelves.get('s'))?.name).toBe('Проза');
    await db.delete();
  });
});

describe('заметки', () => {
  it('теги из текста', () => {
    expect(parseTags('Мысль про #Детство и #сказку, а не C# или # пусто')).toEqual(['детство', 'сказку']);
  });
  it('экспорт в Markdown для Obsidian', () => {
    const book = { title: 'Белый пароход', author: 'Чингиз Айтматов' } as Book;
    const base = { bookId: 'b', tags: [], updatedAt: 0, deviceId: 'a' };
    const notes = [
      { ...base, id: '2', kind: 'thought', bodyMd: 'Сказка сильнее взрослых #детство', tags: ['детство'], createdAt: Date.UTC(2026, 0, 2), locator: { chapter: 1, offset: 5 } },
      { ...base, id: '1', kind: 'quote', bodyMd: 'У него были две сказки', page: 3, createdAt: Date.UTC(2026, 0, 1), locator: { chapter: 0, offset: 10 } },
    ] as Note[];
    const md = bookNotesMarkdown(book, notes, new Map());
    expect(md).toMatch(/^---\ntitle: "Белый пароход"\nauthor: "Чингиз Айтматов"/);
    expect(md).toContain('tags: [детство]');
    expect(md.indexOf('> У него были две сказки')).toBeLessThan(md.indexOf('Сказка сильнее взрослых'));
    expect(md).toContain('Цитата · стр. 3 · 2026-01-01');
    expect(safeName('Что/такое: «свет»?')).toBe('Что такое «свет»');
  });
});
