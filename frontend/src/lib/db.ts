import { supabase } from "./supabase";
import type { Candidate, ScreenResponse, Weights } from "../api";

export type ReviewStatus = "new" | "shortlisted" | "interview" | "rejected" | "hired";
export const STATUSES: ReviewStatus[] = ["new", "shortlisted", "interview", "rejected", "hired"];

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
  job_id?: string | null;
  created_at: string;
}

export interface Profile {
  id: string;
  full_name: string | null;
  company: string | null;
  avatar_url: string | null;
  created_at: string;
}

export interface Review {
  run_id: string;
  candidate_key: string;
  candidate_name: string | null;
  candidate_email: string | null;
  status: ReviewStatus;
  notes: string | null;
}

export interface JobRow {
  id: string;
  title: string;
  description: string;
  top_n: number;
  weights: Weights | null;
  created_at: string;
  updated_at: string;
}

export function candidateKey(c: { email?: string; filename?: string }): string {
  return (c.email || c.filename || "").toLowerCase();
}

// ---------------------------------------------------------------- runs
export async function saveRun(
  userId: string,
  title: string,
  source: "upload" | "gmail" | "auto",
  data: ScreenResponse,
  jobId?: string | null
): Promise<string> {
  const avg = data.top.length
    ? Math.round((data.top.reduce((s, c) => s + c.score, 0) / data.top.length) * 10) / 10
    : 0;
  const top = data.top[0];
  const { data: row, error } = await supabase
    .from("screening_runs")
    .insert({
      user_id: userId,
      title: title || "Untitled role",
      source,
      total_resumes: data.total_resumes,
      shortlisted: data.top.length,
      avg_score: avg,
      top_name: top?.name ?? null,
      top_score: top?.score ?? null,
      results: data,
      job_id: jobId ?? null,
    })
    .select("id")
    .single();
  if (error) throw error;
  return row.id as string;
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

export async function priorAppearances(emails: string[], excludeRunId?: string): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  const wanted = new Set(emails.filter(Boolean).map((e) => e.toLowerCase()));
  if (!wanted.size) return map;
  const runs = await listRuns();
  for (const r of runs) {
    if (excludeRunId && r.id === excludeRunId) continue;
    const seen = new Set<string>();
    for (const c of r.results?.ranked ?? []) {
      const e = (c.email || "").toLowerCase();
      if (e && wanted.has(e) && !seen.has(e)) {
        seen.add(e);
        map.set(e, (map.get(e) ?? 0) + 1);
      }
    }
  }
  return map;
}

// ---------------------------------------------------------------- reviews
export async function listReviews(runId: string): Promise<Map<string, Review>> {
  const { data, error } = await supabase
    .from("candidate_reviews")
    .select("run_id,candidate_key,candidate_name,candidate_email,status,notes")
    .eq("run_id", runId);
  if (error) throw error;
  const m = new Map<string, Review>();
  (data ?? []).forEach((r) => m.set(r.candidate_key, r as Review));
  return m;
}

export async function listAllReviews(): Promise<Review[]> {
  const { data, error } = await supabase
    .from("candidate_reviews")
    .select("run_id,candidate_key,candidate_name,candidate_email,status,notes");
  if (error) throw error;
  return (data ?? []) as Review[];
}

export async function upsertReview(
  userId: string,
  runId: string,
  key: string,
  fields: { status?: ReviewStatus; notes?: string; name?: string; email?: string }
): Promise<void> {
  const { error } = await supabase.from("candidate_reviews").upsert(
    {
      user_id: userId,
      run_id: runId,
      candidate_key: key,
      candidate_name: fields.name ?? null,
      candidate_email: fields.email ?? null,
      ...(fields.status !== undefined ? { status: fields.status } : {}),
      ...(fields.notes !== undefined ? { notes: fields.notes } : {}),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "run_id,candidate_key" }
  );
  if (error) throw error;
}

