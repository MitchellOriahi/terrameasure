-- docs/reports_table.sql
-- =======================
-- Creates the `reports` table for TerraMeasure share links.
--
-- HOW TO USE: open your Supabase project dashboard, go to
-- "SQL Editor", paste this whole file, and click "Run".
--
-- What each column is for:
--   id         : internal unique row id, the database fills it in
--   slug       : the short code in the share URL (/r/{slug}), must be unique
--   title      : optional human title the user gave the report
--   snapshot   : the whole survey snapshot as JSON (jsonb = binary JSON,
--                Postgres's efficient JSON column type)
--   created_at : when the report was created, the database fills it in

create table if not exists public.reports (
    id         uuid primary key default gen_random_uuid(),
    slug       text unique not null,
    title      text,
    snapshot   jsonb not null,
    created_at timestamptz default now()
);

-- Looking up a report by slug is the only query we run, so give it an
-- index. (The `unique` constraint above already creates one, but being
-- explicit documents the intent.)
create index if not exists reports_slug_idx on public.reports (slug);

-- SECURITY: turn on Row Level Security and add NO policies.
--
-- With RLS on and zero policies, the anon key (the public one that lives
-- in the frontend) can neither read nor write this table at all. Only the
-- service_role key, which bypasses RLS and lives ONLY in the server's
-- environment variables, can touch it. All public access goes through
-- our API, where we control validation, slimming, and rate limits.
alter table public.reports enable row level security;
