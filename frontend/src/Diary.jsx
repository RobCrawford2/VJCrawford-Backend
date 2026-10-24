import React, { useEffect, useState } from "react";
import { X, Plus, Calendar, CheckCircle2, RotateCcw, Trash2, AlertTriangle, Gavel } from "lucide-react";
import { api } from "./api";
import { notify } from "./notify";
import { areaOf, areaName } from "./areas";

/**
 * Court and deadline diary: hearings, limitation dates, court-ordered
 * deadlines and filing dates. Critical ones warn two weeks ahead; anything
 * overdue is flagged on the matter, on the home page and to supervisors
 * (who see their team's matters).
 */

export const KIND_LABELS = { hearing: "Hearing", limitation: "Limitation", court_deadline: "Court deadline", filing: "Filing", other: "Other" };

const todayStr = () => new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" });
export const daysUntil = (date) => Math.round((new Date(`${date}T00:00:00Z`) - new Date(`${todayStr()}T00:00:00Z`)) / 86400000);
const fmt = (d) => (d ? new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "—");

/** Works a due date out from a starting date and a rule ({ years, months, weeks, days, endOfMonth }). */
export function computeDue(base, rule) {
  if (!base || !rule) return "";
  const [y, m, d] = base.split("-").map(Number);
  let date = new Date(Date.UTC(y + (rule.years || 0), m - 1 + (rule.months || 0), 1));
  // Same day of the month, or the month's last day if it's shorter (31 Jan + 1 month = 28/29 Feb).
  const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(rule.endOfMonth ? last : Math.min(d, last));
  date = new Date(date.getTime() + ((rule.weeks || 0) * 7 + (rule.days || 0)) * 86400000);
  return date.toISOString().slice(0, 10);
}

/** How urgent an open deadline is: "overdue" | "soon" | "upcoming". */
export function urgency(d) {
  const left = daysUntil(d.dueDate || d.due_date);
  if (left < 0) return "overdue";
  if (left <= (d.critical ? 14 : 3)) return "soon";
  return "upcoming";
}

function whenText(date) {
  const left = daysUntil(date);
  if (left < 0) return `${-left} day${left === -1 ? "" : "s"} overdue`;
  if (left === 0) return "today";
  if (left === 1) return "tomorrow";
  return `in ${left} days`;
}

/* ---------------------------------------------------------------------- */
/* On the matter                                                           */
/* ---------------------------------------------------------------------- */

