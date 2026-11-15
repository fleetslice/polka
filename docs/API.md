# API

Все маршруты — на сервере Next.js, принимают запросы только со своего origin. Лимит: `POLKA_AI_RATE_PER_MIN` запросов в минуту на IP.

| Код | Значение |
|---|---|
| 400 | неверное тело запроса |
| 403 | чужой origin |
| 429 | превышен лимит запросов |
| 502 | ИИ не ответил или вернул не JSON |
| 503 | не задан `ANTHROPIC_API_KEY` |

## `GET /api/ai/status`
`{ "ai": true | false }` — подключён ли ИИ. Используется и как healthcheck.

## `POST /api/ai/ask`
Потоковый ответ (`text/plain`, чанки текста).

```json
{
  "question": "Что за бинокль у деда?",
  "mode": "library | passage | book | debate | essay",
  "selection": "выделенный текст (необязательно, до 3000 символов)",
  "noSpoilers": true,
  "sources": [{ "n": 1, "kind": "book | note", "bookTitle": "…", "chapterTitle": "…", "page": 12, "text": "…" }],
  "history": [{ "role": "user | assistant", "content": "…" }]
}
```
Ограничения: вопрос до 2000 символов, до 12 источников по 4000 символов, до 8 реплик истории.
В ответе ссылки вида `[1]` указывают на номера источников.

## `POST /api/ai/insight`
Ответ `{ "data": …, "model": "…" }`.

| `kind` | Поля запроса | `data` |
|---|---|---|
| `book` | `title`, `author`, `excerpts` (до 120 000 символов) | `{ oneLiner, summary, ideas[3], characters[], context[], debates[], cards[] }` |
| `recap` | `title`, `chapterTitle`, `text` (до 60 000) | `{ recap }` |
| `links` | `notes` (до 40 000) | `{ themes[], contradictions[] }` |

## Supabase
- `rpc upsert_record(p_tbl, p_key, p_data, p_updated_at, p_device_id)` — запись с last-write-wins.
- `select tbl, data, synced_at from records where synced_at > :cursor` — догрузка изменений (курсор — серверное время приёма записи).
- Realtime-канал по таблице `records`.
