import React, { useState } from "react";
import { Plus, FileText, Paperclip, Download, Folder, FolderOpen, FolderPlus, Pencil, Trash2, Inbox, Files, RotateCcw } from "lucide-react";
import { api } from "./api";
import { notify, confirmAction } from "./notify";

/**
 * The Documents tab: folders down the side (All, each folder, Unfiled) and
 * the documents in the chosen one. A matter starts with its department's
 * standard folders; documents can be dragged onto a folder or moved with
 * "Move to".
 */

const ALL = "all";
const UNFILED = "unfiled";

const fmtDate = (d) => (d ? new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—");
function fmtSize(bytes) {
  if (!bytes) return "";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function DocumentsTab({ matter, onChanged, onAddDoc, onAttachFile, onOpenFile, onEdit, onDelete, RowActions, fileAccept }) {
  const [view, setView] = useState(ALL);
  const [dragOver, setDragOver] = useState(null);
  const [newName, setNewName] = useState(null); // null = not adding; string = the name being typed
  const [renaming, setRenaming] = useState(null); // { id, name }
  const folders = matter.folders;
  const folderIds = new Set(folders.map((f) => f.id));
  const folderOf = (d) => (d.folderId && folderIds.has(d.folderId) ? d.folderId : UNFILED);
  const count = (id) => matter.documents.filter((d) => folderOf(d) === id).length;
  const unfiled = count(UNFILED);
  // If the folder being viewed has gone (deleted elsewhere), fall back to All.
  const current = view === ALL || view === UNFILED || folderIds.has(view) ? view : ALL;
  const shown = current === ALL ? matter.documents : matter.documents.filter((d) => folderOf(d) === current);
  const currentFolder = folders.find((f) => f.id === current);

  async function run(action, failure) {
    try {
      await action();
      await onChanged();
      return true;
    } catch (err) {
      notify(err.message || failure);
      return false;
    }
  }

  const move = (doc, folderId) => {
    if ((doc.folderId || null) === (folderId || null)) return;
    run(() => api.moveDocument(matter.id, doc.id, folderId), "Couldn't move the document.");
  };

  async function addFolder(e) {
    e.preventDefault();
    const name = (newName || "").trim();
    if (!name) return setNewName(null);
    let created;
    if (await run(async () => { created = await api.addFolder(matter.id, name); }, "Couldn't add the folder.")) {
      setNewName(null);
      setView(created.id);
    }
  }

  async function rename(e) {
    e.preventDefault();
    const name = renaming.name.trim();
    const folder = folders.find((f) => f.id === renaming.id);
    if (!name || !folder || name === folder.name) return setRenaming(null);
    if (await run(() => api.updateFolder(matter.id, renaming.id, { name }), "Couldn't rename the folder.")) setRenaming(null);
  }

  async function removeFolder(folder) {
    const n = count(folder.id);
    const ok = await confirmAction(
      n ? `Delete the folder “${folder.name}”? Its ${n} document${n === 1 ? "" : "s"} will be kept, as unfiled.` : `Delete the empty folder “${folder.name}”?`,
      { confirmLabel: "Delete folder", danger: true }
    );
    if (!ok) return;
    if (await run(() => api.deleteFolder(matter.id, folder.id), "Couldn't delete the folder.")) setView(ALL);
  }

  async function restoreStandard() {
    let added = [];
    await run(async () => { added = (await api.addStandardFolders(matter.id)).added; }, "Couldn't add the standard folders.");
    notify(added.length ? `Added: ${added.join(", ")}` : "All the standard folders are already here.", "success");
  }

  // Drag a document row onto a folder in the side list.
  const dropProps = (id) => ({
    onDragOver: (e) => { if (e.dataTransfer.types.includes("text/x-vjc-doc")) { e.preventDefault(); setDragOver(id); } },
    onDragLeave: () => setDragOver((v) => (v === id ? null : v)),
    onDrop: (e) => {
      e.preventDefault();
      setDragOver(null);
      const doc = matter.documents.find((d) => d.id === e.dataTransfer.getData("text/x-vjc-doc"));
      if (doc) move(doc, id === UNFILED ? null : id);
    },
  });

  const navItem = (id, label, icon, n, extra = {}) => (
    <button type="button" key={id} className={`ac-folder ${current === id ? "on" : ""} ${dragOver === id ? "drop" : ""}`}
      onClick={() => setView(id)} {...extra}>
      {icon}<span className="name">{label}</span><span className="n">{n}</span>
    </button>
  );

  return (
    <div className="ac-detail-body" style={{ gridTemplateColumns: "1fr" }}>
      <div className="ac-docs">
        <nav className="ac-folders" aria-label="Folders">
          {navItem(ALL, "All documents", <Files size={14} />, matter.documents.length)}
          <div className="ac-folders-label">Folders</div>
          {folders.map((f) => (renaming && renaming.id === f.id ? (
            <form key={f.id} onSubmit={rename} className="ac-folder-form">
              <input value={renaming.name} autoFocus maxLength={80} onChange={(e) => setRenaming({ ...renaming, name: e.target.value })}
                onBlur={rename} onKeyDown={(e) => { if (e.key === "Escape") setRenaming(null); }} aria-label="Folder name" />
            </form>
          ) : navItem(f.id, f.name, current === f.id ? <FolderOpen size={14} /> : <Folder size={14} />, count(f.id), dropProps(f.id))))}
          {(unfiled > 0 || current === UNFILED) && navItem(UNFILED, "Unfiled", <Inbox size={14} />, unfiled, dropProps(UNFILED))}
          {newName === null ? (
            <button type="button" className="ac-folder add" onClick={() => setNewName("")}><FolderPlus size={14} /><span className="name">New folder</span></button>
          ) : (
            <form onSubmit={addFolder} className="ac-folder-form">
              <input value={newName} autoFocus maxLength={80} placeholder="Folder name" onChange={(e) => setNewName(e.target.value)}
                onBlur={addFolder} onKeyDown={(e) => { if (e.key === "Escape") setNewName(null); }} aria-label="New folder name" />
            </form>
          )}
          <button type="button" className="ac-folder add" onClick={restoreStandard} title="Puts back any of this department's standard folders that are missing">
            <RotateCcw size={13} /><span className="name">Add the standard folders</span>
          </button>
          <p className="ac-folders-hint">Drag a document onto a folder to file it.</p>
        </nav>

        <div className="ac-col-main" style={{ minWidth: 0 }}>
          <div className="ac-section-head">
            <h2>{currentFolder ? currentFolder.name : current === UNFILED ? "Unfiled" : "All documents"}</h2>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              {currentFolder && (
                <>
                  <button type="button" className="ac-iconbtn" title="Rename folder" aria-label="Rename folder" onClick={() => setRenaming({ id: currentFolder.id, name: currentFolder.name })}><Pencil size={13} /></button>
                  <button type="button" className="ac-iconbtn" title="Delete folder" aria-label="Delete folder" onClick={() => removeFolder(currentFolder)}><Trash2 size={13} /></button>
                </>
              )}
              <button className="ac-addbtn" onClick={() => onAddDoc(currentFolder ? currentFolder.id : null)}><Plus size={13} /> Add document</button>
            </div>
          </div>
          {shown.length === 0 && (
            <p style={{ color: "var(--slate)", fontSize: 13 }}>
              {matter.documents.length === 0 ? "No documents recorded yet." : currentFolder ? "Nothing in this folder yet — add a document, or drag one here." : "Nothing here."}
            </p>
          )}
          {shown.map((d) => {
            const inFolder = folderOf(d);
            const folderName = folders.find((f) => f.id === inFolder)?.name;
            return (
              <div key={d.id} className="ac-doc-row" draggable
                onDragStart={(e) => { e.dataTransfer.setData("text/x-vjc-doc", d.id); e.dataTransfer.effectAllowed = "move"; }}
                onDragEnd={() => setDragOver(null)}>
                <div className="ac-doc-icon"><FileText size={16} /></div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="ac-doc-name">{d.name}</div>
                  <div className="ac-doc-meta">
                    {d.category} · {fmtDate(d.date)}
                    {current === ALL && <> · <Folder size={10} style={{ verticalAlign: -1 }} /> {folderName || "Unfiled"}</>}
                  </div>
                  {d.fileName && <div className="ac-doc-file"><Paperclip size={11} /> {d.fileName} · {fmtSize(d.fileSize)}</div>}
                  {d.notes && <div className="ac-doc-notes">{d.notes}</div>}
                </div>
                <div className="ac-doc-actions">
                  <select className="ac-doc-move" value={inFolder === UNFILED ? "" : inFolder} aria-label={`Folder for ${d.name}`}
                    title="Move to folder" onChange={(e) => move(d, e.target.value || null)}>
                    {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                    <option value="">Unfiled</option>
                  </select>
                  <RowActions onEdit={() => onEdit(d)} onDelete={() => onDelete(d)} />
                  {d.fileName ? (
                    <>
                      <button className="ac-tablebtn" onClick={() => onOpenFile(d, false)}>View</button>
                      <button className="ac-tablebtn" onClick={() => onOpenFile(d, true)}><Download size={12} /> Download</button>
                    </>
                  ) : (
                    <label className="ac-tablebtn" style={{ cursor: "pointer" }}>
                      <Paperclip size={12} /> Attach file
                      <input type="file" accept={fileAccept} style={{ display: "none" }}
                        onChange={(e) => { const file = e.target.files[0]; e.target.value = ""; if (file) onAttachFile(d.id, file); }} />
                    </label>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** Settings card: each department's standard folders, one per line (admins can change them). */
export function FolderTemplatesCard({ templates, areaName, isAdmin, onSaved }) {
  const [dept, setDept] = useState(templates[0]?.department || "");
  const template = templates.find((t) => t.department === dept) || templates[0];
  const [text, setText] = useState(template ? template.folders.join("\n") : "");
  const [saving, setSaving] = useState(false);
  if (!template) return null;

  const choose = (d) => {
    setDept(d);
    setText((templates.find((t) => t.department === d)?.folders || []).join("\n"));
  };

  async function save(folders) {
    setSaving(true);
    try {
      const updated = await api.updateFirmSettings({ folderTemplate: { department: template.department, folders } });
      const next = updated.folderTemplates.find((t) => t.department === template.department);
      setText(next.folders.join("\n"));
      onSaved(updated.folderTemplates);
      notify(`Standard folders for ${areaName(template.department)} saved. New matters will start with them.`, "success");
    } catch (err) {
      notify(err.message || "Couldn't save the folders.");
    } finally {
      setSaving(false);
    }
  }

  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  return (
    <div>
      {templates.length > 1 && (
        <div className="ac-field">
          <label>Department</label>
          <select value={template.department} onChange={(e) => choose(e.target.value)}>
            {templates.map((t) => <option key={t.department} value={t.department}>{areaName(t.department)}</option>)}
          </select>
        </div>
      )}
      <div className="ac-field">
        <label>Folders, one per line {template.customised ? "(this firm's own list)" : "(the standard list)"}</label>
        <textarea rows={Math.min(14, Math.max(5, lines.length + 1))} value={text} disabled={!isAdmin || saving}
          onChange={(e) => setText(e.target.value)} />
      </div>
      <p style={{ fontSize: 11.5, color: "var(--slate)", marginTop: 0 }}>
        New matters start with these folders; existing matters can pick up new ones with “Add the standard folders” on their Documents tab.
      </p>
      {isAdmin && (
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" className="ac-addbtn" disabled={saving || !lines.length} onClick={() => save(lines)}>Save folders</button>
          {template.customised && <button type="button" className="ac-tablebtn" disabled={saving} onClick={() => save(null)}>Back to the standard list</button>}
        </div>
      )}
    </div>
  );
}
