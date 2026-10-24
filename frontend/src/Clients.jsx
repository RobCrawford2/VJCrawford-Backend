import React, { useEffect, useState } from "react";
import { X, Search, Plus, ShieldCheck, AlertTriangle, CheckCircle2, Users, ChevronRight, Trash2, UserPlus } from "lucide-react";
import { api } from "./api";
import { adaptClient } from "./adapters";
import { notify, confirmAction } from "./notify";
import { partyRoles } from "./areas";

/**
 * Client register, client records (ID / AML checks) and conflict checks.
 * Matters in departments the user can't see come back from the server as
 * { hidden, departmentName } and are shown that way — never their details.
 */

const fmtDate = (d) => (d ? new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—");

export const ID_METHODS = ["Passport", "Driving licence", "Electronic ID check", "Certified copies", "In person — other ID", "Company search (Companies House)"];
const RISK_LABELS = { low: "Low risk", medium: "Medium risk", high: "High risk" };

/* ---------------------------------------------------------------------- */
/* Conflict check                                                          */
/* ---------------------------------------------------------------------- */

function MatterLine({ m, onOpenMatter }) {
  if (m.hidden) {
    return <div className="ac-conflict-matter hidden">A matter in the <strong>{m.departmentName}</strong> department — speak to them before going further</div>;
  }
  return (
    <div className="ac-conflict-matter">
      {onOpenMatter ? <button type="button" className="ac-linkbtn" onClick={() => onOpenMatter(m.id)}>{m.reference}</button> : <strong>{m.reference}</strong>}
      {" "}— {m.address} <span className="dept">({m.departmentName}{m.type ? ` · ${m.type}` : ""})</span>
    </div>
  );
}

/** Results of a conflict check: one block per name checked. */
export function ConflictResults({ results, onOpenMatter }) {
  return (
    <div className="ac-conflicts">
      {results.map((r) => (
        <div key={r.name} className={`ac-conflict ${r.matches.length ? "hit" : "clear"}`}>
          <div className="head">
            {r.matches.length ? <AlertTriangle size={13} /> : <CheckCircle2 size={13} />}
            <strong>{r.name}</strong> — {r.matches.length ? `${r.matches.length} possible match${r.matches.length === 1 ? "" : "es"}` : "no matches"}
          </div>
          {r.matches.map((m, i) => (
            <div key={i} className="ac-conflict-match">
              <div>{m.kind === "client" ? <>Existing client: <strong>{m.name}</strong></> : <>Named as <strong>{m.role}</strong>: <strong>{m.name}</strong></>}</div>
              {m.matters.length === 0 && <div className="ac-conflict-matter">No matters yet</div>}
              {m.matters.map((mm, j) => <MatterLine key={j} m={mm} onOpenMatter={onOpenMatter} />)}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * The conflict-check step of opening a matter. `names` are everyone to
 * check; the check has to be re-run whenever they change.
 */
export function ConflictCheckStep({ names, excludeClientIds = [], value, onChange }) {
  const [busy, setBusy] = useState(false);
  const signature = JSON.stringify([names, excludeClientIds]);
  const current = value && value.signature === signature ? value : null;
  const matchCount = current ? current.results.reduce((n, r) => n + r.matches.length, 0) : 0;

  async function run() {
    if (!names.some((n) => n.trim())) return notify("Enter the client's name first.");
    setBusy(true);
    try {
      const { results } = await api.conflictCheck(names.filter((n) => n.trim()), { excludeClientIds });
      onChange({ signature, results, note: value?.note || "" });
    } catch (err) {
      notify(err.message || "Couldn't run the conflict check.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ac-conflict-step">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
        <div style={{ fontSize: 12.5, color: "var(--ink-soft)" }}>
          Checks the client and every other party against the whole firm's clients and parties.
        </div>
        <button type="button" className="ac-tablebtn primary" onClick={run} disabled={busy}><Search size={12} /> {busy ? "Checking…" : current ? "Run again" : "Run conflict check"}</button>
      </div>
      {value && !current && <div className="ac-doc-gaps" style={{ marginTop: 6 }}>Names have changed since the last check — run it again.</div>}
      {current && <ConflictResults results={current.results} />}
      {current && matchCount > 0 && (
        <div className="ac-field" style={{ marginTop: 10, marginBottom: 0 }}>
          <label>Why isn't this a conflict? (required)</label>
          <textarea value={value.note} onChange={(e) => onChange({ ...value, note: e.target.value })} style={{ minHeight: 60 }}
            placeholder="e.g. Different person — checked address and date of birth with the Family team" />
        </div>
      )}
    </div>
  );
}

/** Is the conflict step complete for these names? Returns an error message or null. */
export function conflictStepProblem(value, names, excludeClientIds = []) {
  const signature = JSON.stringify([names, excludeClientIds]);
  if (!value || value.signature !== signature) return "Run the conflict check before opening the matter.";
  const matches = value.results.reduce((n, r) => n + r.matches.length, 0);
  if (matches && !value.note.trim()) return "The conflict check found possible matches — note why there's no conflict.";
  return null;
}

/* ---------------------------------------------------------------------- */
/* Client search                                                           */
/* ---------------------------------------------------------------------- */

/** Type-ahead search of the client register. */
export function ClientSearch({ onPick, placeholder = "Search existing clients by name, email or company number…" }) {
  const [term, setTerm] = useState("");
  const [results, setResults] = useState([]);
  useEffect(() => {
    if (term.trim().length < 2) { setResults([]); return; }
    const t = setTimeout(() => api.getClients(term.trim()).then((rows) => setResults(rows.map(adaptClient))).catch(() => {}), 250);
    return () => clearTimeout(t);
  }, [term]);
  return (
    <div className="ac-client-search">
      <div className="ac-search" style={{ marginBottom: 0 }}>
        <Search size={14} color="var(--slate-light)" />
        <input value={term} onChange={(e) => setTerm(e.target.value)} placeholder={placeholder} />
      </div>
      {results.length > 0 && (
        <div className="ac-client-results">
          {results.map((c) => (
            <button key={c.id} type="button" onClick={() => { onPick(c); setTerm(""); setResults([]); }}>
              <strong>{c.name}</strong>
              <span>{[c.email, c.address?.split("\n")[0], `${c.matterCount} matter${c.matterCount === 1 ? "" : "s"}`].filter(Boolean).join(" · ")}</span>
            </button>
          ))}
        </div>
      )}
      {term.trim().length >= 2 && results.length === 0 && <div className="ac-client-none">No matching client you can see — they'll be added as a new client.</div>}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* ID / AML check                                                          */
/* ---------------------------------------------------------------------- */

export function IdCheckForm({ client, onClose, onSaved }) {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" });
  const [f, setF] = useState({ verifiedOn: client.idVerifiedOn || today, method: client.idMethod || ID_METHODS[0], riskLevel: client.riskLevel || "low" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function save(e) {
    e.preventDefault();
    setBusy(true); setError("");
    try { await api.recordIdCheck(client.id, f); await onSaved(); onClose(); notify(`ID check recorded for ${client.name}.`, "success"); }
    catch (err) { setError(err.message || "Couldn't save."); }
    finally { setBusy(false); }
  }
  return (
    <div className="ac-overlay center" onClick={onClose}>
      <form className="ac-modal" onClick={(e) => e.stopPropagation()} onSubmit={save} style={{ width: 440 }}>
        <h3 style={{ marginTop: 0 }}><ShieldCheck size={14} /> ID &amp; AML check — {client.name}</h3>
        <div className="ac-row2">
          <div className="ac-field"><label>Date checked</label><input type="date" value={f.verifiedOn} onChange={(e) => setF({ ...f, verifiedOn: e.target.value })} /></div>
          <div className="ac-field">
            <label>Risk level</label>
            <select value={f.riskLevel} onChange={(e) => setF({ ...f, riskLevel: e.target.value })}>
              {Object.entries(RISK_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </div>
        </div>
        <div className="ac-field">
          <label>How was ID checked?</label>
          <select value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}>
            {ID_METHODS.map((m) => <option key={m}>{m}</option>)}
          </select>
        </div>
        {error && <p style={{ color: "var(--danger)", fontSize: 12.5 }}>{error}</p>}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button type="button" className="ac-tablebtn" onClick={onClose}>Cancel</button>
          <button type="submit" className="ac-tablebtn primary" disabled={busy}>Save check</button>
        </div>
      </form>
    </div>
  );
}

function IdStatus({ client }) {
  return client.idVerifiedOn
    ? <span className="ac-idstatus ok"><ShieldCheck size={12} /> ID checked {fmtDate(client.idVerifiedOn)}{client.riskLevel ? ` · ${RISK_LABELS[client.riskLevel]}` : ""}</span>
    : <span className="ac-idstatus no"><AlertTriangle size={12} /> ID not checked</span>;
}

/* ---------------------------------------------------------------------- */
/* On the matter                                                           */
/* ---------------------------------------------------------------------- */

/** The matter's client records: ID status, open the record, add / remove clients. */
export function MatterClientsCard({ matter, users, onChanged, onOpenClient }) {
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [lastCheck, setLastCheck] = useState(null);
  const [idFor, setIdFor] = useState(null);
  const checkedBy = matter.conflictCheck && users.find((u) => u.id === matter.conflictCheck.byId)?.name;

  async function add(payload) {
    try {
      const res = await api.addMatterClient(matter.id, payload);
      setLastCheck(res.conflicts);
      setAdding(false); setNewName("");
      await onChanged();
    } catch (err) { notify(err.message || "Couldn't add the client."); }
  }
  async function remove(c) {
    if (!(await confirmAction(`Remove ${c.name} from this matter? Their client record stays in the register.`, { confirmLabel: "Remove" }))) return;
    try { await api.removeMatterClient(matter.id, c.id); await onChanged(); }
    catch (err) { notify(err.message || "Couldn't remove the client."); }
  }

  return (
    <div className="ac-card" id="client-records">
      <h3><Users size={12} /> Client records &amp; ID</h3>
      {matter.clients.length === 0 && <div style={{ fontSize: 12.5, color: "var(--slate)" }}>No client record linked.</div>}
      {matter.clients.map((c) => (
        <div key={c.id} className="ac-client-row">
          <div style={{ minWidth: 0 }}>
            <button type="button" className="ac-linkbtn" onClick={() => onOpenClient(c.id)}>{c.name} <ChevronRight size={12} style={{ verticalAlign: -2 }} /></button>
            <div><IdStatus client={c} /></div>
          </div>
          <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
            <button type="button" className="ac-tablebtn" onClick={() => setIdFor(c)}><ShieldCheck size={12} /> {c.idVerifiedOn ? "Update ID check" : "Record ID check"}</button>
            {matter.clients.length > 1 && <button type="button" className="ac-iconbtn" onClick={() => remove(c)} aria-label={`Remove ${c.name}`}><Trash2 size={13} /></button>}
          </div>
        </div>
      ))}
      <div className="ac-conflict-done">
        {matter.conflictCheck
          ? <>Conflict check by {checkedBy || "—"} on {fmtDate(matter.conflictCheck.at)}{matter.conflictCheck.note ? ` — “${matter.conflictCheck.note}”` : " — no matches"}</>
          : "No conflict check recorded when this matter was opened."}
      </div>
      {adding ? (
        <div style={{ marginTop: 10 }}>
          <ClientSearch onPick={(c) => add({ clientId: c.id })} />
          <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
            <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="…or a new client's full name" style={{ flex: 1 }} />
            <button type="button" className="ac-tablebtn primary" disabled={!newName.trim()} onClick={() => add({ newClient: { name: newName.trim() } })}>Add new</button>
            <button type="button" className="ac-tablebtn" onClick={() => setAdding(false)}>Cancel</button>
          </div>
        </div>
      ) : (
        <button type="button" className="ac-tablebtn" style={{ marginTop: 10 }} onClick={() => setAdding(true)}><UserPlus size={12} /> Add a client (e.g. joint client)</button>
      )}
      {lastCheck && (
        <div style={{ marginTop: 10 }}>
          <ConflictResults results={lastCheck} />
          <button type="button" className="ac-tablebtn" style={{ marginTop: 6 }} onClick={() => setLastCheck(null)}>Dismiss</button>
        </div>
      )}
      {idFor && <IdCheckForm client={idFor} onClose={() => setIdFor(null)} onSaved={onChanged} />}
    </div>
  );
}

/** Everyone else on the matter (other side, opponents, the deceased…) — each is conflict-checked when added. */
export function PartiesCard({ matter, onChanged, onDelete }) {
  const roles = partyRoles(matter.department);
  const [f, setF] = useState({ name: "", role: roles[0] });
  const [busy, setBusy] = useState(false);
  const [lastCheck, setLastCheck] = useState(null);
  async function add(e) {
    e.preventDefault();
    if (!f.name.trim()) return;
    setBusy(true);
    try {
      const res = await api.addParty(matter.id, f);
      setLastCheck(res.conflicts);
      setF({ name: "", role: f.role });
      await onChanged();
    } catch (err) { notify(err.message || "Couldn't add the party."); }
    finally { setBusy(false); }
  }
  return (
    <div className="ac-card">
      <h3><Users size={12} /> Other parties</h3>
      {matter.otherParties.length === 0 && <div style={{ fontSize: 12.5, color: "var(--slate)", marginBottom: 6 }}>None recorded. Add everyone else involved so conflict checks can find them.</div>}
      {matter.otherParties.map((p) => (
        <div key={p.id} className="ac-kv">
          <span className="k">{p.role}</span>
          <span className="v" style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {p.name}
            <button type="button" className="ac-iconbtn" onClick={() => onDelete(p)} aria-label={`Remove ${p.name}`}><Trash2 size={12} /></button>
          </span>
        </div>
      ))}
      <form onSubmit={add} style={{ display: "flex", gap: 6, marginTop: 10 }}>
        <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Name" style={{ flex: 1, minWidth: 0 }} />
        <select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })} style={{ maxWidth: 170 }}>
          {roles.map((r) => <option key={r}>{r}</option>)}
        </select>
        <button type="submit" className="ac-tablebtn primary" disabled={busy || !f.name.trim()}><Plus size={12} /> Add</button>
      </form>
      {lastCheck && (
        <div style={{ marginTop: 10 }}>
          <ConflictResults results={lastCheck} />
          <button type="button" className="ac-tablebtn" style={{ marginTop: 6 }} onClick={() => setLastCheck(null)}>Dismiss</button>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Client register                                                         */
/* ---------------------------------------------------------------------- */

const CLIENT_FIELDS = [
  ["name", "Full name / organisation name"], ["email", "Email"], ["phone", "Phone"], ["salutation", "Letters start “Dear …”"],
  ["dateOfBirth", "Date of birth", "date"], ["companyNumber", "Company number"],
];

function ClientDetail({ clientId, onBack, onOpenMatter, onChanged }) {
  const [client, setClient] = useState(null);
  const [editing, setEditing] = useState(false);
  const [f, setF] = useState(null);
  const [idCheck, setIdCheck] = useState(false);
  const load = () => api.getClient(clientId).then((c) => setClient(adaptClient(c))).catch((err) => notify(err.message));
  const reloadAll = async () => { await load(); onChanged?.(); }; // the open matter's ID warning may change
  useEffect(() => { load(); }, [clientId]);
  if (!client) return <p style={{ fontSize: 13, color: "var(--slate)" }}>Loading…</p>;

  async function save(e) {
    e.preventDefault();
    try { await api.updateClient(client.id, f); setEditing(false); await reloadAll(); notify("Client record saved.", "success"); }
    catch (err) { notify(err.message || "Couldn't save."); }
  }

  return (
    <div>
      <button type="button" className="ac-hidelist" onClick={onBack}>← All clients</button>
      <h2 style={{ margin: "0 0 4px" }}>{client.name}</h2>
      <div style={{ marginBottom: 12 }}><IdStatus client={client} />{client.idMethod && <span style={{ fontSize: 12, color: "var(--slate)" }}> · {client.idMethod}{client.idVerifiedByName ? ` · by ${client.idVerifiedByName}` : ""}</span>}</div>
      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        <button type="button" className="ac-tablebtn" onClick={() => { setF({ name: client.name, email: client.email, phone: client.phone, salutation: client.salutation, dateOfBirth: client.dateOfBirth, companyNumber: client.companyNumber, address: client.address, notes: client.notes }); setEditing(true); }}>Edit details</button>
        <button type="button" className="ac-tablebtn primary" onClick={() => setIdCheck(true)}><ShieldCheck size={12} /> {client.idVerifiedOn ? "Update ID check" : "Record ID check"}</button>
      </div>
      {editing ? (
        <form onSubmit={save} className="ac-card">
          <div className="ac-row2">
            {CLIENT_FIELDS.map(([k, label, type]) => (
              <div key={k} className="ac-field"><label>{label}</label><input type={type || "text"} value={f[k] || ""} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></div>
            ))}
          </div>
          <div className="ac-field"><label>Address</label><textarea value={f.address || ""} onChange={(e) => setF({ ...f, address: e.target.value })} style={{ minHeight: 60 }} /></div>
          <div className="ac-field"><label>Notes</label><textarea value={f.notes || ""} onChange={(e) => setF({ ...f, notes: e.target.value })} style={{ minHeight: 60 }} /></div>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="submit" className="ac-tablebtn primary">Save</button>
            <button type="button" className="ac-tablebtn" onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </form>
      ) : (
        <div className="ac-card">
          {CLIENT_FIELDS.slice(1).map(([k, label]) => client[k] ? <div key={k} className="ac-kv"><span className="k">{label}</span><span className="v">{k === "dateOfBirth" ? fmtDate(client[k]) : client[k]}</span></div> : null)}
          <div className="ac-kv"><span className="k">Address</span><span className="v" style={{ whiteSpace: "pre-line", textAlign: "right" }}>{client.address || "—"}</span></div>
          {client.notes && <div className="ac-kv"><span className="k">Notes</span><span className="v" style={{ whiteSpace: "pre-line", textAlign: "right" }}>{client.notes}</span></div>}
        </div>
      )}
      <div className="ac-card">
        <h3>Matters</h3>
        {(client.matters || []).length === 0 && <div style={{ fontSize: 12.5, color: "var(--slate)" }}>No matters yet.</div>}
        {(client.matters || []).map((m, i) => (
          <MatterLine key={i} m={m.hidden ? m : { ...m, departmentName: m.departmentName }} onOpenMatter={onOpenMatter} />
        ))}
      </div>
      {idCheck && <IdCheckForm client={client} onClose={() => setIdCheck(false)} onSaved={reloadAll} />}
    </div>
  );
}

/** Top-bar panel: search the client register, open a client, run a stand-alone conflict check. */
export function ClientsPanel({ onClose, onOpenMatter, onChanged, initialClientId = null }) {
  const [openId, setOpenId] = useState(initialClientId);
  const [term, setTerm] = useState("");
  const [rows, setRows] = useState([]);
  const [checkNames, setCheckNames] = useState("");
  const [check, setCheck] = useState(null);

  useEffect(() => {
    const t = setTimeout(() => api.getClients(term.trim()).then((r) => setRows(r.map(adaptClient))).catch(() => {}), 250);
    return () => clearTimeout(t);
  }, [term]);

  async function runCheck(e) {
    e.preventDefault();
    const names = checkNames.split(/\n|;/).map((n) => n.trim()).filter(Boolean);
    if (!names.length) return;
    try { setCheck((await api.conflictCheck(names)).results); }
    catch (err) { notify(err.message || "Couldn't run the check."); }
  }

  const openMatter = (id) => { onOpenMatter(id); onClose(); };

  return (
    <div className="ac-overlay" onClick={onClose}>
      <div className="ac-panel wide" onClick={(e) => e.stopPropagation()}>
        <div className="ac-panel-head">
          <h2>Clients</h2>
          <button type="button" className="ac-iconbtn" onClick={onClose}><X size={18} /></button>
        </div>
        {openId ? (
          <ClientDetail clientId={openId} onBack={() => setOpenId(null)} onOpenMatter={openMatter} onChanged={onChanged} />
        ) : (
          <>
            <div className="ac-card">
              <h3><ShieldCheck size={12} /> Quick conflict check</h3>
              <form onSubmit={runCheck} style={{ display: "flex", gap: 6 }}>
                <input value={checkNames} onChange={(e) => setCheckNames(e.target.value)} placeholder="Names to check, separated by ;" style={{ flex: 1 }} />
                <button type="submit" className="ac-tablebtn primary">Check</button>
              </form>
              {check && <div style={{ marginTop: 10 }}><ConflictResults results={check} onOpenMatter={openMatter} /></div>}
            </div>
            <div className="ac-search">
              <Search size={14} color="var(--slate-light)" />
              <input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Search clients by name, email or company number…" autoFocus />
            </div>
            {rows.length === 0 && <p style={{ fontSize: 13, color: "var(--slate)" }}>No clients found.</p>}
            {rows.map((c) => (
              <button key={c.id} type="button" className="ac-client-listrow" onClick={() => setOpenId(c.id)}>
                <div>
                  <strong>{c.name}</strong>
                  <div className="meta">{[c.email, c.phone, `${c.matterCount} matter${c.matterCount === 1 ? "" : "s"}`].filter(Boolean).join(" · ")}</div>
                </div>
                <IdStatus client={c} />
              </button>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
