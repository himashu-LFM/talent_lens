import { useEffect, useState } from "react";
import { Mail, Moon, Palette, Play, Plus, Radar, Settings as SettingsIcon, Sun, Tags, Trash2, Unplug } from "lucide-react";
import { useToast } from "../components/Toast";
import {
  addCustomSkill, deleteWatch, gmailConnect, gmailDisconnect, gmailStatus, listSkills, listWatches,
  removeCustomSkill, runWatch, updateWatch, type GmailStatus, type Watch,
} from "../api";

export type Theme = "dark" | "light";
export function getTheme(): Theme {
  try { return (localStorage.getItem("tl-theme") as Theme) || "dark"; } catch { return "dark"; }
}
export function applyTheme(t: Theme) {
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem("tl-theme", t); } catch { /* ignore */ }
}

export default function Settings() {
  const toast = useToast();
  const [gmail, setGmail] = useState<GmailStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [custom, setCustom] = useState<Record<string, string[]>>({});
  const [builtinCount, setBuiltinCount] = useState(0);
  const [name, setName] = useState("");
  const [aliases, setAliases] = useState("");
  const [watches, setWatches] = useState<Watch[]>([]);
  const [theme, setTheme] = useState<Theme>(getTheme());

  useEffect(() => {
    gmailStatus().then(setGmail).catch(() => {});
    listSkills().then((s) => { setCustom(s.custom); setBuiltinCount(Object.keys(s.builtin).length); }).catch(() => {});
    listWatches().then(setWatches).catch(() => {});
  }, []);

  async function connect() {
    setBusy(true);
    const id = toast.loading("Opening Google sign-in…");
    try { const r = await gmailConnect(); setGmail({ configured: true, connected: true, can_send: r.can_send }); toast.update(id, "success", `Connected: ${r.email}`); }
    catch (e) { toast.update(id, "error", `Connect failed: ${msg(e)}`, 7000); }
    finally { setBusy(false); }
  }
  async function disconnect() {
    await gmailDisconnect().catch(() => {});
    setGmail((g) => g ? { ...g, connected: false, can_send: false } : g);
    toast.info("Gmail disconnected. Connect again to grant permissions (including sending).");
  }

  async function addSkill() {
    if (!name.trim()) return;
    try {
      setCustom(await addCustomSkill(name, aliases.split(",").map((a) => a.trim()).filter(Boolean)));
      setName(""); setAliases("");
      toast.success(`Skill “${name.trim()}” added to the taxonomy.`);
    } catch (e) { toast.error(`Couldn't add: ${msg(e)}`); }
  }
  async function delSkill(n: string) {
    try { setCustom(await removeCustomSkill(n)); toast.success(`Removed “${n}”.`); } catch (e) { toast.error(`Couldn't remove: ${msg(e)}`); }
  }

  async function toggleWatch(w: Watch) {
    try { const u = await updateWatch(w.id, { enabled: !w.enabled }); setWatches((ws) => ws.map((x) => x.id === w.id ? u : x)); }
    catch (e) { toast.error(msg(e)); }
  }
  async function runNow(w: Watch) {
    const id = toast.loading(`Checking “${w.label_name || w.label_id}”…`);
    try {
      const r = await runWatch(w.id);
      setWatches(await listWatches());
      toast.update(id, r.fetched ? "success" : "info", r.fetched ? `Fetched ${r.fetched} new resume(s) — see the dashboard banner.` : "No new applications right now.", 5000);
    } catch (e) { toast.update(id, "error", `Run failed: ${msg(e)}`, 6000); }
  }
  async function delWatch(w: Watch) {
    try { await deleteWatch(w.id); setWatches((ws) => ws.filter((x) => x.id !== w.id)); toast.success("Watch removed."); } catch (e) { toast.error(msg(e)); }
  }

  return (
    <main className="page">
      <div className="page-head"><h1><SettingsIcon size={26} className="h-ico" /> Settings</h1><p>Connections, automation, taxonomy and appearance.</p></div>

      <div className="settings-grid">
        <section className="panel">
          <div className="panel-head"><h2><Mail size={17} /> Gmail connection</h2>
            <span className={`status-pill ${gmail?.connected ? "on" : ""}`}><i className="dot" />{gmail?.connected ? "Connected" : "Not connected"}</span>
          </div>
          {!gmail?.configured && <div className="notice mb"><b>Not configured.</b> Add <code>credentials.json</code> to the backend folder (see README).</div>}
          <ul className="perm-list">
            <li><span className={gmail?.connected ? "ok" : ""}>●</span> Read resume attachments &amp; mark as read</li>
            <li><span className={gmail?.can_send ? "ok" : ""}>●</span> Send emails to candidates {gmail?.connected && !gmail?.can_send && <em className="muted">— reconnect to grant</em>}</li>
          </ul>
          <div className="head-actions">
            {gmail?.connected
              ? <><button className="btn btn-ghost" onClick={disconnect}><Unplug size={15} /> Disconnect</button>{!gmail.can_send && <button className="btn btn-primary" onClick={async () => { await disconnect(); await connect(); }} disabled={busy}>Reconnect to enable sending</button>}</>
              : <button className="btn btn-primary" onClick={connect} disabled={busy || !gmail?.configured}><Mail size={15} /> {busy ? "Waiting for Google…" : "Connect Gmail"}</button>}
          </div>
        </section>

        <section className="panel">
          <div className="panel-head"><h2><Radar size={17} /> Auto-screen watches</h2><span className="chip">{watches.filter((w) => w.enabled).length} active</span></div>
          {watches.length === 0 && <p className="muted">No watches yet. On the dashboard, open <b>From Gmail</b>, pick a label and click <b>Turn on</b> under “Auto-screen this label”.</p>}
          {watches.map((w) => (
            <div key={w.id} className={`watch-card ${w.enabled ? "" : "off"}`}>
              <div className="watch-main">
                <b>{w.title || "Untitled role"}</b>
                <div className="muted small">Label “{w.label_name || w.label_id}” · every {w.interval_min} min · {w.unread_only ? "unread only" : "all mail"} · {w.runs} run{w.runs === 1 ? "" : "s"}{w.last_run ? ` · last ${new Date(w.last_run).toLocaleString()} (${w.last_fetched} new)` : ""}</div>
              </div>
              <div className="head-actions">
                <label className="switch"><input type="checkbox" checked={w.enabled} onChange={() => toggleWatch(w)} /><span className="track" /><span className="switch-label">{w.enabled ? "On" : "Off"}</span></label>
                <button className="btn btn-ghost sm" onClick={() => runNow(w)}><Play size={13} /> Run now</button>
                <button className="btn btn-ghost sm danger icon-only" onClick={() => delWatch(w)} title="Delete watch"><Trash2 size={14} /></button>
              </div>
            </div>
          ))}
        </section>

        <section className="panel">
          <div className="panel-head"><h2><Tags size={17} /> Skill taxonomy</h2><span className="chip">{builtinCount} built-in · {Object.keys(custom).length} custom</span></div>
          <p className="muted small mb">Add company-specific tools so they count as matched skills (e.g. your internal platform, niche software). Aliases are alternative spellings.</p>
          <div className="create-row">
            <input className="input" placeholder="Skill name, e.g. ListenFirst Platform" value={name} onChange={(e) => setName(e.target.value)} />
            <input className="input" placeholder="Aliases, comma-separated" value={aliases} onChange={(e) => setAliases(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addSkill()} />
            <button className="btn btn-primary" onClick={addSkill} disabled={!name.trim()}><Plus size={15} /> Add</button>
          </div>
          <ul className="skill-list">
            {Object.entries(custom).map(([n, als]) => (
              <li key={n}><b>{n}</b>{als.length > 0 && <span className="muted"> · {als.join(", ")}</span>}<button className="link-btn danger" onClick={() => delSkill(n)}>remove</button></li>
            ))}
            {Object.keys(custom).length === 0 && <li className="muted">No custom skills yet.</li>}
          </ul>
        </section>

        <section className="panel">
          <div className="panel-head"><h2><Palette size={17} /> Appearance</h2></div>
          <div className="segmented">
            <button className={theme === "dark" ? "seg on" : "seg"} onClick={() => { setTheme("dark"); applyTheme("dark"); }}><Moon size={14} /> Dark</button>
            <button className={theme === "light" ? "seg on" : "seg"} onClick={() => { setTheme("light"); applyTheme("light"); }}><Sun size={14} /> Light</button>
          </div>
          <p className="muted small" style={{ marginTop: 12 }}>Keyboard shortcuts in results: <kbd>j</kbd>/<kbd>k</kbd> move · <kbd>s</kbd> shortlist · <kbd>r</kbd> reject · <kbd>i</kbd> interview · <kbd>e</kbd> expand · <kbd>a</kbd> anonymize.</p>
        </section>
      </div>
    </main>
  );
}

function msg(e: unknown) { return e instanceof Error ? e.message : "unknown error"; }
