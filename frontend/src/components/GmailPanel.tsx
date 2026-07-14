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
  onLabel: (id: string) => void;
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
        const firstUser = ls.find((l) => l.type === "user");
        onLabel((firstUser ?? ls[0]).id);
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
      onLabel(label.id);
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
            {connecting ? "Waiting for Google…" : "Connect Gmail"}
          </button>
        </>
      )}

      {connected && (
        <>
          <div className="field">
            <label className="field-label">Applications label</label>
            <LabelPicker labels={labels} value={labelId} onChange={onLabel} />
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
