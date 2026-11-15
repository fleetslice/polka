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
  const since = ((await db.meta.get('sync.pulledAt'))?.value as number | undefined) ?? 0;
  let applied = 0;
  let from = 0;
  let maxSeen = since;
  for (;;) {
    const { data, error } = await sb.from('records').select('tbl,data,updated_at').gt('updated_at', since)
      .order('updated_at').range(from, from + 499);
    if (error || !data?.length) break;
    for (const r of data as { tbl: string; data: Synced & Record<string, unknown>; updated_at: number }[]) {
      if (SYNCED_TABLES.includes(r.tbl as SyncedTable) && (await applyRemote(r.tbl as SyncedTable, r.data))) applied += 1;
      maxSeen = Math.max(maxSeen, r.updated_at);
    }
    if (data.length < 500) break;
    from += 500;
  }
  await db.meta.put({ key: 'sync.pulledAt', value: maxSeen });
  return applied;
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
    } catch {
      /* попробуем на следующем цикле */
    }
  };
  void (async () => {
    const sb = await supabase();
    if (!sb || stopped) return;
    channel = sb.channel('records').on('postgres_changes', { event: '*', schema: 'public', table: 'records' }, (payload) => {
      const r = payload.new as { tbl?: string; data?: Synced & Record<string, unknown> };
      if (r?.tbl && r.data && SYNCED_TABLES.includes(r.tbl as SyncedTable)) void applyRemote(r.tbl as SyncedTable, r.data);
    }).subscribe();
    await tick();
  })();
  const timer = window.setInterval(() => void tick(), 20_000);
  const onOnline = (): void => void tick();
  window.addEventListener('online', onOnline);
  return () => {
    stopped = true;
    window.clearInterval(timer);
    window.removeEventListener('online', onOnline);
    channel?.unsubscribe();
  };
}
