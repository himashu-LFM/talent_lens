import { supabase } from "./supabase";
import type { Candidate, ScreenResponse, Weights } from "../api";

/* ============================================================ types */
export type ReviewStatus = "new" | "shortlisted" | "interview" | "rejected" | "hired";
export const STATUSES: ReviewStatus[] = ["new", "shortlisted", "interview", "rejected", "hired"];

export type Role = "admin" | "recruiter" | "interviewer" | "viewer";
export const ROLES: Role[] = ["admin", "recruiter", "interviewer", "viewer"];
export const ROLE_LABEL: Record<Role, string> = {
  admin: "Admin", recruiter: "Recruiter", interviewer: "Interviewer", viewer: "Viewer",
};
export const ROLE_BLURB: Record<Role, string> = {
  admin: "Everything, plus the team roster, retention and billing settings.",
  recruiter: "Run screenings, manage jobs, email candidates, set statuses.",
  interviewer: "Review candidates, comment, set statuses. Cannot change jobs.",
  viewer: "Read-only across shortlists, history and insights.",
};
export const canWrite = (r?: Role | null) => r === "admin" || r === "recruiter";
export const canReview = (r?: Role | null) => r === "admin" || r === "recruiter" || r === "interviewer";
export const isAdmin = (r?: Role | null) => r === "admin";

export interface Org {
  id: string;
  name: string;
  retention_days: number;
  contact_email: string | null;
  created_at: string;
}
export interface Membership { org_id: string; user_id: string; role: Role; created_at: string; organizations?: Org }
export interface Member { user_id: string; role: Role; created_at: string; full_name: string | null; email: string | null }
export interface Invite { id: string; org_id: string; email: string; role: Role; token: string; created_at: string; accepted_at: string | null }

export interface RunRow {
  id: string; org_id: string; user_id: string; title: string; source: string;
  total_resumes: number; shortlisted: number; avg_score: number;
  top_name: string | null; top_score: number | null;
  results: ScreenResponse; job_id?: string | null; created_at: string;
}
export interface Profile { id: string; full_name: string | null; company: string | null; email: string | null; avatar_url: string | null; active_org_id: string | null; created_at: string }
export interface Review {
  run_id: string; candidate_key: string; candidate_name: string | null;
  candidate_email: string | null; status: ReviewStatus; notes: string | null;
  assignee_id: string | null; updated_at?: string;
}
export interface Comment {
  id: string; run_id: string; candidate_key: string; author_id: string;
  body: string; created_at: string; edited_at: string | null;
  author?: { full_name: string | null; email: string | null } | null;
}
export interface JobRow {
  id: string; org_id: string; title: string; description: string; top_n: number;
  weights: Weights | null; is_open: boolean; location: string | null;
  employment_type: string | null; headcount: number; owner_id: string | null;
  apply_enabled: boolean; public_token: string; auto_ack: boolean;
  created_at: string; updated_at: string;
}
export interface Application {
  id: string; org_id: string; job_id: string; name: string; email: string;
  phone: string | null; location: string | null; notice_period: string | null;
  expected_salary: string | null; current_company: string | null; current_title: string | null;
  links: Record<string, string>; cover_note: string | null;
  voluntary_demographics: Record<string, string> | null;
  resume_id: string | null; parsed: Record<string, unknown> | null;
  score: number | null; breakdown: Record<string, { score: number; max: number }> | null;
  matched_skills: string[] | null; missing_skills: string[] | null;
  status: ReviewStatus; status_token: string; screened_at: string | null;
  purged_at: string | null; created_at: string;
}
export interface InterviewSlot {
  id: string; org_id: string; job_id: string | null; starts_at: string;
  duration_min: number; mode: "video" | "phone" | "onsite"; location: string | null;
  meeting_link: string | null; interviewer_id: string | null;
  taken_by: string | null; taken_at: string | null;
}
export interface Interview {
  id: string; org_id: string; job_id: string | null; application_id: string | null;
  run_id: string | null; candidate_key: string | null; candidate_name: string | null;
  candidate_email: string | null; starts_at: string; duration_min: number;
  mode: string; location: string | null; meeting_link: string | null;
  interviewer_ids: string[];
  status: "scheduled" | "completed" | "cancelled" | "no_show"; notes: string | null;
}
export type TemplateStage = "ack" | "shortlisted" | "interview" | "rejected" | "hired" | "custom";
export interface EmailTemplate {
  id: string; org_id: string; name: string; stage: TemplateStage;
  subject: string; body: string; is_default: boolean; updated_at: string;
}
export interface QueuedEmail {
  id: string; to_email: string; to_name: string | null; subject: string;
  status: "queued" | "sent" | "failed" | "cancelled"; send_after: string;
  attempts: number; last_error: string | null; sent_at: string | null; created_at: string;
}
export interface AuditEntry {
  id: number; org_id: string; actor_id: string | null; action: string; entity: string;
  entity_id: string | null; run_id: string | null; candidate_key: string | null;
  candidate_name: string | null; before: Record<string, unknown> | null;
  after: Record<string, unknown> | null; at: string;
  actor?: { full_name: string | null; email: string | null } | null;
}
export interface DeletionRequest {
  id: string; org_id: string; email: string; reason: string | null; source: string;
  status: "pending" | "completed" | "rejected"; requested_at: string;
  processed_at: string | null; note: string | null;
}

