import { useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { FileText, UploadCloud, X } from "lucide-react";

interface Props { files: File[]; onFiles: (files: File[]) => void }
const ACCEPT = [".pdf", ".docx", ".txt"];
const accepted = (n: string) => ACCEPT.some((e) => n.toLowerCase().endsWith(e));
const fmt = (b: number) => (b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`);

export default function UploadZone({ files, onFiles }: Props) {
  const [drag, setDrag] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function addFiles(list: FileList | null) {
    if (!list) return;
    const incoming = Array.from(list).filter((f) => accepted(f.name));
    const map = new Map(files.map((f) => [f.name + f.size, f]));
    incoming.forEach((f) => map.set(f.name + f.size, f));
    onFiles(Array.from(map.values()));
  }

  return (
    <div>
      <div className={`dropzone ${drag ? "dropzone--active" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); addFiles(e.dataTransfer.files); }}
        onClick={() => inputRef.current?.click()} role="button" tabIndex={0}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && inputRef.current?.click()}>
        <motion.div className="dz-icon" animate={drag ? { y: -4, scale: 1.08 } : { y: 0, scale: 1 }}><UploadCloud size={24} /></motion.div>
        <p className="dz-text">{drag ? "Release to add" : <>Drop resumes here or <span className="link">browse</span></>}</p>
        <p className="dz-hint">PDF, DOCX or TXT · up to 300 files · 15 MB each</p>
        <input ref={inputRef} type="file" multiple accept={ACCEPT.join(",")} hidden onChange={(e) => addFiles(e.target.files)} />
      </div>

      <AnimatePresence>
        {files.length > 0 && (
          <motion.ul className="file-list" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <AnimatePresence>
              {files.map((f) => (
                <motion.li key={f.name + f.size} className="file-chip" layout initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }}>
                  <FileText size={14} />
                  <span className="file-name" title={f.name}>{f.name}</span>
                  <span className="file-size">{fmt(f.size)}</span>
                  <button className="file-remove" onClick={(e) => { e.stopPropagation(); onFiles(files.filter((x) => x !== f)); }} aria-label={`Remove ${f.name}`}><X size={12} /></button>
                </motion.li>
              ))}
            </AnimatePresence>
            {files.length > 1 && <li><button className="link-btn" onClick={() => onFiles([])}>Clear all</button></li>}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}
