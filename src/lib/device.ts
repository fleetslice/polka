import { db, uid } from './db';
import type { Synced } from './types';

let cached: string | null = null;

export function deviceId(): string {
  if (cached) return cached;
  if (typeof localStorage === 'undefined') return (cached = 'server');
  let id = localStorage.getItem('polka.device');
  if (!id) {
    id = uid();
    localStorage.setItem('polka.device', id);
  }
  return (cached = id);
}

export function guessDeviceName(ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''): string {
  if (/iPad|Tablet|Android(?!.*Mobile)/i.test(ua)) return 'Планшет';
  if (/iPhone|Android.*Mobile|Mobile/i.test(ua)) return 'Телефон';
  return 'Ноутбук';
}

/** Метка для записи: время изменения + устройство (основа last-write-wins). */
export const stamp = (): Synced => ({ updatedAt: Date.now(), deviceId: deviceId() });

export async function touchDevice(): Promise<void> {
  const id = deviceId();
  const existing = await db.devices.get(id);
  await db.devices.put({
    id,
    name: existing?.name ?? guessDeviceName(),
    lastSeen: Date.now(),
    ...stamp(),
  });
  await queue('devices', id);
}

/** Ставит запись в очередь исходящей синхронизации. */
export async function queue(table: string, key: string): Promise<void> {
  await db.outbox.where('[table+key]').equals([table, key]).delete();
  await db.outbox.add({ table, key, updatedAt: Date.now() });
}
