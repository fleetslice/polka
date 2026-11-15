'use client';
import { ArrowLeft, ArrowRight, Pencil, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { createShelf, deleteShelf, renameShelf, reorderShelves } from '@/lib/actions';
import type { Book, Shelf } from '@/lib/types';

interface Props { shelves: Shelf[]; books: Book[]; active: string; onSelect: (id: string) => void }

/** Полки-пилюли со счётчиками. Свои полки можно создавать, переименовывать, удалять и переставлять (перетаскиванием или стрелками). */
export function ShelfTabs({ shelves, books, active, onSelect }: Props) {
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [drag, setDrag] = useState<string | null>(null);
  const count = (id: string): number => books.filter((b) => b.shelfId === id).length;
  const current = shelves.find((s) => s.id === active);
  const move = (dir: -1 | 1): void => {
    const ids = shelves.map((s) => s.id);
    const i = ids.indexOf(active);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    void reorderShelves(ids);
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Полки">
        <button type="button" className="pill" aria-pressed={active === 'all'} onClick={() => onSelect('all')}>
          Все <span className="count">{books.length}</span>
        </button>
        {shelves.map((s) => (
          <button
            key={s.id}
            type="button"
            className="pill"
            aria-pressed={active === s.id}
            draggable
            onDragStart={() => setDrag(s.id)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => {
              if (!drag || drag === s.id) return;
              const ids = shelves.map((x) => x.id).filter((x) => x !== drag);
              ids.splice(ids.indexOf(s.id), 0, drag);
              void reorderShelves(ids);
              setDrag(null);
            }}
            onClick={() => onSelect(s.id)}
          >
            {s.name} <span className="count">{count(s.id)}</span>
          </button>
        ))}
        {adding ? (
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const name = String(new FormData(e.currentTarget).get('name') ?? '').trim();
              setAdding(false);
              if (name) void createShelf(name).then((s) => onSelect(s.id));
            }}
          >
            <label htmlFor="new-shelf" className="sr-only">Название новой полки</label>
            <input id="new-shelf" name="name" autoFocus maxLength={40} placeholder="Название полки" className="field" style={{ width: 200 }}
              onKeyDown={(e) => e.key === 'Escape' && setAdding(false)} />
            <button type="submit" className="pill pill-accent">Создать</button>
          </form>
        ) : (
          <button type="button" className="pill" style={{ borderStyle: 'dashed', color: 'var(--text-2)' }} onClick={() => setAdding(true)}>
            + новая полка
          </button>
        )}
      </div>
      {current && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {renaming ? (
            <form
              className="flex items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const name = String(new FormData(e.currentTarget).get('name') ?? '').trim();
                setRenaming(false);
                if (name) void renameShelf(current.id, name);
              }}
            >
              <label htmlFor="rename-shelf" className="sr-only">Новое название полки</label>
              <input id="rename-shelf" name="name" autoFocus maxLength={40} defaultValue={current.name} className="field" style={{ width: 220 }}
                onKeyDown={(e) => e.key === 'Escape' && setRenaming(false)} />
              <button type="submit" className="pill pill-accent">Сохранить</button>
            </form>
          ) : (
            <>
              <span className="mono mr-1">Полка «{current.name}»</span>
              <button type="button" className="icon-btn" aria-label="Переименовать полку" onClick={() => setRenaming(true)}><Pencil size={16} aria-hidden /></button>
              <button type="button" className="icon-btn" aria-label="Сдвинуть полку влево" onClick={() => move(-1)}><ArrowLeft size={16} aria-hidden /></button>
              <button type="button" className="icon-btn" aria-label="Сдвинуть полку вправо" onClick={() => move(1)}><ArrowRight size={16} aria-hidden /></button>
              <button
                type="button"
                className="icon-btn"
                aria-label="Удалить полку"
                onClick={() => {
                  if (window.confirm(`Удалить полку «${current.name}»? Книги останутся в библиотеке.`)) {
                    void deleteShelf(current.id);
                    onSelect('all');
                  }
                }}
              >
                <Trash2 size={16} aria-hidden />
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
