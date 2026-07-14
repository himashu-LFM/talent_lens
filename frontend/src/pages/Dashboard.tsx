import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import JobForm from "../components/JobForm";
import UploadZone from "../components/UploadZone";
import GmailPanel from "../components/GmailPanel";
import Results from "../components/Results";
import { useToast } from "../components/Toast";
import { useAuth } from "../auth/AuthProvider";
import { saveRun } from "../lib/db";
import {
  screen,
  gmailScreen,
  gmailStatus,
  exportExcel,
  type ScreenResponse,
} from "../api";

type Source = "upload" | "gmail";

export default function Dashboard() {
  const toast = useToast();
  const { user, configured } = useAuth();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [topN, setTopN] = useState(10);
  const [files, setFiles] = useState<File[]>([]);
  const [source, setSource] = useState<Source>("upload");

  const [gmailConnected, setGmailConnected] = useState(false);
  const [labelId, setLabelId] = useState("");
  const [unreadOnly, setUnreadOnly] = useState(true);
  const [markRead, setMarkRead] = useState(true);

  const [data, setData] = useState<ScreenResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);

  const hasJD = description.trim().length > 0;
  const firstName = ((user?.user_metadata?.full_name as string) || user?.email || "there")
    .split(/[@.\s]/)[0];

  useEffect(() => {
    gmailStatus().then((s) => setGmailConnected(s.connected)).catch(() => {});
  }, []);

  function setFilesToasted(next: File[]) {
    const added = next.length - files.length;
    setFiles(next);
    if (added > 0) toast.info(`Added ${added} file${added === 1 ? "" : "s"}`);
  }

  async function persist(res: ScreenResponse, src: Source) {
    if (configured && user && res.top.length > 0) {
      try {
        await saveRun(user.id, title, src, res);
        toast.info("Saved to history.");
      } catch {
        /* non-fatal */
      }
    }
  }

  function showResults(res: ScreenResponse) {
    setData(res);
    requestAnimationFrame(() =>
      document.getElementById("results")?.scrollIntoView({ behavior: "smooth" })
    );
  }

  async function runUpload() {
    if (!hasJD) return toast.error("Add a job description first.");
    if (!files.length) return toast.error("Upload at least one resume.");
    setLoading(true);
    setData(null);
    const id = toast.loading(`Screening ${files.length} resume(s)…`);
    try {
      const res = await screen(title, description, topN, files);
      showResults(res);
      toast.update(id, "success", `Ranked ${res.ranked.length} — showing top ${res.top.length}.`);
      if (res.errors.length) toast.error(`${res.errors.length} file(s) couldn't be read.`, 6000);
      await persist(res, "upload");
    } catch (e) {
      toast.update(id, "error", `Screening failed: ${msg(e)}`, 7000);
    } finally {
      setLoading(false);
    }
  }

  async function runGmail() {
    if (!hasJD) return toast.error("Add a job description first.");
    if (!labelId) return toast.error("Pick a Gmail label to screen.");
    setLoading(true);
    setData(null);
    const id = toast.loading("Fetching resumes from Gmail…");
    try {
      const res = await gmailScreen({
        title, description, top_n: topN,
        label_id: labelId, unread_only: unreadOnly, mark_read: markRead,
      });
      if ((res.fetched ?? 0) === 0) {
        toast.update(id, "info",
          unreadOnly
            ? "No unread emails with resume attachments in that label."
            : "No resume attachments found in that label.", 6000);
        setLoading(false);
        return;
      }
      showResults(res);
      toast.update(id, "success",
        `Fetched ${res.fetched} — ranked ${res.ranked.length}, showing top ${res.top.length}.`);
      if (markRead) toast.info("Screened emails marked as read.");
      await persist(res, "gmail");
    } catch (e) {
      toast.update(id, "error", `Gmail screening failed: ${msg(e)}`, 7000);
    } finally {
      setLoading(false);
    }
  }

  async function doExport() {
    if (!data) return;
    setExporting(true);
    const id = toast.loading("Building Excel file…");
    try {
      await exportExcel(data.top);
      toast.update(id, "success", `Exported top ${data.top.length} candidate(s).`);
    } catch (e) {
      toast.update(id, "error", `Export failed: ${msg(e)}`, 6000);
    } finally {
      setExporting(false);
    }
  }

  return (
    <main className="page">
      <div className="page-head">
        <h1>Welcome back, {firstName} 👋</h1>
        <p>
          Define the role, add resumes from your device or a Gmail label, and get a
          transparent, ranked shortlist you can export.
          {gmailConnected && <span className="inline-pill">● Gmail connected</span>}
        </p>
      </div>

      <div className="workspace">
        <section className="col-main">
          <JobForm
            title={title}
            description={description}
            topN={topN}
            onTitle={setTitle}
            onDescription={setDescription}
            onTopN={setTopN}
          />

          <div className="panel">
            <div className="panel-head">
              <h2>Add resumes</h2>
              <div className="segmented" role="tablist">
                <button className={source === "upload" ? "seg on" : "seg"} onClick={() => setSource("upload")}>
                  Upload files
                </button>
                <button className={source === "gmail" ? "seg on" : "seg"} onClick={() => setSource("gmail")}>
                  From Gmail
                </button>
              </div>
            </div>

            <motion.div key={source} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
              {source === "upload" ? (
                <>
                  <UploadZone files={files} onFiles={setFilesToasted} />
                  <button className="btn btn-primary full" onClick={runUpload} disabled={loading}>
                    {loading ? "Screening…" : "Screen uploaded resumes"}
                  </button>
                </>
              ) : (
                <>
                  <GmailPanel
                    labelId={labelId}
                    unreadOnly={unreadOnly}
                    markRead={markRead}
                    onLabel={setLabelId}
                    onUnreadOnly={setUnreadOnly}
                    onMarkRead={setMarkRead}
                    onConnectedChange={setGmailConnected}
                  />
                  <button className="btn btn-primary full" onClick={runGmail} disabled={loading || !gmailConnected}>
                    {loading ? "Screening…" : "Screen resumes from Gmail"}
                  </button>
                </>
              )}
            </motion.div>
          </div>
        </section>

        <aside className="col-side">
          <div className="panel how">
            <h3>How scoring works</h3>
            <ul>
              <li><b>Skills</b><span>55%</span></li>
              <li><b>Role fit</b><span>20%</span></li>
              <li><b>Experience</b><span>15%</span></li>
              <li><b>Keywords</b><span>10%</span></li>
            </ul>
            <p className="how-note">
              Every score traces back to concrete matched terms — expand any candidate to
              see the breakdown. No AI black box.
            </p>
          </div>
          {!configured && (
            <div className="panel warn-panel">
              <b>History off</b>
              <p>Add Supabase keys to <code>frontend/.env</code> to save runs to your history.</p>
            </div>
          )}
        </aside>
      </div>

      <div id="results">
        {data && data.top.length > 0 && (
          <Results data={data} onExport={doExport} exporting={exporting} />
        )}
      </div>
    </main>
  );
}

function msg(e: unknown) {
  return e instanceof Error ? e.message : "unknown error";
}
