/** Merge-field rendering shared by the bulk-email composer and its preview.
 *  Must stay in step with MERGE_FIELDS in backend/app/services/mailer.py. */
import type { Candidate } from "../api";

export const MERGE_FIELDS = [
  { key: "first_name", label: "First name" },
  { key: "name", label: "Full name" },
  { key: "email", label: "Email" },
  { key: "job_title", label: "Job title" },
  { key: "company", label: "Company" },
  { key: "score", label: "Match score" },
  { key: "location", label: "Location" },
  { key: "status_link", label: "Status page link" },
  { key: "interview_time", label: "Interview time" },
  { key: "recruiter", label: "Your name" },
] as const;

export type MergeContext = Record<string, string | number>;

export function render(template: string, ctx: MergeContext): string {
  return (template || "").replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_m, key: string) =>
    String(ctx[key] ?? "")
  );
}

export function contextFor(
  c: Pick<Candidate, "name" | "email" | "score"> & { location?: string },
  extra: { jobTitle?: string; company?: string; recruiter?: string; statusLink?: string; interviewTime?: string } = {}
): MergeContext {
  const name = (c.name || "").trim();
  return {
    name: name || "there",
    first_name: name ? name.split(/\s+/)[0] : "there",
    email: c.email || "",
    score: c.score ?? "",
    location: c.location || "",
    job_title: extra.jobTitle || "the role",
    company: extra.company || "our team",
    recruiter: extra.recruiter || "",
    status_link: extra.statusLink || "",
    interview_time: extra.interviewTime || "",
  };
}

/** Any {{field}} in the text that isn't a known merge field. */
export function unknownFields(template: string): string[] {
  const known = new Set(MERGE_FIELDS.map((f) => f.key));
  const found = new Set<string>();
  for (const m of (template || "").matchAll(/\{\{\s*([a-z_]+)\s*\}\}/g)) {
    if (!known.has(m[1] as never)) found.add(m[1]);
  }
  return [...found];
}