export function candidateKey(c: { email?: string; filename?: string }): string {
  return (c.email || c.filename || "").toLowerCase();
}

function unwrap<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return (res.data ?? []) as T;
}

/* ============================================================ org & team */
export async function myMemberships(): Promise<Membership[]> {
  const { data, error } = await supabase
    .from("memberships")
    .select("org_id,user_id,role,created_at,organizations(id,name,retention_days,contact_email,created_at)")
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as Membership[];
}

export async function createOrg(userId: string, name: string): Promise<Org> {
  const { data: org, error } = await supabase
    .from("organizations")
    .insert({ name: name || "My team", created_by: userId })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  const { error: mErr } = await supabase
    .from("memberships")
    .insert({ org_id: org.id, user_id: userId, role: "admin" });
  if (mErr) throw new Error(mErr.message);
  await supabase.from("profiles").update({ active_org_id: org.id }).eq("id", userId);
  return org as Org;
}

export async function updateOrg(orgId: string, fields: Partial<Pick<Org, "name" | "retention_days" | "contact_email">>): Promise<void> {
  const { error } = await supabase.from("organizations").update(fields).eq("id", orgId);
  if (error) throw new Error(error.message);
}

export async function setActiveOrg(userId: string, orgId: string): Promise<void> {
  await supabase.from("profiles").update({ active_org_id: orgId }).eq("id", userId);
}

export async function listMembers(orgId: string): Promise<Member[]> {
  const { data, error } = await supabase
    .from("memberships")
    .select("user_id,role,created_at,profiles(full_name,email)")
    .eq("org_id", orgId);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: Record<string, unknown>) => {
    const p = (r.profiles ?? {}) as { full_name?: string | null; email?: string | null };
    return {
      user_id: r.user_id as string, role: r.role as Role, created_at: r.created_at as string,
      full_name: p.full_name ?? null, email: p.email ?? null,
    };
  });
}

export async function updateMemberRole(orgId: string, userId: string, role: Role): Promise<void> {
  const { error } = await supabase.from("memberships").update({ role })
    .eq("org_id", orgId).eq("user_id", userId);
  if (error) throw new Error(error.message);
}

export async function removeMember(orgId: string, userId: string): Promise<void> {
  const { error } = await supabase.from("memberships").delete()
    .eq("org_id", orgId).eq("user_id", userId);
  if (error) throw new Error(error.message);
}

export async function listInvites(orgId: string): Promise<Invite[]> {
  const { data, error } = await supabase.from("org_invites").select("*")
    .eq("org_id", orgId).order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as Invite[];
}

