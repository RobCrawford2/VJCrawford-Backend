import React, { useState } from "react";
import { Scale } from "lucide-react";
import { api, setAuthToken } from "./api";

export default function Login({ onLoggedIn }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const { token, user } = await api.login(email.trim(), password);
      setAuthToken(token);
      onLoggedIn(user);
    } catch (err) {
      setError(err.message || "Couldn't log in — check your details and try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={styles.page}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Georgia&display=swap');
        .vjc-login-root * { box-sizing: border-box; }
      `}</style>
      <div className="vjc-login-root" style={styles.card}>
        <div style={styles.brandRow}>
          <div style={styles.mark}><Scale size={18} color="#ab8a44" /></div>
          <div>
            <div style={styles.firmName}>V J Crawford Conveyancing</div>
            <div style={styles.tag}>Case Management</div>
          </div>
        </div>

        <form onSubmit={submit}>
          <label style={styles.label}>Email</label>
          <input
            style={styles.input}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@vjcrawfordconveyancing.co.uk"
            autoFocus
            required
          />
          <label style={styles.label}>Password</label>
          <input
            style={styles.input}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          {error && <div style={styles.error}>{error}</div>}
          <button type="submit" style={styles.button} disabled={loading}>
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}

const styles = {
  page: {
    minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
    background: "#ede9e0", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  },
  card: {
    width: 360, background: "#fbfaf7", border: "1px solid #d4cfc0", borderRadius: 3,
    padding: "32px 30px", boxShadow: "0 1px 2px rgba(22,33,47,0.06)",
  },
  brandRow: { display: "flex", alignItems: "center", gap: 10, marginBottom: 28 },
  mark: { width: 32, height: 32, borderRadius: 2, background: "#16212f", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 },
  firmName: { fontFamily: "Georgia, serif", fontWeight: 600, fontSize: 16, color: "#16212f" },
  tag: { fontSize: 10.5, textTransform: "uppercase", letterSpacing: "0.07em", color: "#5c6672", marginTop: 2 },
  label: { display: "block", fontSize: 11.5, fontWeight: 600, color: "#5c6672", textTransform: "uppercase", letterSpacing: "0.03em", marginBottom: 5, marginTop: 14 },
  input: { width: "100%", border: "1px solid #d4cfc0", borderRadius: 3, padding: "9px 10px", fontSize: 13.5, background: "#fff", color: "#16212f", outline: "none" },
  error: { color: "#7c3232", fontSize: 12.5, marginTop: 12 },
  button: {
    width: "100%", background: "#7d6127", color: "#fff", border: "1px solid #7d6127", borderRadius: 2,
    padding: 11, fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em",
    marginTop: 22, cursor: "pointer",
  },
};
