import { db, SYNCED_TABLES, type SyncedTable } from './db';
import type { Synced } from './types';

/**
 * Синхронизация last-write-wins.
 * Между вкладками одного браузера работает сама: IndexedDB общая, Dexie рассылает изменения.
 * Между устройствами — через Supabase (если заданы NEXT_PUBLIC_SUPABASE_URL / ANON_KEY):
 * исходящие изменения копятся в очереди outbox (в том числе офлайн) и уходят при появлении сети,
 * входящие приходят через Realtime и первичную догрузку.
 */

export const syncConfigured = (): boolean =>
  !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/** true — входящая запись новее локальной. При равном времени побеждает больший deviceId (детерминированно). */
export function remoteWins(local: Synced | undefined, remote: Synced): boolean {
  if (!local) return true;
  if (remote.updatedAt !== local.updatedAt) return remote.updatedAt > local.updatedAt;
  return remote.deviceId > local.deviceId;
}

export const keyOf = (table: SyncedTable, row: Record<string, unknown>): string => {
  if (table === 'chapterProgress') return `${row.bookId}|${row.chapterId}`;
  if (table === 'positions') return `${row.bookId}|${row.deviceId}`;
  return String(row.id);
};

const dexieKey = (table: SyncedTable, key: string): string | [string, string] =>
  table === 'chapterProgress' || table === 'positions' ? (key.split('|') as [string, string]) : key;

/** Применяет входящую запись, если она новее локальной. Возвращает true, если запись принята. */
export async function applyRemote(table: SyncedTable, row: Synced & Record<string, unknown>): Promise<boolean> {
  const t = db.table(table);
  const local = (await t.get(dexieKey(table, keyOf(table, row)) as never)) as Synced | undefined;
  if (!remoteWins(local, row)) return false;
  await t.put(row);
  return true;
}

type SupabaseClient = import('@supabase/supabase-js').SupabaseClient;
let client: SupabaseClient | null = null;

export async function supabase(): Promise<SupabaseClient | null> {
  if (!syncConfigured()) return null;
  if (!client) {
    const { createClient } = await import('@supabase/supabase-js');
    client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
  }
  return client;
}

/** Отправляет очередь изменений. Записи хранятся на сервере как jsonb в таблице records (см. supabase/migrations). */
export async function pushOutbox(): Promise<number> {
  const sb = await supabase();
  if (!sb || !navigator.onLine) return 0;
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) return 0;
  const items = await db.outbox.orderBy('seq').limit(200).toArray();
  let sent = 0;
  for (const item of items) {
    if (!SYNCED_TABLES.includes(item.table as SyncedTable)) {
      await db.outbox.delete(item.seq!);
      continue;
    }
    const table = item.table as SyncedTable;
    const row = (await db.table(table).get(dexieKey(table, item.key) as never)) as (Synced & Record<string, unknown>) | undefined;
    if (row) {
      const { error } = await sb.rpc('upsert_record', {
        p_tbl: table, p_key: item.key, p_data: row, p_updated_at: row.updatedAt, p_device_id: row.deviceId,
      });
      if (error) break; // сеть или сервер недоступны — попробуем позже, порядок сохранится
    }
    await db.outbox.delete(item.seq!);
    sent += 1;
  }
  return sent;
}

export async function pullAll(): Promise<number> {
  const sb = await supabase();
  if (!sb || !navigator.onLine) return 0;
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) return 0;
  // Курсор — серверное время приёма записи (synced_at), а не клиентское updated_at:
  // запись, сделанная офлайн «в прошлом», всё равно окажется после курсора, когда доедет до сервера.
  const since = ((await db.meta.get('sync.cursor'))?.value as string | undefined) ?? '1970-01-01T00:00:00Z';
  let applied = 0;
  let from = 0;
  let maxSeen = since;
  for (;;) {
    const { data, error } = await sb.from('records').select('tbl,data,synced_at').gt('synced_at', since)
      .order('synced_at').range(from, from + 499);
    if (error || !data?.length) break;
    for (const r of data as { tbl: string; data: Synced & Record<string, unknown>; synced_at: string }[]) {
      if (SYNCED_TABLES.includes(r.tbl as SyncedTable) && (await applyRemote(r.tbl as SyncedTable, r.data))) applied += 1;
      if (r.synced_at > maxSeen) maxSeen = r.synced_at;
    }
    if (data.length < 500) break;
    from += 500;
  }
  await db.meta.put({ key: 'sync.cursor', value: maxSeen });
  return applied;
}

/* ── Вход владельца ── */

