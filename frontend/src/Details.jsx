import React, { useState } from "react";
import { FileText, Pencil, ShieldAlert } from "lucide-react";
import { api } from "./api";
import { notify } from "./notify";
import { FieldInput, showFieldValue } from "./Practice";

/**
 * The details recorded for a matter's department and type (the deceased on
 * a probate file, the marriage on a divorce…). The fields come from the
 * server (matter.detailFields), so a new field needs no change here.
 */

const blankIfNull = (v) => (v === null || v === undefined ? "" : String(v));

const TITLES = {
  "Probate / estate administration": "The deceased & the grant",
  Will: "Will",
  "Lasting power of attorney": "Lasting powers of attorney",
  Trust: "Trust",
  Divorce: "Divorce",
  "Financial settlement": "Financial proceedings",
  Children: "Children proceedings",
  "Injunction / domestic abuse": "Injunction",
  "Tribunal claim — for employee": "The claim",
  "Tribunal claim — for employer": "The claim",
  "Settlement agreement": "Settlement agreement",
  "Employment advice": "The advice",
};

/* ---------------------------------------------------------------------- */
/* Details card                                                           */
/* ---------------------------------------------------------------------- */

export function DetailsCard({ matter, onChanged }) {
  const fields = matter.detailFields || [];
  const [editing, setEditing] = useState(false);
  if (!fields.length) return null;
  return (
    <div className="ac-card" id="matter-details">
      <h3><FileText size={12} /> {TITLES[matter.type] || "Details"}</h3>
      {!editing && <button type="button" className="ac-card-edit" aria-label="Edit details" onClick={() => setEditing(true)}><Pencil size={11} /> Edit</button>}
      {editing
        ? <DetailsForm matter={matter} fields={fields} onCancel={() => setEditing(false)} onSaved={async () => { setEditing(false); await onChanged(); }} />
        : fields.filter((f) => f.key !== "confidentialAddress").map((f) => (
          <div key={f.key} className="ac-kv"><span className="k">{f.label}</span><span className="v" style={{ textAlign: "right" }}>{showFieldValue(f, matter.details[f.key])}</span></div>
        ))}
    </div>
  );
}

function DetailsForm({ matter, fields, onCancel, onSaved }) {
  const [f, setF] = useState(() => Object.fromEntries(fields.map((x) => [x.key, x.kind === "bool" ? !!matter.details[x.key] : blankIfNull(matter.details[x.key])])));
  const [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.updateDetails(matter.id, f);
      await onSaved();
    } catch (err) {
      notify(err.message || "Couldn't save the details.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit}>
      <div className="ac-pc-grid">
        {fields.map((x) => (
          <div key={x.key} className={`ac-field ${x.kind === "text" ? "wide" : ""}`}>
            {x.kind !== "bool" && <label>{x.label}</label>}
            <FieldInput field={x} value={f[x.key]} onChange={(v) => setF((prev) => ({ ...prev, [x.key]: v }))} />
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button className="ac-addbtn" type="submit" disabled={busy}>{busy ? "Saving…" : "Save"}</button>
        <button className="ac-tablebtn" type="button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}


/** Red banner across a matter whose client's whereabouts must be kept confidential. */
export function ConfidentialBanner({ matter }) {
  if (!matter.details?.confidentialAddress) return null;
  return (
    <div className="ac-confidential" role="alert">
      <ShieldAlert size={16} />
      <div><strong>Confidential address.</strong> Never disclose the client's address, phone, email or whereabouts — to the other party, their solicitor, or on any court form (use form C8).</div>
    </div>
  );
}
