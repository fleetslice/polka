-- ПОЛКА. — схема Supabase. Один владелец; RLS: каждый видит только свои строки.
-- Скрипт можно запускать повторно: всё создаётся «если нет», политики пересоздаются.
create extension if not exists vector;

-- ── Синхронизация (используется клиентом сейчас) ─────────────────────────────
-- Клиент local-first: записи живут в IndexedDB и зеркалятся сюда целиком как jsonb.
-- tbl — имя локальной таблицы (books, shelves, chapterProgress, positions, sessions,
-- highlights, notes, flashcards, bookmarks, devices); key — её первичный ключ.
create table if not exists public.records (
  user_id    uuid   not null default auth.uid() references auth.users on delete cascade,
  tbl        text   not null,
  key        text   not null,
  data       jsonb  not null,
  updated_at bigint not null,          -- метка времени клиента, мс
  device_id  text   not null,
  synced_at  timestamptz not null default now(),  -- серверное время приёма; по нему клиенты догружают изменения
  primary key (user_id, tbl, key)
);
alter table public.records add column if not exists synced_at timestamptz not null default now();
create index if not exists records_synced on public.records (user_id, synced_at);

alter table public.records enable row level security;
drop policy if exists "records: владелец читает" on public.records;
create policy "records: владелец читает"  on public.records for select using (user_id = auth.uid());
drop policy if exists "records: владелец пишет" on public.records;
create policy "records: владелец пишет"   on public.records for insert with check (user_id = auth.uid());
drop policy if exists "records: владелец меняет" on public.records;
create policy "records: владелец меняет"  on public.records for update using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "records: владелец удаляет" on public.records;
create policy "records: владелец удаляет" on public.records for delete using (user_id = auth.uid());

-- Last-write-wins на стороне сервера: старая запись не перезапишет новую,
-- при равном времени побеждает больший device_id (то же правило, что на клиенте).
create or replace function public.upsert_record(p_tbl text, p_key text, p_data jsonb, p_updated_at bigint, p_device_id text)
returns void language plpgsql security invoker set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if p_tbl not in ('books','shelves','chapterProgress','positions','sessions','highlights','notes','flashcards','bookmarks','devices') then
    raise exception 'unknown table %', p_tbl;
  end if;
  insert into records (user_id, tbl, key, data, updated_at, device_id)
  values (auth.uid(), p_tbl, p_key, p_data, p_updated_at, p_device_id)
  on conflict (user_id, tbl, key) do update
    set data = excluded.data, updated_at = excluded.updated_at, device_id = excluded.device_id, synced_at = now()
    where (excluded.updated_at, excluded.device_id) > (records.updated_at, records.device_id);
end $$;

do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'records') then
    alter publication supabase_realtime add table public.records;
  end if;
end $$;

-- ── Серверный поиск по смыслу (задел: воркер индексации ещё не написан) ──────
create table if not exists public.chunks (
  id         bigint generated always as identity primary key,
  user_id    uuid not null default auth.uid() references auth.users on delete cascade,
  book_id    text not null,
  chapter_id text not null,
  locator    jsonb not null,           -- { chapter, offset }
  page       int,
  text       text not null,
  embedding  vector(1024)              -- Voyage AI voyage-3
);
create index if not exists chunks_book on public.chunks (user_id, book_id);
create index if not exists chunks_embedding on public.chunks using hnsw (embedding vector_cosine_ops);
alter table public.chunks enable row level security;
drop policy if exists "chunks: владелец" on public.chunks;
create policy "chunks: владелец" on public.chunks for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ── Облачные источники (задел: OAuth-маршруты ещё не написаны) ───────────────
create table if not exists public.cloud_sources (
  id        uuid primary key default gen_random_uuid(),
  user_id   uuid not null default auth.uid() references auth.users on delete cascade,
  provider  text not null check (provider in ('gdrive','yandex','dropbox','onedrive','webdav')),
  folder    text not null,
  enabled   boolean not null default true,
  token_enc bytea                      -- токен шифруется на сервере; клиенту колонка не отдаётся
);
alter table public.cloud_sources enable row level security;
drop policy if exists "cloud_sources: владелец" on public.cloud_sources;
create policy "cloud_sources: владелец" on public.cloud_sources for all using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke select (token_enc) on public.cloud_sources from anon, authenticated;

-- ── Файлы книг: приватный бакет, доступ только к своей папке, выдача по подписанным URL ──
insert into storage.buckets (id, name, public) values ('books', 'books', false) on conflict do nothing;
drop policy if exists "books: своя папка" on storage.objects;
create policy "books: своя папка" on storage.objects for all
  using (bucket_id = 'books' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'books' and (storage.foldername(name))[1] = auth.uid()::text);