export async function currentEmail(): Promise<string | null> {
  const sb = await supabase();
  if (!sb) return null;
  const { data } = await sb.auth.getSession();
  return data.session?.user.email ?? null;
}

/** Вход по e-mail и паролю. Возвращает текст ошибки или null. */
export async function signIn(email: string, password: string): Promise<string | null> {
  const sb = await supabase();
  if (!sb) return 'Синхронизация не настроена.';
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (!error) return null;
  if (/confirm/i.test(error.message)) return 'Почта ещё не подтверждена: открой письмо от Supabase и нажми на ссылку, потом войди снова.';
  if (/invalid/i.test(error.message)) return 'Неверная почта или пароль. Если аккаунта ещё нет — нажми «Создать аккаунт».';
  return `Не получилось войти: ${error.message}`;
}

/** Регистрация. 'confirm' — нужно подтвердить почту по ссылке из письма. */
export async function signUp(email: string, password: string): Promise<{ error: string | null; confirm: boolean }> {
  const sb = await supabase();
  if (!sb) return { error: 'Синхронизация не настроена.', confirm: false };
  const { data, error } = await sb.auth.signUp({ email, password });
  if (error) return { error: /registered/i.test(error.message) ? 'Такой аккаунт уже есть — нажми «Войти».' : `Не получилось создать аккаунт: ${error.message}`, confirm: false };
  return { error: null, confirm: !data.session };
}

export async function signOut(): Promise<void> {
  await (await supabase())?.auth.signOut();
}

/** Подписка на вход и выход. Возвращает функцию отписки. */
export function onAuth(cb: (email: string | null) => void): () => void {
  let unsub = (): void => {};
  let stopped = false;
  void supabase().then((sb) => {
    if (!sb || stopped) return;
    void sb.auth.getSession().then(({ data }) => cb(data.session?.user.email ?? null));
    const { data } = sb.auth.onAuthStateChange((_event, session) => cb(session?.user.email ?? null));
    unsub = () => data.subscription.unsubscribe();
  });
  return () => {
    stopped = true;
    unsub();
  };
}

/** Одна попытка обмена: отправить очередь и забрать новое. Возвращает текст ошибки или null. */
export async function syncNow(): Promise<string | null> {
  try {
    const sb = await supabase();
    if (!sb) return 'Синхронизация не настроена.';
    const { data } = await sb.auth.getSession();
    if (!data.session) return 'Сначала войди в аккаунт.';
    const probe = await sb.from('records').select('key').limit(1);
    if (probe.error) {
      return /relation|does not exist|schema cache|not find/i.test(probe.error.message)
        ? 'В базе Supabase нет таблицы records: выполни SQL из supabase/migrations/0001_init.sql в SQL Editor.'
        : `Supabase ответил ошибкой: ${probe.error.message}`;
    }
    await pushOutbox();
    await pullAll();
    await db.meta.put({ key: 'sync.lastOk', value: Date.now() });
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : 'Нет связи с сервером.';
  }
}

/** Запускает фоновую синхронизацию. Возвращает функцию остановки. */
export function startSync(): () => void {
  if (!syncConfigured() || typeof window === 'undefined') return () => {};
  let stopped = false;
  let channel: { unsubscribe: () => void } | null = null;
  const tick = async (): Promise<void> => {
    if (stopped) return;
    try {
      await pushOutbox();
      await pullAll();
      // Файлы книг — в облако, чтобы другие устройства могли их скачать.
      void import('./cloudFiles').then((m) => m.uploadAll()).catch(() => undefined);
    } catch {
      /* попробуем на следующем цикле */
    }
  };
  // Канал Realtime открывается после входа (RLS отдаёт строки только владельцу) и закрывается при выходе.
  const stopAuth = onAuth((email) => {
    void (async () => {
      const sb = await supabase();
      if (!sb || stopped) return;
      if (!email) {
        channel?.unsubscribe();
        channel = null;
        return;
      }
      channel ??= sb.channel('records').on('postgres_changes', { event: '*', schema: 'public', table: 'records' }, (payload) => {
        const r = payload.new as { tbl?: string; data?: Synced & Record<string, unknown> };
        if (r?.tbl && r.data && SYNCED_TABLES.includes(r.tbl as SyncedTable)) void applyRemote(r.tbl as SyncedTable, r.data);
      }).subscribe();
      await tick();
    })();
  });
  const timer = window.setInterval(() => void tick(), 20_000);
  const onOnline = (): void => void tick();
  window.addEventListener('online', onOnline);
  return () => {
    stopped = true;
    stopAuth();
    window.clearInterval(timer);
    window.removeEventListener('online', onOnline);
    channel?.unsubscribe();
  };
}
