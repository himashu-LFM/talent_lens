export interface BreakdownEntry {
  score: number;
  max: number;
  [k: string]: unknown;
}

export interface Improvement {
  requirement: string;
  points: number;
  must_have: boolean;
}

export interface Brief {
  headline: string;
  experience: string;
  strengths: string[];
  gaps: string[];
}

export interface CareerRole {
  title: string;
  company: string;
  start: string;
  end: string;
  months: number;
  current: boolean;
}

export interface CareerProfile {
  roles: CareerRole[];
  current_title: string;
  current_company: string;
  seniority: string;
  total_months: number;
  avg_tenure_months: number;
  role_count: number;
  gaps: { from: string; to: string; months: number }[];
  longest_gap_months: number;
  job_hopping: boolean;
  flags: string[];
  education_level: string;
  education: { text: string; year?: number }[];
  grad_year: number | null;
}

/** Optional LLM second opinion on a shortlisted candidate. */
export interface AIAssessment {
  verdict?: "strong_yes" | "yes" | "maybe" | "no";
  fit_score?: number;
  summary?: string;
  strengths?: string[];
  concerns?: string[];
  evidence?: string[];
  questions?: string[];
  seniority?: string;
  model?: string;
  error?: string;
}

export interface Candidate {
  rank: number;
  filename: string;
  name: string;
  email: string;
  phone: string;
  experience_years: number;
  skills: string[];
  score: number;
  matched_skills: string[];
  missing_skills: string[];
  breakdown: Record<string, BreakdownEntry>;
  evidence?: Record<string, string>;
  best_match_snippet?: string;
  improvements?: Improvement[];
  brief?: Brief;
  interview_questions?: string[];
  duplicate_group?: string | null;
  confidence?: number;
  word_count?: number;
  source?: string;
  location?: string;
  links?: Record<string, string>;
  profile?: CareerProfile;
  ai?: AIAssessment;
}

export interface FlaggedDoc {
  filename: string;
  name: string;
  confidence: number;
  reasons: string[];
  source?: string;
}

export type Weights = Record<"semantic" | "skills" | "relevance" | "experience", number>;

export interface BiasReport {
  job_title: string;
  anonymisation: {
    ran: boolean;
    reason?: string;
    method?: string;
    candidates?: number;
    personas?: string[];
    max_spread?: number;
    mean_spread?: number;
    rank_swaps?: number;
    component_spread?: Record<string, number>;
    unstable_components?: string[];
    clean?: boolean;
    threshold?: number;
    verdict?: string;
    recommendation?: string;
    affected?: { filename: string; name: string; score: number | null; spread: number; by_persona: Record<string, number> }[];
  };
  resume_pii: {
    categories: { category: string; count: number; examples: string[] }[];
    affected_candidates: number;
    note: string;
  };
  jd_language: { issues: { category: string; terms: string[] }[]; clean: boolean; note: string };
  adverse_impact: {
    min_group_size: number;
    basis: string;
    attributes: {
      attribute: string;
      flagged: string[];
      note: string;
      rows: { group: string; total: number; selected?: number; rate?: number; impact_ratio?: number | null; suppressed: boolean }[];
    }[];
  };
  disclaimer: string;
}

export interface ScreenResponse {
  job: {
    title: string;
    required_years: number;
    required_skills: string[];
    extra_requirements?: string[];
    alternative_groups?: string[][];
    weights?: Weights;
  };
  total_resumes: number;
  ranked: Candidate[];
  top: Candidate[];
  top_n: number;
  errors: { filename: string; error: string }[];
  flagged?: FlaggedDoc[];
  fetched?: number;
  bias_audit?: BiasReport;
  llm?: {
    ran: boolean;
    reason?: string;
    model?: string;
    assessed?: number;
    usage?: { input_tokens: number; output_tokens: number; cache_read_input_tokens: number };
  };
}

export interface RoleMatch {
  job_id?: string;
  title: string;
  score: number;
  breakdown: Record<string, BreakdownEntry>;
  matched_skills: string[];
  missing_skills: string[];
  required_years: number;
  meets_experience: boolean;
  headline: string;
}

