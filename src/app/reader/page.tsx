'use client';
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowLeft, Bookmark, Maximize, PanelLeft, PanelRight, Search, Settings2, Volume2, VolumeX } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { PagesView } from '@/components/reader/PagesView';
import { ProgressSidebar } from '@/components/reader/ProgressSidebar';
import { SegmentBar } from '@/components/reader/SegmentBar';
import { SidePanel, type SidePanelHandle } from '@/components/reader/SidePanel';
import { chapterNumber, chapterRows, charsLeft, leftLabel, totalProgress } from '@/components/reader/model';
import { addBookmark, addHighlight, addNote, latestPosition, logSession, removeBookmark, removeHighlight, savePosition } from '@/lib/actions';
import { db } from '@/lib/db';
import { offsetFromPoint, rangeAt, textOffset, wrapRange } from '@/lib/dom';
import { useBook, useBooks, useMediaQuery, lastBook } from '@/lib/hooks';
import { readingSpeed, readingStreak, todayStats } from '@/lib/progress';
import { pageFor } from '@/lib/rag';
import { snippet } from '@/lib/search';
import { ACCENTS, useSettings, type ReaderTheme } from '@/lib/settings';
import type { Book, ChapterContent, HighlightColor, Locator } from '@/lib/types';
import { downloadBook } from '@/lib/cloudFiles';

const THEMES: Record<ReaderTheme, { label: string; bg: string; fg: string }> = {
  night: { label: 'Ночь', bg: 'var(--night-bg)', fg: 'var(--night-fg)' },
  paper: { label: 'Бумага', bg: 'var(--paper-bg)', fg: 'var(--paper-fg)' },
  sepia: { label: 'Сепия', bg: 'var(--sepia-bg)', fg: 'var(--sepia-fg)' },
};
const FONTS = { literata: 'var(--font-book)', golos: 'var(--font-ui)', mono: 'var(--font-mono)' } as const;
const GAP = 48;
const isTyping = (t: EventTarget | null): boolean =>
  t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));

interface Sel { start: number; end: number; text: string; x: number; y: number }

