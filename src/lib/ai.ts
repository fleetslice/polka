import { BASE } from './base';
import type { Source } from './rag';

/** Нет ключа (503) или нет сервера вовсе — статический хостинг отвечает 404/405. */
const noAi = (status: number): boolean => status === 503 || status === 404 || status === 405;

export class AiUnavailable extends Error {}

export interface AskPayload {
  question: string;
  sources: Pick<Source, 'n' | 'kind' | 'bookTitle' | 'chapterTitle' | 'page' | 'text'>[];
  /** library — ответ по всей библиотеке; passage — толкование выделенного места; book — вопрос об одной книге. */
  mode: 'library' | 'passage' | 'book' | 'debate' | 'essay';
  selection?: string;
  noSpoilers?: boolean;
  history?: { role: 'user' | 'assistant'; content: string }[];
}

/** Потоковый ответ ИИ. onText получает очередной кусок текста. */
export async function askStream(payload: AskPayload, onText: (chunk: string) => void, signal?: AbortSignal): Promise<void> {
  const res = await fetch(`${BASE}/api/ai/ask`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal,
  });
  if (noAi(res.status)) throw new AiUnavailable('ИИ не подключён: у сайта нет сервера с ключом ANTHROPIC_API_KEY.');
  if (res.status === 429) throw new Error('Слишком много запросов к ИИ. Подожди минуту и повтори.');
  if (!res.ok || !res.body) throw new Error('ИИ не ответил. Попробуй ещё раз.');
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    onText(decoder.decode(value, { stream: true }));
  }
}

export interface BookInsight {
  oneLiner: string;
  summary: string;
  ideas: { title: string; text: string }[];
  characters: { name: string; role: string }[];
  context: { date: string; text: string }[];
  debates: { question: string; readings: string[] }[];
  cards: { front: string; back: string }[];
}

export async function generate<T>(body: Record<string, unknown>): Promise<{ data: T; model: string }> {
  const res = await fetch(`${BASE}/api/ai/insight`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (noAi(res.status)) throw new AiUnavailable('ИИ не подключён: у сайта нет сервера с ключом ANTHROPIC_API_KEY.');
  if (res.status === 429) throw new Error('Слишком много запросов к ИИ. Подожди минуту и повтори.');
  if (!res.ok) throw new Error('ИИ не смог подготовить ответ. Попробуй ещё раз.');
  return (await res.json()) as { data: T; model: string };
}
