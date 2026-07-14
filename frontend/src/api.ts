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
  breakdown: Record<string, { score: number; max: number; [k: string]: unknown }>;
  source?: string;
}

export interface ScreenResponse {
  job: { title: string; required_years: number; required_skills: string[] };
  total_resumes: number;
  ranked: Candidate[];
  top: Candidate[];
  top_n: number;
  errors: { filename: string; error: string }[];
  fetched?: number;
}

export interface GmailStatus {
  configured: boolean;
  connected: boolean;
}

export interface GmailLabel {
  id: string;
  name: string;
  type: string;
}

export async function screen(
  title: string,
  description: string,
  topN: number,
  files: File[]
): Promise<ScreenResponse> {
  const fd = new FormData();
  fd.append("title", title);
  fd.append("description", description);
  fd.append("top_n", String(topN));
  files.forEach((f) => fd.append("files", f));

  const res = await fetch("/api/screen", { method: "POST", body: fd });
  if (!res.ok) {
    const msg = await res.text();
    throw new Error(msg || `Request failed (${res.status})`);
  }
  return res.json();
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

export async function gmailStatus(): Promise<GmailStatus> {
  return json(await fetch("/api/gmail/status"));
}

export async function gmailConnect(): Promise<{ email: string }> {
  return json(await fetch("/api/gmail/connect", { method: "POST" }));
}

export async function gmailLabels(): Promise<GmailLabel[]> {
  const data = await json<{ labels: GmailLabel[] }>(
    await fetch("/api/gmail/labels")
  );
  return data.labels;
}

export async function gmailCreateLabel(name: string): Promise<GmailLabel> {
  const data = await json<{ label: GmailLabel }>(
    await fetch("/api/gmail/labels/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    })
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
}): Promise<ScreenResponse> {
  return json(
    await fetch("/api/gmail/screen", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    })
  );
}

export async function exportExcel(candidates: Candidate[]): Promise<void> {
  const res = await fetch("/api/export", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ candidates }),
  });
  if (!res.ok) throw new Error("Export failed");
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "top_candidates.xlsx";
  a.click();
  URL.revokeObjectURL(url);
}