function Reader({ id }: { id: string }) {
  const params = useSearchParams();
  const book = useBook(id);
  const st = useSettings();
  const wide = useMediaQuery('(min-width: 1100px)');
  const chapters = useLiveQuery(() => db.chapters.where('bookId').equals(id).sortBy('order'), [id]);
  const progress = useLiveQuery(() => db.chapterProgress.where('bookId').equals(id).toArray(), [id]) ?? [];
  const highlights = useLiveQuery(async () => (await db.highlights.where('bookId').equals(id).toArray()).filter((h) => !h.deleted), [id]) ?? [];
  const notes = useLiveQuery(async () => (await db.notes.where('bookId').equals(id).toArray()).filter((n) => !n.deleted).sort((a, b) => b.createdAt - a.createdAt), [id]) ?? [];
  const bookmarks = useLiveQuery(async () => (await db.bookmarks.where('bookId').equals(id).toArray()).filter((b) => !b.deleted), [id]) ?? [];
  const sessions = useLiveQuery(() => db.sessions.toArray(), []) ?? [];

  const [loc, setLoc] = useState<Locator | null>(null);
  const [readTo, setReadTo] = useState(0);
  const [content, setContent] = useState<ChapterContent | null>(null);
  const [sel, setSel] = useState<Sel | null>(null);
  const [markMenu, setMarkMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [drawer, setDrawer] = useState<'progress' | 'panel' | null>(null);
  const [footnote, setFootnote] = useState<string | null>(null);
  const [toast, setToast] = useState('');
  const [tts, setTts] = useState(false);
  const [findQ, setFindQ] = useState('');
  const [findHits, setFindHits] = useState<{ chapter: number; offset: number; text: string }[]>([]);
  const [flash, setFlash] = useState<{ chapter: number; start: number; end: number } | null>(null);

  const scroller = useRef<HTMLDivElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const panel = useRef<SidePanelHandle>(null);
  const pending = useRef<number | 'end' | null>(null);
  const restored = useRef(false);
  const settingsDlg = useRef<HTMLDialogElement>(null);
  const findDlg = useRef<HTMLDialogElement>(null);
  const noteDlg = useRef<HTMLDialogElement>(null);
  const session = useRef({ start: 0, last: 0, chars: 0, prev: -1, chapter: -1 });
  const ttsOn = useRef(false);

  const paged = st.flow === 'paged' && book?.kind === 'text';
  const chapter = chapters && loc ? chapters[loc.chapter] : undefined;
  const say = (m: string): void => {
    setToast(m);
    window.setTimeout(() => setToast(''), 2600);
  };

  /* ── Начальная позиция: из ссылки (?c=&o=) либо самая свежая среди устройств ── */
  const linkKey = `${params.get('c') ?? ''}|${params.get('o') ?? ''}|${params.get('q') ?? ''}|${params.get('t') ?? ''}`;
  const appliedLink = useRef<string | null>(null);

  /** Место из ссылки (?c=&o=&q=). С q подсвечивается первое вхождение слова запроса после смещения. */
  const linkTarget = useCallback(async (count: number): Promise<{ target: Locator; flash: { chapter: number; start: number; end: number } | null } | null> => {
    const c = params.get('c');
    if (c === null) return null;
    const target: Locator = { chapter: Math.min(count - 1, Math.max(0, Number(c) || 0)), offset: Math.max(0, Number(params.get('o')) || 0) };
    const q = params.get('q');
    if (q) {
      const text = (await db.contents.get([id, target.chapter]))?.text.toLowerCase() ?? '';
      const words = (q.toLowerCase().match(/[a-zа-яё0-9]{3,}/gi) ?? []).sort((x, y) => y.length - x.length);
      for (const w of words) {
        const stemmed = w.length > 5 ? w.slice(0, w.length - 2) : w;
        let at = text.indexOf(stemmed, target.offset);
        if (at < 0) at = text.indexOf(stemmed);
        if (at >= 0) return { target: { chapter: target.chapter, offset: Math.max(0, at - 200) }, flash: { chapter: target.chapter, start: at, end: at + w.length } };
      }
    }
    return { target, flash: null };
  }, [params, id]);

  useEffect(() => {
    if (!chapters?.length || loc) return;
    appliedLink.current = linkKey;
    void (async () => {
      const link = await linkTarget(chapters.length);
      const saved = link ? null : await latestPosition(id);
      const start: Locator = link?.target ?? (saved?.locator && chapters[saved.locator.chapter] ? saved.locator : { chapter: 0, offset: 0 });
      if (link?.flash) setFlash(link.flash);
      pending.current = start.offset;
      setLoc(start);
      setReadTo(start.offset);
    })();
  }, [chapters, loc, id, linkKey, linkTarget]);

  /* ── Текст текущей главы ── */
  useEffect(() => {
    if (!loc || book?.kind !== 'text') return;
    let stale = false;
    void db.contents.get([id, loc.chapter]).then((c) => {
      if (!stale) setContent(c ?? null);
    });
    return () => {
      stale = true;
    };
  }, [id, loc?.chapter, book?.kind]); // eslint-disable-line react-hooks/exhaustive-deps

  const step = useCallback((): number => (viewport.current ? viewport.current.clientWidth + GAP : 1), []);

  const goTo = useCallback((offset: number | 'end'): void => {
    const text = textRef.current;
    const sc = scroller.current;
    const vp = viewport.current;
    if (!text || !sc || !vp) return;
    if (offset === 'end') {
      if (paged) vp.scrollLeft = Math.max(0, Math.ceil(vp.scrollWidth / step()) - 1) * step();
      else sc.scrollTop = sc.scrollHeight;
      return;
    }
    if (offset <= 0) {
      vp.scrollLeft = 0;
      sc.scrollTop = 0;
      return;
    }
    const len = text.textContent?.length ?? 0;
    const rect = rangeAt(text, Math.min(offset, Math.max(0, len - 1)), Math.min(offset + 1, len))?.getBoundingClientRect();
    if (!rect) return;
    if (paged) {
      const x = rect.left - vp.getBoundingClientRect().left + vp.scrollLeft + 1;
      vp.scrollLeft = Math.floor(x / step()) * step();
    } else sc.scrollTop += rect.top - sc.getBoundingClientRect().top - 28;
  }, [paged, step]);

  /* ── Замер позиции: смещение текста у верхнего края (локатор) и у нижнего (дочитано до) ── */
  const measure = useCallback((): void => {
    const text = textRef.current;
    const sc = scroller.current;
    const vp = viewport.current;
    if (!text || !sc || !vp || !restored.current) return;
    const len = text.textContent?.length ?? 0;
    if (!len) return;
    let top: number;
    let bottom: number;
    if (paged) {
      const r = vp.getBoundingClientRect();
      const pages = Math.max(1, Math.round(vp.scrollWidth / step()));
      const page = Math.round(vp.scrollLeft / step());
      top = page === 0 ? 0 : offsetFromPoint(text, r.left + 4, r.top + 10);
      bottom = page >= pages - 1 ? len : offsetFromPoint(text, r.right - 4, r.bottom - 10);
      if (top < 0) top = Math.round((page / pages) * len);
      if (bottom < 0) bottom = Math.round(((page + 1) / pages) * len);
    } else {
      const sr = sc.getBoundingClientRect();
      const tr = text.getBoundingClientRect();
      const max = Math.max(1, sc.scrollHeight - sc.clientHeight);
      const atEnd = sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 3;
      top = sc.scrollTop <= 1 ? 0 : offsetFromPoint(text, tr.left + 8, Math.max(sr.top, tr.top) + 10);
      bottom = atEnd ? len : offsetFromPoint(text, tr.left + 8, Math.min(sr.bottom, tr.bottom) - 10);
      if (top < 0) top = Math.round((sc.scrollTop / max) * len);
      if (bottom < 0) bottom = Math.round(Math.min(1, (sc.scrollTop + sc.clientHeight) / sc.scrollHeight) * len);
    }
    setLoc((l) => (l && l.offset !== top ? { chapter: l.chapter, offset: top } : l));
    setReadTo(Math.max(top, bottom));
  }, [paged, step]);

  /* ── Отрисовка главы и выделений ── */
  const hlKey = highlights.filter((h) => h.chapter === loc?.chapter).map((h) => `${h.id}:${h.color}`).join(',');
  useLayoutEffect(() => {
    const text = textRef.current;
    if (!text || !content || content.order !== loc?.chapter) return;
    text.innerHTML = content.html; // HTML очищен DOMPurify при импорте
    for (const h of highlights) if (h.chapter === content.order) wrapRange(text, h.start, h.end, `hl-${h.color}`, h.id);
    if (flash && flash.chapter === content.order) wrapRange(text, flash.start, flash.end, 'hl-find');
    if (pending.current !== null) {
      const target = pending.current;
      pending.current = null;
      goTo(target);
      // Веб-шрифт может догрузиться позже и сдвинуть текст — возвращаемся на то же место.
      if (document.fonts?.status !== 'loaded') void document.fonts?.ready.then(() => goTo(target));
      restored.current = true;
      window.requestAnimationFrame(measure);
    }
  }, [content, hlKey, flash]); // eslint-disable-line react-hooks/exhaustive-deps

  /* Настройки вёрстки меняют раскладку — возвращаемся на то же место текста. */
  useEffect(() => {
    if (restored.current && loc && book?.kind === 'text') {
      const t = window.setTimeout(() => goTo(loc.offset), 60);
      return () => window.clearTimeout(t);
    }
  }, [st.fontSize, st.lineHeight, st.margin, st.fontFamily, st.columns, st.flow, wide, st.progressOpen, st.panelOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  /* Размер окна меняет ширину колонок и страниц — выравниваемся на то же место текста. */
  const locRef = useRef(loc);
  locRef.current = loc;
  useEffect(() => {
    let t = 0;
    const onResize = (): void => {
      window.clearTimeout(t);
      t = window.setTimeout(() => {
        if (restored.current && locRef.current) goTo(locRef.current.offset);
      }, 120);
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.clearTimeout(t);
    };
  }, [goTo]);

  /* ── Сохранение позиции и учёт сессии чтения ── */
  useEffect(() => {
    if (!book || !chapters || !loc || !restored.current && book.kind === 'text') return;
    const s = session.current;
    const now = Date.now();
    if (s.chapter !== loc.chapter) {
      s.chapter = loc.chapter;
      s.prev = readTo;
    }
    const delta = readTo - s.prev;
    if (book.kind === 'text' && delta > 0 && delta < 9000) {
      if (s.start && now - s.last > 5 * 60_000) {
        void logSession(book.id, s.start, s.last, s.chars);
        s.start = 0;
        s.chars = 0;
      }
      if (!s.start) s.start = now;
      s.chars += delta;
      s.last = now;
    }
    s.prev = Math.max(s.prev, readTo);
    const t = window.setTimeout(() => void savePosition(book, chapters, loc, readTo), 600);
    return () => window.clearTimeout(t);
  }, [loc, readTo]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const flush = (): void => {
      const s = session.current;
      if (s.start) void logSession(id, s.start, Math.max(s.last, s.start), s.chars);
      s.start = 0;
      s.chars = 0;
    };
    const onHide = (): void => {
      if (document.visibilityState === 'hidden') flush();
    };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', flush);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', flush);
      flush();
      ttsOn.current = false;
      window.speechSynthesis?.cancel();
    };
  }, [id]);

  /* ── Навигация ── */
  const jump = useCallback((target: Locator | { chapter: number; offset: 'end' }): void => {
    if (!chapters?.[target.chapter] || !loc) return;
    setSel(null);
    setDrawer(null);
    if (book?.kind !== 'text') {
      const off = target.offset === 'end' ? chapters[target.chapter]!.lengthChars - 1 : target.offset;
      setLoc({ chapter: target.chapter, offset: off });
      setReadTo(off + 1);
      return;
    }
    if (target.chapter === loc.chapter) {
      goTo(target.offset);
      window.requestAnimationFrame(measure);
      return;
    }
    pending.current = target.offset;
    restored.current = false; // пока новая глава не отрисована, замеры по старому тексту не принимаются
    const len = chapters[target.chapter]!.lengthChars;
    const off = target.offset === 'end' ? Math.max(0, len - 1) : target.offset;
    setLoc({ chapter: target.chapter, offset: off });
    setReadTo(off);
  }, [chapters, loc, book?.kind, goTo, measure]);

  /* Ссылка на место в уже открытой книге (источник в ответе ИИ, результат поиска). */
  useEffect(() => {
    if (!chapters?.length || !loc || appliedLink.current === linkKey) return;
    appliedLink.current = linkKey;
    void linkTarget(chapters.length).then((link) => {
      if (!link) return;
      setFlash(link.flash);
      jump(link.target);
    });
  }, [linkKey, chapters, loc, linkTarget, jump]);

  /** Клик по главе: начало главы; у текущей — место, где остановились. */
  const openChapter = (index: number): void => {
    if (!loc) return;
    jump(index === loc.chapter ? loc : { chapter: index, offset: 0 });
  };

  const turn = useCallback((dir: 1 | -1): void => {
    const sc = scroller.current;
    const vp = viewport.current;
    if (!loc || !chapters) return;
    if (book?.kind !== 'text') {
      const ch = chapters[loc.chapter]!;
      const next = loc.offset + dir;
      if (next >= 0 && next < ch.lengthChars) jump({ chapter: loc.chapter, offset: next });
      else if (dir > 0) jump({ chapter: loc.chapter + 1, offset: 0 });
      else if (loc.chapter > 0) jump({ chapter: loc.chapter - 1, offset: 'end' });
      return;
    }
    if (!sc || !vp) return;
    if (paged) {
      const max = Math.max(0, Math.ceil(vp.scrollWidth / step()) - 1) * step();
      if (dir > 0 && vp.scrollLeft >= max - 2) return jump({ chapter: loc.chapter + 1, offset: 0 });
      if (dir < 0 && vp.scrollLeft <= 2) return jump({ chapter: loc.chapter - 1, offset: 'end' });
      vp.scrollLeft = Math.round((vp.scrollLeft + dir * step()) / step()) * step();
      measure();
    } else {
      if (dir > 0 && sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 3) return jump({ chapter: loc.chapter + 1, offset: 0 });
      if (dir < 0 && sc.scrollTop <= 1) return jump({ chapter: loc.chapter - 1, offset: 'end' });
      sc.scrollTop += dir * Math.max(120, sc.clientHeight - 72);
    }
  }, [loc, chapters, book?.kind, paged, step, jump, measure]);

  const toggleProgress = useCallback((): void => {
    if (wide) st.set('progressOpen', !st.progressOpen);
    else setDrawer((d) => (d === 'progress' ? null : 'progress'));
  }, [wide, st]);
  const togglePanel = useCallback((): void => {
    if (wide) st.set('panelOpen', !st.panelOpen);
    else setDrawer((d) => (d === 'panel' ? null : 'panel'));
  }, [wide, st]);
  const showPanel = useCallback((): void => {
    if (wide) st.set('panelOpen', true);
    else setDrawer('panel');
  }, [wide, st]);

  /* ── Горячие клавиши ── */
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (document.querySelector('dialog[open]')) return;
      const k = e.key.toLowerCase();
      if (e.key === 'ArrowRight' || e.key === 'PageDown' || (e.key === ' ' && !e.shiftKey)) {
        if (e.key === ' ' && e.target instanceof HTMLElement && e.target.closest('button, a, [role="tab"]')) return;
        e.preventDefault();
        turn(1);
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp' || (e.key === ' ' && e.shiftKey)) {
        e.preventDefault();
        turn(-1);
      } else if (k === 'f' || k === 'а') {
        if (document.fullscreenElement) void document.exitFullscreen();
        else void document.documentElement.requestFullscreen?.();
      } else if (k === 't' || k === 'е') toggleProgress();
      else if (k === 'n' || k === 'т') {
        e.preventDefault();
        showPanel();
        window.setTimeout(() => panel.current?.focusNote(), 30);
      } else if (e.key === 'Escape') {
        setSel(null);
        setMarkMenu(null);
        setDrawer(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [turn, toggleProgress, showPanel]);

  /* ── Выделение текста → плавающее меню ── */
  useEffect(() => {
    let t = 0;
    const onSel = (): void => {
      window.clearTimeout(t);
      t = window.setTimeout(() => {
        const s = window.getSelection();
        const text = textRef.current;
        if (!s || s.isCollapsed || !s.rangeCount || !text) return setSel(null);
        const r = s.getRangeAt(0);
        if (!text.contains(r.startContainer) || !text.contains(r.endContainer)) return setSel(null);
        const start = textOffset(text, r.startContainer, r.startOffset);
        const end = textOffset(text, r.endContainer, r.endOffset);
        const str = s.toString().trim();
        if (start < 0 || end <= start || !str) return setSel(null);
        const rect = r.getBoundingClientRect();
        setMarkMenu(null);
        setSel({ start, end, text: str, x: rect.left + rect.width / 2, y: rect.bottom + 10 });
      }, 180);
    };
    document.addEventListener('selectionchange', onSel);
    return () => {
      document.removeEventListener('selectionchange', onSel);
      window.clearTimeout(t);
    };
  }, []);

  const mark = async (color: HighlightColor): Promise<string | undefined> => {
    if (!sel || !book || !chapter) return undefined;
    const h = await addHighlight(book, chapter, sel, color);
    window.getSelection()?.removeAllRanges();
    setSel(null);
    return h.id;
  };

  const onTextClick = (e: React.MouseEvent): void => {
    const target = e.target as HTMLElement;
    const link = target.closest('a');
    if (link) {
      const href = link.getAttribute('href') ?? '';
      if (href.startsWith('#')) {
        e.preventDefault();
        void showFootnote(href.slice(1));
      }
      return;
    }
    const m = target.closest<HTMLElement>('mark[data-hl]');
    if (m?.dataset.hl && window.getSelection()?.isCollapsed) {
      const r = m.getBoundingClientRect();
      setMarkMenu({ id: m.dataset.hl, x: r.left + r.width / 2, y: r.bottom + 8 });
    } else setMarkMenu(null);
  };

  const showFootnote = async (anchor: string): Promise<void> => {
    let el: Element | null = textRef.current?.querySelector(`[id="${CSS.escape(anchor)}"]`) ?? null;
    if (!el) {
      const all = await db.contents.where('bookId').equals(id).toArray();
      for (const c of all) {
        if (!c.html.includes(`id="${anchor}"`)) continue;
        el = new DOMParser().parseFromString(c.html, 'text/html').getElementById(anchor);
        if (el) break;
      }
    }
    const text = (el?.textContent ?? '').trim();
    setFootnote(text ? text.slice(0, 2000) : 'Сноска не найдена в файле книги.');
    noteDlg.current?.showModal();
  };

  /* ── Озвучка ── */
  const toggleTts = (): void => {
    const synth = window.speechSynthesis;
    if (!synth) return say('В этом браузере нет озвучки.');
    if (tts) {
      ttsOn.current = false; // cancel() в части браузеров завершает фразу событием end — оно не должно запускать следующую
      synth.cancel();
      setTts(false);
      return;
    }
    if (!content || !loc) return;
    const sentences = content.text.slice(loc.offset).match(/[^.!?…]+[.!?…]*\s*/g) ?? [];
    let offset = loc.offset;
    let i = 0;
    const next = (): void => {
      if (!ttsOn.current) return;
      const sentence = sentences[i];
      if (!sentence) {
        ttsOn.current = false;
        return setTts(false);
      }
      const u = new SpeechSynthesisUtterance(sentence);
      u.lang = book?.lang ?? (/[а-яё]/i.test(sentence) ? 'ru-RU' : 'en-US');
      const at = offset;
      u.onstart = () => goTo(at);
      u.onend = () => {
        offset += sentence.length;
        i += 1;
        next();
      };
      u.onerror = () => {
        ttsOn.current = false;
        setTts(false);
      };
      synth.speak(u);
    };
    ttsOn.current = true;
    setTts(true);
    next();
  };

  /* ── Поиск по книге ── */
  useEffect(() => {
    const q = findQ.trim().toLowerCase();
    if (q.length < 2) return setFindHits([]);
    let stale = false;
    const t = window.setTimeout(() => {
      void db.contents.where('bookId').equals(id).sortBy('order').then((all) => {
        const hits: { chapter: number; offset: number; text: string }[] = [];
        for (const c of all) {
          const lower = c.text.toLowerCase();
          for (let at = lower.indexOf(q); at >= 0 && hits.length < 60; at = lower.indexOf(q, at + q.length)) {
            hits.push({ chapter: c.order, offset: at, text: c.text.slice(Math.max(0, at - 50), at + q.length + 70).replace(/\s+/g, ' ') });
          }
        }
        if (!stale) setFindHits(hits);
      });
    }, 200);
    return () => {
      stale = true;
      window.clearTimeout(t);
    };
  }, [findQ, id]);

  /* ── Производные ── */
  const rows = useMemo(() => (chapters && loc ? chapterRows(chapters, progress, loc.chapter, readTo) : []), [chapters, progress, loc, readTo]);
  const speed = useMemo(() => readingSpeed(sessions), [sessions]);
  const today = useMemo(() => todayStats(sessions), [sessions]);
  const streak = useMemo(() => readingStreak(sessions), [sessions]);

  if (book === undefined || chapters === undefined) return <p className="mono p-8">Открываю книгу…</p>;
  if (!book || book.deleted) {
    return (
      <div className="page pt-16">
        <h1 className="display text-[40px]">Такой книги нет<span className="dot">.</span></h1>
        <p className="mt-4 text-text-2">Возможно, её удалили. <Link href="/" className="underline">Вернуться на полку</Link></p>
      </div>
    );
  }
  if (!chapters.length) return <FromCloud book={book} />;
  if (!loc || !chapter) return <p className="mono p-8">Открываю книгу…</p>;

  const bookPct = Math.round(totalProgress(rows) * 100);
  const row = rows[loc.chapter]!;
  const chapterLeft = Math.max(0, chapter.lengthChars - Math.max(readTo, chapter.lengthChars * row.percent));
  const page = book.kind === 'text' ? pageFor(chapter, loc.offset) : book.kind === 'pages' ? chapter.startPage + loc.offset : loc.offset;
  const parent = chapter.parentId ? chapters.find((c) => c.id === chapter.parentId) : undefined;
  const theme = THEMES[st.theme];
  const progressShown = wide ? st.progressOpen : drawer === 'progress';
  const panelShown = wide ? st.panelOpen : drawer === 'panel';
  const menuStyle = (x: number, y: number): React.CSSProperties => wide
    ? { position: 'fixed', left: Math.min(Math.max(x, 240), window.innerWidth - 240), top: Math.min(y, window.innerHeight - 130), transform: 'translateX(-50%)', zIndex: 40 }
    : { position: 'fixed', left: 8, right: 8, bottom: 72, zIndex: 40 };

  return (
    <div className="flex flex-col" style={{ height: '100dvh' }}>
      {/* Верхняя панель */}
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line px-3 py-2 md:px-5">
        <Link href="/" className="icon-btn" aria-label="Назад на полку"><ArrowLeft size={18} aria-hidden /></Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-display text-[15px] font-semibold md:text-[17px]">{book.title}</h1>
          <p className="mono truncate">
            {[book.sourceLabel, parent?.title, chapter.title, book.kind === 'audio' ? null : `стр. ${page} / ${book.pages}`].filter(Boolean).join(' · ')}
          </p>
        </div>
        <p className="hidden text-[13px] text-text-2 xl:block" aria-live="off">
          Глава {chapterNumber(chapters, loc.chapter)} · {Math.round(row.percent * 100)}% главы · {bookPct}% книги
        </p>
        {book.kind === 'text' && (
          <div className="hidden items-center gap-2 lg:flex">
            <div className="flex rounded-pill border border-line-3 p-[3px]" role="group" aria-label="Тема страницы">
              {(Object.keys(THEMES) as ReaderTheme[]).map((t) => (
                <button key={t} type="button" aria-pressed={st.theme === t} onClick={() => st.set('theme', t)}
                  className="rounded-pill px-3 font-mono text-[11px] font-semibold uppercase tracking-[0.12em]"
                  style={{ minHeight: 38, background: st.theme === t ? 'var(--text)' : 'transparent', color: st.theme === t ? 'var(--bg)' : 'var(--text-2)' }}>
                  {THEMES[t].label}
                </button>
              ))}
            </div>
            <button type="button" className="icon-btn" onClick={() => st.set('fontSize', Math.max(13, st.fontSize - 1))}><span aria-hidden>А−</span><span className="sr-only">Уменьшить шрифт</span></button>
            <span className="mono w-6 text-center" aria-label={`Размер шрифта ${st.fontSize}`}>{st.fontSize}</span>
            <button type="button" className="icon-btn" onClick={() => st.set('fontSize', Math.min(34, st.fontSize + 1))}><span aria-hidden>А+</span><span className="sr-only">Увеличить шрифт</span></button>
            <button type="button" className="icon-btn" aria-pressed={tts} aria-label={tts ? 'Остановить озвучку' : 'Озвучить с этого места'} onClick={toggleTts}>
              {tts ? <VolumeX size={18} aria-hidden /> : <Volume2 size={18} aria-hidden />}
            </button>
          </div>
        )}
        <div className="flex items-center gap-2">
          <button type="button" className="icon-btn" aria-pressed={progressShown} aria-label="Прогресс и оглавление (T)" onClick={toggleProgress}><PanelLeft size={18} aria-hidden /></button>
          {book.kind === 'text' && <button type="button" className="icon-btn" aria-label="Поиск по книге и закладки" onClick={() => findDlg.current?.showModal()}><Search size={18} aria-hidden /></button>}
          <button type="button" className="icon-btn" aria-label="Настройки чтения" onClick={() => settingsDlg.current?.showModal()}><Settings2 size={18} aria-hidden /></button>
          <button type="button" className="icon-btn" aria-pressed={panelShown} aria-label="ИИ-толкователь и заметки" onClick={togglePanel}><PanelRight size={18} aria-hidden /></button>
        </div>
      </header>

      <div className="relative flex min-h-0 flex-1">
        {!wide && drawer && <button type="button" aria-label="Закрыть панель" className="fixed inset-0 z-20 bg-black/60" onClick={() => setDrawer(null)} />}

        {progressShown && (
          <aside aria-label="Прогресс" className={`flex-none border-r border-line bg-bg-2 ${wide ? '' : 'fixed inset-y-0 left-0 z-30'}`} style={{ width: 300, maxWidth: '88vw' }}>
            <ProgressSidebar book={book} rows={rows} speed={speed} highlights={highlights} notes={notes} today={today} streak={streak} currentLeft={chapterLeft} onGo={openChapter} />
          </aside>
        )}

        {/* Страница */}
        <div
          ref={scroller}
          className="min-w-0 flex-1"
          style={{ overflowY: paged || book.kind !== 'text' ? (book.kind === 'text' ? 'hidden' : 'auto') : 'auto', padding: book.kind === 'text' ? (wide ? '28px 24px' : '12px 8px') : 0 }}
          onScroll={() => !paged && measure()}
          onTouchStart={(e) => {
            const t = e.touches[0]!;
            (scroller.current as HTMLDivElement & { _t?: { x: number; y: number } })._t = { x: t.clientX, y: t.clientY };
          }}
          onTouchEnd={(e) => {
            const s = (scroller.current as HTMLDivElement & { _t?: { x: number; y: number } })._t;
            const t = e.changedTouches[0]!;
            if (!s) return;
            const dx = t.clientX - s.x;
            if (Math.abs(dx) < 70 || Math.abs(t.clientY - s.y) > 50 || !window.getSelection()?.isCollapsed) return;
            if (s.x < 28 && dx > 0) setDrawer('progress'); // свайп от левого края
            else if (paged) turn(dx < 0 ? 1 : -1);
          }}
        >
          {book.kind === 'pages' && <PagesView book={book} page={page} onPage={(p) => {
            const idx = chapters.findIndex((c) => p >= c.startPage && p <= c.endPage);
            if (idx >= 0) jump({ chapter: idx, offset: p - chapters[idx]!.startPage });
          }} />}
          {book.kind === 'audio' && <AudioView bookId={book.id} start={loc.offset} onTime={(sec) => {
            setLoc({ chapter: 0, offset: sec });
            setReadTo(sec);
          }} />}
          {book.kind === 'text' && (
            <article
              className="mx-auto flex flex-col"
              lang={book.lang}
              style={{
                maxWidth: paged && st.columns === 2 && wide ? 1180 : 680 + st.margin * 2 - 112, background: theme.bg, color: theme.fg,
                padding: wide ? `${Math.min(64, st.margin)}px ${st.margin}px` : `24px ${Math.min(24, st.margin)}px`,
                height: paged ? '100%' : undefined, minHeight: paged ? undefined : '100%',
              }}
            >
              <p className="mb-6 font-mono text-[11px] uppercase tracking-[0.12em]" style={{ opacity: 0.7 }}>
                {[parent?.title, chapter.title].filter(Boolean).join(' · ')}
              </p>
              <div ref={viewport} className="min-h-0 flex-1" style={paged ? { overflow: 'hidden' } : undefined}>
                <div
                  ref={textRef}
                  className="book-text"
                  onClick={onTextClick}
                  style={{
                    ['--book-size' as string]: `${st.fontSize}px`, ['--book-lh' as string]: st.lineHeight, ['--book-font' as string]: FONTS[st.fontFamily],
                    ...(paged ? { height: '100%', columnCount: wide ? st.columns : 1, columnGap: GAP, columnFill: 'auto' as const } : {}),
                  }}
                />
              </div>
              {!paged && (
                <div className="mt-10 flex flex-wrap justify-between gap-3 font-sans">
                  <button type="button" className="pill pill-sm" style={{ color: 'inherit', borderColor: 'currentColor' }} disabled={loc.chapter === 0}
                    onClick={() => jump({ chapter: loc.chapter - 1, offset: 0 })}>← Предыдущая глава</button>
                  <button type="button" className="pill pill-sm" style={{ color: 'inherit', borderColor: 'currentColor' }} disabled={loc.chapter >= chapters.length - 1}
                    onClick={() => jump({ chapter: loc.chapter + 1, offset: 0 })}>Следующая глава →</button>
                </div>
              )}
            </article>
          )}
        </div>

        {panelShown && (
          <aside aria-label="ИИ-толкователь и заметки" className={`flex-none border-l border-line bg-bg ${wide ? '' : 'fixed inset-y-0 right-0 z-30'}`} style={{ width: 380, maxWidth: '92vw' }}>
            <SidePanel ref={panel} book={book} chapter={chapter} locator={loc} page={page} notes={notes} onJump={jump} />
          </aside>
        )}
      </div>

      {/* Сегментированная полоса глав */}
      <footer className="border-t border-line px-4 md:px-6">
        <SegmentBar rows={rows} onGo={openChapter}
          label={`${bookPct}%${book.kind === 'text' && bookPct < 100 ? ` · ${leftLabel(charsLeft(rows), speed)} до конца` : ''}`} />
      </footer>

      {/* Меню выделения */}
      {sel && (
        <div role="toolbar" aria-label="Действия с выделенным текстом" style={menuStyle(sel.x, sel.y)}
          className="flex flex-wrap items-center justify-center gap-1 rounded-[26px] border border-line-3 p-1" onMouseDown={(e) => e.preventDefault()}>
          <span className="absolute inset-0 -z-10 rounded-[26px] bg-ink" aria-hidden />
          <button type="button" className="pill pill-sm pill-accent" onClick={() => {
            const s = sel;
            void mark('accent');
            showPanel();
            window.setTimeout(() => panel.current?.ask('Объясни это место', s.text), 60);
          }}>Спросить ИИ</button>
          <button type="button" className="pill pill-sm pill-ghost" onClick={() => {
            void mark('orange').then((hid) => {
              showPanel();
              window.setTimeout(() => panel.current?.focusNote(hid), 60);
            });
          }}>Заметка</button>
          <button type="button" className="pill pill-sm pill-ghost" onClick={() => {
            const s = sel;
            void mark('accent').then((hid) => addNote({ kind: 'quote', bodyMd: s.text, bookId: book.id, chapter, locator: { chapter: loc.chapter, offset: s.start }, highlightId: hid }));
            say('Цитата сохранена в «Поля»');
          }}>Цитата</button>
          <button type="button" className="pill pill-sm pill-ghost" onClick={() => {
            const s = sel;
            setSel(null);
            showPanel();
            window.setTimeout(() => panel.current?.ask('Переведи это место на русский; если оно уже по-русски — на английский', s.text), 60);
          }}>Перевести</button>
          <button type="button" className="icon-btn" style={{ border: 0 }} aria-label="Выделить цветом" onClick={() => void mark('accent')}>
            <i aria-hidden style={{ width: 16, height: 16, borderRadius: '50%', background: 'var(--accent)' }} />
          </button>
          <button type="button" className="icon-btn" style={{ border: 0 }} aria-label="Подчеркнуть оранжевым" onClick={() => void mark('orange')}>
            <i aria-hidden style={{ width: 16, height: 3, background: 'var(--accent-2)' }} />
          </button>
        </div>
      )}
      {markMenu && (
        <div role="toolbar" aria-label="Выделение" style={menuStyle(markMenu.x, markMenu.y)} className="flex gap-1 rounded-[26px] border border-line-3 bg-ink p-1">
          <button type="button" className="pill pill-sm pill-ghost" onClick={() => {
            void removeHighlight(markMenu.id);
            setMarkMenu(null);
          }}>Убрать выделение</button>
          <button type="button" className="pill pill-sm pill-ghost" onClick={() => {
            const hid = markMenu.id;
            setMarkMenu(null);
            showPanel();
            window.setTimeout(() => panel.current?.focusNote(hid), 60);
          }}>Заметка к нему</button>
        </div>
      )}

      <p role="status" aria-live="polite" className={toast ? 'pill pill-accent fixed bottom-20 left-1/2 z-50 -translate-x-1/2' : 'sr-only'}>{toast}</p>

      {/* Сноска */}
      <dialog ref={noteDlg} aria-label="Сноска" className="max-w-[520px] border border-line-2 bg-bg-2 p-6 text-text backdrop:bg-black/60"
        onClick={(e) => e.target === noteDlg.current && noteDlg.current?.close()}>
        <p className="mono">Сноска</p>
        <p className="mt-3 whitespace-pre-wrap font-book text-[16px] leading-relaxed">{footnote}</p>
        <button type="button" className="pill pill-sm mt-5" autoFocus onClick={() => noteDlg.current?.close()}>Закрыть</button>
      </dialog>

      {/* Поиск по книге и закладки */}
      <dialog ref={findDlg} aria-label="Поиск по книге и закладки" className="w-full max-w-[640px] border border-line-2 bg-bg-2 p-0 text-text backdrop:bg-black/60"
        onClick={(e) => e.target === findDlg.current && findDlg.current?.close()}>
        <div className="flex max-h-[80vh] flex-col">
          <div className="border-b border-line p-5">
            <label htmlFor="find" className="mono">Поиск по книге</label>
            <input id="find" autoFocus className="field mt-2" value={findQ} onChange={(e) => setFindQ(e.target.value)} placeholder="Слово или фраза" autoComplete="off" />
          </div>
          <div className="overflow-y-auto">
            {findQ.trim().length >= 2 && (
              <p className="mono px-5 pt-4" aria-live="polite">{findHits.length ? `Найдено: ${findHits.length}${findHits.length === 60 ? '+' : ''}` : 'Ничего не найдено'}</p>
            )}
            <ul>
              {findHits.map((h, i) => (
                <li key={i} className="border-b border-line">
                  <button type="button" className="block w-full px-5 py-3 text-left hover:bg-surface" onClick={() => {
                    findDlg.current?.close();
                    setFlash({ chapter: h.chapter, start: h.offset, end: h.offset + findQ.trim().length });
                    jump({ chapter: h.chapter, offset: h.offset });
                  }}>
                    <span className="mono block">{chapters[h.chapter]?.title}</span>
                    <span className="text-[14px] text-text-2">…{snippet(h.text, findQ, 70)}</span>
                  </button>
                </li>
              ))}
            </ul>
            <div className="p-5">
              <div className="flex items-center justify-between gap-3">
                <h2 className="mono">Закладки</h2>
                <button type="button" className="pill pill-sm" onClick={() => {
                  void addBookmark(book.id, loc, `${chapter.title} · стр. ${page}`);
                  say('Закладка поставлена');
                }}><Bookmark size={14} aria-hidden /> Поставить здесь</button>
              </div>
              {bookmarks.length === 0 && <p className="mt-3 text-[14px] text-text-2">Закладок пока нет.</p>}
              <ul className="mt-2">
                {bookmarks.map((b) => (
                  <li key={b.id} className="flex items-center justify-between gap-2 border-b border-line">
                    <button type="button" className="min-h-[44px] flex-1 text-left text-[14px]" onClick={() => {
                      findDlg.current?.close();
                      jump(b.locator);
                    }}>{b.label}</button>
                    <button type="button" className="mono min-h-[44px] underline underline-offset-4" onClick={() => void removeBookmark(b.id)}>Убрать</button>
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <div className="border-t border-line p-4"><button type="button" className="pill pill-sm" onClick={() => findDlg.current?.close()}>Закрыть</button></div>
        </div>
      </dialog>

      {/* Настройки чтения */}
      <dialog ref={settingsDlg} aria-label="Настройки чтения" className="w-full max-w-[480px] border border-line-2 bg-bg-2 p-6 text-text backdrop:bg-black/60"
        onClick={(e) => e.target === settingsDlg.current && settingsDlg.current?.close()}>
        <h2 className="font-display text-[20px] font-semibold">Настройки чтения</h2>
        <div className="mt-5 grid gap-5">
          <Choice label="Тема" value={st.theme} options={[['night', 'Ночь'], ['paper', 'Бумага'], ['sepia', 'Сепия']]} onChange={(v) => st.set('theme', v as ReaderTheme)} />
          <Choice label="Шрифт" value={st.fontFamily} options={[['literata', 'Literata'], ['golos', 'Golos'], ['mono', 'Mono']]} onChange={(v) => st.set('fontFamily', v as 'literata')} />
          <Range label="Размер" value={st.fontSize} min={13} max={34} step={1} onChange={(v) => st.set('fontSize', v)} />
          <Range label="Интервал" value={st.lineHeight} min={1.2} max={2.2} step={0.05} onChange={(v) => st.set('lineHeight', v)} />
          <Range label="Поля" value={st.margin} min={16} max={96} step={8} onChange={(v) => st.set('margin', v)} />
          <Choice label="Листание" value={st.flow} options={[['scroll', 'Прокрутка'], ['paged', 'Страницы']]} onChange={(v) => st.set('flow', v as 'scroll')} />
          {st.flow === 'paged' && <Choice label="Колонки" value={String(st.columns)} options={[['1', 'Одна'], ['2', 'Две']]} onChange={(v) => st.set('columns', Number(v) as 1 | 2)} />}
          <fieldset>
            <legend className="mono">Акцент</legend>
            <div className="mt-2 flex gap-2">
              {ACCENTS.map((a) => (
                <button key={a} type="button" aria-pressed={st.accent === a} aria-label={`Цвет акцента ${a}`} onClick={() => st.set('accent', a)}
                  className="icon-btn" style={{ background: a, borderColor: st.accent === a ? 'var(--text)' : a, borderWidth: 3 }} />
              ))}
            </div>
          </fieldset>
          <div className="flex flex-wrap gap-2 lg:hidden">
            <button type="button" className="pill pill-sm" aria-pressed={tts} onClick={toggleTts}>{tts ? 'Остановить озвучку' : 'Озвучить'}</button>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="pill pill-sm" onClick={() => document.fullscreenElement ? void document.exitFullscreen() : void document.documentElement.requestFullscreen?.()}>
              <Maximize size={14} aria-hidden /> Полный экран (F)
            </button>
            <Link href={`/book?id=${book.id}`} className="pill pill-sm">Страница книги</Link>
          </div>
          <p className="text-[13px] text-muted">Клавиши: ← → и Пробел — листать, F — полный экран, N — заметка, T — прогресс.</p>
        </div>
        <button type="button" className="pill pill-accent mt-6" onClick={() => settingsDlg.current?.close()}>Готово</button>
      </dialog>
    </div>
  );
}

function Choice({ label, value, options, onChange }: { label: string; value: string; options: [string, string][]; onChange: (v: string) => void }) {
  return (
    <fieldset>
      <legend className="mono">{label}</legend>
      <div className="mt-2 flex flex-wrap gap-2">
        {options.map(([v, l]) => <button key={v} type="button" className="pill pill-sm" aria-pressed={value === v} onClick={() => onChange(v)}>{l}</button>)}
      </div>
    </fieldset>
  );
}

function Range({ label, value, min, max, step, onChange }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void }) {
  const idFor = `r-${label}`;
  return (
    <div>
      <label htmlFor={idFor} className="mono flex justify-between"><span>{label}</span><span>{Math.round(value * 100) / 100}</span></label>
      <input id={idFor} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))}
        className="mt-2 w-full" style={{ accentColor: 'var(--accent)', minHeight: 32 }} />
    </div>
  );
}

