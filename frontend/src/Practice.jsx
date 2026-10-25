import React, { useState } from "react";
import {
  Plus, Pencil, Trash2, Download, Handshake, ListOrdered, Hourglass, Calculator, ClipboardList, Gavel, Scale, PoundSterling, Clock, Info,
} from "lucide-react";
import { api } from "./api";
import { notify, confirmAction } from "./notify";

/**
 * Screens for the departments built from configuration (employment,
 * litigation, personal injury, corporate, crime): the calculation cards on
 * the overview, and a tab for each list the matter keeps. Everything shown
 * here — fields, figures, warnings — comes from the server.
 */

const ICONS = { Handshake, ListOrdered, Hourglass, Calculator, ClipboardList, Gavel, Scale, PoundSterling, Clock, Info };
export const listIcon = (name, size = 13) => {
  const Icon = ICONS[name] || ClipboardList;
  return <Icon size={size} />;
};

const money = (v) => `£${Number(v).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDate = (d) => (d ? new Date(`${String(d).slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "");
const blankIfNull = (v) => (v === null || v === undefined ? "" : String(v));

export function showFieldValue(field, v) {
  if (v === undefined || v === null || v === "") return "—";
  switch (field.kind) {
    case "money": return money(v);
    case "date": return fmtDate(v);
    case "datetime": return `${fmtDate(String(v).slice(0, 10))} ${String(v).slice(11, 16)}`;
    case "percent": return `${v}%`;
    case "bool": return v ? "Yes" : "No";
    default: return String(v);
  }
}

/** One input for a field definition (shared by the details card and list forms). */
export function FieldInput({ field, value, onChange }) {
  if (field.kind === "bool") {
    return (
      <label className="ac-check" style={{ margin: "22px 0 0" }}>
        <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} /> {field.label}
      </label>
    );
  }
  if (field.kind === "select") {
    return (
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">—</option>
        {field.options.map((o) => <option key={o}>{o}</option>)}
      </select>
    );
  }
  const numeric = ["money", "percent", "number"].includes(field.kind);
  return (
    <input
      type={field.kind === "date" ? "date" : field.kind === "datetime" ? "datetime-local" : numeric ? "number" : "text"}
      min={numeric ? 0 : undefined} max={field.kind === "percent" ? 100 : undefined}
      step={field.kind === "money" ? "0.01" : field.kind === "number" ? "any" : undefined}
      value={value} onChange={(e) => onChange(e.target.value)} />
  );
}

/* ---------------------------------------------------------------------- */
/* Calculation cards                                                      */
/* ---------------------------------------------------------------------- */

export function InsightCards({ matter }) {
  const cards = matter.insights || [];
  return cards.map((c) => (
    <div className="ac-card" key={c.title}>
      <h3>{listIcon(c.icon, 12)} {c.title}</h3>
      {c.rows.map((r, i) => (
        <div key={`${r.label}-${i}`} className="ac-kv">
          <span className="k">{r.label}</span>
          <span className="v" style={{ textAlign: "right", fontWeight: r.strong ? 700 : undefined, color: r.warn ? "#8a3b1f" : undefined }}>{r.value}</span>
        </div>
      ))}
      {c.note && <p className="ac-muted small" style={{ marginBottom: 0 }}>{c.note}</p>}
    </div>
  ));
}

/* ---------------------------------------------------------------------- */
/* List tab                                                               */
/* ---------------------------------------------------------------------- */