export interface RoleMatchResponse {
  filename: string;
  error?: string;
  reasons?: string[];
  candidate?: Candidate;
  matches: RoleMatch[];
  best_fit?: RoleMatch | null;
  verdict?: string;
}

export interface GmailStatus {
  configured: boolean;
  connected: boolean;
  can_send?: boolean;
}

export interface GmailLabel {
  id: string;
  name: string;
  type: string;
}

export interface Readiness {
  status: string;
  semantic_model: "ready" | "unavailable";
  gmail_configured: boolean;
  gmail_connected: boolean;
  gmail_can_send: boolean;
  limits: { max_files: number; max_file_mb: number };
  default_weights: Weights;
  watches: number;
  unacked_auto_results: number;
  ocr?: string;
  llm?: { available: boolean; status: string; model: string; max_candidates: number };
  supabase?: boolean;
  public_apply?: boolean;
  app_url?: string;
}

export interface JDIssue {
  severity: "high" | "medium" | "low" | "info";
  message: string;
  suggestion: string;
}

export interface JDAnalysis {
  score: number;
  grade: string;
  stats: {
    words: number;
    requirements: number;
    taxonomy_skills: string[];
    extracted_requirements: string[];
    years_specified: number;
  };
  issues: JDIssue[];
}

export interface Watch {
  id: string;
  label_id: string;
  label_name: string;
  title: string;
  description: string;
  top_n: number;
  interval_min: number;
  unread_only: boolean;
  mark_read: boolean;
  weights?: Weights | null;
  enabled: boolean;
  created_at: string;
  last_run: string | null;
  last_fetched: number;
  runs: number;
}

export interface AutoResult {
  id: string;
  watch_id: string;
  title: string;
  label_name: string;
  created_at: string;
  acked: boolean;
  result: ScreenResponse;
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      msg = body.detail || msg;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  return res.json();
}

const J = { "Content-Type": "application/json" };

/** Screening can legitimately take minutes (large batches, or a sleeping free-tier
 *  backend cold-starting). `fetch` has no default timeout, so without this a stalled
 *  connection leaves the UI spinning forever. */
const SCREEN_TIMEOUT_MS = 300_000;

async function withTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ac.signal });
  } catch (e) {
    if ((e as Error)?.name === "AbortError") {
      throw new Error(
        `No response after ${Math.round(ms / 1000)}s. The screening server may be waking up or offline — check it and try again.`
      );
    }
    throw new Error(`Couldn't reach the screening server (${(e as Error)?.message || "network error"}).`);
  } finally {
    clearTimeout(timer);
  }
}

export async function readiness(): Promise<Readiness> {
  return json(await fetch("/api/ready"));
}

export interface ScreenOptions {
  weights?: Weights;
  /** Run the fairness audit (re-scores everyone under substituted identities). */
  audit?: boolean;
  /** Ask the LLM for a second opinion on the shortlist (needs a server key). */
  deep?: boolean;
  deepTopN?: number;
}

export async function screen(
  title: string,
  description: string,
  topN: number,
  files: File[],
  opts: ScreenOptions = {}
): Promise<ScreenResponse> {
  const fd = new FormData();
  fd.append("title", title);
  fd.append("description", description);
  fd.append("top_n", String(topN));
  if (opts.weights) fd.append("weights", JSON.stringify(opts.weights));
  if (opts.audit) fd.append("audit", "true");
  if (opts.deep) fd.append("deep", "true");
  if (opts.deepTopN) fd.append("deep_top_n", String(opts.deepTopN));
  files.forEach((f) => fd.append("files", f));
  return json(await withTimeout("/api/screen", { method: "POST", body: fd }, SCREEN_TIMEOUT_MS));
}

/** Score one resume against several open roles — "which of our jobs does this
 *  person actually fit?" */
export async function matchRoles(
  file: File,
  roles: { id?: string; title: string; description: string; weights?: Weights | null }[]
): Promise<RoleMatchResponse> {
  const fd = new FormData();
  fd.append("roles", JSON.stringify(roles));
  fd.append("file", file);
  return json(await withTimeout("/api/match/roles", { method: "POST", body: fd }, SCREEN_TIMEOUT_MS));
}

