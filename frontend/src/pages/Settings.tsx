import { useEffect, useState } from "react";
import { Mail, Moon, Palette, Play, Radar, Sun, Tags, Trash2 } from "lucide-react";
import { useToast } from "../components/Toast";
import { SegTabs } from "../components/ds";
import { useWorkspace } from "../context/Workspace";
import { applyTheme, getTheme, type Theme } from "../lib/theme";
import {
  addCustomSkill, deleteWatch, gmailConnect, gmailDisconnect, gmailStatus, listSkills, listWatches,
  removeCustomSkill, runWatch, updateWatch, type GmailStatus, type Watch,
} from "../api";

export default function Settings() {
  const toast = useToast();
  const { refreshReady } = useWorkspace();
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
    try { const r = await gmailConnect(); setGmail({ configured: true, connected: true, can_send: r.can_send }); toast.update(id, "success", `Connected: ${r.email}`); refreshReady(); }
    catch (e) { toast.update(id, "error", `Connect failed: ${msg(e)}`, 7000); }
    finally { setBusy(false); }
  }
  async function disconnect() {
    await gmailDisconnect().catch(() => {});
    setGmail((g) => g ? { ...g, connected: false, can_send: false } : g);
    refreshReady();
    toast.info("Gmail disconnected. Connect again to grant permissions (including sending).");
  }
  async function addSkill() {
    if (!name.trim()) return;
    try {
      setCustom(await addCustomSkill(name, aliases.split(",").map((a) => a.trim()).filter(Boolean)));
      toast.success(`Skill “${name.trim()}” added to the taxonomy.`);
      setName(""); setAliases("");
    } catch (e) { toast.error(`Couldn't add: ${msg(e)}`); }
  }
  async function delSkill(n: string) {
    try { setCustom(await removeCustomSkill(n)); toast.success(`Removed “${n}”.`); } catch (e) { toast.error(`Couldn't remove: ${msg(e)}`); }
  }
  async function toggleWatch(w: Watch) {
    try { const u = await updateWatch(w.id, { enabled: !w.enabled }); setWatches((ws) => ws.map((x) => x.id === w.id ? u : x)); refreshReady(); }
    catch (e) { toast.error(msg(e)); }
  }
  async function runNow(w: Watch) {
    const id = toast.loading(`Checking “${w.label_name || w.label_id}”…`);
    try {
      const r = await runWatch(w.id);
      setWatches(await listWatches()); refreshReady();
      toast.update(id, r.fetched ? "success" : "info", r.fetched ? `Fetched ${r.fetched} new resume(s) — see the Screen page banner.` : "No new applications right now.", 5000);
    } catch (e) { toast.update(id, "error", `Run failed: ${msg(e)}`, 6000); }
  }
  async function delWatch(w: Watch) {
    try { await deleteWatch(w.id); setWatches((ws) => ws.filter((x) => x.id !== w.id)); refreshReady(); toast.success("Watch removed."); } catch (e) { toast.error(msg(e)); }
  }
  const active = watches.filter((w) => w.enabled).length;

  return (
    <div className="settings-grid">
      <section className="card">
        <div className="card-head">
          <h2><Mail size={17} /> Gmail connection</h2>
          <span className={`pill-status ${gmail?.connected ? "on" : ""}`}><i />{gmail?.connected ? "Connected" : "Not connected"}</span>
        </div>
        {gmail && !gmail.configured && <div className="notice warn mb"><b>Not configured.</b> Add <code>credentials.json</code> to the backend folder (see README).</div>}
        <ul className="perm-list">
          <li><i className={gmail?.connected ? "ok" : ""} />Read resume attachments and mark as read</li>
          <li><i className={gmail?.can_send ? "ok" : ""} />Send emails to candidates {gmail?.connected && !gmail?.can_send && <em>— reconnect to grant</em>}</li>
        </ul>
        <div style={{ display: "flex", gap: 9, flexWrap: "wrap" }}>
          {gmail?.connected
            ? <><button className="btn btn-secondary" onClick={disconnect}>Disconnect</button>{!gmail.can_send && <button className="btn btn-primary" onClick={async () => { await disconnect(); await connect(); }} disabled={busy}>Reconnect to enable sending</button>}</>
            : <button className="btn btn-primary" onClick={connect} disabled={busy || !gmail?.configured}><Mail size={15} /> {busy ? "Waiting for Google…" : "Connect Gmail"}</button>}
        </div>
      </section>

      <section className="card">
        <div className="card-head"><h2><Radar size={17} /> Auto-screen watches</h2><span className="count-pill">{active} active</span></div>
        {watches.length === 0 && <p className="muted small">No watches yet. On the Screen page, open <b>Gmail</b>, pick a label and click <b>Turn on</b> under “Auto-screen this label”.</p>}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {watches.map((w) => (
            <div key={w.id} className={`watch-row ${w.enabled ? "" : "off"}`}>
              <div className="watch-main">
                <b>{w.title || "Untitled role"}</b>
                <div className="m">{w.label_name || w.label_id} · every {w.interval_min} min · {w.runs} run{w.runs === 1 ? "" : "s"}{w.last_run ? ` · last ${new Date(w.last_run).toLocaleString()} (${w.last_fetched} new)` : ""}</div>
              </div>
              <label className="switch" aria-label={w.enabled ? "Disable watch" : "Enable watch"}><input type="checkbox" checked={w.enabled} onChange={() => toggleWatch(w)} /><span className="track" /></label>
              <button className="btn btn-ghost sm" onClick={() => runNow(w)}><Play size={12} /> Run now</button>
              <button className="btn btn-ghost sm icon-only danger" onClick={() => delWatch(w)} title="Delete watch" aria-label="Delete watch"><Trash2 size={13} /></button>
            </div>
          ))}
        </div>
      </section>

      <section className="card">
        <div className="card-head" style={{ marginBottom: 8 }}><h2><Tags size={17} /> Skill taxonomy</h2><span className="count-pill">{builtinCount} built-in · {Object.keys(custom).length} custom</span></div>
        <p className="muted small" style={{ marginBottom: 16, lineHeight: 1.6 }}>Add company-specific tools so they count as matched skills. Aliases are alternative spellings.</p>
        <div className="create-row" style={{ marginBottom: 14 }}>
          <input className="input" placeholder="Skill name" value={name} onChange={(e) => setName(e.target.value)} />
          <input className="input" placeholder="Aliases" value={aliases} onChange={(e) => setAliases(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addSkill()} />
          <button className="btn btn-primary" onClick={addSkill} disabled={!name.trim()}>Add</button>
        </div>
        {Object.entries(custom).map(([n, als]) => (
          <div key={n} className="skill-row"><b>{n}</b>{als.length > 0 && <span>· {als.join(", ")}</span>}<button className="link-btn danger" onClick={() => delSkill(n)}>remove</button></div>
        ))}
        {Object.keys(custom).length === 0 && <div className="muted small">No custom skills yet.</div>}
      </section>

      <section className="card">
        <div className="card-head"><h2><Palette size={17} /> Appearance &amp; shortcuts</h2></div>
        <SegTabs value={theme} onChange={(t) => { setTheme(t); applyTheme(t); }} items={[
          { value: "dark", label: <><Moon size={14} /> Dark</> },
          { value: "light", label: <><Sun size={14} /> Light</> },
        ]} />
        <p className="shortcuts" style={{ marginTop: 16 }}>
          In the shortlist: <kbd>j</kbd> <kbd>k</kbd> move · <kbd>↵</kbd> open · <kbd>s</kbd> shortlist · <kbd>r</kbd> reject · <kbd>i</kbd> interview · <kbd>a</kbd> anonymize · <kbd>⌘K</kbd> command palette.
        </p>
      </section>
    </div>
  );
}

function msg(e: unknown) { return e instanceof Error ? e.message : "unknown error"; }