export async function inviteMember(orgId: string, userId: string, email: string, role: Role): Promise<Invite> {
  const { data, error } = await supabase.from("org_invites")
    .upsert({ org_id: orgId, email: email.trim().toLowerCase(), role, invited_by: userId, accepted_at: null },
            { onConflict: "org_id,email" })
    .select("*").single();
  if (error) throw new Error(error.message);
  return data as Invite;
}

export async function revokeInvite(id: string): Promise<void> {
  const { error } = await supabase.from("org_invites").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

/** Redeem an invite token. The database matches it against the signed-in
 *  user's own email, so a token cannot be used to join an arbitrary org. */
export async function acceptInvite(token: string): Promise<string> {
  const { data, error } = await supabase.rpc("accept_invite", { invite_token: token });
  if (error) throw new Error(error.message);
  return data as string;
}

export function inviteLink(token: string): string {
  return `${window.location.origin}/join/${token}`;
}

/* ============================================================ runs */
export async function saveRun(
  orgId: string,
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
      org_id: orgId, user_id: userId, title: title || "Untitled role", source,
      total_resumes: data.total_resumes, shortlisted: data.top.length, avg_score: avg,
      top_name: top?.name ?? null, top_score: top?.score ?? null,
      results: data, job_id: jobId ?? null,
    })
    .select("id").single();
  if (error) throw new Error(error.message);
  return row.id as string;
}

export async function listRuns(orgId?: string): Promise<RunRow[]> {
  let q = supabase.from("screening_runs").select("*").order("created_at", { ascending: false });
  if (orgId) q = q.eq("org_id", orgId);
  return unwrap<RunRow[]>(await q);
}

export async function deleteRun(id: string): Promise<void> {
  const { error } = await supabase.from("screening_runs").delete().eq("id", id);
  if (error) throw new Error(error.message);
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
      if (e && wanted.has(e) && !seen.has(e)) { seen.add(e); map.set(e, (map.get(e) ?? 0) + 1); }
    }
  }
  return map;
}

/* ============================================================ reviews */
const REVIEW_COLS = "run_id,candidate_key,candidate_name,candidate_email,status,notes,assignee_id,updated_at";

export async function listReviews(runId: string): Promise<Map<string, Review>> {
  const rows = unwrap<Review[]>(
    await supabase.from("candidate_reviews").select(REVIEW_COLS).eq("run_id", runId)
  );
  const m = new Map<string, Review>();
  rows.forEach((r) => m.set(r.candidate_key, r));
  return m;
}

export async function listAllReviews(orgId?: string): Promise<Review[]> {
  let q = supabase.from("candidate_reviews").select(REVIEW_COLS);
  if (orgId) q = q.eq("org_id", orgId);
  return unwrap<Review[]>(await q);
}

export async function upsertReview(
  orgId: string,
  userId: string,
  runId: string,
  key: string,
  fields: { status?: ReviewStatus; notes?: string; name?: string; email?: string; assignee_id?: string | null }
): Promise<void> {
  const { error } = await supabase.from("candidate_reviews").upsert(
    {
      org_id: orgId, user_id: userId, run_id: runId, candidate_key: key,
      candidate_name: fields.name ?? null, candidate_email: fields.email ?? null,
      ...(fields.status !== undefined ? { status: fields.status } : {}),
      ...(fields.notes !== undefined ? { notes: fields.notes } : {}),
      ...(fields.assignee_id !== undefined ? { assignee_id: fields.assignee_id } : {}),
      updated_by: userId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "run_id,candidate_key" }
  );
  if (error) throw new Error(error.message);
}

