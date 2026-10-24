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
  getReportOnTitle: (id) => request(`/matters/${id}/report-on-title`, { blob: true }),
  getDocumentTemplates: () => request("/matters/document-templates"),
  generateDocument: (id, template) => request(`/matters/${id}/generate/${template}`, { blob: true }),
  addBankDetails: (id, details) => request(`/matters/${id}/bank-details`, { method: "POST", body: details }),
  verifyBankDetails: (id, bankId, method, note) => request(`/matters/${id}/bank-details/${bankId}/verify`, { method: "POST", body: { method, note } }),
  createMatter: (payload) => request("/matters", { method: "POST", body: payload }),
  importMatters: (rows, dryRun) => request("/matters/import", { method: "POST", body: { rows, dryRun } }),
  updateMatter: (id, patch) => request(`/matters/${id}`, { method: "PATCH", body: patch }),
  setStage: (id, stageIndex) => request(`/matters/${id}/stage`, { method: "POST", body: { stageIndex } }),
  requestStage: (id, stageIndex, note) => request(`/matters/${id}/stage-requests`, { method: "POST", body: { stageIndex, note } }),
  decideStageRequest: (id, requestId, approve, note) =>
    request(`/matters/${id}/stage-requests/${requestId}/decision`, { method: "POST", body: { approve, note } }),
  withdrawStageRequest: (id, requestId) => request(`/matters/${id}/stage-requests/${requestId}`, { method: "DELETE" }),
  getPendingSignoffs: () => request("/matters/sign-offs/pending"),
  addNote: (id, text) => request(`/matters/${id}/notes`, { method: "POST", body: { text } }),

  addDocument: (id, doc) => request(`/matters/${id}/documents`, { method: "POST", body: doc }),
  uploadDocumentFile: (id, documentId, file) => {
    const formData = new FormData();
    formData.append("file", file);
    return request(`/matters/${id}/documents/${documentId}/file`, { method: "PUT", formData });
  },
  getDocumentFile: (id, documentId) => request(`/matters/${id}/documents/${documentId}/file`, { blob: true }),
  moveDocument: (id, documentId, folderId) => request(`/matters/${id}/documents/${documentId}/folder`, { method: "PUT", body: { folderId } }),
  addFolder: (id, name) => request(`/matters/${id}/folders`, { method: "POST", body: { name } }),
  updateFolder: (id, folderId, patch) => request(`/matters/${id}/folders/${folderId}`, { method: "PATCH", body: patch }),
  deleteFolder: (id, folderId) => request(`/matters/${id}/folders/${folderId}`, { method: "DELETE" }),
  addStandardFolders: (id) => request(`/matters/${id}/folders/standard`, { method: "POST" }),

  addEmail: (id, email) => request(`/matters/${id}/emails`, { method: "POST", body: email }),
  matchEmail: (id, emailId) => request(`/matters/${id}/emails/${emailId}/match`, { method: "POST" }),

  addEnquiry: (id, question) => request(`/matters/${id}/enquiries`, { method: "POST", body: { question } }),
  addStandardEnquiries: (id, questions) => request(`/matters/${id}/enquiries/bulk`, { method: "POST", body: { questions } }),
  setEnquiryStatus: (id, enquiryId, status) =>
    request(`/matters/${id}/enquiries/${enquiryId}/status`, { method: "PATCH", body: { status } }),
  addEnquiryReply: (id, enquiryId, payload) =>
    request(`/matters/${id}/enquiries/${enquiryId}/replies`, { method: "POST", body: payload }),
  addEnquiryComment: (id, enquiryId, comment) =>
    request(`/matters/${id}/enquiries/${enquiryId}/comments`, { method: "POST", body: { comment } }),

  addSearch: (id, search) => request(`/matters/${id}/searches`, { method: "POST", body: search }),
  updateSearch: (id, searchId, patch) => request(`/matters/${id}/searches/${searchId}`, { method: "PATCH", body: patch }),

  addUndertaking: (id, undertaking) => request(`/matters/${id}/undertakings`, { method: "POST", body: undertaking }),
  dischargeUndertaking: (id, undertakingId, dateDischarged) =>
    request(`/matters/${id}/undertakings/${undertakingId}/discharge`, { method: "PATCH", body: { dateDischarged } }),

  addTask: (id, task) => request(`/matters/${id}/tasks`, { method: "POST", body: task }),
  addTasks: (id, tasks) => request(`/matters/${id}/tasks/bulk`, { method: "POST", body: { tasks } }),
  updateTask: (id, taskId, patch) => request(`/matters/${id}/tasks/${taskId}`, { method: "PATCH", body: patch }),
  getTasks: (mine) => request(`/tasks${mine ? "?mine=true" : ""}`),
  getUpcoming: (days = 7) => request(`/matters/upcoming?days=${days}`),
  getUndertakings: (status) => request(`/undertakings${status ? `?status=${status}` : ""}`),
  getBilling: (id) => request(`/matters/${id}/billing`),
  addTime: (id, payload) => request(`/matters/${id}/time`, { method: "POST", body: payload }),
  updateTime: (id, entryId, patch) => request(`/matters/${id}/time/${entryId}`, { method: "PATCH", body: patch }),
  createBill: (id, payload) => request(`/matters/${id}/bills`, { method: "POST", body: payload }),
  issueBill: (id, billId) => request(`/matters/${id}/bills/${billId}/issue`, { method: "POST" }),
  cancelBill: (id, billId, reason) => request(`/matters/${id}/bills/${billId}/cancel`, { method: "POST", body: { reason } }),
  getBillDocument: (id, billId) => request(`/matters/${id}/bills/${billId}/document`, { blob: true }),
  getTimesheet: (from, to) => request(`/time?from=${from}&to=${to}`),
  addDeadline: (id, payload) => request(`/matters/${id}/deadlines`, { method: "POST", body: payload }),
  updateDeadline: (id, deadlineId, patch) => request(`/matters/${id}/deadlines/${deadlineId}`, { method: "PATCH", body: patch }),
  getDiary: (days, mine) => request(`/deadlines?days=${days}${mine ? "&mine=true" : ""}`),
  conflictCheck: (names, { excludeClientIds = [], matterId } = {}) =>
    request("/clients/conflict-check", { method: "POST", body: { names, excludeClientIds, matterId } }),
  getClients: (search) => request(`/clients${search ? `?search=${encodeURIComponent(search)}` : ""}`),
  getClient: (id) => request(`/clients/${id}`),
  createClient: (payload) => request("/clients", { method: "POST", body: payload }),
  updateClient: (id, patch) => request(`/clients/${id}`, { method: "PATCH", body: patch }),
  recordIdCheck: (id, payload) => request(`/clients/${id}/id-check`, { method: "POST", body: payload }),
  addMatterClient: (id, payload) => request(`/matters/${id}/clients`, { method: "POST", body: payload }),
  removeMatterClient: (id, clientId) => request(`/matters/${id}/clients/${clientId}`, { method: "DELETE" }),
  addParty: (id, payload) => request(`/matters/${id}/parties`, { method: "POST", body: payload }),
  deleteItem: (id, kind, itemId) => request(`/matters/${id}/${kind}/${itemId}`, { method: "DELETE" }),
  editItem: (id, kind, itemId, patch) => request(`/matters/${id}/${kind}/${itemId}`, { method: "PATCH", body: patch }),
  completeTask: (id, taskId) => request(`/matters/${id}/tasks/${taskId}/complete`, { method: "PATCH" }),
  reopenTask: (id, taskId) => request(`/matters/${id}/tasks/${taskId}/reopen`, { method: "PATCH" }),

  linkMatter: (id, linkedId) => request(`/matters/${id}/links/${linkedId}`, { method: "PUT" }),
  unlinkMatter: (id, linkedId) => request(`/matters/${id}/links/${linkedId}`, { method: "DELETE" }),

  // ---- Users & firm settings ----
  getUsers: () => request("/users"),
  createUser: (payload) => request("/users", { method: "POST", body: payload }),
  updateUser: (id, patch) => request(`/users/${id}`, { method: "PATCH", body: patch }),
  resetUserPassword: (id, password) => request(`/users/${id}/reset-password`, { method: "POST", body: { password } }),
  getStaffAudit: () => request("/users/audit"),

  getFirmSettings: () => request("/settings"),
  updateFirmSettings: (patch) => request("/settings", { method: "PATCH", body: patch }),
};
