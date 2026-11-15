'use client';
import { Minus, Plus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { db } from '@/lib/db';
import type { Book } from '@/lib/types';

type Pdf = import('pdfjs-dist').PDFDocumentProxy;
interface Source { pdf?: Pdf; zip?: import('jszip'); names?: string[] }

/** Одна страница: рисуется, только пока она рядом с экраном. */
function PageBody({ source, n, width }: { source: Source; n: number; width: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [img, setImg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let url: string | null = null;
    let task: { cancel: () => void } | null = null;
    void (async () => {
      if (source.pdf) {
        const p = await source.pdf.getPage(n);
        const c = canvas.current;
        if (cancelled || !c) return;
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const vp = p.getViewport({ scale: (width / p.getViewport({ scale: 1 }).width) * dpr });
        c.width = Math.ceil(vp.width);
        c.height = Math.ceil(vp.height);
        const ctx = c.getContext('2d');
        if (!ctx) return;
        const render = p.render({ canvasContext: ctx, viewport: vp });
        task = render;
        await render.promise.catch(() => undefined);
      } else if (source.zip && source.names) {
        const name = source.names[n - 1];
        const blob = name ? await source.zip.file(name)?.async('blob') : null;
        if (blob && !cancelled) {
          url = URL.createObjectURL(blob);
          setImg(url);
        }
      }
    })();
    return () => {
      cancelled = true;
      task?.cancel();
      if (url) URL.revokeObjectURL(url);
    };
  }, [source, n, width]);

  if (source.pdf) return <canvas ref={canvas} role="img" aria-label={`Страница ${n}`} style={{ width: '100%', display: 'block' }} />;
  // eslint-disable-next-line @next/next/no-img-element
  return img ? <img src={img} alt={`Страница ${n}`} style={{ width: '100%', display: 'block' }} /> : null;
}

/**
 * Постраничные книги (сканы PDF, комиксы CBZ) сплошной лентой: страницы идут друг за другом и прокручиваются,
 * как обычный текст. page — номер страницы с 1; onPage сообщает страницу у верхнего края экрана.
 */
export function PagesView({ book, page, onPage }: { book: Book; page: number; onPage: (p: number) => void }) {
  const [zoom, setZoom] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<Source | null>(null);
  const [ratio, setRatio] = useState(1.414); // высота / ширина
  const [base, setBase] = useState(800);
  const [near, setNear] = useState<Set<number>>(new Set());
  const list = useRef<HTMLOListElement>(null);
  const reported = useRef(page);

  useEffect(() => {
    let cancelled = false;
    let opened: Pdf | undefined;
    void (async () => {
      const file = await db.files.get(book.id);
      if (!file) {
        setError('Файла этой книги нет на этом устройстве. Закинь его ещё раз — прогресс и заметки сохранятся.');
        return;
      }
      const buf = await file.blob.arrayBuffer();
      if (book.format === 'pdf') {
        const { loadPdfJs } = await import('@/lib/import/pdf');
        const pdf = await (await loadPdfJs()).getDocument({ data: new Uint8Array(buf) }).promise;
        opened = pdf;
        const vp = (await pdf.getPage(1)).getViewport({ scale: 1 });
        if (cancelled) return;
        setRatio(vp.height / vp.width);
        setSource({ pdf });
      } else {
        const { default: JSZip } = await import('jszip');
        const zip = await JSZip.loadAsync(buf);
        const names = Object.values(zip.files).filter((f) => !f.dir && /\.(jpe?g|png|gif|webp)$/i.test(f.name)).map((f) => f.name)
          .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
        const first = names[0] ? await zip.file(names[0])?.async('blob') : null;
        if (first) {
          const bmp = await createImageBitmap(first).catch(() => null);
          if (bmp && !cancelled) setRatio(bmp.height / bmp.width);
        }
        if (!cancelled) setSource({ zip, names });
      }
    })().catch(() => setError('Не получилось открыть файл книги.'));
    return () => {
      cancelled = true;
      void opened?.destroy();
    };
  }, [book.id, book.format]);

  // Ширина страницы подстраивается под экран.
  useEffect(() => {
    const update = (): void => setBase(Math.min(900, window.innerWidth - 24));
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  // Какие страницы рядом с экраном (их рисуем) и какая сейчас у верхнего края (её сообщаем наверх).
  useEffect(() => {
    const root = list.current;
    if (!root || !source) return;
    const io = new IntersectionObserver((entries) => {
      setNear((prev) => {
        const next = new Set(prev);
        for (const e of entries) {
          const n = Number((e.target as HTMLElement).dataset.page);
          if (e.isIntersecting) next.add(n);
          else next.delete(n);
        }
        return next;
      });
    }, { rootMargin: '900px 0px' });
    root.querySelectorAll('[data-page]').forEach((el) => io.observe(el));

    let frame = 0;
    const onScroll = (): void => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        const line = Math.min(window.innerHeight * 0.4, 260);
        for (const el of root.querySelectorAll<HTMLElement>('[data-page]')) {
          const r = el.getBoundingClientRect();
          if (r.bottom > line) {
            const n = Number(el.dataset.page);
            if (n !== reported.current) {
              reported.current = n;
              onPage(n);
            }
            break;
          }
        }
      });
    };
    document.addEventListener('scroll', onScroll, true);
    return () => {
      io.disconnect();
      document.removeEventListener('scroll', onScroll, true);
      window.cancelAnimationFrame(frame);
    };
  }, [source, book.pages]); // eslint-disable-line react-hooks/exhaustive-deps

  // Переход извне (оглавление, полоса глав, клавиши) и первое открытие — прокручиваем к странице.
  const first = useRef(true);
  useEffect(() => {
    if (!source) return;
    if (!first.current && page === reported.current) return;
    first.current = false;
    reported.current = page;
    list.current?.querySelector(`[data-page="${page}"]`)?.scrollIntoView({ block: 'start' });
  }, [page, source, zoom, base]);

  if (error) return <p className="m-auto max-w-[420px] p-8 text-center text-text-2">{error}</p>;
  const width = Math.round(base * zoom);

  return (
    <div className="flex min-h-full flex-col items-center gap-3 px-3 pb-10">
      <div className="sticky top-2 z-10 flex items-center gap-2 rounded-pill border border-line-2 bg-bg p-1">
        <button type="button" className="icon-btn" aria-label="Уменьшить" onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}><Minus size={16} aria-hidden /></button>
        <span className="mono w-12 text-center" aria-live="polite">{Math.round(zoom * 100)}%</span>
        <button type="button" className="icon-btn" aria-label="Увеличить" onClick={() => setZoom((z) => Math.min(3, z + 0.25))}><Plus size={16} aria-hidden /></button>
        <span className="mono px-3">стр. {page} / {book.pages}</span>
      </div>
      {book.format === 'pdf' && (
        <p className="max-w-[640px] text-center text-[13px] text-muted">Это скан: текст в нём не распознан, поэтому выделения и поиск по этой книге недоступны.</p>
      )}
      {!source && <p className="mono">Открываю страницы…</p>}
      <div className="max-w-full overflow-x-auto">
        <ol ref={list} className="flex flex-col gap-3" aria-label="Страницы книги">
          {source && Array.from({ length: book.pages }, (_, i) => i + 1).map((n) => (
            <li key={n} data-page={n} className="bg-surface" style={{ width, minHeight: Math.round(width * ratio), scrollMarginTop: 64 }}>
              {near.has(n) && <PageBody source={source} n={n} width={width} />}
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
