import React, { useEffect, useState } from "react";
import { Plus, Pencil, Trash2, X, Download, FileText, Lock, Search, Landmark, Calculator, Archive } from "lucide-react";
import { api } from "./api";
import { notify, confirmAction } from "./notify";

/**
 * Wills, Trusts & Probate screens:
 *   PcDetailsCard     the type's details (deceased & grant, will, LPA, trust) — fields come from the server
 *   EstateSummaryCard probate overview: estate value and IHT at a glance
 *   EstateTab         probate: assets, liabilities, beneficiaries, IHT estimate, estate account and letters
 *   SafeCustodyCard   originals of this matter's wills / LPAs / deeds held by the firm
 *   SafeCustodyPanel  the firm's whole safe custody register
 */

const fmtDate = (d) => (d ? new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—");
const money = (v) => (v === null || v === undefined || v === "" ? "—" : `£${Number(v).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const todayISO = () => new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" });
const blankIfNull = (v) => (v === null || v === undefined ? "" : String(v));

export const PROBATE = "Probate / estate administration";
const DETAILS_TITLE = {
  [PROBATE]: "The deceased & the grant",
  Will: "Will",
  "Lasting power of attorney": "Lasting powers of attorney",
  Trust: "Trust",
};

async function saveBlob(load, fileName) {
  try {
    const blob = await load();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (err) {
    notify(err.message || "Couldn't create the document.");
  }
}

/** Runs a save, reloads the matter, and reports errors. Returns true on success. */
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

function showValue(field, v) {
  if (v === undefined || v === null || v === "") return "—";
  if (field.kind === "date") return fmtDate(v);
  if (field.kind === "money") return money(v);
  if (field.kind === "percent") return `${v}%`;
  if (field.kind === "bool") return v ? "Yes" : "No";
  return String(v);
}

/* ---------------------------------------------------------------------- */
/* Details card                                                           */
/* ---------------------------------------------------------------------- */

export function PcDetailsCard({ matter, onChanged }) {
  const fields = matter.pcFields || [];
  const [editing, setEditing] = useState(false);
  if (!fields.length) return null;
  return (
    <div className="ac-card">
      <h3><FileText size={12} /> {DETAILS_TITLE[matter.type] || "Details"}</h3>
      {!editing && <button type="button" className="ac-card-edit" aria-label="Edit details" onClick={() => setEditing(true)}><Pencil size={11} /> Edit</button>}
      {editing
        ? <PcDetailsForm matter={matter} fields={fields} onCancel={() => setEditing(false)} onSaved={async () => { setEditing(false); await onChanged(); }} />
        : fields.map((f) => (
          <div key={f.key} className="ac-kv"><span className="k">{f.label}</span><span className="v" style={{ textAlign: "right" }}>{showValue(f, matter.pcDetails[f.key])}</span></div>
        ))}
    </div>
  );
}

function PcDetailsForm({ matter, fields, onCancel, onSaved }) {
  const [f, setF] = useState(() => Object.fromEntries(fields.map((x) => [x.key, x.kind === "bool" ? !!matter.pcDetails[x.key] : blankIfNull(matter.pcDetails[x.key])])));
  const [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.updatePcDetails(matter.id, f);
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
            {x.kind === "bool" ? (
              <label style={{ display: "flex", gap: 8, alignItems: "center", textTransform: "none", fontWeight: 500, color: "var(--ink)", fontSize: 13 }}>
                <input type="checkbox" style={{ width: "auto" }} checked={f[x.key]} onChange={(e) => setF({ ...f, [x.key]: e.target.checked })} /> {x.label}
              </label>
            ) : (
              <>
                <label>{x.label}</label>
                {x.kind === "select" ? (
                  <select value={f[x.key]} onChange={(e) => setF({ ...f, [x.key]: e.target.value })}>
                    <option value="">—</option>
                    {x.options.map((o) => <option key={o}>{o}</option>)}
                  </select>
                ) : (
                  <input type={x.kind === "date" ? "date" : ["money", "percent"].includes(x.kind) ? "number" : "text"}
                    min={["money", "percent"].includes(x.kind) ? 0 : undefined} max={x.kind === "percent" ? 100 : undefined}
                    step={x.kind === "money" ? "0.01" : undefined}
                    value={f[x.key]} onChange={(e) => setF({ ...f, [x.key]: e.target.value })} />
                )}
              </>
            )}
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

/* ---------------------------------------------------------------------- */
/* Estate (probate)                                                       */
/* ---------------------------------------------------------------------- */

export function EstateSummaryCard({ matter, onOpenEstate }) {
  const s = matter.estateSummary;
  if (!s) return null;
  const toNotify = (matter.estateItems || []).filter((i) => i.status === "To notify").length;
  return (
    <div className="ac-card">
      <h3><Landmark size={12} /> Estate</h3>
      <div className="ac-kv"><span className="k">Gross estate</span><span className="v">{money(s.grossEstate)}</span></div>
      <div className="ac-kv"><span className="k">Net estate (for IHT)</span><span className="v">{money(s.netEstate)}</span></div>
      <div className="ac-kv"><span className="k">IHT estimate</span><span className="v" style={s.iht.due > 0 ? { color: "#8a3b1f", fontWeight: 600 } : {}}>{s.iht.due > 0 ? money(s.iht.due) : "None due"}</span></div>
      <div className="ac-kv"><span className="k">Residue to distribute</span><span className="v">{money(s.distribution.residue)}</span></div>
      {toNotify > 0 && <p style={{ fontSize: 12, color: "#8a3b1f", margin: "8px 0 0" }}>{toNotify} asset holder{toNotify === 1 ? "" : "s"} / creditor{toNotify === 1 ? "" : "s"} still to be notified of the death.</p>}
      <button className="ac-addbtn" style={{ marginTop: 10, width: "100%", justifyContent: "center" }} onClick={onOpenEstate}><Landmark size={13} /> Open the estate</button>
    </div>
  );
}

const ASSET_CATEGORIES = [
  "Property (main residence)", "Other property", "Bank / building society", "Investments / shares", "Premium Bonds / NS&I",
  "Pension", "Life insurance", "Personal possessions", "Vehicle", "Business interest", "Money owed to the deceased", "Other asset",
];
const LIABILITY_CATEGORIES = ["Funeral", "Mortgage", "Credit card / loan", "Household bills", "Care fees", "Income tax", "Administration expense", "Other debt"];
const STATUSES = { asset: ["To notify", "Notified", "Valued", "Collected / transferred"], liability: ["To notify", "Notified", "Agreed", "Paid"] };
const GIFT_TYPES = ["Specific gift", "Pecuniary legacy", "Share of residue"];

export function EstateTab({ matter, onChanged }) {
  const [form, setForm] = useState(null); // { kind: 'asset'|'liability'|'beneficiary', item? }
  const items = matter.estateItems || [];
  const assets = items.filter((i) => i.kind === "asset");
  const liabilities = items.filter((i) => i.kind === "liability");
  const people = matter.beneficiaries || [];
  const s = matter.estateSummary;
  const d = matter.pcDetails || {};
  const entitlement = Object.fromEntries((s?.distribution.beneficiaries || []).map((b) => [b.id, b]));
  const name = d.deceasedName || "the deceased";

  const setStatus = (item, status) => attempt(() => api.updateEstateItem(matter.id, item.id, { status }), onChanged, "Couldn't update that.");
  async function remove(item, label, del) {
    if (!(await confirmAction(`Remove ${label}?`, { confirmLabel: "Remove", danger: true }))) return;
    await attempt(del, onChanged, "Couldn't remove that.");
  }
  const letter = (item) => saveBlob(() => api.getDeathLetter(matter.id, item.id), `Notification of death - ${item.holder || item.description} - ${matter.reference}.docx`);
  const close = () => setForm(null);
  const formFor = (kind, item) => setForm({ kind, item });

  const itemTable = (kind, rows) => (
    <>
      <div className="ac-section-head">
        <h2>{kind === "asset" ? "Assets" : "Liabilities & expenses"}</h2>
        <button className="ac-addbtn" onClick={() => formFor(kind)}><Plus size={13} /> Add {kind === "asset" ? "asset" : "liability"}</button>
      </div>
      {form && form.kind === kind && !form.item && <EstateItemForm matter={matter} kind={kind} onCancel={close} onSaved={close} onChanged={onChanged} />}
      {rows.length === 0 ? <p className="ac-muted">None recorded yet.</p> : (
        <div className="ac-table-wrap">
          <table className="ac-table ac-estate-table">
            <thead><tr><th>{kind === "asset" ? "Asset" : "Owed to"}</th><th className="num">{kind === "asset" ? "At death" : "Owed"}</th><th className="num">{kind === "asset" ? "Realised" : "Paid"}</th><th>Status</th><th /></tr></thead>
            <tbody>
              {rows.map((i) => (form && form.item?.id === i.id ? (
                <tr key={i.id}><td colSpan={5}><EstateItemForm matter={matter} kind={kind} item={i} onCancel={close} onSaved={close} onChanged={onChanged} /></td></tr>
              ) : (
                <tr key={i.id} className={i.status === "To notify" ? "ac-row-issue" : ""}>
                  <td>
                    <div style={{ fontWeight: 600, color: "var(--ink)" }}>{i.description}</div>
                    <div className="ac-muted small">{i.category}{i.holder ? ` · ${i.holder}` : ""}{i.reference ? ` · ${i.reference}` : ""}{i.passes_outside_will ? " · passes outside the will" : ""}</div>
                    {i.notes && <div className="ac-muted small">{i.notes}</div>}
                  </td>
                  <td className="num">{money(i.value_at_death)}</td>
                  <td className="num">{money(i.value_realised)}</td>
                  <td>
                    <select className="ac-doc-move" value={i.status} aria-label={`Status of ${i.description}`} onChange={(e) => setStatus(i, e.target.value)}>
                      {STATUSES[kind].map((st) => <option key={st}>{st}</option>)}
                    </select>
                    {i.notified_on && <div className="ac-muted small">Notified {fmtDate(i.notified_on)}</div>}
                  </td>
                  <td className="actions">
                    {i.holder && <button className="ac-tablebtn" title="Letter notifying them of the death" onClick={() => letter(i)}><Download size={11} /> Letter</button>}
                    <button className="ac-iconbtn" title="Edit" aria-label={`Edit ${i.description}`} onClick={() => formFor(kind, i)}><Pencil size={13} /></button>
                    <button className="ac-iconbtn" title="Remove" aria-label={`Remove ${i.description}`} onClick={() => remove(i, `“${i.description}”`, () => api.deleteEstateItem(matter.id, i.id))}><Trash2 size={13} /></button>
                  </td>
                </tr>
              )))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );

  return (
    <div className="ac-detail-body">
      <div className="ac-col-main" style={{ minWidth: 0 }}>
        {!d.dateOfDeath && <p className="ac-estate-warn">Add the date of death (and the other details of the deceased) on the Overview so letters and deadlines are right.</p>}
        {itemTable("asset", assets)}
        {itemTable("liability", liabilities)}

        <div className="ac-section-head">
          <h2>Beneficiaries</h2>
          <button className="ac-addbtn" onClick={() => formFor("beneficiary")}><Plus size={13} /> Add beneficiary</button>
        </div>
        {form && form.kind === "beneficiary" && !form.item && <BeneficiaryForm matter={matter} onCancel={close} onSaved={close} onChanged={onChanged} />}
        {people.length === 0 ? <p className="ac-muted">No beneficiaries recorded yet. Add each gift in the will (or the intestacy entitlements).</p> : (
          <div className="ac-table-wrap">
            <table className="ac-table ac-estate-table">
              <thead><tr><th>Beneficiary</th><th>Gift</th><th className="num">Due</th><th className="num">Paid</th><th className="num">Balance</th><th /></tr></thead>
              <tbody>
                {people.map((b) => (form && form.item?.id === b.id ? (
                  <tr key={b.id}><td colSpan={6}><BeneficiaryForm matter={matter} item={b} onCancel={close} onSaved={close} onChanged={onChanged} /></td></tr>
                ) : (
                  <tr key={b.id}>
                    <td>
                      <div style={{ fontWeight: 600, color: "var(--ink)" }}>{b.name}</div>
                      <div className="ac-muted small">{b.relationship || ""}{b.exemption ? `${b.relationship ? " · " : ""}${b.exemption === "spouse" ? "spouse exempt" : "charity exempt"}` : ""}</div>
                    </td>
                    <td>
                      {b.gift_type === "Share of residue" ? `${Number(b.share_percent)}% of residue` : b.gift_type === "Pecuniary legacy" ? `Legacy of ${money(b.amount)}` : `${b.description || "Specific gift"}${b.amount ? ` (${money(b.amount)})` : ""}`}
                      {b.paid_on && <div className="ac-muted small">Paid {fmtDate(b.paid_on)}{b.receipt_on ? ` · receipt ${fmtDate(b.receipt_on)}` : " · receipt awaited"}</div>}
                    </td>
                    <td className="num">{money(entitlement[b.id]?.entitlement)}</td>
                    <td className="num">{money(b.paid_amount || 0)}</td>
                    <td className="num" style={entitlement[b.id]?.balance > 0.005 ? { fontWeight: 600 } : {}}>{money(entitlement[b.id]?.balance)}</td>
                    <td className="actions">
                      <button className="ac-tablebtn" title="Letter sending their payment, with a receipt" onClick={() => saveBlob(() => api.getPaymentLetter(matter.id, b.id), `Payment to ${b.name} - ${matter.reference}.docx`)}><Download size={11} /> Letter</button>
                      <button className="ac-iconbtn" title="Edit" aria-label={`Edit ${b.name}`} onClick={() => formFor("beneficiary", b)}><Pencil size={13} /></button>
                      <button className="ac-iconbtn" title="Remove" aria-label={`Remove ${b.name}`} onClick={() => remove(b, b.name, () => api.deleteBeneficiary(matter.id, b.id))}><Trash2 size={13} /></button>
                    </td>
                  </tr>
                )))}
              </tbody>
            </table>
          </div>
        )}
        {s && s.distribution.totalShares > 0 && Math.abs(s.distribution.totalShares - 100) > 0.001 && (
          <p className="ac-estate-warn">The shares of residue add up to {s.distribution.totalShares}%, not 100%.</p>
        )}
      </div>

      <div className="ac-col-side">
        {s && <IhtCard s={s} name={name} />}
        {s && (
          <div className="ac-card">
            <h3><Landmark size={12} /> Estate account</h3>
            <div className="ac-kv"><span className="k">Assets (realised where known)</span><span className="v">{money(s.distribution.realised)}</span></div>
            <div className="ac-kv"><span className="k">Less debts and expenses</span><span className="v">({money(s.distribution.payments)})</span></div>
            <div className="ac-kv"><span className="k">Less IHT {s.iht.paid ? "paid" : "(estimate)"}</span><span className="v">({money(s.distribution.iht)})</span></div>
            <div className="ac-kv"><span className="k">For distribution</span><span className="v" style={{ fontWeight: 600 }}>{money(s.distribution.forDistribution)}</span></div>
            <div className="ac-kv"><span className="k">Less legacies</span><span className="v">({money(s.distribution.legacies)})</span></div>
            <div className="ac-kv"><span className="k">Residue</span><span className="v" style={{ fontWeight: 600 }}>{money(s.distribution.residue)}</span></div>
            <button className="ac-addbtn" style={{ marginTop: 10, width: "100%", justifyContent: "center" }}
              onClick={() => saveBlob(() => api.getEstateAccount(matter.id), `Estate account - ${matter.reference}.docx`)}>
              <Download size={13} /> Estate account (Word)
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function IhtCard({ s, name }) {
  const i = s.iht;
  return (
    <div className="ac-card">
      <h3><Calculator size={12} /> Inheritance tax estimate</h3>
      <div className="ac-kv"><span className="k">Gross estate</span><span className="v">{money(s.grossEstate)}</span></div>
      <div className="ac-kv"><span className="k">Less debts and funeral</span><span className="v">({money(s.debts)})</span></div>
      <div className="ac-kv"><span className="k">Net estate</span><span className="v">{money(s.netEstate)}</span></div>
      {i.spouseExempt > 0 && <div className="ac-kv"><span className="k">Less to spouse / civil partner</span><span className="v">({money(i.spouseExempt)})</span></div>}
      {i.charityExempt > 0 && <div className="ac-kv"><span className="k">Less to charity</span><span className="v">({money(i.charityExempt)})</span></div>}
      {i.reliefs > 0 && <div className="ac-kv"><span className="k">Less business / agricultural relief</span><span className="v">({money(i.reliefs)})</span></div>}
      {i.lifetimeGifts > 0 && <div className="ac-kv"><span className="k">Add gifts in the last 7 years</span><span className="v">{money(i.lifetimeGifts)}</span></div>}
      <div className="ac-kv"><span className="k">Nil-rate band</span><span className="v">({money(i.nilRateBand)})</span></div>
      <div className="ac-kv"><span className="k">Residence nil-rate band</span><span className="v">({money(i.residenceNilRateBand)})</span></div>
      <div className="ac-kv"><span className="k">Taxable</span><span className="v">{money(i.taxable)}</span></div>
      <div className="ac-kv"><span className="k">{i.due > 0 ? `IHT at ${Math.round(i.rate * 100)}%` : "Inheritance tax"}</span><span className="v" style={{ fontWeight: 700, color: i.due > 0 ? "#8a3b1f" : "var(--success)" }}>{i.due > 0 ? money(i.due) : "None due"}</span></div>
      {i.paid > 0 && <div className="ac-kv"><span className="k">Paid</span><span className="v">{money(i.paid)}</span></div>}
      <p className="ac-muted small" style={{ marginBottom: 0 }}>
        An estimate for {name}'s estate from the figures entered. It doesn't gross up gifts, or cover gifts with reservation or quick succession relief. Check it before reporting to HMRC.
      </p>
    </div>
  );
}

function EstateItemForm({ matter, kind, item, onCancel, onSaved, onChanged }) {
  const cats = kind === "asset" ? ASSET_CATEGORIES : LIABILITY_CATEGORIES;
  const [f, setF] = useState(() => ({
    category: item?.category || cats[kind === "asset" ? 2 : 0], description: item?.description || "", holder: item?.holder || "",
    holderAddress: item?.holder_address || "", reference: item?.reference || "", valueAtDeath: blankIfNull(item?.value_at_death),
    valueRealised: blankIfNull(item?.value_realised), status: item?.status || "To notify", notifiedOn: item?.notified_on ? String(item.notified_on).slice(0, 10) : "",
    passesOutsideWill: !!item?.passes_outside_will, notes: item?.notes || "",
  }));
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    const body = kind === "asset" ? f : (({ passesOutsideWill, ...rest }) => rest)(f);
    const ok = await attempt(() => (item ? api.updateEstateItem(matter.id, item.id, body) : api.addEstateItem(matter.id, { kind, ...body })), onChanged, "Couldn't save that.");
    setBusy(false);
    if (ok) onSaved();
  }
  return (
    <form className="ac-card ac-inline-form" onSubmit={submit}>
      <div className="ac-row2">
        <div className="ac-field"><label>Category</label><select value={f.category} onChange={set("category")}>{cats.map((c) => <option key={c}>{c}</option>)}</select></div>
        <div className="ac-field"><label>Description</label><input value={f.description} onChange={set("description")} placeholder={kind === "asset" ? "e.g. Current account" : "e.g. Funeral account"} autoFocus /></div>
      </div>
      <div className="ac-row2">
        <div className="ac-field"><label>{kind === "asset" ? "Held with (bank, insurer…)" : "Owed to"}</label><input value={f.holder} onChange={set("holder")} /></div>
        <div className="ac-field"><label>Account / policy reference</label><input value={f.reference} onChange={set("reference")} /></div>
      </div>
      <div className="ac-field"><label>Their address (for letters)</label><textarea rows={2} value={f.holderAddress} onChange={set("holderAddress")} /></div>
      <div className="ac-row2">
        <div className="ac-field"><label>{kind === "asset" ? "Value at date of death (£)" : "Amount owed at death (£)"}</label><input type="number" min="0" step="0.01" value={f.valueAtDeath} onChange={set("valueAtDeath")} /></div>
        <div className="ac-field"><label>{kind === "asset" ? "Amount realised (£)" : "Amount paid (£)"}</label><input type="number" min="0" step="0.01" value={f.valueRealised} onChange={set("valueRealised")} /></div>
      </div>
      <div className="ac-row2">
        <div className="ac-field"><label>Status</label><select value={f.status} onChange={set("status")}>{STATUSES[kind].map((st) => <option key={st}>{st}</option>)}</select></div>
        <div className="ac-field"><label>Notified on</label><input type="date" value={f.notifiedOn} onChange={set("notifiedOn")} /></div>
      </div>
      {kind === "asset" && (
        <label className="ac-check"><input type="checkbox" checked={f.passesOutsideWill} onChange={(e) => setF({ ...f, passesOutsideWill: e.target.checked })} /> Passes outside the will (joint asset to the survivor, nominated pension…) — counted for IHT, not distributed</label>
      )}
      {kind === "liability" && f.category === "Administration expense" && <p className="ac-muted small">Administration expenses are paid from the estate but aren't deducted for inheritance tax.</p>}
      <div className="ac-field"><label>Notes</label><input value={f.notes} onChange={set("notes")} /></div>
      <div style={{ display: "flex", gap: 8 }}>
        <button className="ac-addbtn" type="submit" disabled={busy}>{busy ? "Saving…" : item ? "Save" : `Add ${kind}`}</button>
        <button className="ac-tablebtn" type="button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

function BeneficiaryForm({ matter, item, onCancel, onSaved, onChanged }) {
  const [f, setF] = useState(() => ({
    name: item?.name || "", relationship: item?.relationship || "", giftType: item?.gift_type || "Share of residue",
    description: item?.description || "", amount: blankIfNull(item?.amount), sharePercent: blankIfNull(item?.share_percent),
    exemption: item?.exemption || "", paidAmount: blankIfNull(item?.paid_amount), paidOn: item?.paid_on ? String(item.paid_on).slice(0, 10) : "",
    receiptOn: item?.receipt_on ? String(item.receipt_on).slice(0, 10) : "", notes: item?.notes || "",
  }));
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    const ok = await attempt(() => (item ? api.updateBeneficiary(matter.id, item.id, f) : api.addBeneficiary(matter.id, f)), onChanged, "Couldn't save that.");
    setBusy(false);
    if (ok) onSaved();
  }
  return (
    <form className="ac-card ac-inline-form" onSubmit={submit}>
      <div className="ac-row2">
        <div className="ac-field"><label>Name</label><input value={f.name} onChange={set("name")} autoFocus /></div>
        <div className="ac-field"><label>Relationship</label><input value={f.relationship} onChange={set("relationship")} placeholder="e.g. Daughter, Charity" /></div>
      </div>
      <div className="ac-row2">
        <div className="ac-field"><label>Gift</label><select value={f.giftType} onChange={set("giftType")}>{GIFT_TYPES.map((g) => <option key={g}>{g}</option>)}</select></div>
        {f.giftType === "Share of residue"
          ? <div className="ac-field"><label>Share of residue (%)</label><input type="number" min="0" max="100" step="0.001" value={f.sharePercent} onChange={set("sharePercent")} /></div>
          : <div className="ac-field"><label>{f.giftType === "Specific gift" ? "Value (£, optional)" : "Amount (£)"}</label><input type="number" min="0" step="0.01" value={f.amount} onChange={set("amount")} /></div>}
      </div>
      {f.giftType === "Specific gift" && <div className="ac-field"><label>What is given</label><input value={f.description} onChange={set("description")} placeholder="e.g. Diamond engagement ring" /></div>}
      <div className="ac-field">
        <label>Exempt from inheritance tax?</label>
        <select value={f.exemption} onChange={set("exemption")}>
          <option value="">No</option><option value="spouse">Yes — spouse or civil partner</option><option value="charity">Yes — charity</option>
        </select>
      </div>
      <div className="ac-row3">
        <div className="ac-field"><label>Paid so far (£)</label><input type="number" min="0" step="0.01" value={f.paidAmount} onChange={set("paidAmount")} /></div>
        <div className="ac-field"><label>Paid on</label><input type="date" value={f.paidOn} onChange={set("paidOn")} /></div>
        <div className="ac-field"><label>Receipt returned</label><input type="date" value={f.receiptOn} onChange={set("receiptOn")} /></div>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button className="ac-addbtn" type="submit" disabled={busy}>{busy ? "Saving…" : item ? "Save" : "Add beneficiary"}</button>
        <button className="ac-tablebtn" type="button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

/* ---------------------------------------------------------------------- */
/* Safe custody                                                           */
/* ---------------------------------------------------------------------- */

const CUSTODY_TYPES = ["Will", "Codicil", "Lasting power of attorney", "Enduring power of attorney", "Trust deed", "Title deeds", "Other deed"];
const defaultDocType = (type) => (type === "Lasting power of attorney" ? "Lasting power of attorney" : type === "Trust" ? "Trust deed" : "Will");

function CustodyForm({ matterId, initial, onCancel, onSaved }) {
  const [f, setF] = useState({ docType: "Will", person: "", documentDate: "", location: "", receivedOn: todayISO(), notes: "", ...initial });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.addSafeCustody({ ...f, matterId: matterId || undefined });
      await onSaved();
    } catch (err) {
      notify(err.message || "Couldn't add that to the register.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="ac-card ac-inline-form" onSubmit={submit}>
      <div className="ac-row2">
        <div className="ac-field"><label>Document</label><select value={f.docType} onChange={set("docType")}>{CUSTODY_TYPES.map((t) => <option key={t}>{t}</option>)}</select></div>
        <div className="ac-field"><label>Whose (testator / donor)</label><input value={f.person} onChange={set("person")} autoFocus /></div>
      </div>
      <div className="ac-row3">
        <div className="ac-field"><label>Dated</label><input type="date" value={f.documentDate} onChange={set("documentDate")} /></div>
        <div className="ac-field"><label>Received into custody</label><input type="date" value={f.receivedOn} onChange={set("receivedOn")} /></div>
        <div className="ac-field"><label>Where it's kept</label><input value={f.location} onChange={set("location")} placeholder="e.g. Strongroom A — packet 1044" /></div>
      </div>
      <div className="ac-field"><label>Notes</label><input value={f.notes} onChange={set("notes")} /></div>
      <div style={{ display: "flex", gap: 8 }}>
        <button className="ac-addbtn" type="submit" disabled={busy}><Lock size={12} /> {busy ? "Saving…" : "Add to the register"}</button>
        <button className="ac-tablebtn" type="button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

function WithdrawForm({ entry, onCancel, onSaved }) {
  const [f, setF] = useState({ withdrawnOn: todayISO(), withdrawnTo: "" });
  const [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.withdrawSafeCustody(entry.id, f);
      await onSaved();
    } catch (err) {
      notify(err.message || "Couldn't record that.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="ac-inline-form" onSubmit={submit} style={{ marginTop: 8 }}>
      <p className="ac-muted small" style={{ marginTop: 0 }}>Only release an original to the person it belongs to, their executors (with a death certificate) or someone with their written authority.</p>
      <div className="ac-row2">
        <div className="ac-field"><label>Released on</label><input type="date" value={f.withdrawnOn} onChange={(e) => setF({ ...f, withdrawnOn: e.target.value })} /></div>
        <div className="ac-field"><label>Released to (and authority)</label><input value={f.withdrawnTo} onChange={(e) => setF({ ...f, withdrawnTo: e.target.value })} placeholder="e.g. Susan Clarke, executor" autoFocus /></div>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button className="ac-addbtn" type="submit" disabled={busy}>{busy ? "Saving…" : "Record release"}</button>
        <button className="ac-tablebtn" type="button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

function CustodyRow({ entry, onChanged, showMatter, onOpenMatter }) {
  const [withdrawing, setWithdrawing] = useState(false);
  const out = !!entry.withdrawn_on;
  return (
    <div className="ac-custody-row" style={out ? { opacity: 0.65 } : {}}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 13 }}>{entry.doc_type} — {entry.person}</div>
          <div className="ac-muted small">
            {entry.document_date ? `Dated ${fmtDate(entry.document_date)} · ` : ""}{entry.location}{!out ? ` · held since ${fmtDate(entry.received_on)}` : ""}
          </div>
          {out && <div className="ac-muted small">Released {fmtDate(entry.withdrawn_on)} to {entry.withdrawn_to}{entry.withdrawn_by_name ? ` (by ${entry.withdrawn_by_name})` : ""}</div>}
          {showMatter && entry.matter_reference && <button className="ac-linkbtn small" onClick={() => onOpenMatter(entry.matter_id)}>{entry.matter_reference} — {entry.matter_description}</button>}
          {entry.notes && <div className="ac-muted small">{entry.notes}</div>}
        </div>
        {!out && !withdrawing && <button className="ac-tablebtn" onClick={() => setWithdrawing(true)}>Release</button>}
        {out && <span className="ac-pill ac-pill--closed">Released</span>}
      </div>
      {withdrawing && <WithdrawForm entry={entry} onCancel={() => setWithdrawing(false)} onSaved={async () => { setWithdrawing(false); await onChanged(); }} />}
    </div>
  );
}

export function SafeCustodyCard({ matter, onChanged }) {
  const [adding, setAdding] = useState(false);
  const entries = matter.safeCustody || [];
  const d = matter.pcDetails || {};
  const person = d.testator || d.donor || d.settlor || d.deceasedName || matter.client;
  return (
    <div className="ac-card">
      <h3><Archive size={12} /> Safe custody</h3>
      {entries.length === 0 && !adding && <p className="ac-muted" style={{ marginTop: 0 }}>No originals from this matter are held.</p>}
      {entries.map((e) => <CustodyRow key={e.id} entry={e} onChanged={onChanged} />)}
      {adding
        ? <CustodyForm matterId={matter.id} initial={{ docType: defaultDocType(matter.type), person, documentDate: d.dateSigned || d.dateOfWill || "" }}
            onCancel={() => setAdding(false)} onSaved={async () => { setAdding(false); await onChanged(); }} />
        : <button className="ac-addbtn" style={{ marginTop: 8 }} onClick={() => setAdding(true)}><Lock size={12} /> Record an original held</button>}
    </div>
  );
}

export function SafeCustodyPanel({ onClose, onOpenMatter }) {
  const [search, setSearch] = useState("");
  const [showReleased, setShowReleased] = useState(false);
  const [rows, setRows] = useState(null);
  const [adding, setAdding] = useState(false);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(() => {
      api.getSafeCustody(search.trim(), showReleased)
        .then((r) => { if (!cancelled) setRows(r.entries); })
        .catch((err) => { if (!cancelled) { setRows([]); notify(err.message || "Couldn't load the register."); } });
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [search, showReleased, reload]);
  const refresh = async () => setReload((n) => n + 1);

  return (
    <div className="ac-overlay" onClick={onClose}>
      <div className="ac-panel wide" onClick={(e) => e.stopPropagation()}>
        <div className="ac-panel-head">
          <h2>Safe custody register</h2>
          <button type="button" className="ac-iconbtn" onClick={onClose}><X size={18} /></button>
        </div>
        <p style={{ fontSize: 12.5, color: "var(--slate)", marginTop: -8 }}>Original wills, powers of attorney and deeds the firm holds. Search by name, packet or matter reference.</p>
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
          <div className="ac-search" style={{ flex: 1, minWidth: 200 }}>
            <Search size={14} />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search the register" aria-label="Search the register" />
          </div>
          <label className="ac-check" style={{ margin: 0 }}><input type="checkbox" checked={showReleased} onChange={(e) => setShowReleased(e.target.checked)} /> Include released</label>
          {!adding && <button className="ac-addbtn" onClick={() => setAdding(true)}><Plus size={13} /> Add</button>}
        </div>
        {adding && <CustodyForm onCancel={() => setAdding(false)} onSaved={async () => { setAdding(false); await refresh(); }} />}
        {rows === null && <p className="ac-muted">Loading…</p>}
        {rows && rows.length === 0 && <p className="ac-muted">{search ? "Nothing matches." : "Nothing held yet."}</p>}
        {rows && rows.map((e) => <CustodyRow key={e.id} entry={e} onChanged={refresh} showMatter onOpenMatter={(id) => { onClose(); onOpenMatter(id); }} />)}
      </div>
    </div>
  );
}

