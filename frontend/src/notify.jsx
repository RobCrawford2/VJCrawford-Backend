import React, { useEffect, useState } from "react";
import { X, AlertTriangle, CheckCircle2 } from "lucide-react";

/**
 * In-page messages and confirmations, replacing the browser's plain
 * alert()/confirm() pop-ups. Call notify() / confirmAction() from anywhere;
 * <Notifications /> (rendered once in App) shows them.
 */

let listener = null;
let nextId = 1;

/** Show a message. kind: "error" (default) | "success" | "info". */
export function notify(message, kind = "error") {
  listener?.({ type: "toast", id: nextId++, message: String(message), kind });
}

/**
 * Ask the user to confirm. Resolves true/false.
 *   confirmAction("Delete this task?", { confirmLabel: "Delete", danger: true })
 */
export function confirmAction(message, { confirmLabel = "OK", cancelLabel = "Cancel", danger = false } = {}) {
  return new Promise((resolve) => {
    if (!listener) return resolve(window.confirm(message));
    listener({ type: "confirm", id: nextId++, message, confirmLabel, cancelLabel, danger, resolve });
  });
}

export function Notifications() {
  const [toasts, setToasts] = useState([]);
  const [dialog, setDialog] = useState(null);

  useEffect(() => {
    listener = (item) => {
      if (item.type === "confirm") return setDialog(item);
      setToasts((prev) => [...prev, item]);
      setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== item.id)), item.kind === "error" ? 10000 : 5000);
    };
    return () => { listener = null; };
  }, []);

  function answer(value) {
    dialog?.resolve(value);
    setDialog(null);
  }

  return (
    <>
      <div className="ac-toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`ac-toast ${t.kind}`}>
            {t.kind === "success" ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
            <div className="msg">{t.message}</div>
            <button type="button" onClick={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))} aria-label="Dismiss"><X size={14} /></button>
          </div>
        ))}
      </div>
      {dialog && (
        <div className="ac-overlay center" onClick={() => answer(false)}>
          <div className="ac-modal" onClick={(e) => e.stopPropagation()} role="alertdialog" style={{ width: 420 }}>
            <p style={{ fontSize: 14, marginTop: 0, whiteSpace: "pre-line" }}>{dialog.message}</p>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button type="button" className="ac-tablebtn" onClick={() => answer(false)}>{dialog.cancelLabel}</button>
              <button type="button" className={`ac-tablebtn ${dialog.danger ? "danger" : "primary"}`} onClick={() => answer(true)} autoFocus>{dialog.confirmLabel}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
