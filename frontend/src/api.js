const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4000";

let authToken = null;
let onUnauthorized = null;

export function setAuthToken(token) {
  authToken = token;
  if (token) sessionStorage.setItem("vjc_token", token);
  else sessionStorage.removeItem("vjc_token");
}

export function getStoredToken() {
  return sessionStorage.getItem("vjc_token");
}

/** Registered once by App on mount so a 401 anywhere can bounce back to the login screen. */
export function setUnauthorizedHandler(fn) {
  onUnauthorized = fn;
}

async function request(path, { method = "GET", body, formData, skipAuth = false, blob = false } = {}) {
  // FormData sets its own multipart Content-Type (with boundary), so only
  // JSON bodies get an explicit one.
  const headers = formData ? {} : { "Content-Type": "application/json" };
  if (!skipAuth && authToken) headers.Authorization = `Bearer ${authToken}`;

  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers,
    body: formData || (body !== undefined ? JSON.stringify(body) : undefined),
  });

  if (res.status === 401 && !skipAuth) {
    onUnauthorized?.();
    throw new Error("Session expired — please log in again.");
  }

  if (res.status === 204) return null;
  if (blob && res.ok) return res.blob();

  let data;
  try {
    data = await res.json();
  } catch (e) {
    data = null;
  }

  if (!res.ok) {
    throw new Error(data?.error || `Request failed (${res.status})`);
  }
  return data;
}

export const api = {
  // ---- Auth ----
  login: (email, password) => request("/auth/login", { method: "POST", body: { email, password }, skipAuth: true }),
  register: (payload) => request("/auth/register", { method: "POST", body: payload, skipAuth: true }),
  me: () => request("/auth/me"),
  changePassword: (currentPassword, newPassword) =>
    request("/auth/change-password", { method: "POST", body: { currentPassword, newPassword } }),

  // ---- Matters ----
  getMatters: (params = {}) => {
    const qs = new URLSearchParams(
      Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ""))
    ).toString();
    return request(`/matters${qs ? `?${qs}` : ""}`);
  },
  getMatter: (id) => request(`/matters/${id}`),
  createMatter: (payload) => request("/matters", { method: "POST", body: payload }),
  importMatters: (rows, dryRun) => request("/matters/import", { method: "POST", body: { rows, dryRun } }),
  updateMatter: (id, patch) => request(`/matters/${id}`, { method: "PATCH", body: patch }),
  setStage: (id, stageIndex) => request(`/matters/${id}/stage`, { method: "POST", body: { stageIndex } }),
  addNote: (id, text) => request(`/matters/${id}/notes`, { method: "POST", body: { text } }),

  addDocument: (id, doc) => request(`/matters/${id}/documents`, { method: "POST", body: doc }),
  uploadDocumentFile: (id, documentId, file) => {
    const formData = new FormData();
    formData.append("file", file);
    return request(`/matters/${id}/documents/${documentId}/file`, { method: "PUT", formData });
  },
  getDocumentFile: (id, documentId) => request(`/matters/${id}/documents/${documentId}/file`, { blob: true }),

  addEmail: (id, email) => request(`/matters/${id}/emails`, { method: "POST", body: email }),
  matchEmail: (id, emailId) => request(`/matters/${id}/emails/${emailId}/match`, { method: "POST" }),

  addEnquiry: (id, question) => request(`/matters/${id}/enquiries`, { method: "POST", body: { question } }),
  addStandardEnquiries: (id, questions) => request(`/matters/${id}/enquiries/bulk`, { method: "POST", body: { questions } }),
  answerEnquiry: (id, enquiryId, answer, dateAnswered) =>
    request(`/matters/${id}/enquiries/${enquiryId}/answer`, { method: "PATCH", body: { answer, dateAnswered } }),
  reviewEnquiry: (id, enquiryId, payload) =>
    request(`/matters/${id}/enquiries/${enquiryId}/review`, { method: "PATCH", body: payload }),

  addSearch: (id, search) => request(`/matters/${id}/searches`, { method: "POST", body: search }),
  updateSearch: (id, searchId, patch) => request(`/matters/${id}/searches/${searchId}`, { method: "PATCH", body: patch }),

  addUndertaking: (id, undertaking) => request(`/matters/${id}/undertakings`, { method: "POST", body: undertaking }),
  dischargeUndertaking: (id, undertakingId, dateDischarged) =>
    request(`/matters/${id}/undertakings/${undertakingId}/discharge`, { method: "PATCH", body: { dateDischarged } }),

  addTask: (id, task) => request(`/matters/${id}/tasks`, { method: "POST", body: task }),
  completeTask: (id, taskId) => request(`/matters/${id}/tasks/${taskId}/complete`, { method: "PATCH" }),
  reopenTask: (id, taskId) => request(`/matters/${id}/tasks/${taskId}/reopen`, { method: "PATCH" }),

  linkMatter: (id, linkedId) => request(`/matters/${id}/links/${linkedId}`, { method: "PUT" }),
  unlinkMatter: (id, linkedId) => request(`/matters/${id}/links/${linkedId}`, { method: "DELETE" }),

  // ---- Users & firm settings ----
  getUsers: () => request("/users"),
  createUser: (payload) => request("/users", { method: "POST", body: payload }),
  updateUser: (id, patch) => request(`/users/${id}`, { method: "PATCH", body: patch }),

  getFirmSettings: () => request("/settings"),
  updateFirmSettings: (patch) => request("/settings", { method: "PATCH", body: patch }),
};