function DeadlineForm({ matter, initial, onCancel, onSave }) {
  const templates = areaOf(matter.department).deadlines || [];
  const [t, setT] = useState(null);
  const [base, setBase] = useState("");
  const [f, setF] = useState({ title: "", kind: "other", dueDate: "", dueTime: "", location: "", notes: "", critical: false, ...initial });
  const [busy, setBusy] = useState(false);

  function chooseTemplate(i) {
    const tpl = templates[i] || null;
    setT(tpl);
    if (tpl) setF((prev) => ({ ...prev, title: tpl.title, kind: tpl.kind, critical: !!tpl.critical, dueDate: tpl.rule && base ? computeDue(base, tpl.rule) : prev.dueDate }));
  }
  function setBaseDate(v) {
    setBase(v);
    if (t?.rule && v) setF((prev) => ({ ...prev, dueDate: computeDue(v, t.rule) }));
  }
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try { await onSave(f); } finally { setBusy(false); }
  }

  return (
    <form onSubmit={submit} className="ac-card ac-deadline-form">
      {!initial && templates.length > 0 && (
        <div className="ac-field">
          <label>Common {areaName(matter.department).toLowerCase()} deadlines</label>
          <select defaultValue="" onChange={(e) => chooseTemplate(e.target.value === "" ? -1 : Number(e.target.value))}>
            <option value="">— Choose one, or enter your own below —</option>
            {templates.map((tpl, i) => <option key={tpl.title} value={i}>{tpl.title}</option>)}
          </select>
        </div>
      )}
      {t?.rule && (
        <div className="ac-row2">
          <div className="ac-field"><label>{t.rule.from}</label><input type="date" value={base} onChange={(e) => setBaseDate(e.target.value)} /></div>
          <div className="ac-field" style={{ alignSelf: "end", fontSize: 11.5, color: "var(--slate)" }}>
            The due date is worked out from this. It's a guide — check the rules that apply to this case.
          </div>
        </div>
      )}
      <div className="ac-field"><label>Title</label><input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></div>
      <div className="ac-row2">
        <div className="ac-field"><label>Due date</label><input type="date" value={f.dueDate} onChange={(e) => setF({ ...f, dueDate: e.target.value })} /></div>
        <div className="ac-field"><label>Time (optional)</label><input type="time" value={f.dueTime} onChange={(e) => setF({ ...f, dueTime: e.target.value })} /></div>
      </div>
      <div className="ac-row2">
        <div className="ac-field">
          <label>Type</label>
          <select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
            {Object.entries(KIND_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </div>
        <div className="ac-field"><label>Where (hearings)</label><input value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} placeholder="e.g. Bristol Civil & Family Justice Centre" /></div>
      </div>
      <div className="ac-field"><label>Notes</label><input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></div>
      <label className="ac-dept-tick" style={{ marginBottom: 10 }}>
        <input type="checkbox" checked={f.critical} onChange={(e) => setF({ ...f, critical: e.target.checked })} />
        Critical — missing it would harm the client's case (warn two weeks ahead)
      </label>
      <div style={{ display: "flex", gap: 8 }}>
        <button type="submit" className="ac-tablebtn primary" disabled={busy || !f.title.trim() || !f.dueDate}>{initial ? "Save" : "Add to diary"}</button>
        <button type="button" className="ac-tablebtn" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

export function DiaryTab({ matter, onChanged, onDelete }) {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(null);
  const open = matter.deadlines.filter((d) => d.status === "open");
  const done = matter.deadlines.filter((d) => d.status === "done");

  async function add(f) {
    try { await api.addDeadline(matter.id, f); setAdding(false); await onChanged(); notify("Added to the diary.", "success"); }
    catch (err) { notify(err.message || "Couldn't add that."); }
  }
  async function update(d, patch) {
    try { await api.updateDeadline(matter.id, d.id, patch); setEditing(null); await onChanged(); }
    catch (err) { notify(err.message || "Couldn't save that."); }
  }

  return (
    <div className="ac-detail-body" style={{ gridTemplateColumns: "1fr" }}>
      <div className="ac-col-main">
        <div className="ac-section-head">
          <h2>Diary</h2>
          <button className="ac-addbtn" onClick={() => { setAdding(true); setEditing(null); }}><Plus size={13} /> Add hearing or deadline</button>
        </div>
        {adding && <DeadlineForm matter={matter} onCancel={() => setAdding(false)} onSave={add} />}
        {open.length === 0 && !adding && <p style={{ color: "var(--slate)", fontSize: 13 }}>Nothing in the diary. Add hearings, limitation dates and court deadlines so nobody misses them.</p>}
        {open.map((d) => (
          editing === d.id
            ? <DeadlineForm key={d.id} matter={matter} initial={d} onCancel={() => setEditing(null)} onSave={(f) => update(d, f)} />
            : (
              <div key={d.id} className={`ac-deadline ${urgency(d)} ${d.critical ? "critical" : ""}`}>
                <div className="when">
                  <div className="date">{fmt(d.dueDate)}{d.dueTime ? ` · ${d.dueTime}` : ""}</div>
                  <div className="left">{whenText(d.dueDate)}</div>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="title">{d.critical && <AlertTriangle size={12} />} {d.title}</div>
                  <div className="meta">{KIND_LABELS[d.kind]}{d.location ? ` · ${d.location}` : ""}{d.notes ? ` · ${d.notes}` : ""}</div>
                </div>
                <div className="actions">
                  <button type="button" className="ac-tablebtn" onClick={() => update(d, { status: "done" })}><CheckCircle2 size={12} /> Done</button>
                  <button type="button" className="ac-tablebtn" onClick={() => { setEditing(d.id); setAdding(false); }}>Edit</button>
                  <button type="button" className="ac-iconbtn" onClick={() => onDelete(d)} aria-label="Delete"><Trash2 size={13} /></button>
                </div>
              </div>
            )
        ))}
        {done.length > 0 && (
          <>
            <div className="ac-fieldset-title" style={{ marginTop: 18 }}>Done</div>
            {done.map((d) => (
              <div key={d.id} className="ac-deadline done">
                <div className="when"><div className="date">{fmt(d.dueDate)}</div></div>
                <div style={{ flex: 1 }}>
                  <div className="title">{d.title}</div>
                  <div className="meta">Done{d.doneByName ? ` by ${d.doneByName}` : ""}</div>
                </div>
                <div className="actions"><button type="button" className="ac-tablebtn" onClick={() => update(d, { status: "open" })}><RotateCcw size={12} /> Reopen</button></div>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Firm diary                                                              */
/* ---------------------------------------------------------------------- */

function DiaryRows({ rows, onOpenMatter, showDepartment }) {
  if (!rows.length) return <p style={{ fontSize: 13, color: "var(--slate)", margin: 0 }}>Nothing due.</p>;
  return rows.map((d) => (
    <div key={d.id} className={`ac-deadline compact ${urgency(d)} ${d.critical ? "critical" : ""}`}>
      <div className="when">
        <div className="date">{fmt(d.due_date)}{d.due_time ? ` · ${d.due_time}` : ""}</div>
        <div className="left">{whenText(d.due_date)}</div>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="title">{d.critical && <AlertTriangle size={12} />} {d.title}</div>
        <div className="meta">
          <button type="button" className="ac-linkbtn" style={{ fontSize: 12 }} onClick={() => onOpenMatter(d.matter_id)}>{d.reference}</button>
          {" "}— {d.address}{d.fee_earner_name ? ` · ${d.fee_earner_name}` : ""}{showDepartment ? ` · ${areaName(d.department)}` : ""}
        </div>
      </div>
    </div>
  ));
}

/** Home-page card: the next fortnight's hearings and deadlines (and anything overdue). */
export function DiaryCard({ onOpenMatter, refreshKey, showDepartment }) {
  const [mine, setMine] = useState(false);
  const [rows, setRows] = useState(null);
  useEffect(() => { api.getDiary(14, mine).then((r) => setRows(r.deadlines)).catch(() => setRows([])); }, [mine, refreshKey]);
  const overdue = (rows || []).filter((d) => urgency(d) === "overdue").length;
  return (
    <div className="ac-card" style={{ marginBottom: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, gap: 10, flexWrap: "wrap" }}>
        <h3 style={{ margin: 0 }}><Gavel size={12} /> Diary — hearings &amp; deadlines, next 14 days{overdue ? ` (${overdue} overdue)` : ""}</h3>
        <div style={{ display: "flex", gap: 6 }}>
          <button className={`ac-chip ${!mine ? "active" : ""}`} onClick={() => setMine(false)}>Everything I can see</button>
          <button className={`ac-chip ${mine ? "active" : ""}`} onClick={() => setMine(true)}>My files</button>
        </div>
      </div>
      {rows === null ? <p style={{ fontSize: 13, color: "var(--slate)", margin: 0 }}>Loading…</p> : <DiaryRows rows={rows} onOpenMatter={onOpenMatter} showDepartment={showDepartment} />}
    </div>
  );
}

/** Top-bar panel: the diary for the next 60 days. */
export function DiaryPanel({ onClose, onOpenMatter, showDepartment }) {
  const [mine, setMine] = useState(false);
  const [rows, setRows] = useState(null);
  useEffect(() => { api.getDiary(60, mine).then((r) => setRows(r.deadlines)).catch(() => setRows([])); }, [mine]);
  const open = (id) => { onOpenMatter(id); onClose(); };
  return (
    <div className="ac-overlay" onClick={onClose}>
      <div className="ac-panel wide" onClick={(e) => e.stopPropagation()}>
        <div className="ac-panel-head">
          <h2><Calendar size={16} /> Diary — next 60 days</h2>
          <button type="button" className="ac-iconbtn" onClick={onClose}><X size={18} /></button>
        </div>
        <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
          <button className={`ac-chip ${!mine ? "active" : ""}`} onClick={() => setMine(false)}>Everything I can see</button>
          <button className={`ac-chip ${mine ? "active" : ""}`} onClick={() => setMine(true)}>My files</button>
        </div>
        {rows === null ? <p style={{ fontSize: 13, color: "var(--slate)" }}>Loading…</p> : <DiaryRows rows={rows} onOpenMatter={open} showDepartment={showDepartment} />}
      </div>
    </div>
  );
}
