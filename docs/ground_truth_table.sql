-- docs/ground_truth_table.sql
-- ===========================
-- Creates the `ground_truth` table for TerraMeasure's accuracy
-- feedback loop (the Ground Truth page at /photo).
--
-- HOW TO USE: open your Supabase project dashboard, go to
-- "SQL Editor", paste this whole file, and click "Run".
--
-- WHY THIS TABLE MATTERS: surveyors log what they ACTUALLY measured
-- when they walked a site, next to what TerraMeasure predicted. Every
-- row is a real-world correction. Over time this becomes proprietary
-- accuracy data: it tells us exactly where our predictions run hot or
-- cold, region by region. Nobody can scrape that; it has to be earned.
--
-- What each column is for:
--   id                     : internal unique row id, the database fills it in
--   user_id                : which account logged it (ties into Supabase auth)
--   survey_id              : the saved survey this visit corrects, or null
--                            when the surveyor typed coordinates by hand.
--                            NOTE: the surveys table uses a bigint id (not a
--                            uuid), so this column is bigint to match. The
--                            foreign key "on delete set null" means deleting
--                            a saved survey keeps the ground-truth row but
--                            blanks the link, so field data is never lost.
--   lat, lon               : where the site is (WGS84 degrees)
--   measured_slope_deg     : average slope they measured on site, in degrees
--   measured_elev_range_ft : elevation range they measured, in feet
--   field_verdict          : the go / caution / no-go THEY would give after
--                            walking it (text: "go", "caution", "no-go")
--   notes                  : free text: what the data missed (drainage,
--                            access, rock outcrops, anything)
--   visited_on             : the calendar date of the site visit
--   created_at             : when the row was logged, the database fills it in

create table if not exists public.ground_truth (
    id                     uuid primary key default gen_random_uuid(),
    user_id                uuid not null references auth.users (id) on delete cascade,
    survey_id              bigint references public.surveys (id) on delete set null,
    lat                    double precision,
    lon                    double precision,
    measured_slope_deg     double precision,
    measured_elev_range_ft double precision,
    field_verdict          text,
    notes                  text,
    visited_on             date,
    created_at             timestamptz default now()
);

-- SECURITY: Row Level Security with own-data policies, same pattern as
-- the surveys table. The public anon key in the frontend can only do
-- what these policies allow:
--   * insert rows stamped with YOUR OWN user id
--   * read back YOUR OWN rows
-- Nobody can read anyone else's field data. Aggregated accuracy
-- analysis happens later, server-side, with the service_role key.
alter table public.ground_truth enable row level security;

-- auth.uid() is "the user id inside the caller's login token". The
-- WITH CHECK clause on insert rejects any row whose user_id does not
-- match the person actually making the request.
create policy "Users can insert their own ground truth"
    on public.ground_truth
    for insert
    with check (auth.uid() = user_id);

create policy "Users can view their own ground truth"
    on public.ground_truth
    for select
    using (auth.uid() = user_id);

-- The one query the app runs is "my entries, newest first", so index
-- exactly that access path.
create index if not exists ground_truth_user_created_idx
    on public.ground_truth (user_id, created_at desc);
