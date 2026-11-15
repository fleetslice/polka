import 'server-only';
import Anthropic from '@anthropic-ai/sdk';

export const MODEL = process.env.POLKA_AI_MODEL || 'claude-opus-5-5';
export const aiReady = (): boolean => !!process.env.ANTHROPIC_API_KEY;

let client: Anthropic | null = null;
export const anthropic = (): Anthropic => (client ??= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }));

/** Простой лимит запросов на IP (в памяти процесса). За балансировщиком на несколько инстансов нужен общий стор. */
const hits = new Map<string, number[]>();
const LIMIT = Number(process.env.POLKA_AI_RATE_PER_MIN || 20);

export function rateLimited(req: Request): boolean {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
  const now = Date.now();
  const list = (hits.get(ip) ?? []).filter((t) => now - t < 60_000);
  if (list.length >= LIMIT) {
    hits.set(ip, list);
    return true;
  }
  list.push(now);
  hits.set(ip, list);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((t) => now - t < 60_000)) hits.delete(k);
  return false;
}

/** Запросы принимаются только со своего сайта: API не должен быть открытым прокси к ИИ. */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get('origin');
  if (!origin) return true;
  try {
    return new URL(origin).host === (req.headers.get('x-forwarded-host') ?? req.headers.get('host'));
  } catch {
    return false;
  }
}

export const clip = (s: unknown, max: number): string => (typeof s === 'string' ? s.slice(0, max) : '');
