'use client';
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowDown } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { ACCEPT } from '@/components/Header';
import { db, SYNCED_TABLES } from '@/lib/db';
import { deviceId } from '@/lib/device';
import { useDevices, useOnline, useSyncEmail } from '@/lib/hooks';
import { filesFromDrop, importFiles } from '@/lib/import';
import { formatSize, relativeDay } from '@/lib/progress';
import { signIn, signOut, signUp, syncConfigured, syncNow } from '@/lib/sync';
import { uploadAll } from '@/lib/cloudFiles';

const FORMATS: { name: string; note: string; ready: boolean }[] = [
  { name: 'EPUB', note: 'основной, с оглавлением', ready: true },
  { name: 'FB2', note: 'и FB2.ZIP', ready: true },
  { name: 'PDF', note: 'текстовый слой или сканы', ready: true },
  { name: 'DOCX', note: 'и ODT', ready: true },
  { name: 'RTF', note: 'с кириллицей', ready: true },
  { name: 'TXT', note: 'любая кодировка, cp1251', ready: true },
  { name: 'CBZ', note: 'комиксы', ready: true },
  { name: 'HTML', note: 'сохранённые статьи', ready: true },
  { name: 'MP3', note: 'аудиокниги, M4B', ready: true },
  { name: 'MOBI', note: 'нужен конвертер', ready: false },
  { name: 'AZW3', note: 'нужен конвертер', ready: false },
  { name: 'DJVU', note: 'нужен конвертер и OCR', ready: false },
];

const CLOUDS = [
  ['GD', 'Google Drive'], ['ЯД', 'Яндекс Диск'], ['DB', 'Dropbox'], ['OD', 'OneDrive'], ['WD', 'WebDAV / NAS'],
] as const;

