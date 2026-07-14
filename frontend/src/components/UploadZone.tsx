import { useRef, useState } from "react";

interface Props {
  files: File[];
  onFiles: (files: File[]) => void;
}

const ACCEPT = [".pdf", ".docx", ".txt"];

function accepted(name: string) {
  return ACCEPT.some((ext) => name.toLowerCase().endsWith(ext));
}

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
    <div className="source-body">
      <div
        className={`dropzone ${drag ? "dropzone--active" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          addFiles(e.dataTransfer.files);
        }}
        onClick={() => inputRef.current?.click()}
      >
        <svg className="dz-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
          <path d="M12 16V4m0 0L8 8m4-4l4 4" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M4 15v3a2 2 0 002 2h12a2 2 0 002-2v-3" strokeLinecap="round" />
        </svg>
        <p className="dz-text">
          Drag &amp; drop resumes, or <span className="link">browse</span>
        </p>
        <p className="dz-hint">PDF, DOCX or TXT · multiple files</p>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPT.join(",")}
          hidden
          onChange={(e) => addFiles(e.target.files)}
        />
      </div>

      {files.length > 0 && (
        <ul className="file-list">
          {files.map((f) => (
            <li key={f.name + f.size} className="file-chip">
              <span className="file-name">{f.name}</span>
              <button
                className="file-remove"
                onClick={() => onFiles(files.filter((x) => x !== f))}
                aria-label={`Remove ${f.name}`}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
