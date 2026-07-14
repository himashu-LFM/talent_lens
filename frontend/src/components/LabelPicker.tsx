import { useEffect, useMemo, useRef, useState } from "react";
import type { GmailLabel } from "../api";

interface Props {
  labels: GmailLabel[];
  value: string;
  onChange: (id: string) => void;
}

export default function LabelPicker({ labels, value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = labels.find((l) => l.id === value);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const match = q
      ? labels.filter((l) => l.name.toLowerCase().includes(q))
      : labels;
    const user = match.filter((l) => l.type === "user");
    const sys = match.filter((l) => l.type !== "user");
    return { user, sys, flat: [...user, ...sys] };
  }, [labels, query]);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  useEffect(() => setActive(0), [query, open]);

  function choose(id: string) {
    onChange(id);
    setOpen(false);
    setQuery("");
  }

  function onKey(e: React.KeyboardEvent) {
    if (!open && (e.key === "ArrowDown" || e.key === "Enter")) {
      setOpen(true);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, filtered.flat.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = filtered.flat[active];
      if (item) choose(item.id);
    } else if (e.key === "Escape") {
      setOpen(false);
      setQuery("");
    }
  }

  function renderOption(l: GmailLabel) {
    const idx = filtered.flat.indexOf(l);
    return (
      <li
        key={l.id}
        className={`lp-option ${l.id === value ? "selected" : ""} ${
          idx === active ? "active" : ""
        }`}
        onMouseEnter={() => setActive(idx)}
        onMouseDown={(e) => {
          e.preventDefault();
          choose(l.id);
        }}
      >
        <span className="lp-option-name">{l.name}</span>
        {l.id === value && <span className="lp-check">✓</span>}
      </li>
    );
  }

  return (
    <div className="label-picker" ref={boxRef}>
      <div
        className={`lp-control ${open ? "open" : ""}`}
        onClick={() => {
          setOpen(true);
          inputRef.current?.focus();
        }}
      >
        <input
          ref={inputRef}
          className="lp-input"
          value={open ? query : selected?.name ?? ""}
          placeholder={selected ? "" : "Search labels…"}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onKeyDown={onKey}
          onFocus={() => setOpen(true)}
        />
        <span className={`lp-caret ${open ? "up" : ""}`}>▾</span>
      </div>

      {open && (
        <div className="lp-menu">
          {filtered.flat.length === 0 && (
            <div className="lp-empty">No labels match “{query}”.</div>
          )}
          {filtered.user.length > 0 && (
            <>
              <div className="lp-group">Your labels</div>
              <ul className="lp-list">{filtered.user.map(renderOption)}</ul>
            </>
          )}
          {filtered.sys.length > 0 && (
            <>
              <div className="lp-group">Gmail system</div>
              <ul className="lp-list">{filtered.sys.map(renderOption)}</ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}