function AudioView({ bookId, start, onTime }: { bookId: string; start: number; onTime: (sec: number) => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const initial = useRef(start);
  useEffect(() => {
    let u: string | null = null;
    void db.files.get(bookId).then((f) => {
      if (!f) return setMissing(true);
      u = URL.createObjectURL(f.blob);
      setUrl(u);
    });
    return () => {
      if (u) URL.revokeObjectURL(u);
    };
  }, [bookId]);
  if (missing) return <p className="m-auto max-w-[420px] p-8 text-center text-text-2">Файла аудиокниги нет на этом устройстве. Закинь его ещё раз.</p>;
  return (
    <div className="flex h-full items-center justify-center p-6">
      {url && (
        <audio controls src={url} className="w-full max-w-[640px]" aria-label="Аудиокнига"
          onLoadedMetadata={(e) => { e.currentTarget.currentTime = initial.current; }}
          onTimeUpdate={(e) => {
            const sec = Math.floor(e.currentTarget.currentTime);
            if (sec % 5 === 0) onTime(sec);
          }} />
      )}
    </div>
  );
}

/** Файла книги на этом устройстве нет — скачиваем его из облака сами. */
function FromCloud({ book }: { book: Book }) {
  const [state, setState] = useState<'loading' | 'error'>('loading');
  const [message, setMessage] = useState('');
  const started = useRef(false);
  const run = useCallback(() => {
    setState('loading');
    void downloadBook(book).then((err) => {
      if (err) {
        setMessage(err);
        setState('error');
      }
    });
  }, [book]);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    run();
  }, [run]);
  return (
    <div className="page pt-16" aria-live="polite">
      <h1 className="display text-[clamp(28px,5vw,48px)]">{book.title}<span className="dot">.</span></h1>
      {state === 'loading' ? (
        <p className="mono mt-4">Скачиваю книгу из облака…</p>
      ) : (
        <>
          <p className="mt-4 max-w-[560px] text-[17px] text-text-2">{message}</p>
          <div className="mt-6 flex flex-wrap gap-3">
            <button type="button" className="pill pill-accent" onClick={run}>Попробовать ещё раз</button>
            <Link href="/cloud" className="pill">Закинуть файл вручную</Link>
          </div>
        </>
      )}
    </div>
  );
}

function ReaderEntry() {
  const params = useSearchParams();
  const books = useBooks();
  const id = params.get('id') ?? lastBook(books)?.id ?? null;
  if (!id) {
    if (books === undefined) return <p className="mono p-8">Открываю…</p>;
    return (
      <div className="page pt-16">
        <h1 className="display text-[clamp(28px,5vw,48px)]">Читать пока нечего<span className="dot">.</span></h1>
        <p className="mt-4 text-[17px] text-text-2">На полке пока пусто — закинь первую книгу.</p>
        <Link href="/cloud" className="pill pill-accent mt-6">Закинуть книгу</Link>
      </div>
    );
  }
  return <Reader key={id} id={id} />;
}

export default function ReaderPage() {
  return (
    <Suspense fallback={<p className="mono p-8">Открываю…</p>}>
      <ReaderEntry />
    </Suspense>
  );
}