export async function analyzeJD(title: string, description: string): Promise<JDAnalysis> {
  return json(await fetch("/api/jd/analyze", { method: "POST", headers: J, body: JSON.stringify({ title, description }) }));
}

// ---- skills taxonomy ----
export async function listSkills(): Promise<{ builtin: Record<string, string[]>; custom: Record<string, string[]> }> {
  return json(await fetch("/api/skills"));
}
export async function addCustomSkill(name: string, aliases: string[]): Promise<Record<string, string[]>> {
  const d = await json<{ custom: Record<string, string[]> }>(
    await fetch("/api/skills/custom", { method: "POST", headers: J, body: JSON.stringify({ name, aliases }) })
  );
  return d.custom;
}
export async function removeCustomSkill(name: string): Promise<Record<string, string[]>> {
  const d = await json<{ custom: Record<string, string[]> }>(
    await fetch(`/api/skills/custom/${encodeURIComponent(name)}`, { method: "DELETE" })
  );
  return d.custom;
}

// ---- gmail ----
export async function gmailStatus(): Promise<GmailStatus> {
  return json(await fetch("/api/gmail/status"));
}
export async function gmailConnect(): Promise<{ email: string; can_send: boolean }> {
  return json(await fetch("/api/gmail/connect", { method: "POST" }));
}
export async function gmailDisconnect(): Promise<void> {
  await json(await fetch("/api/gmail/disconnect", { method: "POST" }));
}
export async function gmailLabels(): Promise<GmailLabel[]> {
  const data = await json<{ labels: GmailLabel[] }>(await fetch("/api/gmail/labels"));
  return data.labels;
}
export async function gmailCreateLabel(name: string): Promise<GmailLabel> {
  const data = await json<{ label: GmailLabel }>(
    await fetch("/api/gmail/labels/create", { method: "POST", headers: J, body: JSON.stringify({ name }) })
  );
  return data.label;
}
export async function gmailScreen(params: {
  title: string;
  description: string;
  top_n: number;
  label_id: string;
  unread_only: boolean;
  mark_read: boolean;
  weights?: Weights;
  audit?: boolean;
  deep?: boolean;
  deep_top_n?: number;
}): Promise<ScreenResponse> {
  return json(
    await withTimeout("/api/gmail/screen", { method: "POST", headers: J, body: JSON.stringify(params) }, SCREEN_TIMEOUT_MS)
  );
}
export async function gmailSend(to: string, subject: string, body: string): Promise<void> {
  await json(await fetch("/api/gmail/send", { method: "POST", headers: J, body: JSON.stringify({ to, subject, body }) }));
}

// ---- auto-screen watches ----
export async function listWatches(): Promise<Watch[]> {
  return (await json<{ watches: Watch[] }>(await fetch("/api/watches"))).watches;
}
export async function addWatch(w: Omit<Watch, "id" | "enabled" | "created_at" | "last_run" | "last_fetched" | "runs">): Promise<Watch> {
  return (await json<{ watch: Watch }>(await fetch("/api/watches", { method: "POST", headers: J, body: JSON.stringify(w) }))).watch;
}
export async function updateWatch(id: string, fields: Partial<Pick<Watch, "enabled" | "interval_min" | "top_n" | "unread_only" | "mark_read">>): Promise<Watch> {
  return (await json<{ watch: Watch }>(await fetch(`/api/watches/${id}`, { method: "PATCH", headers: J, body: JSON.stringify(fields) }))).watch;
}
export async function deleteWatch(id: string): Promise<void> {
  await json(await fetch(`/api/watches/${id}`, { method: "DELETE" }));
}
export async function runWatch(id: string): Promise<{ fetched: number; stored: boolean }> {
  return json(await fetch(`/api/watches/${id}/run`, { method: "POST" }));
}
export async function listAutoResults(unackedOnly = false): Promise<AutoResult[]> {
  return (await json<{ results: AutoResult[] }>(await fetch(`/api/watches/results?unacked=${unackedOnly}`))).results;
}
export async function ackAutoResult(id: string): Promise<void> {
  await json(await fetch(`/api/watches/results/${id}/ack`, { method: "POST" }));
}
export async function deleteAutoResult(id: string): Promise<void> {
  await json(await fetch(`/api/watches/results/${id}`, { method: "DELETE" }));
}