export async function bulkUpsertReviews(
  userId: string,
  runId: string,
  items: { key: string; status: ReviewStatus; name?: string; email?: string }[]
): Promise<void> {
  if (!items.length) return;
  const { error } = await supabase.from("candidate_reviews").upsert(
    items.map((i) => ({
      user_id: userId,
      run_id: runId,
      candidate_key: i.key,
      candidate_name: i.name ?? null,
      candidate_email: i.email ?? null,
      status: i.status,
      updated_at: new Date().toISOString(),
    })),
    { onConflict: "run_id,candidate_key" }
  );
  if (error) throw error;
}

// ---------------------------------------------------------------- jobs
export async function listJobs(): Promise<JobRow[]> {
  const { data, error } = await supabase.from("jobs").select("*").order("updated_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as JobRow[];
}

export async function saveJob(
  userId: string,
  job: { id?: string; title: string; description: string; top_n: number; weights: Weights | null }
): Promise<JobRow> {
  const payload = {
    ...(job.id ? { id: job.id } : {}),
    user_id: userId,
    title: job.title || "Untitled role",
    description: job.description,
    top_n: job.top_n,
    weights: job.weights,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await supabase.from("jobs").upsert(payload).select("*").single();
  if (error) throw error;
  return data as JobRow;
}

export async function deleteJob(id: string): Promise<void> {
  const { error } = await supabase.from("jobs").delete().eq("id", id);
  if (error) throw error;
}

// ---------------------------------------------------------------- profile
export async function getProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle();
  if (error) throw error;
  return data as Profile | null;
}

export async function upsertProfile(
  userId: string,
  fields: Partial<Pick<Profile, "full_name" | "company" | "avatar_url">>
): Promise<void> {
  const { error } = await supabase.from("profiles").upsert({ id: userId, ...fields }, { onConflict: "id" });
  if (error) throw error;
}

// ---------------------------------------------------------------- learn from decisions
/**
 * Suggest scoring weights from the recruiter's own decisions: for every reviewed
 * candidate, compare each signal's normalised score between positive outcomes
 * (shortlisted / interview / hired) and rejections. Signals that separate the two
 * groups better get more weight. Returns null when there isn't enough signal.
 */
export function suggestWeights(
  runs: RunRow[],
  reviews: Review[],
  current: Weights
): { weights: Weights; positives: number; negatives: number } | null {
  const byRun = new Map<string, Map<string, Review>>();
  for (const r of reviews) {
    if (!byRun.has(r.run_id)) byRun.set(r.run_id, new Map());
    byRun.get(r.run_id)!.set(r.candidate_key, r);
  }
  const keys: (keyof Weights)[] = ["semantic", "skills", "relevance", "experience"];
  const pos: Record<string, number[]> = {};
  const neg: Record<string, number[]> = {};
  keys.forEach((k) => { pos[k] = []; neg[k] = []; });
  let positives = 0, negatives = 0;

  for (const run of runs) {
    const rv = byRun.get(run.id);
    if (!rv) continue;
    for (const c of run.results?.ranked ?? []) {
      const review = rv.get(candidateKey(c));
      if (!review || review.status === "new") continue;
      const good = review.status !== "rejected";
      if (good) positives++; else negatives++;
      for (const k of keys) {
        const b = (c as Candidate).breakdown?.[k];
        if (!b || !b.max) continue;
        (good ? pos : neg)[k].push(b.score / b.max);
      }
    }
  }
  if (positives < 3 || negatives < 3) return null;

  const mean = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
  const sep: Record<string, number> = {};
  for (const k of keys) sep[k] = Math.max(0.05, mean(pos[k]) - mean(neg[k]) + 0.25);
  const total = keys.reduce((s, k) => s + sep[k], 0);
  // blend 50/50 with current weights so suggestions move gradually
  const out = {} as Weights;
  let acc = 0;
  for (const k of keys) {
    const v = Math.round(0.5 * current[k] + 0.5 * (sep[k] / total) * 100);
    out[k] = v;
    acc += v;
  }
  out.semantic += 100 - acc;
  return { weights: out, positives, negatives };
}
