import { supabase } from "./supabase";
import type { ScreenResponse } from "../api";

export interface RunRow {
  id: string;
  user_id: string;
  title: string;
  source: string;
  total_resumes: number;
  shortlisted: number;
  avg_score: number;
  top_name: string | null;
  top_score: number | null;
  results: ScreenResponse;
  created_at: string;
}

export interface Profile {
  id: string;
  full_name: string | null;
  company: string | null;
  avatar_url: string | null;
  created_at: string;
}

export async function saveRun(
  userId: string,
  title: string,
  source: "upload" | "gmail",
  data: ScreenResponse
): Promise<void> {
  const avg =
    data.top.length > 0
      ? Math.round((data.top.reduce((s, c) => s + c.score, 0) / data.top.length) * 10) / 10
      : 0;
  const top = data.top[0];
  const { error } = await supabase.from("screening_runs").insert({
    user_id: userId,
    title: title || "Untitled role",
    source,
    total_resumes: data.total_resumes,
    shortlisted: data.top.length,
    avg_score: avg,
    top_name: top?.name ?? null,
    top_score: top?.score ?? null,
    results: data,
  });
  if (error) throw error;
}

export async function listRuns(): Promise<RunRow[]> {
  const { data, error } = await supabase
    .from("screening_runs")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as RunRow[];
}

export async function deleteRun(id: string): Promise<void> {
  const { error } = await supabase.from("screening_runs").delete().eq("id", id);
  if (error) throw error;
}

export async function getProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw error;
  return data as Profile | null;
}

export async function upsertProfile(
  userId: string,
  fields: Partial<Pick<Profile, "full_name" | "company" | "avatar_url">>
): Promise<void> {
  const { error } = await supabase
    .from("profiles")
    .upsert({ id: userId, ...fields }, { onConflict: "id" });
  if (error) throw error;
}
