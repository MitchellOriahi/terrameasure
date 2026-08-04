// lib/supabase.ts
// The one Supabase client for the whole app.
//
// What is Supabase? A hosted Postgres database with authentication built
// in. We use it for two things only:
//   1. accounts (email+password and Google sign-in)
//   2. the user's saved surveys (the "surveys" table)
// The survey ENGINE itself never touches Supabase; measuring stays free
// and anonymous, always.

import { createClient } from "@supabase/supabase-js";

// The project URL and "anon" key. The anon key is PUBLIC BY DESIGN:
// it only allows what the database's Row Level Security (RLS) policies
// permit (each user can read and write only their own rows), so it is
// safe to ship in frontend code. The secret service_role key is a
// different key entirely and must never appear here.
//
// Both can be overridden at build time with env vars, which is handy if
// the project ever moves.
const SUPABASE_URL: string =
  import.meta.env.VITE_SUPABASE_URL ?? "https://onmrarnvanpufmlsshvj.supabase.co";
const SUPABASE_ANON: string =
  import.meta.env.VITE_SUPABASE_ANON ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9ubXJhcm52YW5wdWZtbHNzaHZqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI3NDIxOTUsImV4cCI6MjA5ODMxODE5NX0.Z1IEDaDrR4DwaVG3JZkFC8roNl8ZU0qsUhJWepuNLDc";

// createClient handles session storage (localStorage), silent token
// refresh, and picking up the session from the URL after an OAuth
// redirect. All of that is default behavior; no extra config needed.
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON);

// ------------------------------------------------------------------
// Row shapes for the two tables we touch. Written by hand (no codegen)
// and kept minimal: only the columns this app reads or writes.
// ------------------------------------------------------------------

/** A row of the "profiles" table (one per account, created by a
    database trigger the moment an account is created). */
export interface ProfileRow {
  id: string; // same as auth.users id
  name: string | null;
}

/** A row of the "surveys" table: one saved survey. */
export interface SurveyRow {
  id: number;
  user_id: string;
  lat: number;
  lon: number;
  score: number | null;
  area_acres: number | null;
  source: string | null;
  surveyed_at: string; // ISO timestamp
}
