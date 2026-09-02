import { useEffect, useState } from "react";
import {
  gmailConnect,
  gmailCreateLabel,
  gmailLabels,
  gmailStatus,
  type GmailLabel,
} from "../api";
import { useToast } from "./Toast";
import LabelPicker from "./LabelPicker";

interface Props {
  labelId: string;
  unreadOnly: boolean;
  markRead: boolean;
  onLabel: (id: string, name?: string) => void;
  onUnreadOnly: (v: boolean) => void;
  onMarkRead: (v: boolean) => void;
  onConnectedChange: (connected: boolean) => void;
}

export default function GmailPanel({
  labelId,
  unreadOnly,
  markRead,
  onLabel,
  onUnreadOnly,
  onMarkRead,
  onConnectedChange,
}: Props) {
  const toast = useToast();
  const [configured, setConfigured] = useState(false);
  const [connected, setConnected] = useState(false);
  const [labels, setLabels] = useState<GmailLabel[]>([]);
  const [connecting, setConnecting] = useState(false);
  const [checked, setChecked] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [creating, setCreating] = useState(false);

  async function loadLabels() {
    try {
      const ls = await gmailLabels();
      setLabels(ls);
      if (!labelId && ls.length) {
        const first = ls.find((l) => l.type === "user") ?? ls[0];
        onLabel(first.id, first.name);
      }
    } catch (e) {
      toast.error(`Couldn't load Gmail labels: ${msg(e)}`);
    }
  }

  useEffect(() => {
    (async () => {
      try {
        const s = await gmailStatus();
        setConfigured(s.configured);
        setConnected(s.connected);
        onConnectedChange(s.connected);
        if (s.connected) await loadLabels();
      } catch {
        /* backend may still be starting */
      } finally {
        setChecked(true);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function createLabel() {
    const name = newLabel.trim();
    if (!name) return;
    setCreating(true);
    const id = toast.loading(`Creating label “${name}”…`);
    try {
      const label = await gmailCreateLabel(name);
      setLabels((prev) =>
        prev.some((l) => l.id === label.id) ? prev : [label, ...prev]
      );
      onLabel(label.id, label.name);
      setNewLabel("");
      toast.update(id, "success", `Label “${label.name}” ready — now selected.`);
    } catch (e) {
      toast.update(id, "error", `Couldn't create label: ${msg(e)}`, 6000);
    } finally {
      setCreating(false);
    }
  }

  async function connect() {
    setConnecting(true);
    const id = toast.loading("Opening Google sign-in in your browser…");
    try {
      const { email } = await gmailConnect();
      setConnected(true);
      onConnectedChange(true);
      toast.update(id, "success", `Gmail connected${email ? `: ${email}` : ""}`);
      await loadLabels();
    } catch (e) {
      toast.update(id, "error", `Gmail connection failed: ${msg(e)}`, 7000);
    } finally {
      setConnecting(false);
    }
  }

  return (
    <div className="source-body">
      {!checked && <p className="muted">Checking Gmail status…</p>}

      {checked && !configured && (
        <div className="notice">
          <b>Gmail not configured.</b> Add a Google OAuth <code>credentials.json</code>{" "}
          (Desktop app) to the <code>backend</code> folder — see the README. You can
          still upload resumes manually.
        </div>
      )}

      {checked && configured && !connected && (
        <>
          <p className="muted mb">
            Connect once to read resume attachments from a label. The app never sends
            email; it only marks screened messages as read (optional).
          </p>
          <button className="btn btn-google" onClick={connect} disabled={connecting}>
            <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden><path fill="#EA4335" d="M12 11v2.6h6.5c-.3 1.6-1.9 4.6-6.5 4.6-3.9 0-7.1-3.2-7.1-7.2S8.1 3.8 12 3.8c2.2 0 3.7.9 4.6 1.8l3.1-3C17.7.9 15.1 0 12 0 5.4 0 0 5.4 0 12s5.4 12 12 12c6.9 0 11.5-4.9 11.5-11.7 0-.8-.1-1.4-.2-2H12z"/></svg>
            {connecting ? "Waiting for Google…" : "Connect Gmail"}
          </button>
        </>
      )}

      {connected && (
        <>
          <div className="field">
            <label className="field-label">Applications label</label>
            <LabelPicker labels={labels} value={labelId} onChange={(id) => onLabel(id, labels.find((l) => l.id === id)?.name)} />
            <p className="hint">
              Type to search. Labels you created appear under <b>Your labels</b>.
            </p>
          </div>

          <div className="field">
            <label className="field-label">Create a new label in Gmail</label>
            <div className="create-row">
              <input
                className="input"
                placeholder="e.g. Applications 2026"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && createLabel()}
              />
              <button
                className="btn btn-google"
                onClick={createLabel}
                disabled={creating || !newLabel.trim()}
              >
                {creating ? "Creating…" : "+ Create"}
              </button>
            </div>
            <p className="hint">
              Creates the label in your Gmail. Then move applicant emails into it and
              screen from here.
            </p>
          </div>

          <div className="options">
            <label className="switch">
              <input
                type="checkbox"
                checked={unreadOnly}
                onChange={(e) => onUnreadOnly(e.target.checked)}
              />
              <span className="track" />
              <span className="switch-label">Unread emails only</span>
            </label>
            <label className="switch">
              <input
                type="checkbox"
                checked={markRead}
                onChange={(e) => onMarkRead(e.target.checked)}
              />
              <span className="track" />
              <span className="switch-label">Mark as read after screening</span>
            </label>
          </div>
        </>
      )}
    </div>
  );
}

function msg(e: unknown) {
  return e instanceof Error ? e.message : "unknown error";
}
