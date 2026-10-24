import React, { useState } from "react";
import { Plus, Pencil, Trash2, Download, Baby, Calculator, Scale, CalendarClock } from "lucide-react";
import { api } from "./api";
import { notify, confirmAction } from "./notify";
import { childMaintenance, divorceDates, ageOn, daysBetween } from "./familyCalc";

/**
 * Family screens:
 *   AssetScheduleTab   financial settlements: who owns what now, the proposed division, ES2 in Word
 *   ChildrenCard       the children on any family matter, with a child maintenance estimate
 *   DivorceDatesCard   when the conditional and final orders can be applied for
 */

const money = (v) => (v === null || v === undefined || v === "" ? "—" : `${Number(v) < 0 ? "−" : ""}£${Math.abs(Number(v)).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const fmtDate = (d) => (d ? new Date(`${String(d).slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—");
const todayISO = () => new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" });
const blankIfNull = (v) => (v === null || v === undefined ? "" : String(v));

async function attempt(action, onChanged, failure) {
  try {
    await action();
    await onChanged();
    return true;
  } catch (err) {
    notify(err.message || failure);
    return false;
  }
}

/* ---------------------------------------------------------------------- */
/* Asset schedule                                                         */
/* ---------------------------------------------------------------------- */

const CATEGORIES = {
  asset: ["Family home", "Other property", "Bank / savings", "Investments / shares", "Business interest", "Vehicle", "Other asset"],
  liability: ["Mortgage", "Loan / credit card", "Tax", "Other debt"],
  pension: ["Defined benefit (final salary)", "Defined contribution", "State pension (additional)", "Other pension"],
};
const KIND_TITLES = { asset: "Assets", liability: "Liabilities", pension: "Pensions (CETV)" };
const defaultPercent = (owner) => (owner === "client" ? 100 : owner === "joint" ? 50 : 0);

export function AssetScheduleTab({ matter, onChanged }) {
  const [form, setForm] = useState(null); // { kind, item? }
  const items = matter.familyAssets || [];
  const s = matter.assetSchedule;
  const client = matter.client;
  const other = matter.details?.otherParty || "Other party";
  const ownerName = { client, other, joint: "Joint" };
  const close = () => setForm(null);

  async function remove(item) {
    if (!(await confirmAction(`Remove “${item.description}” from the schedule?`, { confirmLabel: "Remove", danger: true }))) return;
    await attempt(() => api.deleteFamilyAsset(matter.id, item.id), onChanged, "Couldn't remove that.");
  }
  async function download() {
    try {
      const blob = await api.getAssetSchedule(matter.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Asset schedule - ${matter.reference}.docx`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      notify(err.message || "Couldn't create the schedule.");
    }
  }

  const section = (kind) => {
    const rows = items.filter((i) => i.kind === kind);
    return (
      <div key={kind}>
        <div className="ac-section-head">
          <h2>{KIND_TITLES[kind]}</h2>
          <button className="ac-addbtn" onClick={() => setForm({ kind })}><Plus size={13} /> Add {kind === "pension" ? "pension" : kind}</button>
        </div>
        {form && form.kind === kind && !form.item && <FamilyAssetForm matter={matter} kind={kind} ownerName={ownerName} onCancel={close} onSaved={close} onChanged={onChanged} />}
        {rows.length === 0 ? <p className="ac-muted">None entered.</p> : (
          <div className="ac-table-wrap">
            <table className="ac-table ac-estate-table">
              <thead><tr><th>{kind === "pension" ? "Pension" : "Item"}</th><th>Whose</th><th className="num">{kind === "pension" ? "CETV" : "Value"}</th><th className="num">To {client} (proposed)</th><th /></tr></thead>
              <tbody>
                {rows.map((i) => (form && form.item?.id === i.id ? (
                  <tr key={i.id}><td colSpan={5}><FamilyAssetForm matter={matter} kind={kind} item={i} ownerName={ownerName} onCancel={close} onSaved={close} onChanged={onChanged} /></td></tr>
                ) : (
                  <tr key={i.id}>
                    <td>
                      <div style={{ fontWeight: 600, color: "var(--ink)" }}>{i.description}</div>
                      <div className="ac-muted small">{i.category}{i.source ? ` · ${i.source}` : ""}</div>
                      {i.notes && <div className="ac-muted small">{i.notes}</div>}
                    </td>
                    <td>{ownerName[i.owner]}</td>
                    <td className="num">{kind === "liability" ? `(${money(i.value)})` : money(i.value)}</td>
                    <td className="num">
                      {i.proposed_client_percent === null || i.proposed_client_percent === undefined ? `${defaultPercent(i.owner)}%` : <strong>{Number(i.proposed_client_percent)}%</strong>}
                    </td>
                    <td className="actions">
                      <button className="ac-iconbtn" title="Edit" aria-label={`Edit ${i.description}`} onClick={() => setForm({ kind, item: i })}><Pencil size={13} /></button>
                      <button className="ac-iconbtn" title="Remove" aria-label={`Remove ${i.description}`} onClick={() => remove(i)}><Trash2 size={13} /></button>
                    </td>
                  </tr>
                )))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="ac-detail-body">
      <div className="ac-col-main" style={{ minWidth: 0 }}>
        <p className="ac-muted" style={{ marginTop: 0 }}>
          Enter each item under whoever owns it, from the Forms E. Under “to {client}”, set the share of each item the proposal gives your client —
          joint items default to 50%. Bold shares differ from who owns it now.
        </p>
        {["asset", "liability", "pension"].map(section)}
      </div>
      <div className="ac-col-side">
        {s && (
          <>
            <ScheduleCard title="Capital (assets less debts)" g={s.capital} client={client} other={other} />
            {s.pensions.total !== 0 && <ScheduleCard title="Pensions (CETV)" g={s.pensions} client={client} other={other} />}
            <div className="ac-card">
              <h3><Scale size={12} /> The proposal</h3>
              <div className="ac-kv"><span className="k">Capital moving to {client}</span><span className="v">{money(s.capitalTransferToClient)}</span></div>
              {s.pensions.total !== 0 && <div className="ac-kv"><span className="k">Pension share to {client}</span><span className="v">{money(s.pensionShareToClient)}</span></div>}
              <div className="ac-kv"><span className="k">Overall to {client}</span><span className="v" style={{ fontWeight: 700 }}>{s.overall.clientProposedPercent === null ? "—" : `${s.overall.clientProposedPercent}%`}</span></div>
              <p className="ac-muted small">Pension values are cash equivalents and aren't directly comparable with capital — take advice before offsetting.</p>
              <button className="ac-addbtn" style={{ width: "100%", justifyContent: "center" }} onClick={download}><Download size={13} /> Asset schedule (Word, ES2 style)</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function ScheduleCard({ title, g, client, other }) {
  const pct = (v) => (v === null ? "" : ` (${v}%)`);
  return (
    <div className="ac-card">
      <h3><Scale size={12} /> {title}</h3>
      <div className="ac-kv"><span className="k">Total</span><span className="v" style={{ fontWeight: 600 }}>{money(g.total)}</span></div>
      <div className="ac-kv"><span className="k">{client} now</span><span className="v">{money(g.clientNow)}{pct(g.clientNowPercent)}</span></div>
      <div className="ac-kv"><span className="k">{other} now</span><span className="v">{money(g.otherNow)}</span></div>
      <div className="ac-kv"><span className="k">{client} — proposed</span><span className="v" style={{ fontWeight: 600 }}>{money(g.clientProposed)}{pct(g.clientProposedPercent)}</span></div>
      <div className="ac-kv"><span className="k">{other} — proposed</span><span className="v">{money(g.otherProposed)}</span></div>
    </div>
  );
}

function FamilyAssetForm({ matter, kind, item, ownerName, onCancel, onSaved, onChanged }) {
  const [f, setF] = useState(() => ({
    owner: item?.owner || "joint", category: item?.category || CATEGORIES[kind][0], description: item?.description || "",
    value: blankIfNull(item?.value), proposedClientPercent: blankIfNull(item?.proposed_client_percent), source: item?.source || "", notes: item?.notes || "",
  }));
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    const ok = await attempt(() => (item ? api.updateFamilyAsset(matter.id, item.id, f) : api.addFamilyAsset(matter.id, { kind, ...f })), onChanged, "Couldn't save that.");
    setBusy(false);
    if (ok) onSaved();
  }
  return (
    <form className="ac-card ac-inline-form" onSubmit={submit}>
      <div className="ac-row2">
        <div className="ac-field"><label>Whose</label>
          <select value={f.owner} onChange={set("owner")}>
            {["client", "other", "joint"].map((o) => <option key={o} value={o}>{ownerName[o]}</option>)}
          </select>
        </div>
        <div className="ac-field"><label>Category</label><select value={f.category} onChange={set("category")}>{CATEGORIES[kind].map((c) => <option key={c}>{c}</option>)}</select></div>
      </div>
      <div className="ac-field"><label>Description</label><input value={f.description} onChange={set("description")} autoFocus placeholder={kind === "pension" ? "e.g. NHS Pension Scheme" : kind === "liability" ? "e.g. Nationwide mortgage" : "e.g. 12 Elm Road (net of sale costs)"} /></div>
      <div className="ac-row3">
        <div className="ac-field"><label>{kind === "pension" ? "CETV (£)" : kind === "liability" ? "Amount owed (£)" : "Value (£)"}</label><input type="number" min="0" step="0.01" value={f.value} onChange={set("value")} /></div>
        <div className="ac-field"><label>Share to {matter.client} (%)</label><input type="number" min="0" max="100" step="0.01" value={f.proposedClientPercent} onChange={set("proposedClientPercent")} placeholder={`${defaultPercent(f.owner)} (as owned)`} /></div>
        <div className="ac-field"><label>Source</label><input value={f.source} onChange={set("source")} placeholder="e.g. Form E 2.1, valuation" /></div>
      </div>
      <div className="ac-field"><label>Notes</label><input value={f.notes} onChange={set("notes")} /></div>
      <div style={{ display: "flex", gap: 8 }}>
        <button className="ac-addbtn" type="submit" disabled={busy}>{busy ? "Saving…" : item ? "Save" : "Add to schedule"}</button>
        <button className="ac-tablebtn" type="button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

/* ---------------------------------------------------------------------- */
/* Children                                                               */
/* ---------------------------------------------------------------------- */

const LIVES_WITH = ["Client", "Other party", "Shared", "Someone else"];

export function ChildrenCard({ matter, onChanged }) {
  const [form, setForm] = useState(null); // "new" | child
  const [calc, setCalc] = useState(false);
  const children = matter.children || [];
  const today = todayISO();
  async function remove(c) {
    if (!(await confirmAction(`Remove ${c.name} from this matter?`, { confirmLabel: "Remove", danger: true }))) return;
    await attempt(() => api.deleteChild(matter.id, c.id), onChanged, "Couldn't remove that.");
  }
  return (
    <div className="ac-card">
      <h3><Baby size={12} /> Children</h3>
      {children.length === 0 && form !== "new" && <p className="ac-muted" style={{ marginTop: 0 }}>No children recorded.</p>}
      {children.map((c) => (form && form.id === c.id ? (
        <ChildForm key={c.id} matter={matter} child={c} onCancel={() => setForm(null)} onSaved={() => setForm(null)} onChanged={onChanged} />
      ) : (
        <div key={c.id} className="ac-custody-row" style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
          <div>
            <div style={{ fontWeight: 600, fontSize: 13 }}>{c.name}{c.date_of_birth ? `, ${ageOn(c.date_of_birth, today)}` : ""}</div>
            <div className="ac-muted small">
              {c.date_of_birth ? `Born ${fmtDate(c.date_of_birth)}` : "Date of birth not recorded"}
              {c.lives_with ? ` · lives with: ${c.lives_with === "Client" ? matter.client : c.lives_with === "Other party" ? (matter.details?.otherParty || "other party") : c.lives_with.toLowerCase()}` : ""}
              {c.school ? ` · ${c.school}` : ""}
            </div>
            {c.notes && <div className="ac-muted small">{c.notes}</div>}
          </div>
          <div style={{ whiteSpace: "nowrap" }}>
            <button className="ac-iconbtn" title="Edit" aria-label={`Edit ${c.name}`} onClick={() => setForm(c)}><Pencil size={13} /></button>
            <button className="ac-iconbtn" title="Remove" aria-label={`Remove ${c.name}`} onClick={() => remove(c)}><Trash2 size={13} /></button>
          </div>
        </div>
      )))}
      {form === "new" && <ChildForm matter={matter} onCancel={() => setForm(null)} onSaved={() => setForm(null)} onChanged={onChanged} />}
      <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
        {form !== "new" && <button className="ac-addbtn" onClick={() => setForm("new")}><Plus size={12} /> Add child</button>}
        <button className="ac-tablebtn" style={{ display: "inline-flex", alignItems: "center", gap: 4 }} onClick={() => setCalc((v) => !v)}><Calculator size={12} /> Child maintenance estimate</button>
      </div>
      {calc && <ChildMaintenanceCalculator children={children.filter((c) => c.date_of_birth ? ageOn(c.date_of_birth, today) < 20 : true).length || 1} />}
    </div>
  );
}

function ChildForm({ matter, child, onCancel, onSaved, onChanged }) {
  const [f, setF] = useState({
    name: child?.name || "", dateOfBirth: child?.date_of_birth ? String(child.date_of_birth).slice(0, 10) : "",
    livesWith: child?.lives_with || "", school: child?.school || "", notes: child?.notes || "",
  });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    const ok = await attempt(() => (child ? api.updateChild(matter.id, child.id, f) : api.addChild(matter.id, f)), onChanged, "Couldn't save that.");
    setBusy(false);
    if (ok) onSaved();
  }
  return (
    <form className="ac-inline-form" onSubmit={submit} style={{ marginTop: 8 }}>
      <div className="ac-row2">
        <div className="ac-field"><label>Name</label><input value={f.name} onChange={set("name")} autoFocus /></div>
        <div className="ac-field"><label>Date of birth</label><input type="date" value={f.dateOfBirth} onChange={set("dateOfBirth")} /></div>
      </div>
      <div className="ac-row2">
        <div className="ac-field"><label>Lives with</label>
          <select value={f.livesWith} onChange={set("livesWith")}>
            <option value="">—</option>
            {LIVES_WITH.map((l) => <option key={l} value={l}>{l === "Client" ? matter.client : l === "Other party" ? (matter.details?.otherParty || "Other party") : l}</option>)}
          </select>
        </div>
        <div className="ac-field"><label>School / nursery</label><input value={f.school} onChange={set("school")} /></div>
      </div>
      <div className="ac-field"><label>Notes (health, special needs, wishes…)</label><input value={f.notes} onChange={set("notes")} /></div>
      <div style={{ display: "flex", gap: 8 }}>
        <button className="ac-addbtn" type="submit" disabled={busy}>{busy ? "Saving…" : child ? "Save" : "Add child"}</button>
        <button className="ac-tablebtn" type="button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

function ChildMaintenanceCalculator({ children }) {
  const [f, setF] = useState({ income: "", per: "year", children, otherChildren: 0, nights: 0, onBenefits: false });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value });
  const gross = Number(f.income) || 0;
  const weekly = f.per === "year" ? gross / 52 : f.per === "month" ? (gross * 12) / 52 : gross;
  const r = childMaintenance({ grossWeekly: weekly, children: Number(f.children), otherChildren: Number(f.otherChildren), nights: Number(f.nights), onBenefits: f.onBenefits });
  return (
    <div className="ac-calc" style={{ marginTop: 12 }}>
      <div className="ac-row2">
        <div className="ac-field"><label>Paying parent's gross income (£)</label><input type="number" min="0" value={f.income} onChange={set("income")} placeholder="Before tax" /></div>
        <div className="ac-field"><label>Per</label>
          <select value={f.per} onChange={set("per")}><option value="year">Year</option><option value="month">Month</option><option value="week">Week</option></select>
        </div>
      </div>
      <div className="ac-row3">
        <div className="ac-field"><label>Children it's for</label><input type="number" min="1" max="10" value={f.children} onChange={set("children")} /></div>
        <div className="ac-field"><label>Other children they support</label><input type="number" min="0" max="10" value={f.otherChildren} onChange={set("otherChildren")} /></div>
        <div className="ac-field"><label>Nights a year with them</label><input type="number" min="0" max="365" value={f.nights} onChange={set("nights")} /></div>
      </div>
      <label className="ac-check"><input type="checkbox" checked={f.onBenefits} onChange={set("onBenefits")} /> Paying parent gets a qualifying benefit (flat rate)</label>
      {(gross > 0 || f.onBenefits) && (
        <>
          <div className="ac-kv"><span className="k">{r.rate}</span><span className="v" style={{ fontWeight: 700 }}>{money(r.weekly)} a week</span></div>
          <div className="ac-kv"><span className="k">About</span><span className="v">{money(r.monthly)} a month · {money(r.annual)} a year</span></div>
          <ul className="ac-calc-steps">{r.steps.map((st) => <li key={st}>{st}</li>)}</ul>
        </>
      )}
      <p className="ac-muted small" style={{ marginBottom: 0 }}>A guide using the CMS formula. The CMS uses HMRC's figures, and variations or Collect & Pay fees change the amount.</p>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Divorce dates                                                          */
/* ---------------------------------------------------------------------- */

export function DivorceDatesCard({ matter }) {
  const d = matter.details || {};
  const k = divorceDates(d);
  const today = todayISO();
  const when = (iso) => {
    const left = daysBetween(today, iso);
    return left <= 0 ? <span style={{ color: "var(--success)", fontWeight: 600 }}>now (from {fmtDate(iso)})</span> : <>{fmtDate(iso)} <span className="ac-muted small">({left} day{left === 1 ? "" : "s"})</span></>;
  };
  const rows = [
    ["Application issued", d.applicationIssued ? fmtDate(d.applicationIssued) : "—"],
    ["Conditional order can be applied for", d.conditionalOrderApplied ? `Applied ${fmtDate(d.conditionalOrderApplied)}` : k.conditionalOrderFrom ? when(k.conditionalOrderFrom) : "20 weeks after issue"],
    ["Conditional order pronounced", d.conditionalOrderPronounced ? fmtDate(d.conditionalOrderPronounced) : "—"],
    ["Final order can be applied for", d.finalOrderMade ? `Made ${fmtDate(d.finalOrderMade)}` : d.finalOrderApplied ? `Applied ${fmtDate(d.finalOrderApplied)}` : k.finalOrderFrom ? when(k.finalOrderFrom) : "6 weeks and 1 day after the conditional order"],
  ];
  if (k.respondentFinalOrderFrom && !d.finalOrderApplied) rows.push(["Respondent can apply from", fmtDate(k.respondentFinalOrderFrom)]);
  return (
    <div className="ac-card">
      <h3><CalendarClock size={12} /> Divorce timetable</h3>
      {rows.map(([label, value]) => <div key={label} className="ac-kv"><span className="k">{label}</span><span className="v" style={{ textAlign: "right" }}>{value}</span></div>)}
      {k.finalOrderFrom && !d.finalOrderApplied && !d.financialOrderInPlace && (
        <p className="ac-estate-warn" style={{ marginBottom: 0 }}>No financial order or advice recorded. Applying for the final order before finances are settled can lose pension and inheritance rights — consider waiting.</p>
      )}
      {!d.applicationIssued && <p className="ac-muted small" style={{ marginBottom: 0 }}>Add the dates in the Divorce details to work these out.</p>}
    </div>
  );
}
