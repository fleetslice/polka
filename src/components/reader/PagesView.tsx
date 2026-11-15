'use client';
import { Minus, Plus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { db } from '@/lib/db';
import type { Book } from '@/lib/types';

/** Постраничный режим: сканы PDF (рендер pdf.js) и комиксы CBZ. page — номер страницы с 1. */
export function PagesView({ book, page, onPage }: { book: Book; page: number; onPage: (p: number) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [zoom, setZoom] = useState(1);
  const [img, setImg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const source = useRef<{ pdf?: import('pdfjs-dist').PDFDocumentProxy; zip?: import('jszip'); names?: string[] }>({});
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const file = await db.files.get(book.id);
      if (!file) {
        setError('Файла этой книги нет на этом устройстве. Закинь его ещё раз — прогресс и заметки сохранятся.');
        return;
      }
      const buf = await file.blob.arrayBuffer();
      if (book.format === 'pdf') {
        const { loadPdfJs } = await import('@/lib/import/pdf');
        const pdfjs = await loadPdfJs();
        source.current.pdf = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;
      } else {
        const { default: JSZip } = await import('jszip');
        const zip = await JSZip.loadAsync(buf);
        source.current.zip = zip;
        source.current.names = Object.values(zip.files).filter((f) => !f.dir && /\.(jpe?g|png|gif|webp)$/i.test(f.name)).map((f) => f.name)
          .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
      }
      if (!cancelled) setReady(true);
    })().catch(() => setError('Не получилось открыть файл книги.'));
    return () => {
      cancelled = true;
      void source.current.pdf?.destroy();
      source.current = {};
    };
  }, [book.id, book.format]);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    let url: string | null = null;
    void (async () => {
      const { pdf, zip, names } = source.current;
      if (pdf && canvas.current) {
        const p = await pdf.getPage(Math.min(pdf.numPages, Math.max(1, page)));
        const base = p.getViewport({ scale: 1 });
        const width = Math.min(900, window.innerWidth - 32) * zoom;
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const vp = p.getViewport({ scale: (width / base.width) * dpr });
        const c = canvas.current;
        if (cancelled) return;
        c.width = Math.ceil(vp.width);
        c.height = Math.ceil(vp.height);
        c.style.width = `${Math.ceil(vp.width / dpr)}px`;
        const ctx = c.getContext('2d');
        if (ctx) await p.render({ canvasContext: ctx, viewport: vp }).promise.catch(() => undefined);
      } else if (zip && names) {
        const name = names[Math.min(names.length, Math.max(1, page)) - 1];
        const blob = name ? await zip.file(name)?.async('blob') : null;
        if (blob && !cancelled) {
          url = URL.createObjectURL(blob);
          setImg(url);
        }
      }
    })();
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [ready, page, zoom]);

  if (error) return <p className="m-auto max-w-[420px] p-8 text-center text-text-2">{error}</p>;
  return (
    <div className="flex min-h-full flex-col items-center gap-3 p-4">
      <div className="sticky top-2 z-10 flex items-center gap-2 rounded-pill bg-bg p-1">
        <button type="button" className="icon-btn" aria-label="Уменьшить" onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}><Minus size={16} aria-hidden /></button>
        <span className="mono w-12 text-center" aria-live="polite">{Math.round(zoom * 100)}%</span>
        <button type="button" className="icon-btn" aria-label="Увеличить" onClick={() => setZoom((z) => Math.min(3, z + 0.25))}><Plus size={16} aria-hidden /></button>
        <button type="button" className="pill pill-sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>Назад</button>
        <span className="mono">стр. {page} / {book.pages}</span>
        <button type="button" className="pill pill-sm" disabled={page >= book.pages} onClick={() => onPage(page + 1)}>Дальше</button>
      </div>
      {book.format === 'pdf' && (
        <p className="max-w-[640px] text-center text-[13px] text-muted">Это скан: текст в нём не распознан, поэтому выделения и поиск по этой книге недоступны.</p>
      )}
      <div className="max-w-full overflow-auto">
        {book.format === 'pdf'
          ? <canvas ref={canvas} role="img" aria-label={`Страница ${page}`} />
          // eslint-disable-next-line @next/next/no-img-element
          : img && <img src={img} alt={`Страница ${page}`} style={{ width: `${zoom * 100}%`, maxWidth: 'none', minWidth: 280 }} />}
      </div>
    </div>
  );
}
