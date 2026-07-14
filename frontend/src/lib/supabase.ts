import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** True only when real credentials are configured (not the placeholders). */
export const supabaseConfigured =
  !!url &&
  !!anon &&
  !url.includes("YOUR-PROJECT") &&
  !anon.includes("your-anon");

export const supabase = createClient(
  url || "https://placeholder.supabase.co",
  anon || "public-anon-placeholder"
);