// ---- export ----
export interface ExportCandidate extends Partial<Candidate> {
  status?: string;
  notes?: string;
}

export async function exportExcel(candidates: ExportCandidate[], jobTitle = ""): Promise<void> {
  const res = await fetch("/api/export", { method: "POST", headers: J, body: JSON.stringify({ candidates, job_title: jobTitle }) });
  if (!res.ok) throw new Error("Export failed");
  const blob = await res.blob();
  const m = /filename=([^;]+)/.exec(res.headers.get("Content-Disposition") || "");
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = m ? m[1].trim() : "shortlist.xlsx";
  a.click();
  URL.revokeObjectURL(url);
}

/* ============================================================================
   Public, unauthenticated candidate endpoints.

   Reachable only with an unguessable token. The status response deliberately
   carries no score and no internal assessment — that is for the hiring team.
   ========================================================================== */
export interface PublicJob {
  title: string;
  description: string;
  location: string;
  employment_type: string;
  company: string;
  contact_email: string;
}

export interface PublicSlot {
  id: string;
  starts_at: string;
  duration_min: number;
  mode: string;
  location: string | null;
}

export interface PublicStatus {
  candidate_name: string;
  job_title: string;
  job_location: string;
  company: string;
  contact_email: string;
  submitted_at: string;
  stage: "received" | "in_review" | "interview" | "offer" | "closed";
  stage_label: string;
  stage_blurb: string;
  interview: {
    id: string; starts_at: string; duration_min: number;
    mode: string; location: string | null; meeting_link: string | null;
  } | null;
  slots: PublicSlot[];
  can_book: boolean;
}

export interface ApplyResult {
  duplicate: boolean;
  status_token: string;
  status_url: string;
  message: string;
}

export interface ApplyForm {
  name: string;
  email: string;
  phone?: string;
  location?: string;
  current_company?: string;
  current_title?: string;
  notice_period?: string;
  expected_salary?: string;
  cover_note?: string;
  links?: Record<string, string>;
  /** Voluntary, self-reported, never used for scoring. */
  voluntary_demographics?: Record<string, string>;
  consent: boolean;
}

export async function publicJob(token: string): Promise<PublicJob> {
  return json(await fetch(`/api/public/job/${encodeURIComponent(token)}`));
}

export async function publicApply(token: string, form: ApplyForm, resume: File): Promise<ApplyResult> {
  const fd = new FormData();
  fd.append("name", form.name);
  fd.append("email", form.email);
  for (const k of ["phone", "location", "current_company", "current_title",
                   "notice_period", "expected_salary", "cover_note"] as const) {
    if (form[k]) fd.append(k, String(form[k]));
  }
  if (form.links && Object.keys(form.links).length) fd.append("links", JSON.stringify(form.links));
  if (form.voluntary_demographics && Object.keys(form.voluntary_demographics).length) {
    fd.append("voluntary_demographics", JSON.stringify(form.voluntary_demographics));
  }
  fd.append("consent", form.consent ? "true" : "false");
  fd.append("resume", resume);
  return json(await withTimeout(`/api/public/apply/${encodeURIComponent(token)}`,
                                { method: "POST", body: fd }, SCREEN_TIMEOUT_MS));
}

export async function publicStatus(token: string): Promise<PublicStatus> {
  return json(await fetch(`/api/public/status/${encodeURIComponent(token)}`));
}

export async function publicBook(token: string, slotId: string): Promise<{ booked: boolean; when: string; mode: string; message: string }> {
  return json(await fetch(`/api/public/status/${encodeURIComponent(token)}/book`,
    { method: "POST", headers: J, body: JSON.stringify({ slot_id: slotId }) }));
}

export async function publicDeleteRequest(token: string, reason: string): Promise<{ received: boolean; message: string }> {
  return json(await fetch(`/api/public/status/${encodeURIComponent(token)}/delete-request`,
    { method: "POST", headers: J, body: JSON.stringify({ reason }) }));
}