export default function CloudPage() {
  const jobs = useLiveQuery(() => db.jobs.orderBy('createdAt').reverse().limit(40).toArray(), []) ?? [];
  const devices = useDevices() ?? [];
  const online = useOnline();
  const [over, setOver] = useState(false);
  const [storage, setStorage] = useState<{ used: number; quota: number; persisted: boolean } | null>(null);
  const files = useRef<HTMLInputElement>(null);
  const folder = useRef<HTMLInputElement>(null);

  const refreshStorage = async (): Promise<void> => {
    if (!navigator.storage?.estimate) return;
    const e = await navigator.storage.estimate();
    setStorage({ used: e.usage ?? 0, quota: e.quota ?? 0, persisted: (await navigator.storage.persisted?.()) ?? false });
  };
  useEffect(() => {
    void refreshStorage();
    folder.current?.setAttribute('webkitdirectory', '');
  }, [jobs.length]);

  const take = (list: File[]): void => {
    if (list.length) void importFiles(list).then(refreshStorage);
  };

  const backup = async (): Promise<void> => {
    const dump: Record<string, unknown[]> = {};
    for (const t of SYNCED_TABLES) dump[t] = (await db.table(t).toArray()).map((r: Record<string, unknown>) => ({ ...r, cover: undefined }));
    const url = URL.createObjectURL(new Blob([JSON.stringify({ app: 'polka', version: 1, exportedAt: new Date().toISOString(), ...dump })], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `polka-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="page grid gap-10 pt-8 lg:grid-cols-[1fr_360px]">
      <div className="min-w-0">
        <h1 className="sr-only">Облако: загрузка книг и синхронизация</h1>
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            void filesFromDrop(e.dataTransfer).then(take);
          }}
          className="p-6 md:p-10"
          style={{ border: `1px dashed ${over ? 'var(--accent)' : 'var(--line-3)'}`, background: over ? 'var(--surface)' : 'var(--bg-2)' }}
        >
          <p className="mono">Перетащи файлы или папку целиком</p>
          <p className="display mt-4" style={{ fontSize: 'clamp(48px, 9vw, 112px)' }} aria-hidden>
            Кидай<br />сюда<ArrowDown className="inline" style={{ width: '0.8em', height: '0.8em', color: 'var(--accent)' }} strokeWidth={3} />
          </p>
          <p className="mt-4 text-text-2">До 2 ГБ за раз · дубликаты найдутся сами · обложка и оглавление берутся из файла</p>
          <div className="mt-6 flex flex-wrap gap-3">
            <button type="button" className="pill pill-accent" onClick={() => files.current?.click()}>Выбрать файлы</button>
            <button type="button" className="pill" onClick={() => folder.current?.click()}>Выбрать папку</button>
          </div>
          <input ref={files} type="file" multiple accept={ACCEPT} className="hidden" tabIndex={-1} aria-hidden
            onChange={(e) => {
              take([...(e.target.files ?? [])]);
              e.target.value = '';
            }} />
          <input ref={folder} type="file" multiple className="hidden" tabIndex={-1} aria-hidden
            onChange={(e) => {
              take([...(e.target.files ?? [])].filter((f) => !f.name.startsWith('.')));
              e.target.value = '';
            }} />
        </div>

        <section aria-labelledby="where-h" className="mt-8 border border-line p-5">
          <h2 id="where-h" className="font-display text-[18px] font-semibold">Где лежат книги</h2>
          <p className="mt-2 text-text-2">
            Файлы хранятся на этом устройстве, в памяти браузера (IndexedDB), и читаются без интернета.
            {storage ? ` Занято ${formatSize(storage.used)} из ${formatSize(storage.quota)}.` : ''}
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            {storage && !storage.persisted && (
              <button type="button" className="pill pill-sm" onClick={() => void navigator.storage.persist?.().then(refreshStorage)}>
                Запретить браузеру стирать книги
              </button>
            )}
            {storage?.persisted && <span className="mono"><span className="dot">●</span> хранилище закреплено</span>}
            <button type="button" className="pill pill-sm" onClick={() => void backup()}>Скачать копию заметок и прогресса</button>
          </div>
        </section>

        <section aria-labelledby="formats-h" className="mt-12">
          <h2 id="formats-h" className="font-display text-[22px] font-semibold">Что читается</h2>
          <ul className="hairgrid mt-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}>
            {FORMATS.map((f) => (
              <li key={f.name} className="p-4">
                <span className="block font-mono text-[15px] font-semibold" style={{ color: f.ready ? 'var(--accent)' : 'var(--muted)' }}>{f.name}</span>
                <span className="mt-1 block text-[13px] text-muted">{f.note}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[13px] text-muted">
            MOBI, AZW3, DJVU, DOC и CBR браузер открыть не может — им нужен серверный конвертер, он пока не подключён. Сохрани такую книгу в EPUB или FB2.
          </p>
        </section>

        <section aria-labelledby="queue-h" id="queue" className="mt-12 scroll-mt-24">
          <div className="flex items-center justify-between gap-3">
            <h2 id="queue-h" className="font-display text-[22px] font-semibold">Обработка</h2>
            {jobs.some((j) => j.stage === 'done' || j.stage === 'error') && (
              <button type="button" className="pill pill-sm" onClick={() => void db.jobs.where('createdAt').above(0).filter((j) => j.stage === 'done' || j.stage === 'error').delete()}>
                Очистить список
              </button>
            )}
          </div>
          {jobs.length === 0 ? (
            <p className="mt-4 text-text-2">Очередь пуста. Закинь книгу — здесь будет видно, как она разбирается.</p>
          ) : (
            <ul className="mt-4 border-t border-line" aria-live="polite">
              {jobs.map((j) => (
                <li key={j.id} className="grid items-center gap-x-4 gap-y-1 border-b border-line py-4 md:grid-cols-[56px_1fr_1fr_120px]">
                  <span className="mono">{j.format || '—'}</span>
                  <span className="min-w-0 truncate font-semibold">
                    {j.bookId && j.stage === 'done' ? <Link href={`/reader?id=${j.bookId}`} className="underline underline-offset-4">{j.fileName}</Link> : j.fileName}
                  </span>
                  <span className="text-[14px]" style={{ color: j.stage === 'error' ? 'var(--danger)' : 'var(--text-2)' }}>
                    {j.stage === 'error' ? `Не получилось: ${j.error}` : j.message}
                  </span>
                  <span className="bar" role="progressbar" aria-label={`Обработка ${j.fileName}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(j.progress * 100)}>
                    <i style={{ width: `${j.progress * 100}%`, background: j.stage === 'error' ? 'var(--danger)' : 'var(--accent)' }} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <aside className="min-w-0">
        <section aria-labelledby="clouds-h">
          <h2 id="clouds-h" className="font-display text-[22px] font-semibold">Облака</h2>
          <ul className="mt-3">
            {CLOUDS.map(([abbr, name]) => (
              <li key={abbr} className="flex items-center gap-3 border-b border-line py-3">
                <span className="mono flex h-9 w-9 flex-none items-center justify-center bg-surface" aria-hidden>{abbr}</span>
                <span className="flex-1">
                  <span className="block font-semibold">{name}</span>
                  <span className="block text-[13px] text-muted">не подключено</span>
                </span>
                <button type="button" role="switch" aria-checked={false} aria-label={`${name}: подключение пока недоступно`} disabled
                  className="relative h-7 w-12 flex-none rounded-full bg-line-2 opacity-60">
                  <i className="absolute left-1 top-1 h-5 w-5 rounded-full bg-muted" aria-hidden />
                </button>
              </li>
            ))}
            <li className="flex items-center gap-3 border-b border-line py-3">
              <span className="mono flex h-9 w-9 flex-none items-center justify-center bg-surface" aria-hidden>iC</span>
              <span className="flex-1">
                <span className="block font-semibold">iCloud Drive и «Файлы»</span>
                <span className="block text-[13px] text-muted">через выбор файлов на устройстве</span>
              </span>
              <button type="button" className="pill pill-sm" onClick={() => files.current?.click()}>Выбрать</button>
            </li>
          </ul>
          <p className="mt-3 text-[13px] text-muted">
            Автоподтягивание из облачных папок требует серверной части с ключами OAuth — она не настроена. Пока любая папка облака,
            видимая в проводнике или «Файлах», открывается кнопкой «Выбрать файлы».
          </p>
        </section>

        <section aria-labelledby="devices-h" id="devices" className="mt-8 scroll-mt-24 p-5" style={{ background: 'var(--text)', color: 'var(--ink)' }}>
          <h2 id="devices-h" className="font-mono text-[11px] font-semibold uppercase tracking-[0.12em]">
            Устройства · {!online ? 'офлайн' : syncConfigured() ? 'синхронизация включена' : 'синхронизация не настроена'}
          </h2>
          <ul className="mt-3">
            {devices.map((d) => (
              <li key={d.id} className="flex justify-between gap-3 py-1">
                <span className="font-semibold">{d.name}{d.id === deviceId() ? ' (это)' : ''}</span>
                <span className="font-mono text-[12px]">{relativeDay(d.lastSeen)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[13px]">
            {syncConfigured()
              ? 'Синхронизируются позиция, прогресс по главам, выделения, заметки и полки. Сам файл книги нужно закинуть на каждое устройство — прогресс подхватится.'
              : 'Вкладки этого браузера уже в синхроне. Чтобы подключить телефон и планшет, задай ключи Supabase (см. README) — тогда позиция, выделения, заметки и полки поедут между устройствами.'}
          </p>
          {syncConfigured() && <Account />}
        </section>

        <section aria-labelledby="more-h" className="mt-8 border border-line p-5">
          <h2 id="more-h" className="font-semibold">Ещё способы</h2>
          <p className="mt-2 text-[14px] text-text-2">
            Telegram-бот, личный e-mail полки и OPDS-каталоги запланированы и пока не работают: им тоже нужен сервер.
          </p>
        </section>
      </aside>
    </div>
  );
}

/** Вход владельца: один и тот же аккаунт на всех устройствах включает синхронизацию между ними. */
function Account() {
  const email = useSyncEmail();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const field = 'mt-1 w-full min-h-[44px] rounded-[22px] border border-[#55524b] bg-white px-4 text-[15px] text-ink';

  const run = async (kind: 'in' | 'up', form: HTMLFormElement): Promise<void> => {
    const data = new FormData(form);
    const mail = String(data.get('email') ?? '').trim();
    const password = String(data.get('password') ?? '');
    if (!mail || password.length < 6) return setMessage('Нужны почта и пароль не короче 6 символов.');
    setBusy(true);
    setMessage('');
    if (kind === 'in') setMessage((await signIn(mail, password)) ?? '');
    else {
      const res = await signUp(mail, password);
      setMessage(res.error ?? (res.confirm ? 'Аккаунт создан. Открой письмо от Supabase, подтверди почту и нажми «Войти».' : ''));
    }
    setBusy(false);
  };

  if (email === undefined) return <p className="mt-4 font-mono text-[12px]">Проверяю вход…</p>;
  if (email) {
    return (
      <div className="mt-4 border-t border-[#b9b4aa] pt-4">
        <p className="text-[14px]">Вход выполнен: <strong>{email}</strong></p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className="pill pill-sm" style={{ color: 'var(--ink)', borderColor: 'var(--ink)' }} disabled={busy}
            onClick={() => {
              setBusy(true);
              setMessage('');
              void syncNow().then(async (err) => {
                if (err) {
                  setMessage(err);
                  setBusy(false);
                  return;
                }
                setMessage('Синхронизировано. Загружаю книги в облако…');
                const r = await uploadAll((done, total) => setMessage(`Загружаю книги в облако: ${done} из ${total}`));
                setMessage([
                  r.uploaded ? `Книг загружено в облако: ${r.uploaded}.` : 'Синхронизировано, все книги уже в облаке.',
                  r.tooBig.length ? `Больше 50 МБ, не влезли: ${r.tooBig.join(', ')}.` : '',
                  r.failed ? `Не загрузилось: ${r.failed} — проверь, что в Supabase выполнен SQL для хранилища книг.` : '',
                ].filter(Boolean).join(' '));
                setBusy(false);
              });
            }}>
            {busy ? 'Синхронизирую…' : 'Синхронизировать сейчас'}
          </button>
          <button type="button" className="pill pill-sm" style={{ color: 'var(--ink)', borderColor: 'var(--ink)' }} onClick={() => void signOut()}>Выйти</button>
        </div>
        <p role="status" className="mt-2 text-[13px]">{message}</p>
      </div>
    );
  }
  return (
    <form className="mt-4 border-t border-[#b9b4aa] pt-4" onSubmit={(e) => {
      e.preventDefault();
      void run('in', e.currentTarget);
    }}>
      <p className="text-[14px] font-semibold">Войди, чтобы устройства синхронизировались</p>
      <label className="mt-3 block text-[13px]">Почта
        <input name="email" type="email" autoComplete="email" required className={field} />
      </label>
      <label className="mt-2 block text-[13px]">Пароль
        <input name="password" type="password" autoComplete="current-password" required minLength={6} className={field} />
      </label>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="submit" className="pill pill-sm" style={{ background: 'var(--ink)', color: 'var(--text)', borderColor: 'var(--ink)' }} disabled={busy}>Войти</button>
        <button type="button" className="pill pill-sm" style={{ color: 'var(--ink)', borderColor: 'var(--ink)' }} disabled={busy}
          onClick={(e) => void run('up', e.currentTarget.form!)}>Создать аккаунт</button>
      </div>
      <p role="status" className="mt-2 text-[13px]">{message}</p>
    </form>
  );
}