export function ListTab({ matter, list, onChanged }) {
  const [form, setForm] = useState(null); // "new" | item
  const columns = list.fields.filter((f) => f.table !== false);
  const close = () => setForm(null);

  async function remove(item) {
    if (!(await confirmAction(`Remove this ${list.singular}?`, { confirmLabel: "Remove", danger: true }))) return;
    try {
      await api.deleteListItem(matter.id, list.key, item.id);
      await onChanged();
    } catch (err) {
      notify(err.message || "Couldn't remove that.");
    }
  }
  async function quickStatus(item, status) {
    try {
      await api.updateListItem(matter.id, list.key, item.id, { status });
      await onChanged();
    } catch (err) {
      notify(err.message || "Couldn't update that.");
    }
  }
  async function download() {
    try {
      const blob = await api.getListDocument(matter.id, list.key);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${list.title} - ${matter.reference}.docx`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      notify(err.message || "Couldn't create the document.");
    }
  }
  const statusField = list.fields.find((f) => f.key === "status" && f.kind === "select");

  return (
    <div className="ac-detail-body">
      <div className="ac-col-main" style={{ minWidth: 0 }}>
        <div className="ac-section-head">
          <h2>{list.title}</h2>
          <div style={{ display: "flex", gap: 6 }}>
            <button className="ac-tablebtn" style={{ display: "inline-flex", alignItems: "center", gap: 4 }} onClick={download}><Download size={12} /> Word</button>
            <button className="ac-addbtn" onClick={() => setForm("new")}><Plus size={13} /> Add {list.singular}</button>
          </div>
        </div>
        {list.intro && <p className="ac-muted" style={{ marginTop: 0 }}>{list.intro}</p>}
        {form === "new" && <ListItemForm matter={matter} list={list} onCancel={close} onSaved={close} onChanged={onChanged} />}
        {list.items.length === 0 ? <p className="ac-muted">Nothing recorded yet.</p> : (
          <div className="ac-table-wrap">
            <table className="ac-table ac-estate-table">
              <thead><tr>{columns.map((c) => <th key={c.key} className={["money", "number", "percent"].includes(c.kind) ? "num" : ""}>{c.label}</th>)}<th /></tr></thead>
              <tbody>
                {list.items.map((item) => (form && form.id === item.id ? (
                  <tr key={item.id}><td colSpan={columns.length + 1}><ListItemForm matter={matter} list={list} item={item} onCancel={close} onSaved={close} onChanged={onChanged} /></td></tr>
                ) : (
                  <tr key={item.id}>
                    {columns.map((c) => (
                      <td key={c.key} className={["money", "number", "percent"].includes(c.kind) ? "num" : ""}>
                        {c === statusField ? (
                          <select className="ac-doc-move" value={item.status || ""} aria-label={`${c.label}`} onChange={(e) => quickStatus(item, e.target.value)}>
                            <option value="">—</option>
                            {c.options.map((o) => <option key={o}>{o}</option>)}
                          </select>
                        ) : showFieldValue(c, item[c.key])}
                      </td>
                    ))}
                    <td className="actions">
                      <button className="ac-iconbtn" title="Edit" aria-label={`Edit ${list.singular}`} onClick={() => setForm(item)}><Pencil size={13} /></button>
                      <button className="ac-iconbtn" title="Remove" aria-label={`Remove ${list.singular}`} onClick={() => remove(item)}><Trash2 size={13} /></button>
                    </td>
                  </tr>
                )))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <div className="ac-col-side">
        {list.summary && (
          <div className="ac-card">
            <h3>{listIcon(list.icon, 12)} Summary</h3>
            {list.summary.rows.map((r, i) => (
              <div key={`${r.label}-${i}`} className="ac-kv">
                <span className="k">{r.label}</span>
                <span className="v" style={{ textAlign: "right", fontWeight: r.strong ? 700 : undefined, color: r.warn ? "#8a3b1f" : undefined }}>{r.value}</span>
              </div>
            ))}
            {list.summary.note && <p className="ac-muted small" style={{ marginBottom: 0 }}>{list.summary.note}</p>}
          </div>
        )}
      </div>
    </div>
  );
}

function ListItemForm({ matter, list, item, onCancel, onSaved, onChanged }) {
  const [f, setF] = useState(() => Object.fromEntries(list.fields.map((x) => [x.key, x.kind === "bool" ? !!item?.[x.key] : blankIfNull(item?.[x.key])])));
  const [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      if (item) await api.updateListItem(matter.id, list.key, item.id, f);
      else await api.addListItem(matter.id, list.key, f);
      await onChanged();
      onSaved();
    } catch (err) {
      notify(err.message || "Couldn't save that.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="ac-card ac-inline-form" onSubmit={submit}>
      <div className="ac-pc-grid">
        {list.fields.map((x) => (
          <div key={x.key} className={`ac-field ${x.kind === "text" ? "wide" : ""}`}>
            {x.kind !== "bool" && <label>{x.label}{x.required ? " *" : ""}</label>}
            <FieldInput field={x} value={f[x.key]} onChange={(v) => setF((prev) => ({ ...prev, [x.key]: v }))} />
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button className="ac-addbtn" type="submit" disabled={busy}>{busy ? "Saving…" : item ? "Save" : `Add ${list.singular}`}</button>
        <button className="ac-tablebtn" type="button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
