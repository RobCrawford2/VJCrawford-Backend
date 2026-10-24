import React, { useEffect, useState, useSyncExternalStore } from "react";
import { X, Plus, Clock, Play, Square, Download, FileText, Trash2, Pencil, Send, Ban } from "lucide-react";
import { api } from "./api";
import { notify, confirmAction } from "./notify";

/**
 * Time recording (6-minute units, with a running timer) and billing:
 * drafting bills from unbilled time and disbursements, issuing them with
 * the firm's next bill number, and the Word bill.
 */

export const FUNDING_LABELS = { hourly: "Hourly rate", fixed_fee: "Fixed fee", cfa: "No win, no fee (CFA)", legal_aid: "Legal aid" };
const VAT_RATE = 0.2;
const money = (n) => `£${Number(n || 0).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const todayStr = () => new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" });
const fmtDate = (d) => (d ? new Date(`${String(d).slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "—");
export const unitsText = (units) => {
  const mins = units * 6;
  return mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h${mins % 60 ? ` ${String(mins % 60).padStart(2, "0")}m` : ""}`;
};

/* ---------------------------------------------------------------------- */
/* Timer — one at a time, kept across page reloads                         */
/* ---------------------------------------------------------------------- */

// One running timer per person, so people sharing a computer don't overwrite each other's.
const TIMER_KEY = "vjc-timers";
const listeners = new Set();
function readTimers() {
  try { return JSON.parse(localStorage.getItem(TIMER_KEY) || "{}") || {}; } catch { return {}; }
}
let timers = readTimers();
function saveTimers(next) {
  timers = next;
  try { localStorage.setItem(TIMER_KEY, JSON.stringify(next)); } catch { /* private mode */ }
  listeners.forEach((l) => l());
}
/** This person's running timer, if any. */
export function useTimer(userId) {
  const all = useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => timers);
  return (userId && all[userId]) || null;
}
export const startTimer = (matter, userId) =>
  saveTimers({ ...timers, [userId]: { matterId: matter.id, reference: matter.reference, startedAt: Date.now(), userId } });
export const stopTimer = (userId) => {
  const { [userId]: _gone, ...rest } = timers;
  saveTimers(rest);
};
const elapsedText = (ms) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

/** Top-bar chip while a timer runs: shows the time; Stop opens the record-time form for that matter. */
export function TimerChip({ userId, onStop }) {
  const timer = useTimer(userId);
  const [, tick] = useState(0);
  useEffect(() => {
    if (!timer) return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [timer]);
  if (!timer) return null;
  return (
    <button type="button" className="ac-timerchip" onClick={() => onStop(timer)} title="Stop the timer and record the time">
      <span className="dot" /> {timer.reference} · {elapsedText(Date.now() - timer.startedAt)} <Square size={11} />
    </button>
  );
}

/* ---------------------------------------------------------------------- */
/* Recording time                                                          */
/* ---------------------------------------------------------------------- */

export function TimeEntryForm({ activities, initial, onSave, onCancel }) {
  const [f, setF] = useState({
    workDate: initial?.workDate || todayStr(),
    hours: initial ? Math.floor((initial.minutes || 0) / 60) : 0,
    minutes: initial ? (initial.minutes || 0) % 60 : 6,
    activity: initial?.activity || activities[0],
    description: initial?.description || "",
    billable: initial?.billable !== false,
  });
  const [busy, setBusy] = useState(false);
  const total = Number(f.hours || 0) * 60 + Number(f.minutes || 0);
  const units = Math.ceil(total / 6);
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try { await onSave({ workDate: f.workDate, minutes: total, activity: f.activity, description: f.description, billable: f.billable }); }
    finally { setBusy(false); }
  }
  return (
    <form onSubmit={submit} className="ac-card ac-time-form">
      <div className="ac-time-grid">
        <div className="ac-field"><label>Date</label><input type="date" value={f.workDate} onChange={(e) => setF({ ...f, workDate: e.target.value })} /></div>
        <div className="ac-field"><label>Hours</label><input type="number" min="0" max="24" value={f.hours} onChange={(e) => setF({ ...f, hours: e.target.value })} /></div>
        <div className="ac-field"><label>Minutes</label><input type="number" min="0" max="59" step="1" value={f.minutes} onChange={(e) => setF({ ...f, minutes: e.target.value })} /></div>
        <div className="ac-field">
          <label>Work done</label>
          <select value={f.activity} onChange={(e) => setF({ ...f, activity: e.target.value })}>
            {activities.map((a) => <option key={a}>{a}</option>)}
          </select>
        </div>
      </div>
      <div className="ac-field"><label>Description</label><input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="e.g. Call with client re: disclosure" /></div>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <label className="ac-dept-tick"><input type="checkbox" checked={f.billable} onChange={(e) => setF({ ...f, billable: e.target.checked })} /> Chargeable to the client</label>
        <span style={{ fontSize: 12, color: "var(--slate)" }}>{units > 0 ? `${units} unit${units === 1 ? "" : "s"} of 6 minutes (${unitsText(units)})` : ""}</span>
        <span style={{ flex: 1 }} />
        <button type="button" className="ac-tablebtn" onClick={onCancel}>Cancel</button>
        <button type="submit" className="ac-tablebtn primary" disabled={busy || units < 1}>Save time</button>
      </div>
    </form>
  );
}

/** Modal for recording time when the timer is stopped. */
export function RecordTimerModal({ timer, onClose, onSaved }) {
  const [activities, setActivities] = useState(null);
  useEffect(() => { api.getBilling(timer.matterId).then((b) => setActivities(b.activities)).catch((err) => { notify(err.message); onClose(); }); }, [timer.matterId]);
  const minutes = Math.max(1, Math.round((Date.now() - timer.startedAt) / 60000));
  async function save(entry) {
    try {
      await api.addTime(timer.matterId, entry);
      stopTimer(timer.userId);
      notify("Time recorded.", "success");
      onSaved?.(timer.matterId);
      onClose();
    } catch (err) { notify(err.message || "Couldn't save the time."); }
  }
  return (
    <div className="ac-overlay center" onClick={onClose}>
      <div className="ac-modal" onClick={(e) => e.stopPropagation()} style={{ width: 620 }}>
        <h3 style={{ marginTop: 0 }}><Clock size={14} /> Record time — {timer.reference}</h3>
        {activities
          ? <TimeEntryForm activities={activities} initial={{ minutes }} onSave={save} onCancel={onClose} />
          : <p style={{ fontSize: 13 }}>Loading…</p>}
        <button type="button" className="ac-linkbtn small" onClick={async () => {
          if (await confirmAction("Discard the timer without recording any time?", { confirmLabel: "Discard", danger: true })) { stopTimer(timer.userId); onClose(); }
        }}>Discard the timer</button>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Bills                                                                   */
/* ---------------------------------------------------------------------- */

function DraftBillForm({ matter, entries, onCancel, onCreated }) {
  const unbilled = entries.filter((e) => !e.bill_id && e.billable);
  const [chosen, setChosen] = useState(unbilled.map((e) => e.id));
  const fixed = matter.funding === "fixed_fee";
  const [useOverride, setUseOverride] = useState(fixed);
  const [override, setOverride] = useState(fixed && matter.feeEstimate !== "" ? String(matter.feeEstimate) : "");
  const [disb, setDisb] = useState([]);
  const [narrative, setNarrative] = useState("");
  const [busy, setBusy] = useState(false);

  const timeValue = unbilled.filter((e) => chosen.includes(e.id)).reduce((t, e) => t + Number(e.amount), 0);
  const profit = useOverride && override !== "" ? Number(override) : timeValue;
  const disbTotal = disb.reduce((t, d) => t + (Number(d.amount) || 0), 0);
  const vat = Math.round((profit + disb.filter((d) => d.vat).reduce((t, d) => t + (Number(d.amount) || 0), 0)) * VAT_RATE * 100) / 100;
  const toggle = (id) => setChosen((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.createBill(matter.id, {
        timeEntryIds: chosen,
        profitCosts: useOverride && override !== "" ? Number(override) : undefined,
        disbursements: disb.filter((d) => d.description.trim()).map((d) => ({ ...d, amount: Number(d.amount) || 0 })),
        narrative,
      });
      notify("Draft bill prepared.", "success");
      await onCreated();
    } catch (err) { notify(err.message || "Couldn't prepare the bill."); }
    finally { setBusy(false); }
  }

  return (
    <form onSubmit={submit} className="ac-card">
      <h3>Draft a bill</h3>
      {unbilled.length > 0 && (
        <>
          <div className="ac-fieldset-title" style={{ marginTop: 0 }}>Unbilled time</div>
          {unbilled.map((e) => (
            <label key={e.id} className="ac-bill-entry">
              <input type="checkbox" checked={chosen.includes(e.id)} onChange={() => toggle(e.id)} />
              <span className="d">{fmtDate(e.work_date)}</span>
              <span className="w">{e.activity}{e.description ? ` — ${e.description}` : ""} <em>({e.user_name})</em></span>
              <span className="t">{unitsText(e.units)}</span>
              <span className="a">{money(e.amount)}</span>
            </label>
          ))}
        </>
      )}
      <label className="ac-dept-tick" style={{ margin: "10px 0 6px" }}>
        <input type="checkbox" checked={useOverride} onChange={(e) => setUseOverride(e.target.checked)} />
        {fixed ? "Bill the fixed fee" : "Bill a different amount from the time recorded (e.g. write-down or agreed fee)"}
      </label>
      {useOverride && (
        <div className="ac-field" style={{ maxWidth: 220 }}>
          <label>Our charges, before VAT (£)</label>
          <input type="number" min="0" step="0.01" value={override} onChange={(e) => setOverride(e.target.value)} />
        </div>
      )}
      <div className="ac-fieldset-title">Disbursements</div>
      {disb.map((d, i) => (
        <div key={i} className="ac-cost-row">
          <input value={d.description} placeholder="e.g. Court fee" onChange={(e) => setDisb(disb.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))} />
          <input type="number" min="0" step="0.01" value={d.amount} placeholder="£" onChange={(e) => setDisb(disb.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} />
          <label className="ac-cost-vat"><input type="checkbox" checked={d.vat} onChange={(e) => setDisb(disb.map((x, j) => (j === i ? { ...x, vat: e.target.checked } : x)))} /> VAT</label>
          <button type="button" className="ac-iconbtn" onClick={() => setDisb(disb.filter((_, j) => j !== i))} aria-label="Remove"><Trash2 size={14} /></button>
        </div>
      ))}
      <button type="button" className="ac-tablebtn" onClick={() => setDisb([...disb, { description: "", amount: "", vat: false }])}><Plus size={12} /> Add a disbursement</button>
      <div className="ac-field" style={{ marginTop: 10 }}>
        <label>Narrative (what the bill is for)</label>
        <textarea value={narrative} onChange={(e) => setNarrative(e.target.value)} style={{ minHeight: 60 }} placeholder="For our professional charges in connection with…" />
      </div>
      <div className="ac-bill-totals">
        <span>Charges {money(profit)}</span><span>Disbursements {money(disbTotal)}</span><span>VAT {money(vat)}</span>
        <strong>Total {money(profit + disbTotal + vat)}</strong>
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <button type="submit" className="ac-tablebtn primary" disabled={busy}>Prepare draft</button>
        <button type="button" className="ac-tablebtn" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

const BILL_STATUS = { draft: "Draft", issued: "Issued", cancelled: "Cancelled" };

/* ---------------------------------------------------------------------- */
/* The tab                                                                 */
/* ---------------------------------------------------------------------- */

export function TimeTab({ matter, currentUserId, onChanged, onEditBilling }) {
  const [data, setData] = useState(null);
  const [recording, setRecording] = useState(false);
  const [editing, setEditing] = useState(null);
  const [drafting, setDrafting] = useState(false);
  const [cancelling, setCancelling] = useState(null); // { id, reason }
  const timer = useTimer(currentUserId);
  const load = () => api.getBilling(matter.id).then(setData).catch((err) => notify(err.message));
  useEffect(() => { load(); }, [matter.id, matter.billing?.costsToDate, matter.billing?.unbilledUnits]);

  async function refresh() { await load(); await onChanged(); }
  async function addTime(entry) {
    try { await api.addTime(matter.id, entry); setRecording(false); await refresh(); notify("Time recorded.", "success"); }
    catch (err) { notify(err.message || "Couldn't save the time."); }
  }
  async function saveEdit(e, entry) {
    try { await api.updateTime(matter.id, e.id, entry); setEditing(null); await refresh(); }
    catch (err) { notify(err.message || "Couldn't save the time."); }
  }
  async function removeEntry(e) {
    if (!(await confirmAction(`Delete ${unitsText(e.units)} of time (${e.activity})?`, { confirmLabel: "Delete", danger: true }))) return;
    try { await api.deleteItem(matter.id, "time", e.id); await refresh(); }
    catch (err) { notify(err.message || "Couldn't delete it."); }
  }
  async function billAction(b, action) {
    try {
      if (action === "issue") {
        if (!(await confirmAction(`Issue this bill for ${money(b.total)}? It gets the next bill number and can't then be edited.`, { confirmLabel: "Issue bill" }))) return;
        await api.issueBill(matter.id, b.id);
      } else if (action === "delete") {
        if (!(await confirmAction("Delete this draft bill? Its time goes back to unbilled.", { confirmLabel: "Delete", danger: true }))) return;
        await api.deleteItem(matter.id, "bills", b.id);
      } else if (action === "cancel") {
        await api.cancelBill(matter.id, b.id, cancelling.reason.trim());
        setCancelling(null);
      } else if (action === "download") {
        const blob = await api.getBillDocument(matter.id, b.id);
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${b.bill_number ? `Bill ${b.bill_number}` : "Draft bill"} - ${matter.reference}.docx`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
        return;
      }
      await refresh();
    } catch (err) { notify(err.message || "Couldn't do that."); }
  }

  if (!data) return <div className="ac-detail-body"><p style={{ color: "var(--slate)" }}>Loading…</p></div>;
  const s = data.summary;
  const pct = s.percentOfEstimate;
  const timingThis = timer && timer.matterId === matter.id;

  return (
    <div className="ac-detail-body" style={{ gridTemplateColumns: "1fr" }}>
      <div className="ac-col-main">
        <div className="ac-section-head">
          <h2>Time &amp; billing</h2>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {timingThis
              ? <span className="ac-timer-note">Timer running — stop it from the top bar</span>
              : <button className="ac-addbtn" onClick={() => startTimer(matter, currentUserId)} disabled={!!timer} title={timer ? `A timer is already running on ${timer.reference}` : "Start a timer"}><Play size={13} /> Start timer</button>}
            <button className="ac-addbtn" onClick={() => { setRecording(true); setEditing(null); }}><Plus size={13} /> Record time</button>
            <button className="ac-addbtn" style={{ background: "var(--brass)" }} onClick={() => setDrafting(true)}><FileText size={13} /> Draft a bill</button>
          </div>
        </div>

        <div className="ac-card ac-billing-summary">
          <div><span className="k">Funding</span><span className="v">{FUNDING_LABELS[s.funding]}</span></div>
          <div><span className="k">{s.funding === "fixed_fee" ? "Fixed fee" : "Estimate given"}</span><span className="v">{s.estimate === null ? "—" : money(s.estimate)}</span></div>
          <div><span className="k">Unbilled time</span><span className="v">{money(s.unbilledValue)} <small>({unitsText(s.unbilledUnits || 0)})</small></span></div>
          <div><span className="k">Billed so far</span><span className="v">{money(s.billedCosts)}</span></div>
          <button type="button" className="ac-card-edit" onClick={onEditBilling}><Pencil size={11} /> Edit</button>
          {pct !== null && (
            <div className="ac-estimate-bar" title={`${pct}% of the estimate`}>
              <div className={pct >= 100 ? "over" : pct >= 75 ? "near" : ""} style={{ width: `${Math.min(pct, 100)}%` }} />
              <span>{money(s.costsToDate)} of {money(s.estimate)} ({pct}%)</span>
            </div>
          )}
        </div>

        {recording && <TimeEntryForm activities={data.activities} onSave={addTime} onCancel={() => setRecording(false)} />}
        {drafting && <DraftBillForm matter={matter} entries={data.entries} onCancel={() => setDrafting(false)} onCreated={async () => { setDrafting(false); await refresh(); }} />}

        {data.bills.length > 0 && (
          <div className="ac-card">
            <h3>Bills</h3>
            {data.bills.map((b) => (
              <div key={b.id} className={`ac-bill-row ${b.status}`}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <strong>{b.bill_number ? `Bill ${b.bill_number}` : "Draft bill"}</strong> · {money(b.total)}
                  <span className={`ac-pill ${b.status === "issued" ? "ac-pill--closed" : b.status === "draft" ? "ac-pill--progress" : "ac-pill--setup"}`} style={{ marginLeft: 8 }}>{BILL_STATUS[b.status]}</span>
                  <div className="meta">
                    {b.status === "issued" ? `Issued ${fmtDate(b.bill_date)}${b.issued_by_name ? ` by ${b.issued_by_name}` : ""} · ` : ""}
                    Charges {money(b.profit_costs)} · VAT {money(b.vat)}{b.cancelled_reason ? ` · Cancelled: ${b.cancelled_reason}` : ""}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                  <button type="button" className="ac-tablebtn" onClick={() => billAction(b, "download")}><Download size={12} /> Word</button>
                  {b.status === "draft" && data.canManage && <button type="button" className="ac-tablebtn primary" onClick={() => billAction(b, "issue")}><Send size={12} /> Issue</button>}
                  {b.status === "draft" && <button type="button" className="ac-iconbtn" onClick={() => billAction(b, "delete")} aria-label="Delete draft"><Trash2 size={13} /></button>}
                  {b.status === "issued" && data.canManage && cancelling?.id !== b.id && <button type="button" className="ac-tablebtn" onClick={() => setCancelling({ id: b.id, reason: "" })}><Ban size={12} /> Cancel</button>}
                </div>
                {cancelling?.id === b.id && (
                  <div className="ac-bill-cancel">
                    <input value={cancelling.reason} onChange={(e) => setCancelling({ ...cancelling, reason: e.target.value })} placeholder={`Why is bill ${b.bill_number} being cancelled?`} autoFocus />
                    <button type="button" className="ac-tablebtn danger" disabled={!cancelling.reason.trim()} onClick={() => billAction(b, "cancel")}>Cancel bill</button>
                    <button type="button" className="ac-tablebtn" onClick={() => setCancelling(null)}>Keep it</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="ac-card">
          <h3>Time recorded</h3>
          {data.entries.length === 0 && <p style={{ fontSize: 13, color: "var(--slate)", margin: 0 }}>No time recorded yet.</p>}
          {data.entries.map((e) => (
            editing === e.id
              ? <TimeEntryForm key={e.id} activities={data.activities}
                  initial={{ workDate: e.work_date, minutes: e.units * 6, activity: e.activity, description: e.description, billable: e.billable }}
                  onSave={(entry) => saveEdit(e, entry)} onCancel={() => setEditing(null)} />
              : (
                <div key={e.id} className={`ac-time-row ${e.billable ? "" : "nb"}`}>
                  <span className="d">{fmtDate(e.work_date)}</span>
                  <span className="w">
                    <strong>{e.activity}</strong>{e.description ? ` — ${e.description}` : ""}
                    <span className="meta">{e.user_name}{e.billable ? "" : " · not chargeable"}{e.bill_id ? ` · ${e.bill_number ? `on bill ${e.bill_number}` : "on a draft bill"}` : ""}</span>
                  </span>
                  <span className="t">{unitsText(e.units)}</span>
                  <span className="a">{money(e.amount)}</span>
                  <span className="x">
                    {!e.bill_id && (e.user_id === currentUserId || data.canManage) && (
                      <>
                        <button type="button" className="ac-iconbtn" onClick={() => { setEditing(e.id); setRecording(false); }} aria-label="Edit"><Pencil size={12} /></button>
                        <button type="button" className="ac-iconbtn" onClick={() => removeEntry(e)} aria-label="Delete"><Trash2 size={12} /></button>
                      </>
                    )}
                  </span>
                </div>
              )
          ))}
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Timesheet                                                               */
/* ---------------------------------------------------------------------- */

function mondayOf(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

export function TimesheetPanel({ onClose, onOpenMatter, hourlyRate }) {
  const [range, setRange] = useState("today");
  const [data, setData] = useState(null);
  useEffect(() => {
    const to = todayStr();
    const from = range === "today" ? to : range === "week" ? mondayOf(to) : `${to.slice(0, 7)}-01`;
    api.getTimesheet(from, to).then(setData).catch((err) => notify(err.message));
  }, [range]);
  return (
    <div className="ac-overlay" onClick={onClose}>
      <div className="ac-panel wide" onClick={(e) => e.stopPropagation()}>
        <div className="ac-panel-head">
          <h2><Clock size={16} /> My time</h2>
          <button type="button" className="ac-iconbtn" onClick={onClose}><X size={18} /></button>
        </div>
        <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
          {[["today", "Today"], ["week", "This week"], ["month", "This month"]].map(([k, l]) => (
            <button key={k} className={`ac-chip ${range === k ? "active" : ""}`} onClick={() => setRange(k)}>{l}</button>
          ))}
          <span style={{ fontSize: 12, color: "var(--slate)", marginLeft: "auto" }}>Your rate: {hourlyRate ? `${money(hourlyRate)} an hour` : "not set — ask an admin"}</span>
        </div>
        {data && (
          <>
            <div className="ac-card ac-billing-summary">
              <div><span className="k">Recorded</span><span className="v">{unitsText(data.totals.units)}</span></div>
              <div><span className="k">Chargeable</span><span className="v">{unitsText(data.totals.billableUnits)}</span></div>
              <div><span className="k">Value</span><span className="v">{money(data.totals.value)}</span></div>
            </div>
            {data.entries.length === 0 && <p style={{ fontSize: 13, color: "var(--slate)" }}>No time recorded.</p>}
            {data.entries.map((e) => (
              <div key={e.id} className={`ac-time-row ${e.billable ? "" : "nb"}`}>
                <span className="d">{fmtDate(e.work_date)}</span>
                <span className="w">
                  {e.matter_id
                    ? <button type="button" className="ac-linkbtn" style={{ fontSize: 12.5 }} onClick={() => { onOpenMatter(e.matter_id); onClose(); }}>{e.reference}</button>
                    : <span style={{ color: "var(--slate)" }}>{e.reference}</span>}
                  {" "}— {e.activity}{e.description ? `: ${e.description}` : ""}
                  <span className="meta">{e.address}</span>
                </span>
                <span className="t">{unitsText(e.units)}</span>
                <span className="a">{money(e.amount)}</span>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