export async function bulkUpsertReviews(
  orgId: string,
  userId: string,
  runId: string,
  items: { key: string; status: ReviewStatus; name?: string; email?: string }[]
): Promise<void> {
  if (!items.length) return;
  const { error } = await supabase.from("candidate_reviews").upsert(
    items.map((i) => ({
      org_id: orgId, user_id: userId, run_id: runId, candidate_key: i.key,
      candidate_name: i.name ?? null, candidate_email: i.email ?? null,
      status: i.status, updated_by: userId, updated_at: new Date().toISOString(),
    })),
    { onConflict: "run_id,candidate_key" }
  );
  if (error) throw new Error(error.message);
}

/* ============================================================ comments */
export async function listComments(runId: string, key: string): Promise<Comment[]> {
  const { data, error } = await supabase
    .from("candidate_comments")
    .select("id,run_id,candidate_key,author_id,body,created_at,edited_at,profiles!candidate_comments_author_id_fkey(full_name,email)")
    .eq("run_id", runId).eq("candidate_key", key)
    .order("created_at", { ascending: true });
  if (error) {
    // The embedded author join needs a named FK; fall back to the plain rows.
    const plain = unwrap<Comment[]>(
      await supabase.from("candidate_comments")
        .select("id,run_id,candidate_key,author_id,body,created_at,edited_at")
        .eq("run_id", runId).eq("candidate_key", key)
        .order("created_at", { ascending: true })
    );
    return plain;
  }
  return (data ?? []).map((r: Record<string, unknown>) => ({
    ...(r as unknown as Comment),
    author: (r.profiles ?? null) as Comment["author"],
  }));
}

export async function addComment(orgId: string, runId: string, key: string,
                                 authorId: string, body: string): Promise<Comment> {
  const { data, error } = await supabase.from("candidate_comments")
    .insert({ org_id: orgId, run_id: runId, candidate_key: key, author_id: authorId, body })
    .select("id,run_id,candidate_key,author_id,body,created_at,edited_at").single();
  if (error) throw new Error(error.message);
  return data as Comment;
}

export async function deleteComment(id: string): Promise<void> {
  const { error } = await supabase.from("candidate_comments").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export async function commentCounts(runId: string): Promise<Map<string, number>> {
  const rows = unwrap<{ candidate_key: string }[]>(
    await supabase.from("candidate_comments").select("candidate_key").eq("run_id", runId)
  );
  const m = new Map<string, number>();
  rows.forEach((r) => m.set(r.candidate_key, (m.get(r.candidate_key) ?? 0) + 1));
  return m;
}

/* ============================================================ resume storage */
const BUCKET = "resumes";

async function sha1(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-1", buf);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Store the original document so a re-opened run can still show the PDF.
 *  Deduped per org by content hash, so the same resume across runs costs
 *  one object. Failures are returned, never thrown — losing the file must not
 *  lose the screening. */
export async function uploadResumes(
  orgId: string, userId: string, runId: string,
  items: { key: string; file: File }[]
): Promise<{ stored: number; failed: number }> {
  let stored = 0, failed = 0;
  for (const { key, file } of items) {
    try {
      const hash = await sha1(file);
      const ext = (file.name.match(/\.[a-z0-9]+$/i)?.[0] ?? "").toLowerCase();
      const path = `${orgId}/${hash}${ext}`;
      const up = await supabase.storage.from(BUCKET)
        .upload(path, file, { upsert: true, contentType: file.type || undefined });
      if (up.error && !/exists/i.test(up.error.message)) throw new Error(up.error.message);

      const { data: rf, error: rfErr } = await supabase.from("resume_files")
        .upsert({
          org_id: orgId, sha1: hash, filename: file.name, storage_path: path,
          size_bytes: file.size, content_type: file.type || null, created_by: userId,
        }, { onConflict: "org_id,sha1" })
        .select("id").single();
      if (rfErr) throw new Error(rfErr.message);

      const { error: linkErr } = await supabase.from("run_resumes")
        .upsert({ run_id: runId, candidate_key: key, resume_id: rf.id },
                { onConflict: "run_id,candidate_key" });
      if (linkErr) throw new Error(linkErr.message);
      stored++;
    } catch {
      failed++;
    }
  }
  return { stored, failed };
}

export async function runResumeMap(runId: string): Promise<Map<string, { path: string; filename: string }>> {
  const { data, error } = await supabase.from("run_resumes")
    .select("candidate_key,resume_files(storage_path,filename)")
    .eq("run_id", runId);
  if (error) return new Map();
  const m = new Map<string, { path: string; filename: string }>();
  (data ?? []).forEach((r: Record<string, unknown>) => {
    const f = r.resume_files as { storage_path?: string; filename?: string } | null;
    if (f?.storage_path) m.set(r.candidate_key as string,
      { path: f.storage_path, filename: f.filename ?? "resume" });
  });
  return m;
}

/** Short-lived signed URL; the Storage policy still checks org membership. */
export async function signedResumeUrl(path: string, seconds = 900): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, seconds);
  if (error) throw new Error(error.message);
  return data.signedUrl;
}

/* ============================================================ jobs */
export async function listJobs(orgId?: string): Promise<JobRow[]> {
  let q = supabase.from("jobs").select("*").order("updated_at", { ascending: false });
  if (orgId) q = q.eq("org_id", orgId);
  return unwrap<JobRow[]>(await q);
}

export async function saveJob(
  orgId: string,
  userId: string,
  job: Partial<JobRow> & { title: string; description: string; top_n: number }
): Promise<JobRow> {
  const payload: Record<string, unknown> = {
    ...(job.id ? { id: job.id } : {}),
    org_id: orgId, user_id: userId,
    title: job.title || "Untitled role",
    description: job.description,
    top_n: job.top_n,
    weights: job.weights ?? null,
    updated_at: new Date().toISOString(),
  };
  for (const k of ["is_open", "location", "employment_type", "headcount",
                   "apply_enabled", "auto_ack", "owner_id"] as const) {
    if (job[k] !== undefined) payload[k] = job[k];
  }
  const { data, error } = await supabase.from("jobs").upsert(payload).select("*").single();
  if (error) throw new Error(error.message);
  return data as JobRow;
}

export async function deleteJob(id: string): Promise<void> {
  const { error } = await supabase.from("jobs").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export function applyUrl(token: string): string {
  return `${window.location.origin}/apply/${token}`;
}

/* ============================================================ applications */
export async function listApplications(orgId: string, jobId?: string): Promise<Application[]> {
  let q = supabase.from("applications").select("*").eq("org_id", orgId)
    .order("created_at", { ascending: false });
  if (jobId) q = q.eq("job_id", jobId);
  return unwrap<Application[]>(await q);
}

export async function setApplicationStatus(id: string, status: ReviewStatus): Promise<void> {
  const { error } = await supabase.from("applications").update({ status }).eq("id", id);
  if (error) throw new Error(error.message);
}

/** Voluntary self-reported figures, aggregated for the adverse-impact table.
 *  Individual responses are never surfaced. */
export async function demographicsForJob(orgId: string, jobId?: string): Promise<Record<string, Record<string, { total: number; selected: number }>>> {
  const apps = await listApplications(orgId, jobId);
  const out: Record<string, Record<string, { total: number; selected: number }>> = {};
  for (const a of apps) {
    const d = a.voluntary_demographics;
    if (!d) continue;
    const advanced = a.status === "shortlisted" || a.status === "interview" || a.status === "hired";
    for (const [attr, value] of Object.entries(d)) {
      if (!value || value === "prefer_not_to_say") continue;
      out[attr] = out[attr] ?? {};
      out[attr][value] = out[attr][value] ?? { total: 0, selected: 0 };
      out[attr][value].total++;
      if (advanced) out[attr][value].selected++;
    }
  }
  return out;
}

/* ============================================================ interviews */
export async function listSlots(orgId: string, jobId?: string): Promise<InterviewSlot[]> {
  let q = supabase.from("interview_slots").select("*").eq("org_id", orgId)
    .order("starts_at", { ascending: true });
  if (jobId) q = q.eq("job_id", jobId);
  return unwrap<InterviewSlot[]>(await q);
}

export async function createSlots(orgId: string, userId: string, slots: {
  job_id: string | null; starts_at: string; duration_min: number;
  mode: "video" | "phone" | "onsite"; location?: string | null; meeting_link?: string | null;
  interviewer_id?: string | null;
}[]): Promise<InterviewSlot[]> {
  if (!slots.length) return [];
  const { data, error } = await supabase.from("interview_slots")
    .insert(slots.map((s) => ({ ...s, org_id: orgId, created_by: userId })))
    .select("*");
  if (error) throw new Error(error.message);
  return (data ?? []) as InterviewSlot[];
}

export async function deleteSlot(id: string): Promise<void> {
  const { error } = await supabase.from("interview_slots").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export async function listInterviews(orgId: string): Promise<Interview[]> {
  return unwrap<Interview[]>(
    await supabase.from("interviews").select("*").eq("org_id", orgId)
      .order("starts_at", { ascending: true })
  );
}

export async function setInterviewStatus(id: string, status: Interview["status"]): Promise<void> {
  const { error } = await supabase.from("interviews").update({ status }).eq("id", id);
  if (error) throw new Error(error.message);
}

/* ============================================================ email */
export async function listTemplates(orgId: string): Promise<EmailTemplate[]> {
  return unwrap<EmailTemplate[]>(
    await supabase.from("email_templates").select("*").eq("org_id", orgId)
      .order("stage", { ascending: true })
  );
}

export async function saveTemplate(orgId: string, userId: string,
                                   t: Partial<EmailTemplate> & { name: string; subject: string; body: string; stage: TemplateStage }): Promise<EmailTemplate> {
  const { data, error } = await supabase.from("email_templates").upsert({
    ...(t.id ? { id: t.id } : {}),
    org_id: orgId, name: t.name, stage: t.stage, subject: t.subject, body: t.body,
    is_default: t.is_default ?? false, created_by: userId,
    updated_at: new Date().toISOString(),
  }).select("*").single();
  if (error) throw new Error(error.message);
  return data as EmailTemplate;
}

export async function deleteTemplate(id: string): Promise<void> {
  const { error } = await supabase.from("email_templates").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

/** Queue messages for the backend worker to send. `sendAfter` schedules them. */
export async function enqueueEmails(orgId: string, userId: string, items: {
  to_email: string; to_name?: string; subject: string; body: string;
  run_id?: string | null; candidate_key?: string | null; application_id?: string | null;
}[], sendAfter?: Date): Promise<number> {
  if (!items.length) return 0;
  const { data, error } = await supabase.from("email_queue").insert(
    items.map((i) => ({
      org_id: orgId, created_by: userId,
      to_email: i.to_email, to_name: i.to_name ?? null,
      subject: i.subject, body: i.body,
      run_id: i.run_id ?? null, candidate_key: i.candidate_key ?? null,
      application_id: i.application_id ?? null,
      send_after: (sendAfter ?? new Date()).toISOString(),
    }))
  ).select("id");
  if (error) throw new Error(error.message);
  return (data ?? []).length;
}

export async function listQueue(orgId: string, limit = 100): Promise<QueuedEmail[]> {
  return unwrap<QueuedEmail[]>(
    await supabase.from("email_queue")
      .select("id,to_email,to_name,subject,status,send_after,attempts,last_error,sent_at,created_at")
      .eq("org_id", orgId).order("created_at", { ascending: false }).limit(limit)
  );
}

export async function cancelQueued(id: string): Promise<void> {
  const { error } = await supabase.from("email_queue").update({ status: "cancelled" })
    .eq("id", id).eq("status", "queued");
  if (error) throw new Error(error.message);
}

/* ============================================================ audit log */
export async function listAudit(orgId: string, limit = 200): Promise<AuditEntry[]> {
  const { data, error } = await supabase.from("audit_log")
    .select("*").eq("org_id", orgId).order("at", { ascending: false }).limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as AuditEntry[];
}

export async function listCandidateAudit(runId: string, key: string): Promise<AuditEntry[]> {
  const { data, error } = await supabase.from("audit_log").select("*")
    .eq("run_id", runId).eq("candidate_key", key)
    .order("at", { ascending: false }).limit(50);
  if (error) return [];
  return (data ?? []) as AuditEntry[];
}

/** Explicit log line for actions with no database trigger behind them
 *  (exports, bulk emails, apply-link changes). Never throws. */
export async function logAudit(orgId: string, actorId: string, action: string,
                               entity: string, extra: Partial<AuditEntry> = {}): Promise<void> {
  try {
    await supabase.from("audit_log").insert({
      org_id: orgId, actor_id: actorId, action, entity,
      entity_id: extra.entity_id ?? null, run_id: extra.run_id ?? null,
      candidate_key: extra.candidate_key ?? null, candidate_name: extra.candidate_name ?? null,
      after: extra.after ?? null,
    });
  } catch { /* the audit trail must never block the action it records */ }
}

/* ============================================================ compliance */
export async function listDeletionRequests(orgId: string): Promise<DeletionRequest[]> {
  return unwrap<DeletionRequest[]>(
    await supabase.from("deletion_requests").select("*").eq("org_id", orgId)
      .order("requested_at", { ascending: false })
  );
}

export async function createDeletionRequest(orgId: string, email: string, reason: string): Promise<void> {
  const { error } = await supabase.from("deletion_requests")
    .insert({ org_id: orgId, email: email.trim().toLowerCase(), reason: reason || null, source: "recruiter" });
  if (error) throw new Error(error.message);
}

export async function saveBiasAudit(orgId: string, userId: string, runId: string,
                                    report: Record<string, unknown>): Promise<void> {
  const { error } = await supabase.from("bias_audits")
    .insert({ org_id: orgId, run_id: runId, report, created_by: userId });
  if (error) throw new Error(error.message);
}

export async function latestBiasAudit(runId: string): Promise<Record<string, unknown> | null> {
  const { data, error } = await supabase.from("bias_audits").select("report")
    .eq("run_id", runId).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error || !data) return null;
  return data.report as Record<string, unknown>;
}

/* ============================================================ candidate merge */
export async function mergeCandidates(orgId: string, userId: string,
                                      primaryKey: string, mergedKeys: string[]): Promise<void> {
  if (!mergedKeys.length) return;
  const { error } = await supabase.from("candidate_identities").upsert(
    mergedKeys.filter((k) => k && k !== primaryKey).map((k) => ({
      org_id: orgId, primary_key: primaryKey, merged_key: k, merged_by: userId,
    })), { onConflict: "org_id,merged_key" }
  );
  if (error) throw new Error(error.message);
}

export async function listMerges(orgId: string): Promise<Map<string, string>> {
  const rows = unwrap<{ primary_key: string; merged_key: string }[]>(
    await supabase.from("candidate_identities").select("primary_key,merged_key").eq("org_id", orgId)
  );
  const m = new Map<string, string>();
  rows.forEach((r) => m.set(r.merged_key, r.primary_key));
  return m;
}

export async function unmergeCandidate(orgId: string, mergedKey: string): Promise<void> {
  const { error } = await supabase.from("candidate_identities").delete()
    .eq("org_id", orgId).eq("merged_key", mergedKey);
  if (error) throw new Error(error.message);
}

/* ============================================================ profile */
export async function getProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle();
  if (error) throw new Error(error.message);
  return data as Profile | null;
}

export async function upsertProfile(
  userId: string,
  fields: Partial<Pick<Profile, "full_name" | "company" | "avatar_url" | "active_org_id">>
): Promise<void> {
  const { error } = await supabase.from("profiles").upsert({ id: userId, ...fields }, { onConflict: "id" });
  if (error) throw new Error(error.message);
}

/* ============================================================ learn from decisions */
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
