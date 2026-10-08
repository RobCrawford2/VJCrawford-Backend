import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Search, Plus, FileText, Mail, Calendar, Users, ChevronRight, ChevronLeft,
  X, Check, Building2, Clock, ArrowLeft, PoundSterling, Home as HomeIcon,
  Scale, Landmark, KeyRound, Send, Paperclip, StickyNote, RotateCcw,
  ShieldCheck, FileSearch, FileSignature, Stamp, AlertTriangle, Link2, Gavel,
  Settings as SettingsIcon, Copy, CheckCircle2, Download, Plug, Bell, ListChecks, LogOut, Lock, Upload
} from "lucide-react";
import Papa from "papaparse";
import Login from "./Login";
import { api, setAuthToken, getStoredToken, setUnauthorizedHandler } from "./api";
import { adaptMatter, userName, toApiNewMatter, toApiMatterPatch } from "./adapters";

/* ---------------------------------------------------------------------- */
/* Domain constants                                                       */
/* ---------------------------------------------------------------------- */

const STAGES = [
  { name: "Instructed",           hint: "File opened, client care letter sent" },
  { name: "ID & AML Checks",      hint: "Verification and source-of-funds" },
  { name: "Contract Pack",        hint: "Draft contract and title issued / reviewed" },
  { name: "Searches",             hint: "Local authority, water & drainage, environmental" },
  { name: "Enquiries",            hint: "Pre-contract enquiries raised and answered" },
  { name: "Mortgage Offer",       hint: "Formal mortgage offer received and reviewed" },
  { name: "Report on Title",      hint: "Report sent to client for approval" },
  { name: "Pre-Exchange Review",  hint: "File checked over and confirmed ready before contracts become binding" },
  { name: "Exchange",             hint: "Contracts signed and exchanged, deposit held" },
  { name: "Completion",           hint: "Funds transferred, keys released" },
  { name: "Post-Completion",      hint: "SDLT return filed, Land Registry application" },
  { name: "Closed",               hint: "File closed and archived" },
];

const EXCHANGE_INDEX = STAGES.findIndex((s) => s.name === "Exchange");
const COMPLETION_INDEX = STAGES.findIndex((s) => s.name === "Completion");
const PRE_EXCHANGE_REVIEW_INDEX = STAGES.findIndex((s) => s.name === "Pre-Exchange Review");
const CLOSED_INDEX = STAGES.length - 1;

function stagePhase(idx) {
  if (idx === 0 || idx === 1) return "setup";
  if (idx >= 2 && idx <= 6) return "progress";
  if (idx >= 7 && idx <= COMPLETION_INDEX) return "critical";
  if (idx === COMPLETION_INDEX + 1) return "wrapup";
  return "closed";
}

const PRE_COMPLETION_CHECKLIST = [
  "Client has given informed authority to exchange — the deposit, proposed completion date, and binding nature of exchange have been explained",
  "Deposit funds cleared and held, or mortgage deposit contribution confirmed",
  "Report on Title sent to and approved by the client",
  "All searches satisfactory — no unresolved issues",
  "All essential enquiries answered — any outstanding accepted as low-risk by the client",
  "Mortgage offer reviewed, conditions understood, and offer valid past the proposed completion date",
  "Buildings insurance arranged to commence from exchange",
  "Proposed completion date agreed with the other side, and the chain if applicable",
  "Contract signed by the client and held, ready to exchange",
];

const TYPES = ["Sale", "Purchase", "Remortgage"];
const TENURES = ["Freehold", "Leasehold", "Share of freehold", "Commonhold"];
// Stored enquiry statuses and the wording staff see.
const ENQUIRY_STATUSES = [
  { value: "Outstanding", label: "Raised", pill: "critical" },
  { value: "Pending Review", label: "Response received", pill: "progress" },
  { value: "Answered", label: "Satisfactory", pill: "closed" },
];
const enquiryStatus = (value) => ENQUIRY_STATUSES.find((s) => s.value === value) || ENQUIRY_STATUSES[0];
const isLeasehold = (tenure) => tenure === "Leasehold" || tenure === "Share of freehold";

const DOC_CATEGORIES = [
  "Contract", "Title", "Search", "ID / AML", "Mortgage", "Correspondence", "SDLT / LR", "Other"
];

// Must match ALLOWED_FILE_TYPES / MAX_FILE_BYTES in src/routes/matters.js.
const DOC_FILE_EXTENSIONS = [".pdf", ".doc", ".docx", ".xls", ".xlsx", ".rtf", ".txt", ".csv", ".jpg", ".jpeg", ".png", ".gif", ".heic", ".tif", ".tiff", ".msg", ".eml"];
const DOC_MAX_FILE_MB = 10;
// Types a browser can safely show in a tab; everything else downloads.
const DOC_VIEWABLE_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/gif", "text/plain"];

function checkDocFile(file) {
  const ext = (file.name.match(/\.[^.]+$/) || [""])[0].toLowerCase();
  if (!DOC_FILE_EXTENSIONS.includes(ext)) return "That type of file isn't allowed. Use PDF, Word, Excel, images, text, or Outlook emails.";
  if (file.size > DOC_MAX_FILE_MB * 1024 * 1024) return `Files must be ${DOC_MAX_FILE_MB} MB or smaller.`;
  return "";
}

function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const SEARCH_TYPES = [
  "Local Authority Search", "Water & Drainage Search", "Environmental Search",
  "Chancel Repair Search", "Flood Risk Search", "Mining Search", "Other"
];

const STANDARD_ENQUIRIES = [
  {
    category: "Boundaries & neighbours",
    items: [
      "Please confirm responsibility for maintaining each boundary (fences, walls, hedges) and provide any boundary agreements.",
      "Please confirm whether there have been any disputes, complaints or proceedings involving neighbouring owners or occupiers in the last 3 years.",
      "Please confirm whether any notices have been served or received that are relevant to the property (e.g. planning, highways, party wall).",
    ],
  },
  {
    category: "Alterations & building works",
    items: [
      "Please confirm details of any alterations, extensions or structural works carried out and provide copies of planning permission and Building Regulations completion certificates.",
      "Please confirm whether any works required Party Wall Act notices or agreements, and provide copies.",
      "Please confirm whether any guarantees or warranties are held for the property (e.g. NHBC, damp proofing, timber treatment, cavity wall insulation) and provide copies.",
    ],
  },
  {
    category: "Services & installations",
    items: [
      "Please confirm which mains services are connected (water, gas, electricity, drainage) and the location of the relevant meters and stopcocks.",
      "Please confirm whether drainage is to mains foul/surface water sewers or a private system (septic tank/treatment plant), and provide any relevant certification.",
      "Please confirm details of the current utility suppliers.",
      "Please confirm whether any installations (e.g. boiler, alarm system, solar panels) are leased or rented rather than owned outright, and provide copies of any agreements.",
      "Please confirm the most recent boiler/heating system service date and provide any service history.",
    ],
  },
  {
    category: "Rights, covenants & planning",
    items: [
      "Please confirm details of any rights of way, easements or other rights benefiting or burdening the property.",
      "Please confirm compliance with any restrictive covenants affecting the property.",
      "Please confirm whether the property is subject to any planning conditions, Article 4 directions, listed building status, or conservation area restrictions.",
    ],
  },
  {
    category: "Insurance & environmental",
    items: [
      "Please confirm the buildings insurance claims history for the property, including any claims for subsidence or flooding.",
      "Please confirm whether the property has flooded, or is known to be at risk of flooding, at any time.",
      "Please confirm whether Japanese knotweed is or has been present on, or within influencing distance of, the property.",
      "Please confirm whether the property has been affected by contamination, mining activity or other environmental issues.",
    ],
  },
  {
    category: "Occupation & fixtures",
    items: [
      "Please confirm the names of all occupiers aged 17 or over and confirm their consent to the sale.",
      "Please confirm what fixtures, fittings and contents are included in the sale, supported by a completed fixtures and fittings (TA10) list.",
      "Please confirm the parking arrangements for the property and whether these are demised, allocated or shared.",
    ],
  },
  {
    category: "Leasehold only",
    items: [
      "Please confirm the remaining lease term, current ground rent and service charge, and provide the last 3 years of service charge accounts.",
      "Please confirm the managing agent's or management company's details and confirm there are no outstanding disputes or Section 20 major works notices.",
      "Please confirm whether any consents (e.g. licence to assign) are required from the landlord or management company for this sale.",
    ],
  },
];

// Standard conveyancing tasks, by matter type and stage index (see STAGES).
// A starting point to be reviewed against the firm's own procedures.
const STANDARD_TASKS = {
  Purchase: {
    0: ["Send client care letter, terms of business and costs estimate", "Receive signed terms of business and payment on account", "Record source of instruction / referral arrangements"],
    1: ["Verify client identity (photo ID and proof of address)", "Complete AML risk assessment", "Obtain evidence of source of funds and source of wealth", "Verify client's bank details by phone (cyber-fraud check)"],
    2: ["Request contract pack from seller's solicitors", "Review draft contract, title register and title plan", "Review Property Information Form (TA6) and Fittings & Contents Form (TA10)", "Leasehold: review lease and Leasehold Information Form (TA7)"],
    3: ["Order local authority, water & drainage and environmental searches", "Consider additional searches (coal mining, flood, chancel, highways)", "Review search results and note issues for the report"],
    4: ["Raise pre-contract enquiries with seller's solicitors", "Chase outstanding enquiry replies", "Review enquiry replies and decide whether satisfactory"],
    5: ["Receive and review mortgage offer and special conditions", "Check mortgage offer expiry against the proposed completion date", "Report any issues to the lender (UK Finance Mortgage Lenders' Handbook)"],
    6: ["Send Report on Title to client", "Obtain signed contract, transfer (TR1) and mortgage deed", "Calculate SDLT and prepare completion statement"],
    7: ["Complete the pre-exchange review checklist", "Receive deposit funds (cleared) into client account", "Confirm buildings insurance will be in place from exchange", "Agree completion date with all parties in the chain"],
    8: ["Exchange contracts and record time, method and formula used", "Confirm exchange to client, estate agent and lender", "Send certificate of title and request mortgage advance", "Carry out pre-completion searches (OS1 / bankruptcy)"],
    9: ["Receive mortgage advance and balance of funds from client", "Send completion monies to seller's solicitors", "Confirm completion to client and agent; arrange release of keys"],
    10: ["Submit SDLT return and pay SDLT (within 14 days of completion)", "Discharge any undertakings given", "Apply to register at HM Land Registry (AP1)", "Send title information document to client and lender"],
    11: ["Send final bill and close client ledger", "Archive the file"],
  },
  Sale: {
    0: ["Send client care letter, terms of business and costs estimate", "Receive signed terms of business and payment on account"],
    1: ["Verify client identity (photo ID and proof of address)", "Complete AML risk assessment", "Confirm client's name matches the registered proprietor", "Verify client's bank details by phone (cyber-fraud check)"],
    2: ["Obtain official copies of the title register and plan", "Client to complete TA6, TA10 (and TA7 if leasehold)", "Draft contract and send contract pack to buyer's solicitors", "Leasehold: request management pack from managing agent"],
    4: ["Receive buyer's enquiries", "Answer buyer's enquiries with the client"],
    5: ["Obtain redemption statement for the existing mortgage"],
    7: ["Obtain signed contract and transfer (TR1) from client", "Agree completion date with all parties in the chain"],
    8: ["Exchange contracts and record time, method and formula used", "Confirm exchange to client and estate agent", "Obtain final redemption figure for completion day"],
    9: ["Receive completion monies from buyer's solicitors", "Redeem the seller's mortgage", "Authorise release of keys and confirm completion to client"],
    10: ["Send DS1 / evidence of discharge to buyer's solicitors", "Pay estate agent's invoice", "Account to client for net sale proceeds", "Discharge any undertakings given"],
    11: ["Send final bill and close client ledger", "Archive the file"],
  },
  Remortgage: {
    0: ["Send client care letter, terms of business and costs estimate", "Receive signed terms of business"],
    1: ["Verify client identity (photo ID and proof of address)", "Complete AML risk assessment", "Verify client's bank details by phone (cyber-fraud check)"],
    2: ["Obtain official copies of the title register and plan", "Check title for restrictions and other charges"],
    3: ["Order searches, or search indemnity insurance where the lender allows"],
    5: ["Receive and review mortgage offer and special conditions", "Obtain redemption statement from the existing lender"],
    6: ["Report to the lender / send certificate of title", "Obtain signed mortgage deed"],
    9: ["Draw down the new mortgage advance", "Redeem the existing mortgage", "Account to client for any surplus funds"],
    10: ["Apply to register the new charge at HM Land Registry (AP1 with DS1)", "Send title information document to client and lender"],
    11: ["Send final bill and close client ledger", "Archive the file"],
  },
};

const STANDARD_SEARCHES = [
  {
    category: "Core searches (standard on almost every purchase)",
    items: ["Local Authority Search", "Water & Drainage Search", "Environmental Search"],
  },
  {
    category: "Regional mining & ground stability",
    items: ["Coal Mining Search", "Tin Mining Search (Cornwall & parts of Devon)", "Brine Search (Cheshire)", "Limestone Mining Search"],
  },
  {
    category: "Other common searches",
    items: ["Chancel Repair Search", "Flood Risk Search", "Highways Search", "Commons Registration Search"],
  },
];

function formatDate(d) {
  if (!d) return "—";
  const dt = new Date(d);
  if (isNaN(dt)) return d;
  return dt.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function formatMoney(n) {
  if (n === "" || n === null || n === undefined || isNaN(n)) return "—";
  return "£" + Number(n).toLocaleString("en-GB");
}

function searchStatus(s) {
  if (s.dateReceived) return s.issue ? "issue" : "received";
  if (s.expectedReturn && new Date(s.expectedReturn) < new Date()) return "overdue";
  return "ordered";
}

const SEARCH_STATUS_LABEL = { ordered: "Ordered", overdue: "Overdue", received: "Received", issue: "Issue flagged" };

/**
 * Conveyancing doesn't progress on a single queue — searches, enquiries and the
 * mortgage offer typically run in parallel. This derives a readiness status for
 * each workstream from the actual data, independent of the fee-earner's manual
 * stage marker, so the two can be compared rather than forcing one file queue.
 */
function workstreamStatus(matter) {
  const searchesReady = matter.searches.length > 0 && matter.searches.every((s) => s.dateReceived && !s.issue);
  const searchesBlocked = matter.searches.some((s) => s.issue);
  const enquiriesReady = matter.enquiries.length > 0 && matter.enquiries.every((q) => q.status === "Answered");
  const mortgageNeeded = matter.type === "Purchase" || matter.type === "Remortgage";
  const mortgageDoc = matter.documents.some((d) => d.category === "Mortgage");
  const mortgageExpiry = matter.keyDates.mortgageOfferExpiry;
  const completionRef = matter.keyDates.actualCompletion || matter.keyDates.targetCompletion;
  const mortgageConflict = mortgageNeeded && mortgageExpiry && completionRef && new Date(mortgageExpiry) < new Date(completionRef);

  const searches = matter.searches.length === 0 ? "pending" : searchesBlocked ? "blocked" : searchesReady ? "ready" : "progress";
  const enquiries = matter.enquiries.length === 0 ? "pending" : enquiriesReady ? "ready" : "progress";
  const mortgage = !mortgageNeeded ? "n/a" : mortgageConflict ? "blocked" : mortgageDoc ? "ready" : "pending";

  const readyToExchange = searches === "ready" && enquiries === "ready" && (mortgage === "ready" || mortgage === "n/a");
  return { searches, enquiries, mortgage, readyToExchange, mortgageConflict, mortgageExpiry };
}

function mortgageExpiryInfo(matter) {
  const mortgageNeeded = matter.type === "Purchase" || matter.type === "Remortgage";
  const expiry = matter.keyDates.mortgageOfferExpiry;
  if (!mortgageNeeded || !expiry) return null;
  const completionRef = matter.keyDates.actualCompletion || matter.keyDates.targetCompletion;
  const today = new Date();
  const conflict = completionRef && new Date(expiry) < new Date(completionRef);
  const expired = !matter.keyDates.actualCompletion && new Date(expiry) < today;
  const daysLeft = Math.ceil((new Date(expiry) - today) / 86400000);
  const expiringSoon = !conflict && !expired && !matter.keyDates.actualCompletion && daysLeft <= 14;
  return { expiry, conflict, expired, expiringSoon, daysLeft };
}

function daysSince(dateStr) {
  if (!dateStr) return null;
  return Math.floor((new Date() - new Date(dateStr)) / 86400000);
}

function lastActivityDate(matter) {
  return matter.activity.length ? matter.activity[0].date : matter.keyDates.instructed;
}

function allOpenTasks(matters) {
  return matters
    .flatMap((m) => m.tasks.filter((t) => t.status === "Open").map((t) => ({ ...t, matterId: m.id, matterRef: m.reference, matterAddr: m.address })))
    .sort((a, b) => (a.dueDate || "9999").localeCompare(b.dueDate || "9999"));
}

function staleFiles(matters, staleDays) {
  return matters
    .filter((m) => m.currentStageIndex < CLOSED_INDEX)
    .map((m) => ({ matter: m, idle: daysSince(lastActivityDate(m)) }))
    .filter((x) => x.idle !== null && x.idle >= staleDays)
    .sort((a, b) => b.idle - a.idle);
}

function needsAttention(matter, staleDays = 14) {
  const reasons = [];
  if (matter.searches.some((s) => s.issue)) reasons.push("Search issue flagged");
  if (matter.searches.some((s) => searchStatus(s) === "overdue")) reasons.push("A search is overdue");
  if (matter.enquiries.some((q) => q.status === "Outstanding")) reasons.push("Enquiries raised and not yet answered");
  if (matter.enquiries.some((q) => q.status === "Pending Review")) reasons.push("Enquiry responses received — check whether they're satisfactory");
  if (matter.undertakings.some((u) => u.status === "Outstanding")) reasons.push("Undertaking not yet discharged");
  const today = new Date();
  if (matter.keyDates.targetExchange && !matter.keyDates.actualExchange && new Date(matter.keyDates.targetExchange) < today && matter.currentStageIndex < EXCHANGE_INDEX) {
    reasons.push("Target exchange date has passed");
  }
  if (matter.keyDates.targetCompletion && !matter.keyDates.actualCompletion && new Date(matter.keyDates.targetCompletion) < today && matter.currentStageIndex < COMPLETION_INDEX) {
    reasons.push("Target completion date has passed");
  }
  const overdueTasks = (matter.tasks || []).filter((t) => t.status === "Open" && t.dueDate && new Date(t.dueDate) < today);
  if (overdueTasks.length) reasons.push(`${overdueTasks.length} task${overdueTasks.length === 1 ? "" : "s"} overdue`);
  const mtg = mortgageExpiryInfo(matter);
  if (mtg) {
    if (mtg.conflict) reasons.push(`Mortgage offer expires ${formatDate(mtg.expiry)} — before completion. Risk of losing the offer.`);
    else if (mtg.expired) reasons.push(`Mortgage offer expired ${formatDate(mtg.expiry)}`);
    else if (mtg.expiringSoon) reasons.push(`Mortgage offer expires in ${mtg.daysLeft} day${mtg.daysLeft === 1 ? "" : "s"} (${formatDate(mtg.expiry)})`);
  }
  if (matter.currentStageIndex >= PRE_EXCHANGE_REVIEW_INDEX && matter.currentStageIndex < CLOSED_INDEX && !matter.preCompletionReview.confirmedBy) {
    reasons.push("Pre-exchange review not yet confirmed");
  }
  if (matter.currentStageIndex < CLOSED_INDEX) {
    const idle = daysSince(lastActivityDate(matter));
    if (idle !== null && idle >= staleDays) reasons.push(`No activity logged for ${idle} days — file review due`);
  }
  return reasons;
}

function sdltInfo(matter) {
  if (!matter.keyDates.actualCompletion) return null;
  if (!(matter.type === "Purchase" || matter.type === "Remortgage")) return null;
  const deadline = new Date(matter.keyDates.actualCompletion);
  deadline.setDate(deadline.getDate() + 14);
  const filed = matter.documents.some((d) => d.category === "SDLT / LR");
  const daysLeft = Math.ceil((deadline - new Date()) / 86400000);
  return { deadline: deadline.toISOString().slice(0, 10), filed, daysLeft, overdue: !filed && daysLeft < 0, dueSoon: !filed && daysLeft >= 0 && daysLeft <= 3 };
}



/* ---------------------------------------------------------------------- */
/* Small UI atoms                                                         */
/* ---------------------------------------------------------------------- */

function StagePill({ idx }) {
  const phase = stagePhase(idx);
  return (
    <span className={`ac-pill ac-pill--${phase}`}>
      {phase === "closed" ? <Stamp size={11} /> : null}
      {STAGES[idx].name}
    </span>
  );
}

function TypeTag({ type }) {
  const icon = type === "Sale" ? <HomeIcon size={11} /> : type === "Purchase" ? <KeyRound size={11} /> : <Landmark size={11} />;
  return <span className="ac-typetag">{icon}{type}</span>;
}

/* ---------------------------------------------------------------------- */
/* Main App                                                                */
/* ---------------------------------------------------------------------- */

export default function App() {
  // ---- Auth ----
  const [authUser, setAuthUser] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      setAuthToken(null);
      setAuthUser(null);
    });
    const token = getStoredToken();
    if (!token) {
      setAuthChecked(true);
      return;
    }
    setAuthToken(token);
    api
      .me()
      .then((u) => setAuthUser(u))
      .catch(() => setAuthToken(null))
      .finally(() => setAuthChecked(true));
  }, []);

  function handleLoggedIn(user) {
    setAuthUser(user);
  }

  function logOut() {
    setAuthToken(null);
    setAuthUser(null);
    setSelectedId(null);
  }

  // ---- Matters list (server-filtered, server-paginated) ----
  const [matters, setMatters] = useState([]);
  const [matterTotal, setMatterTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState("");
  const [users, setUsers] = useState([]);
  const [settings, setSettings] = useState({ outlookConnected: false, autoFile: true, domain: "", staleDays: 14, currentUser: "" });
  const [showSettings, setShowSettings] = useState(false);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [showOutlookConsent, setShowOutlookConsent] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [selectedDetail, setSelectedDetail] = useState(null);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("All");
  const [showClosed, setShowClosed] = useState(true);
  const [myMattersOnly, setMyMattersOnly] = useState(false);
  const [visibleCount, setVisibleCount] = useState(20);
  const [showNewMatter, setShowNewMatter] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showStaff, setShowStaff] = useState(false);
  const [stageRequestDraft, setStageRequestDraft] = useState(null);
  const [showStandardTasks, setShowStandardTasks] = useState(false);
  const [pendingSignoffs, setPendingSignoffs] = useState([]);
  const refreshSignoffs = useCallback(() => {
    if (!authUser || isSupportRole(authUser.role)) return setPendingSignoffs([]);
    api.getPendingSignoffs().then(setPendingSignoffs).catch(() => {});
  }, [authUser]);
  useEffect(() => { refreshSignoffs(); }, [refreshSignoffs]);
  // The case list folds away when a matter is opened, so the matter gets the full width.
  const [listOpen, setListOpen] = useState(true);
  const [showEditMatter, setShowEditMatter] = useState(false);
  const [showAddNote, setShowAddNote] = useState(false);
  const [activeTab, setActiveTab] = useState("overview");
  const [showAddDoc, setShowAddDoc] = useState(false);
  const [showAddEmail, setShowAddEmail] = useState(false);
  const [showAddEnquiry, setShowAddEnquiry] = useState(false);
  const [showStandardEnquiries, setShowStandardEnquiries] = useState(false);
  const [showEmailEnquiries, setShowEmailEnquiries] = useState(false);
  const [showAddSearch, setShowAddSearch] = useState(false);
  const [showStandardSearches, setShowStandardSearches] = useState(false);
  const [updatingSearch, setUpdatingSearch] = useState(null);
  const [showAddUndertaking, setShowAddUndertaking] = useState(false);
  const [dischargingUndertaking, setDischargingUndertaking] = useState(null);
  const [showAddTask, setShowAddTask] = useState(false);
  const [showTasksPanel, setShowTasksPanel] = useState(false);
  const [showConfirmReview, setShowConfirmReview] = useState(false);
  const [saveState, setSaveState] = useState("idle");

  // ---- Load users + firm settings once logged in ----
  useEffect(() => {
    if (!authUser) return;
    api.getUsers().then(setUsers).catch(() => {});
    api
      .getFirmSettings()
      .then((s) =>
        setSettings((prev) => ({
          ...prev,
          domain: s.domain || prev.domain,
          staleDays: s.stale_days ?? prev.staleDays,
          requireStageSignoff: s.require_stage_signoff ?? true,
          currentUser: authUser.name,
        }))
      )
      .catch(() => setSettings((prev) => ({ ...prev, currentUser: authUser.name })));
  }, [authUser]);

  function saveSettings(patch) {
    setSettings((prev) => ({ ...prev, ...patch }));
    // Only domain / staleDays are real, persisted firm settings on the backend —
    // outlookConnected / autoFile remain local UI-only state (see the Settings
    // panel note: real Outlook integration is a Phase 2 backend feature).
    const firmPatch = {};
    if ("domain" in patch) firmPatch.domain = patch.domain;
    if ("staleDays" in patch) firmPatch.staleDays = patch.staleDays;
    if ("requireStageSignoff" in patch) firmPatch.requireStageSignoff = patch.requireStageSignoff;
    if (Object.keys(firmPatch).length) {
      api.updateFirmSettings(firmPatch).catch(() => {});
    }
  }

  // ---- Matters list ----
  const refreshList = useCallback(async () => {
    if (!authUser) return;
    setLoading(true);
    try {
      const feeEarnerId = myMattersOnly ? authUser.id : undefined;
      const result = await api.getMatters({
        limit: visibleCount,
        offset: 0,
        type: typeFilter === "All" ? undefined : typeFilter,
        showClosed: showClosed ? undefined : "false",
        search: search.trim() || undefined,
        feeEarnerId,
      });
      setMatters(result.matters.map((m) => adaptMatter(m, users)));
      setMatterTotal(result.pagination.total);
      setListError("");
    } catch (err) {
      setListError(err.message || "Couldn't load matters.");
    } finally {
      setLoading(false);
    }
  }, [authUser, visibleCount, typeFilter, showClosed, search, myMattersOnly, users]);

  useEffect(() => {
    refreshList();
  }, [refreshList]);

  useEffect(() => {
    setVisibleCount(20);
  }, [search, typeFilter, showClosed, myMattersOnly]);

  // ---- Selected matter detail ----
  const refreshSelected = useCallback(
    async (id) => {
      if (!id) {
        setSelectedDetail(null);
        return;
      }
      setSaveState("saving");
      try {
        const detail = await api.getMatter(id);
        setSelectedDetail(adaptMatter(detail, users));
        setSaveState("saved");
      } catch (err) {
        setSelectedDetail(null);
        setSaveState("error");
      }
    },
    [users]
  );

  useEffect(() => {
    refreshSelected(selectedId);
  }, [selectedId, refreshSelected]);

  /** Called after every mutation: re-pulls the open matter's full detail, and
   *  refreshes the list too since stage/dates/attention shown in the sidebar
   *  can change as a result of almost any edit. */
  async function afterMutation() {
    await Promise.all([refreshSelected(selectedId), refreshList()]);
  }

  // ---- New matter ----
  async function addMatter(data) {
    try {
      const created = await api.createMatter(toApiNewMatter(data));
      await refreshList();
      setSelectedId(created.id);
      setShowNewMatter(false);
      setActiveTab("overview");
    } catch (err) {
      window.alert(err.message || "Couldn't create the matter.");
    }
  }

  // ---- Stage ----
  async function setStage(id, idx) {
    const matter = id === selectedId ? selectedDetail : matters.find((m) => m.id === id);
    if (matter && idx >= EXCHANGE_INDEX && idx > matter.currentStageIndex && !matter.preCompletionReview.confirmedBy) {
      const proceed = window.confirm(
        "The pre-exchange review hasn't been confirmed on this file yet. Move to " + STAGES[idx].name + " anyway?"
      );
      if (!proceed) return;
    }
    if (matter && matter.stageMovesNeedSignoff) {
      if (idx === matter.currentStageIndex) return;
      setStageRequestDraft({ matterId: id, stageIndex: idx });
      return;
    }
    try {
      await api.setStage(id, idx);
      await afterMutation();
    } catch (err) {
      window.alert(err.message || "Couldn't update the stage.");
    }
  }

  async function requestStage(id, idx, note) {
    await api.requestStage(id, idx, note);
    setStageRequestDraft(null);
    await afterMutation();
    refreshSignoffs();
  }

  async function decideStageRequest(id, requestId, approve, note) {
    await api.decideStageRequest(id, requestId, approve, note);
    await afterMutation();
    refreshSignoffs();
  }

  async function withdrawStageRequest(id, requestId) {
    try {
      await api.withdrawStageRequest(id, requestId);
      await afterMutation();
    } catch (err) {
      window.alert(err.message || "Couldn't withdraw the request.");
    }
  }

  // ---- Pre-exchange review ----
  async function toggleChecklistItem(id, item) {
    const matter = selectedDetail;
    if (!matter) return;
    const has = matter.preCompletionReview.checkedItems.includes(item);
    const checkedItems = has
      ? matter.preCompletionReview.checkedItems.filter((i) => i !== item)
      : [...matter.preCompletionReview.checkedItems, item];
    // Optimistic local update so the checkbox feels instant, reconciled by afterMutation().
    setSelectedDetail((prev) => (prev ? { ...prev, preCompletionReview: { ...prev.preCompletionReview, checkedItems } } : prev));
    try {
      await api.updateMatter(id, { preExchangeChecklist: checkedItems });
    } catch (err) {
      await refreshSelected(id);
    }
  }

  async function confirmPreCompletionReview(id, confirmedBy) {
    try {
      await api.updateMatter(id, { preExchangeConfirmedBy: confirmedBy, preExchangeConfirmedDate: new Date().toISOString().slice(0, 10) });
      await api.addNote(id, `Pre-exchange review confirmed by ${confirmedBy}`);
      await afterMutation();
    } catch (err) {
      window.alert(err.message || "Couldn't confirm the review.");
    }
  }

  async function resetPreCompletionReview(id) {
    try {
      await api.updateMatter(id, { preExchangeConfirmedBy: "", preExchangeConfirmedDate: null });
      await api.addNote(id, "Pre-exchange review reset — re-confirmation required");
      await afterMutation();
    } catch (err) {
      window.alert(err.message || "Couldn't reset the review.");
    }
  }

  // ---- Documents ----
  async function addDocument(id, doc, file) {
    let created;
    try {
      created = await api.addDocument(id, doc);
    } catch (err) {
      window.alert(err.message || "Couldn't add the document.");
      return;
    }
    if (file) {
      try {
        await api.uploadDocumentFile(id, created.id, file);
      } catch (err) {
        window.alert(`The document was recorded, but the file didn't upload: ${err.message} You can attach it again from the Documents tab.`);
      }
    }
    await afterMutation();
    setShowAddDoc(false);
  }

  async function attachDocumentFile(id, documentId, file) {
    const problem = checkDocFile(file);
    if (problem) return window.alert(problem);
    try {
      await api.uploadDocumentFile(id, documentId, file);
      await afterMutation();
    } catch (err) {
      window.alert(err.message || "Couldn't upload the file.");
    }
  }

  async function downloadReportOnTitle(matter) {
    try {
      const blob = await api.getReportOnTitle(matter.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Report on Title - ${matter.reference}.docx`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      await refreshSelected(matter.id); // picks up the "generated" activity entry
    } catch (err) {
      window.alert(err.message || "Couldn't generate the report.");
    }
  }

  async function openDocumentFile(id, doc, download) {
    // Open the tab now, while we still have the click — browsers block
    // window.open calls made after an await.
    const viewer = download ? null : window.open("", "_blank");
    try {
      const blob = await api.getDocumentFile(id, doc.id);
      const url = URL.createObjectURL(blob);
      if (viewer && DOC_VIEWABLE_TYPES.includes(blob.type)) {
        viewer.location.href = url;
      } else {
        viewer?.close();
        const a = document.createElement("a");
        a.href = url;
        a.download = doc.fileName || doc.name;
        a.click();
      }
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      viewer?.close();
      window.alert(err.message || "Couldn't open the file.");
    }
  }

  // ---- Emails ----
  async function addEmail(id, email) {
    try {
      await api.addEmail(id, email);
      await afterMutation();
      setShowAddEmail(false);
    } catch (err) {
      window.alert(err.message || "Couldn't log the email.");
    }
  }

  function importFromOutlook() {
    // Real Outlook integration is a Phase 2 backend feature (see the Settings
    // panel note) — there is no backend endpoint for this yet, so it's a
    // local-only placeholder rather than silently doing nothing.
    window.alert("Outlook import isn't wired to a real mailbox yet — this is a placeholder for the Phase 2 Microsoft Graph integration.");
  }

  async function matchEmailManually(id, emailId) {
    try {
      await api.matchEmail(id, emailId);
      await afterMutation();
    } catch (err) {
      window.alert(err.message || "Couldn't check that email for enquiry replies.");
    }
  }

  // ---- Enquiries ----
  async function addEnquiry(id, question) {
    try {
      await api.addEnquiry(id, question);
      await afterMutation();
      setShowAddEnquiry(false);
    } catch (err) {
      window.alert(err.message || "Couldn't add the enquiry.");
    }
  }

  async function addStandardEnquiries(id, questions) {
    try {
      await api.addStandardEnquiries(id, questions);
      await afterMutation();
      setShowStandardEnquiries(false);
    } catch (err) {
      window.alert(err.message || "Couldn't add the standard enquiries.");
    }
  }

  async function setEnquiryStatus(id, enquiryId, status) {
    try {
      await api.setEnquiryStatus(id, enquiryId, status);
      await afterMutation();
    } catch (err) {
      window.alert(err.message || "Couldn't change the status.");
    }
  }

  // Throws on failure so the inline form can show the error and keep what was typed.
  async function logEnquiryReply(id, enquiryId, payload) {
    await api.addEnquiryReply(id, enquiryId, payload);
    await afterMutation();
  }

  async function addEnquiryComment(id, enquiryId, comment) {
    await api.addEnquiryComment(id, enquiryId, comment);
    await afterMutation();
  }

  async function emailEnquiries(id, { to, subject, body, count }) {
    try {
      // The mailto: handoff already happened in the modal before this is called;
      // this just logs the copy on the file, same as before.
      await api.addEmail(id, { direction: "out", from: "us", to, subject, date: new Date().toISOString().slice(0, 10), body });
      await api.addNote(id, `${count} enquir${count === 1 ? "y" : "ies"} emailed to other side's solicitor`);
      await afterMutation();
      setShowEmailEnquiries(false);
    } catch (err) {
      window.alert(err.message || "Couldn't log that email.");
    }
  }

  // ---- Searches ----
  async function addSearch(id, search) {
    try {
      await api.addSearch(id, search);
      await afterMutation();
      setShowAddSearch(false);
    } catch (err) {
      window.alert(err.message || "Couldn't add the search.");
    }
  }

  async function addStandardSearches(id, types) {
    const today = new Date().toISOString().slice(0, 10);
    const expected = new Date();
    expected.setDate(expected.getDate() + 14);
    const expectedReturn = expected.toISOString().slice(0, 10);
    try {
      // The backend doesn't have a bulk-searches endpoint (only bulk enquiries) —
      // ordering several searches from a template is just several individual
      // POSTs run one after another.
      for (const type of types) {
        await api.addSearch(id, { type, dateOrdered: today, expectedReturn });
      }
      await afterMutation();
      setShowStandardSearches(false);
    } catch (err) {
      window.alert(err.message || "Couldn't add the standard searches.");
    }
  }

  async function updateSearch(id, searchId, patch) {
    try {
      await api.updateSearch(id, searchId, patch);
      await afterMutation();
      setUpdatingSearch(null);
    } catch (err) {
      window.alert(err.message || "Couldn't update the search.");
    }
  }

  // ---- Undertakings ----
  async function addUndertaking(id, undertaking) {
    try {
      await api.addUndertaking(id, undertaking);
      await afterMutation();
      setShowAddUndertaking(false);
    } catch (err) {
      window.alert(err.message || "Couldn't add the undertaking.");
    }
  }

  async function dischargeUndertaking(id, undertakingId, date) {
    try {
      await api.dischargeUndertaking(id, undertakingId, date);
      await afterMutation();
      setDischargingUndertaking(null);
    } catch (err) {
      window.alert(err.message || "Couldn't discharge the undertaking.");
    }
  }

  // ---- Tasks ----
  async function addTask(id, task) {
    try {
      await api.addTask(id, task);
      await afterMutation();
      setShowAddTask(false);
    } catch (err) {
      window.alert(err.message || "Couldn't add the task.");
    }
  }

  async function completeTask(id, taskId) {
    try {
      await api.completeTask(id, taskId);
      await afterMutation();
    } catch (err) {
      window.alert(err.message || "Couldn't complete the task.");
    }
  }

  async function reopenTask(id, taskId) {
    try {
      await api.reopenTask(id, taskId);
      await afterMutation();
    } catch (err) {
      window.alert(err.message || "Couldn't reopen the task.");
    }
  }

  // ---- Notes / activity ----
  async function addNote(id, text) {
    try {
      await api.addNote(id, text);
      await afterMutation();
      setShowAddNote(false);
    } catch (err) {
      window.alert(err.message || "Couldn't log that update.");
    }
  }

  // ---- Edit matter (incl. reciprocal chain linking) ----
  async function editMatterDetails(id, patch) {
    try {
      if (patch.linkedMatterIds) {
        const current = selectedDetail && selectedDetail.id === id ? selectedDetail : matters.find((m) => m.id === id);
        const before = new Set(current ? current.linkedMatterIds : []);
        const after = new Set(patch.linkedMatterIds);
        const added = [...after].filter((x) => !before.has(x));
        const removed = [...before].filter((x) => !after.has(x));
        await Promise.all([...added.map((linkedId) => api.linkMatter(id, linkedId)), ...removed.map((linkedId) => api.unlinkMatter(id, linkedId))]);
      }
      await api.updateMatter(id, toApiMatterPatch(patch));
      await afterMutation();
      setShowEditMatter(false);
    } catch (err) {
      window.alert(err.message || "Couldn't save those changes.");
    }
  }

  // ---- Derived view state ----
  // Filtering/pagination now happens server-side (see refreshList above), so
  // `matters` already is the current page of results — no client-side
  // re-filtering needed here, unlike the artifact-only prototype.
  const filtered = matters;
  const visibleMatters = matters;
  const selected = selectedDetail;
  useEffect(() => {
    setListOpen(!selectedId);
  }, [selectedId]);

  const activeCount = matters.filter((m) => m.currentStageIndex !== CLOSED_INDEX).length;
  const closedThisYear = matters.filter((m) => m.currentStageIndex === CLOSED_INDEX).length;

  const feeEarners = [...new Set(matters.map((m) => m.feeEarner).filter(Boolean))];
  const workload = feeEarners
    .map((name) => ({ name, count: matters.filter((m) => m.feeEarner === name && m.currentStageIndex !== CLOSED_INDEX).length }))
    .sort((a, b) => b.count - a.count);
  const maxWorkload = Math.max(1, ...workload.map((w) => w.count));

  if (!authChecked) {
    return <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", color: "#5c6672", fontFamily: "sans-serif" }}>Loading…</div>;
  }
  if (!authUser) {
    return <Login onLoggedIn={handleLoggedIn} />;
  }


  return (
    <div className="ac-root">
      <style>{`
        .ac-root {
          --ink: #16212f;
          --ink-soft: #303d4e;
          --slate: #5c6672;
          --slate-light: #96a0aa;
          --paper: #ede9e0;
          --paper-deep: #e0dccf;
          --card: #fbfaf7;
          --line: #d4cfc0;
          --brass: #7d6127;
          --brass-light: #ab8a44;
          --brass-bg: #ede3c8;
          --success: #3a5f45;
          --success-bg: #dfe6dc;
          --danger: #7c3232;
          --font-display: Georgia, 'Iowan Old Style', 'Palatino Linotype', 'Book Antiqua', serif;
          --font-body: -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, Roboto, sans-serif;
          --font-mono: ui-monospace, 'SF Mono', 'Cascadia Code', Consolas, 'Courier New', monospace;

          font-family: var(--font-body);
          color: var(--ink);
          background: var(--paper);
          min-height: 100vh;
          display: flex;
          flex-direction: column;
          font-size: 14px;
          line-height: 1.5;
        }
        .ac-root * { box-sizing: border-box; }
        .ac-root button { font-family: inherit; cursor: pointer; }
        .ac-root input, .ac-root select, .ac-root textarea { font-family: inherit; }

        /* ---- top bar ---- */
        .ac-topbar {
          display: flex; align-items: center; justify-content: space-between;
          padding: 14px 28px 12px; border-bottom: 2.5px double var(--ink);
          background: var(--card); box-shadow: 0 1px 0 var(--line);
        }
        .ac-brand { display: flex; align-items: baseline; gap: 12px; }
        .ac-brand-mark {
          width: 32px; height: 32px; border-radius: 2px; background: var(--ink);
          display: flex; align-items: center; justify-content: center; color: var(--brass-light);
          flex-shrink: 0; border: 1px solid var(--ink);
        }
        .ac-brand h1 {
          font-family: var(--font-display); font-weight: 600; font-size: 20px; margin: 0;
          letter-spacing: 0.015em;
        }
        .ac-brand span.tag {
          color: var(--slate); font-size: 11px; font-weight: 500; margin-left: 6px;
          text-transform: uppercase; letter-spacing: 0.07em; font-style: normal;
        }
        .ac-topstats { display: flex; gap: 26px; }
        .ac-topstat { text-align: right; }
        .ac-topstat .n { font-family: var(--font-mono); font-size: 18px; font-weight: 500; color: var(--ink); display: block; }
        .ac-topstat .l { font-size: 11px; color: var(--slate); text-transform: uppercase; letter-spacing: 0.04em; }

        /* ---- layout ---- */
        .ac-body { display: flex; flex: 1; min-height: 0; }
        .ac-sidebar {
          width: 340px; flex-shrink: 0; border-right: 1px solid var(--line);
          display: flex; flex-direction: column; background: var(--paper);
        }
        .ac-sidebar-head { padding: 16px 16px 12px; border-bottom: 1px solid var(--line); }
        .ac-rail {
          width: 34px; flex-shrink: 0; border: none; border-right: 1px solid var(--line); background: var(--paper);
          display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 16px 0; color: var(--slate);
        }
        .ac-rail:hover { background: var(--card); color: var(--ink); }
        .ac-rail span { writing-mode: vertical-rl; transform: rotate(180deg); font-size: 11px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; }
        .ac-hidelist {
          display: inline-flex; align-items: center; gap: 4px; background: none; border: none; padding: 0;
          font-size: 11.5px; color: var(--slate); margin-bottom: 10px;
        }
        .ac-hidelist:hover { color: var(--ink); }
        .ac-enq-summary { display: flex; gap: 16px; flex-wrap: wrap; font-size: 12.5px; color: var(--slate); margin-bottom: 12px; align-items: center; }
        .ac-enq { background: var(--card); border: 1px solid var(--line); border-radius: 3px; padding: 12px 14px; margin-bottom: 10px; }
        .ac-enq-head { display: flex; gap: 12px; align-items: flex-start; }
        .ac-enq-num { font-family: var(--font-mono); font-size: 13px; color: var(--slate); min-width: 22px; padding-top: 1px; }
        .ac-enq-q { font-size: 13.5px; font-weight: 600; color: var(--ink); }
        .ac-enq-meta { font-size: 11.5px; color: var(--slate); margin-top: 3px; }
        .ac-enq-status {
          border: none; border-radius: 10px; padding: 4px 10px; font-size: 11.5px; font-weight: 600; cursor: pointer; flex-shrink: 0;
        }
        .ac-enq-log { margin: 10px 0 0 34px; border-left: 2px solid var(--line); padding-left: 12px; display: flex; flex-direction: column; gap: 8px; }
        .ac-enq-entry-meta { font-size: 11px; color: var(--slate); }
        .ac-enq-entry-text { font-size: 13px; color: var(--ink-soft); white-space: pre-wrap; margin-top: 2px; }
        .ac-enq-entry.comment .ac-enq-entry-text { font-style: italic; }
        .ac-enq-actions { display: flex; gap: 6px; margin: 10px 0 0 34px; }
        .ac-enq-actions .ac-tablebtn { display: inline-flex; align-items: center; gap: 4px; }
        .ac-tablebtn.primary { background: var(--ink); color: #fff; border-color: var(--ink); }
        .ac-enq-form { margin: 10px 0 0 34px; padding: 10px 12px; background: var(--paper); border: 1px solid var(--line); border-radius: 3px; }
        .ac-enq-form .ac-enq-actions { margin-left: 0; }
        @media (max-width: 700px) { .ac-enq-log, .ac-enq-actions, .ac-enq-form { margin-left: 0; } }
        .ac-linked-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 10px; font-size: 12px; color: var(--slate); }
        .ac-linked-chip {
          display: inline-flex; align-items: center; gap: 6px; background: var(--card); border: 1px solid var(--line);
          border-radius: 3px; padding: 4px 9px; font-size: 12px; color: var(--ink); max-width: 100%;
        }
        .ac-linked-chip:hover { border-color: var(--ink); }
        .ac-linked-chip .addr { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 260px; font-weight: 600; }
        .ac-search {
          display: flex; align-items: center; gap: 8px; background: var(--card);
          border: 1px solid var(--line); border-radius: 3px; padding: 8px 10px; margin-bottom: 10px;
        }
        .ac-search input { border: none; outline: none; background: transparent; width: 100%; font-size: 13px; color: var(--ink); }
        .ac-search input::placeholder { color: var(--slate-light); }
        .ac-filters { display: flex; gap: 6px; flex-wrap: wrap; }
        .ac-chip {
          border: 1px solid var(--line); background: var(--card); color: var(--slate);
          border-radius: 100px; padding: 4px 10px; font-size: 11.5px; font-weight: 500;
        }
        .ac-chip.active { background: var(--ink); color: var(--paper); border-color: var(--ink); }
        .ac-newbtn {
          width: 100%; margin-top: 10px; background: var(--brass); color: #fff; border: 1px solid var(--brass);
          border-radius: 2px; padding: 9px; font-size: 11.5px; font-weight: 600;
          text-transform: uppercase; letter-spacing: 0.06em;
          display: flex; align-items: center; justify-content: center; gap: 6px;
        }
        .ac-newbtn:hover { background: #5f4a1e; border-color: #5f4a1e; }
        .ac-importbtn {
          width: 100%; margin-top: 6px; background: none; border: 1px dashed var(--line); border-radius: 2px;
          padding: 7px; font-size: 11.5px; color: var(--slate); display: flex; align-items: center; justify-content: center; gap: 6px;
        }
        .ac-importbtn:hover { color: var(--ink); border-color: var(--ink); }
        .ac-modal.wide { width: 720px; }
        .ac-panel.wide { width: 620px; }
        .ac-staff-row { border: 1px solid var(--line); background: var(--card); border-radius: 3px; padding: 10px 12px; margin-bottom: 8px; }
        .ac-staff-row.inactive { opacity: 0.6; }
        .ac-staff-top { display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; }
        .ac-staff-name { font-weight: 600; font-size: 13.5px; }
        .ac-staff-meta { font-size: 12px; color: var(--slate); margin-top: 2px; overflow-wrap: anywhere; }
        .ac-staff-actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
        .ac-role-guide { font-size: 12px; color: var(--slate); background: var(--card); border: 1px solid var(--line); border-radius: 3px; padding: 8px 12px; margin-bottom: 14px; line-height: 1.55; }
        .ac-audit-row { font-size: 12px; padding: 6px 0; border-bottom: 1px dashed var(--line); }
        .ac-import-errors { width: 100%; border-collapse: collapse; font-size: 12.5px; margin-top: 8px; }
        .ac-import-errors td { padding: 6px 8px; border-top: 1px solid var(--line); vertical-align: top; }
        .ac-import-errors td:first-child { font-family: var(--font-mono); white-space: nowrap; color: var(--slate); }

        .ac-list { flex: 1; overflow-y: auto; }
        .ac-item {
          padding: 13px 16px; border-bottom: 1px solid var(--line); cursor: pointer;
          border-left: 3px solid transparent;
        }
        .ac-item:hover { background: var(--card); }
        .ac-item.selected { background: var(--card); border-left-color: var(--brass); }
        .ac-item-top { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
        .ac-item-ref { font-family: var(--font-mono); font-size: 10.5px; color: var(--slate); }
        .ac-item-addr { font-family: var(--font-display); font-weight: 600; font-size: 14px; margin: 3px 0 4px; color: var(--ink); }
        .ac-item-client { font-size: 12px; color: var(--slate); margin-bottom: 7px; }
        .ac-item-bottom { display: flex; justify-content: space-between; align-items: center; }
        .ac-empty-list { padding: 30px 16px; color: var(--slate); font-size: 13px; text-align: center; }

        /* pills / tags */
        .ac-pill {
          font-size: 10.5px; font-weight: 600; padding: 3px 8px; border-radius: 100px;
          display: inline-flex; align-items: center; gap: 4px; text-transform: uppercase; letter-spacing: 0.03em;
        }
        .ac-pill--setup { background: #e4e6e1; color: var(--slate); }
        .ac-pill--progress { background: var(--brass-bg); color: var(--brass); }
        .ac-pill--critical { background: #f3e2d2; color: #9a5a1f; }
        .ac-pill--wrapup { background: #dde6f0; color: #2f4f73; }
        .ac-pill--closed { background: var(--success-bg); color: var(--success); }
        .ac-typetag {
          font-size: 10.5px; font-weight: 600; color: var(--ink-soft); background: #e2e4dc;
          padding: 3px 7px; border-radius: 4px; display: inline-flex; align-items: center; gap: 4px;
        }

        /* ---- main / empty state ---- */
        .ac-main { flex: 1; overflow-y: auto; min-width: 0; }
        .ac-home { padding: 26px 30px 40px; }
        .ac-home-intro { display: flex; align-items: center; gap: 16px; margin-bottom: 26px; }
        .ac-home-intro .mark { color: var(--brass-light); flex-shrink: 0; }
        .ac-home-intro h2 { font-family: var(--font-display); color: var(--ink); font-size: 19px; margin: 0 0 3px; }
        .ac-home-intro p { font-size: 12.5px; color: var(--slate); margin: 0; }
        .ac-home-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; margin-bottom: 20px; }
        @media (max-width: 700px) { .ac-home-grid { grid-template-columns: 1fr; } .ac-home-intro { flex-wrap: wrap; } }

        /* ---- matter detail ---- */
        .ac-detail-head {
          padding: 22px 30px 0; border-bottom: 1px solid var(--line); background: var(--card);
        }
        .ac-backlink {
          display: none; align-items: center; gap: 6px; background: none; border: none; color: var(--slate);
          font-size: 12.5px; font-weight: 600; padding: 6px 0 12px; margin: 0;
        }
        .ac-backlink:hover { color: var(--ink); }
        .ac-detail-top { display: flex; justify-content: space-between; align-items: flex-start; gap: 20px; }
        .ac-detail-ref { font-family: var(--font-mono); font-size: 11.5px; color: var(--slate); margin-bottom: 4px; }
        .ac-detail-addr { font-family: var(--font-display); font-size: 24px; font-weight: 600; margin: 0 0 6px; }
        .ac-detail-meta { display: flex; gap: 10px; align-items: center; margin-bottom: 16px; flex-wrap: wrap; }
        .ac-detail-price { font-family: var(--font-mono); font-size: 13px; color: var(--ink-soft); }
        .ac-tabs { display: flex; gap: 4px; margin-top: 6px; overflow-x: auto; }
        .ac-tab {
          background: none; border: none; padding: 9px 4px; font-size: 13px; font-weight: 600; color: var(--slate);
          border-bottom: 2px solid transparent; margin-right: 18px;
        }
        .ac-tab.active { color: var(--ink); border-bottom-color: var(--brass); }

        .ac-detail-body { padding: 24px 30px 50px; display: grid; grid-template-columns: 1fr 300px; gap: 28px; }
        .ac-col-main { min-width: 0; }
        .ac-col-side { min-width: 0; }

        /* stage tracker (signature element) */
        .ac-tracker { background: var(--card); border: 1px solid var(--line); border-radius: 3px; padding: 6px 0; }
        .ac-tracker-title {
          font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--slate);
          padding: 10px 16px 6px; font-weight: 600;
        }
        .ac-stage-row {
          display: flex; align-items: flex-start; gap: 12px; padding: 8px 16px; position: relative; cursor: pointer;
        }
        .ac-stage-row:hover { background: var(--paper); }
        .ac-stage-line {
          position: absolute; left: 27px; top: 0; bottom: 0; width: 1px; background: var(--line); z-index: 0;
        }
        .ac-stage-row:first-child .ac-stage-line { top: 50%; }
        .ac-stage-row:last-child .ac-stage-line { bottom: 50%; }
        .ac-stamp {
          width: 22px; height: 22px; border-radius: 50%; display: flex; align-items: center; justify-content: center;
          flex-shrink: 0; z-index: 1; font-size: 11px; margin-top: 1px; border: 1.5px solid var(--line); background: var(--card);
        }
        .ac-stamp.done { background: var(--success); border-color: var(--success); color: #fff; transform: rotate(-8deg); }
        .ac-stamp.current { background: var(--brass); border-color: var(--brass); color: #fff; }
        .ac-stage-label { font-size: 13px; font-weight: 600; color: var(--slate-light); }
        .ac-stage-row.done .ac-stage-label { color: var(--ink-soft); }
        .ac-stage-row.current .ac-stage-label { color: var(--ink); }
        .ac-stage-hint { font-size: 11.5px; color: var(--slate-light); margin-top: 1px; }
        .ac-stage-row.current .ac-stage-hint { color: var(--slate); }

        /* horizontal stage timeline (top of overview) */
        .ac-timeline {
          grid-column: 1 / -1; min-width: 0; background: var(--card); border: 1px solid var(--line); border-radius: 3px;
          padding: 14px 16px 10px; box-shadow: 0 1px 2px rgba(22, 33, 47, 0.04);
        }
        .ac-timeline-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-bottom: 12px; }
        .ac-timeline-now { font-size: 12.5px; color: var(--slate); }
        .ac-timeline-now strong { color: var(--ink); }
        .ac-timeline-track { display: flex; overflow-x: auto; padding-bottom: 4px; position: relative; }
        .ac-tl-step {
          flex: 1 0 74px; display: flex; flex-direction: column; align-items: center; gap: 5px; position: relative;
          background: none; border: none; padding: 2px 3px 4px; text-align: center; border-radius: 3px;
        }
        .ac-tl-step:hover { background: var(--paper); }
        .ac-tl-step::before {
          content: ""; position: absolute; top: 13px; left: 0; right: 0; height: 2px; background: var(--line); z-index: 0;
        }
        .ac-tl-step:first-child::before { left: 50%; }
        .ac-tl-step:last-child::before { right: 50%; }
        .ac-tl-step.done::before { background: var(--success); }
        .ac-tl-step.current::before { background: linear-gradient(to right, var(--success) 50%, var(--line) 50%); }
        .ac-tl-step:first-child.current::before { background: var(--line); }
        .ac-tl-label { font-size: 11px; font-weight: 600; line-height: 1.25; color: var(--slate-light); }
        .ac-tl-step.done .ac-tl-label { color: var(--ink-soft); }
        .ac-tl-step.current .ac-tl-label { color: var(--ink); }
        .ac-tl-date { font-size: 10px; font-family: var(--font-mono); color: var(--slate); }
        .ac-tl-step.requested .ac-stamp { border: 2px dashed var(--brass); }
        .ac-signoff-banner {
          grid-column: 1 / -1; min-width: 0; background: var(--brass-bg); border: 1px solid var(--brass); border-radius: 3px;
          padding: 12px 16px; display: flex; flex-wrap: wrap; gap: 10px 16px; align-items: center; justify-content: space-between;
        }
        .ac-signoff-banner .txt { font-size: 13px; color: var(--ink); }
        .ac-signoff-banner .note { font-size: 12px; color: var(--ink-soft); font-style: italic; margin-top: 2px; }

        /* cards */
        .ac-card { background: var(--card); border: 1px solid var(--line); border-radius: 3px; padding: 16px 18px; margin-bottom: 18px; box-shadow: 0 1px 2px rgba(22, 33, 47, 0.04); }
        .ac-card h3 {
          font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--slate);
          margin: 0 0 12px; padding-bottom: 9px; font-weight: 700; display: flex; align-items: center; gap: 6px;
          border-bottom: 1px solid var(--line);
        }
        .ac-kv { display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px dashed var(--line); font-size: 13px; }
        .ac-kv:last-child { border-bottom: none; }
        .ac-kv .k { color: var(--slate); }
        .ac-kv .v { color: var(--ink); font-weight: 500; text-align: right; }
        .ac-kv .v.mono { font-family: var(--font-mono); font-size: 12px; }

        .ac-notes-box { font-size: 13px; color: var(--ink-soft); white-space: pre-wrap; line-height: 1.6; }

        /* activity feed */
        .ac-activity-item { display: flex; gap: 10px; padding: 9px 0; border-bottom: 1px solid var(--line); }
        .ac-activity-item:last-child { border-bottom: none; }
        .ac-activity-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--brass-light); margin-top: 6px; flex-shrink: 0; }
        .ac-activity-text { font-size: 12.5px; color: var(--ink-soft); }
        .ac-activity-date { font-size: 10.5px; color: var(--slate-light); font-family: var(--font-mono); margin-top: 1px; }

        /* documents / emails */
        .ac-section-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; padding-bottom: 10px; border-bottom: 1px solid var(--line); }
        .ac-section-head h2 { font-family: var(--font-display); font-size: 17px; margin: 0; font-weight: 600; }
        .ac-addbtn {
          background: var(--ink); color: var(--paper); border: 1px solid var(--ink); border-radius: 2px; padding: 7px 12px;
          font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; display: flex; align-items: center; gap: 5px;
        }
        .ac-addbtn:hover { background: var(--ink-soft); border-color: var(--ink-soft); }
        .ac-addbtn:disabled { background: var(--slate-light); border-color: var(--slate-light); cursor: not-allowed; opacity: 0.6; }
        .ac-addbtn:disabled:hover { background: var(--slate-light); }

        .ac-table { width: 100%; border-collapse: collapse; background: var(--card); border: 1px solid var(--line); border-radius: 3px; overflow: hidden; }
        .ac-table th {
          text-align: left; font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--slate);
          font-weight: 600; padding: 9px 12px; border-bottom: 1px solid var(--line); background: var(--paper);
        }
        .ac-table td { padding: 11px 12px; border-bottom: 1px solid var(--line); font-size: 12.5px; color: var(--ink-soft); vertical-align: top; }
        .ac-table tr:last-child td { border-bottom: none; }
        .ac-table td.mono { font-family: var(--font-mono); font-size: 11.5px; color: var(--slate); }
        .ac-row-issue td { background: #fdf1ea; }
        .ac-tablebtn {
          background: none; border: 1px solid var(--line); border-radius: 2px; padding: 4px 9px; font-size: 11px;
          font-weight: 600; color: var(--ink-soft);
        }
        .ac-tablebtn:hover { border-color: var(--brass); color: var(--brass); }
        .ac-pill--issue { background: #f6ddd0; color: #8a3b1f; }
        .ac-doc-row, .ac-email-row {
          background: var(--card); border: 1px solid var(--line); border-radius: 3px; padding: 12px 14px; margin-bottom: 10px;
          display: flex; gap: 12px; align-items: flex-start;
        }
        .ac-doc-icon {
          width: 34px; height: 34px; border-radius: 3px; background: var(--brass-bg); color: var(--brass);
          display: flex; align-items: center; justify-content: center; flex-shrink: 0;
        }
        .ac-doc-name { font-weight: 600; font-size: 13.5px; }
        .ac-doc-meta { font-size: 11.5px; color: var(--slate); margin-top: 2px; }
        .ac-doc-file { font-size: 12px; color: var(--ink-soft); margin-top: 4px; display: flex; align-items: center; gap: 4px; overflow-wrap: anywhere; }
        .ac-doc-actions { display: flex; gap: 6px; align-items: flex-start; flex-shrink: 0; }
        .ac-doc-actions .ac-tablebtn { display: inline-flex; align-items: center; gap: 4px; }
        .ac-doc-notes { font-size: 12.5px; color: var(--ink-soft); margin-top: 5px; }
        .ac-email-dir {
          font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em;
          padding: 2px 6px; border-radius: 4px; flex-shrink: 0; margin-top: 2px;
        }
        .ac-email-dir.in { background: #dde6f0; color: #2f4f73; }
        .ac-email-dir.out { background: var(--brass-bg); color: var(--brass); }
        .ac-email-subject { font-weight: 600; font-size: 13.5px; }
        .ac-email-meta { font-size: 11.5px; color: var(--slate); margin: 2px 0 6px; }
        .ac-email-body { font-size: 12.5px; color: var(--ink-soft); line-height: 1.5; }

        /* forms / modals */
        .ac-overlay {
          position: fixed; inset: 0; background: rgba(30, 42, 58, 0.4); display: flex; justify-content: flex-end;
          z-index: 50;
        }
        .ac-overlay.center { justify-content: center; align-items: center; }
        .ac-panel {
          width: 460px; max-width: 92vw; background: var(--paper); height: 100%; overflow-y: auto;
          padding: 24px 26px 40px; border-left: 1px solid var(--line);
        }
        .ac-modal {
          width: 480px; max-width: 92vw; background: var(--paper); border-radius: 4px; overflow-y: auto;
          max-height: 88vh; padding: 24px 26px 28px; border: 1px solid var(--line);
        }
        .ac-panel-head, .ac-modal-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 18px; }
        .ac-panel-head h2, .ac-modal-head h2 { font-family: var(--font-display); font-size: 19px; margin: 0; }
        .ac-iconbtn { background: none; border: none; color: var(--slate); padding: 4px; border-radius: 2px; }
        .ac-iconbtn:hover { background: var(--card); color: var(--ink); }
        .ac-badge {
          position: absolute; top: -4px; right: -4px; background: #9a5a1f; color: #fff; font-size: 10px; font-weight: 700;
          min-width: 16px; height: 16px; border-radius: 4px; display: flex; align-items: center; justify-content: center; padding: 0 3px;
        }
        .ac-field { margin-bottom: 14px; }
        .ac-field label { display: block; font-size: 11.5px; font-weight: 600; color: var(--slate); margin-bottom: 5px; text-transform: uppercase; letter-spacing: 0.03em; }
        .ac-field input, .ac-field select, .ac-field textarea {
          width: 100%; border: 1px solid var(--line); border-radius: 3px; padding: 9px 10px; font-size: 13.5px;
          background: var(--card); color: var(--ink); outline: none;
        }
        .ac-field input:focus, .ac-field select:focus, .ac-field textarea:focus { border-color: var(--brass); }
        .ac-field textarea { resize: vertical; min-height: 70px; font-family: inherit; }
        .ac-row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
        .ac-submit {
          width: 100%; background: var(--brass); color: #fff; border: 1px solid var(--brass); border-radius: 2px; padding: 11px;
          font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em;
          margin-top: 6px; display: flex; align-items: center; justify-content: center; gap: 6px;
        }
        .ac-submit:hover { background: #5f4a1e; border-color: #5f4a1e; }
        .ac-submit:disabled { background: var(--slate-light); border-color: var(--slate-light); cursor: not-allowed; opacity: 0.7; }
        .ac-submit:disabled:hover { background: var(--slate-light); }
        .ac-fieldset-title { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--slate); margin: 18px 0 8px; padding-top: 10px; border-top: 1px solid var(--line); }

        .ac-savebadge { font-size: 10.5px; color: var(--slate-light); display: flex; align-items: center; gap: 5px; }
        .ac-account { display: flex; align-items: center; gap: 6px; padding-left: 14px; border-left: 1px solid var(--line); }
        .ac-account-name { font-size: 12.5px; font-weight: 600; color: var(--ink-soft); margin-right: 4px; }
        .ac-account-btn {
          display: inline-flex; align-items: center; gap: 5px; font-size: 12px; color: var(--slate);
          background: none; border: 1px solid var(--line); border-radius: 3px; padding: 5px 9px;
        }
        .ac-account-btn:hover { color: var(--ink); border-color: var(--ink); }
        .ac-resetlink { font-size: 11px; color: var(--slate-light); background: none; border: none; display: flex; align-items: center; gap: 4px; margin-top: 8px; }
        .ac-resetlink:hover { color: var(--danger); }

        @media (max-width: 860px) {
          .ac-detail-body { grid-template-columns: 1fr; }
          .ac-sidebar { width: 100%; position: absolute; inset: 0; z-index: 5; }
          .ac-sidebar--hidden-mobile { display: none; }
          .ac-body { position: relative; }
          .ac-topstats { display: none; }
          .ac-account-name, .ac-account-btn span { display: none; }
          .ac-topbar { padding: 12px 14px 10px; gap: 8px; }
          .ac-brand h1 { font-size: 16px; }
          .ac-brand span.tag { display: none; }
          .ac-account { padding-left: 8px; gap: 4px; }
          .ac-backlink { display: inline-flex !important; }
        }
      `}</style>

      <div className="ac-topbar">
        <div className="ac-brand">
          <div className="ac-brand-mark"><Scale size={16} /></div>
          <h1>V J Crawford Conveyancing<span className="tag">Case Management</span></h1>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <div className="ac-topstats">
            <div className="ac-topstat"><span className="n">{activeCount}</span><span className="l">Active files</span></div>
            <div className="ac-topstat"><span className="n">{closedThisYear}</span><span className="l">Closed</span></div>
          </div>
          <button className="ac-iconbtn" onClick={() => setShowTasksPanel(true)} title="Tasks & reminders" style={{ position: "relative" }}>
            <Bell size={18} />
            {(() => {
              const today = new Date();
              const overdueTaskCount = matters.reduce((n, m) => n + m.tasks.filter((t) => t.status === "Open" && t.dueDate && new Date(t.dueDate) < today).length, 0);
              const staleCount = matters.filter((m) => m.currentStageIndex < CLOSED_INDEX && daysSince(lastActivityDate(m)) >= settings.staleDays).length;
              const total = overdueTaskCount + staleCount;
              return total > 0 ? <span className="ac-badge">{total}</span> : null;
            })()}
          </button>
          {authUser.role === "admin" && (
            <button className="ac-iconbtn" onClick={() => setShowStaff(true)} title="Staff">
              <Users size={18} />
            </button>
          )}
          <button className="ac-iconbtn" onClick={() => setShowSettings(true)} title="Settings & integrations">
            <SettingsIcon size={18} />
          </button>
          <div className="ac-account">
            <span className="ac-account-name">{authUser.name}</span>
            <button className="ac-account-btn" onClick={() => setShowChangePassword(true)} title="Change your password">
              <Lock size={13} /> <span>Change password</span>
            </button>
            <button className="ac-account-btn" onClick={logOut} title="Log out">
              <LogOut size={13} /> <span>Log out</span>
            </button>
          </div>
        </div>
      </div>

      <div className="ac-body">
        {/* ---------------- Sidebar ---------------- */}
        {selected && !listOpen && (
          <button className="ac-rail ac-sidebar--hidden-mobile" onClick={() => setListOpen(true)} title="Show matter list">
            <ChevronRight size={16} />
            <span>Matters</span>
          </button>
        )}
        <div className={`ac-sidebar ${selected ? "ac-sidebar--hidden-mobile" : ""}`} style={selected && !listOpen ? { display: "none" } : undefined}>
          <div className="ac-sidebar-head">
            {selected && (
              <button className="ac-hidelist" onClick={() => setListOpen(false)} title="Hide the list so the matter fills the screen">
                <ChevronLeft size={13} /> Hide list
              </button>
            )}
            <div className="ac-search">
              <Search size={14} color="var(--slate-light)" />
              <input placeholder="Search address, client, reference…" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <div className="ac-filters">
              {["All", ...TYPES].map((t) => (
                <button key={t} className={`ac-chip ${typeFilter === t ? "active" : ""}`} onClick={() => setTypeFilter(t)}>{t}</button>
              ))}
              <button className={`ac-chip ${showClosed ? "active" : ""}`} onClick={() => setShowClosed((s) => !s)}>
                {showClosed ? "Hiding: none" : "Closed hidden"}
              </button>
              {settings.currentUser && (
                <button className={`ac-chip ${myMattersOnly ? "active" : ""}`} onClick={() => setMyMattersOnly((s) => !s)}>
                  My matters
                </button>
              )}
            </div>
            {!settings.currentUser && (
              <button onClick={() => setShowSettings(true)} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontSize: 11, color: "var(--slate-light)", marginTop: 8 }}>
                Set your name in Settings to filter to "My matters"
              </button>
            )}
            <button className="ac-newbtn" onClick={() => setShowNewMatter(true)}><Plus size={15} /> Open new matter</button>
            {authUser.role === "admin" && (
              <button className="ac-importbtn" onClick={() => setShowImport(true)}><Upload size={13} /> Import matters from a spreadsheet</button>
            )}
          </div>
          <div className="ac-list">
            {loading && <div className="ac-empty-list">Loading matters…</div>}
            {!loading && listError && <div className="ac-empty-list" style={{ color: "var(--danger)" }}>{listError}</div>}
            {!loading && !listError && filtered.length === 0 && <div className="ac-empty-list">No matters match this search.</div>}
            {visibleMatters.map((m) => (
              <div key={m.id} className={`ac-item ${selectedId === m.id ? "selected" : ""}`} onClick={() => { setSelectedId(m.id); setActiveTab("overview"); }}>
                <div className="ac-item-top">
                  <span className="ac-item-ref">{m.reference}</span>
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    {needsAttention(m, settings.staleDays).length > 0 && <span title={needsAttention(m, settings.staleDays).join(" · ")} style={{ color: "#9a5a1f" }}><AlertTriangle size={13} /></span>}
                    <TypeTag type={m.type} />
                  </div>
                </div>
                <div className="ac-item-addr">{m.address}</div>
                <div className="ac-item-client">{m.client}</div>
                <div className="ac-item-bottom">
                  <StagePill idx={m.currentStageIndex} />
                  <span style={{ fontSize: 11, color: "var(--slate-light)", fontFamily: "var(--font-mono)" }}>{formatMoney(m.price)}</span>
                </div>
              </div>
            ))}
            {!loading && filtered.length > 0 && (
              <div style={{ padding: "12px 16px", textAlign: "center" }}>
                <div style={{ fontSize: 11, color: "var(--slate-light)", marginBottom: matterTotal > visibleCount ? 8 : 0 }}>
                  Showing {visibleMatters.length} of {matterTotal}
                </div>
                {matterTotal > visibleCount && (
                  <button className="ac-chip" onClick={() => setVisibleCount((c) => c + 20)}>Load 20 more</button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ---------------- Main ---------------- */}
        <div className="ac-main">
          {selectedId && !selected && (
            <div style={{ padding: 60, textAlign: "center", color: "var(--slate)", fontSize: 13 }}>Loading matter…</div>
          )}

          {!selectedId && !selected && (
            <div className="ac-home">
              <div className="ac-home-intro">
                <div className="mark"><Scale size={30} /></div>
                <div>
                  <h2>No matter open</h2>
                  <p>Select a file from the ledger on the left, or open a new matter to begin tracking it.</p>
                </div>
                <button className="ac-newbtn" style={{ width: "auto", padding: "9px 16px", marginLeft: "auto" }} onClick={() => setShowNewMatter(true)}>
                  <Plus size={15} /> Open new matter
                </button>
              </div>

              {pendingSignoffs.length > 0 && (
                <div className="ac-card" style={{ borderColor: "var(--brass)", background: "var(--brass-bg)" }}>
                  <h3><ShieldCheck size={12} /> Awaiting your sign-off ({pendingSignoffs.length})</h3>
                  {pendingSignoffs.map((r) => (
                    <div key={r.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, padding: "8px 0", borderBottom: "1px dashed var(--line)" }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600 }}>{r.reference} — {r.address}</div>
                        <div style={{ fontSize: 12, color: "var(--slate)" }}>
                          {r.requested_by_name} asks to move from {r.from_stage_name} to <strong>{r.to_stage_name}</strong>
                          {r.note && <> · “{r.note}”</>}
                        </div>
                      </div>
                      <button className="ac-tablebtn" onClick={() => { setSelectedId(r.matter_id); setActiveTab("overview"); }}>Open</button>
                    </div>
                  ))}
                </div>
              )}

              {(() => {
                const openTasks = allOpenTasks(matters);
                const stale = staleFiles(matters, settings.staleDays);
                const today = new Date();
                return (
                  <div className="ac-home-grid">
                    <div className="ac-card">
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                        <h3 style={{ margin: 0 }}><ListChecks size={12} /> Upcoming tasks ({openTasks.length})</h3>
                        {openTasks.length > 0 && <button className="ac-tablebtn" onClick={() => setShowTasksPanel(true)}>View all</button>}
                      </div>
                      {openTasks.length === 0 && <p style={{ color: "var(--slate)", fontSize: 13 }}>Nothing outstanding — everything's up to date.</p>}
                      {openTasks.slice(0, 6).map((t) => {
                        const overdue = t.dueDate && new Date(t.dueDate) < today;
                        return (
                          <div key={t.id} style={{ padding: "9px 0", borderBottom: "1px dashed var(--line)" }}>
                            <div style={{ fontSize: 13, fontWeight: 500, color: "var(--ink-soft)" }}>{t.description}</div>
                            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 3 }}>
                              <button onClick={() => { setSelectedId(t.matterId); setActiveTab("tasks"); }} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontSize: 11.5, color: "var(--brass)", fontWeight: 600 }}>
                                {t.matterRef}
                              </button>
                              <span style={{ fontSize: 11.5, color: overdue ? "#8a3b1f" : "var(--slate)", fontWeight: overdue ? 700 : 400 }}>
                                {t.dueDate ? `${overdue ? "Overdue — was due " : "Due "}${formatDate(t.dueDate)}` : "No due date"}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                      {openTasks.length > 6 && <div style={{ fontSize: 11.5, color: "var(--slate-light)", marginTop: 8 }}>+{openTasks.length - 6} more</div>}
                    </div>

                    <div className="ac-card">
                      <h3 style={{ marginBottom: 12 }}><AlertTriangle size={12} /> Files needing review ({stale.length})</h3>
                      {stale.length === 0 && <p style={{ color: "var(--slate)", fontSize: 13 }}>Every open file has been touched recently.</p>}
                      {stale.slice(0, 6).map(({ matter, idle }) => (
                        <div key={matter.id} style={{ padding: "9px 0", borderBottom: "1px dashed var(--line)" }}>
                          <button onClick={() => { setSelectedId(matter.id); setActiveTab("overview"); }} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontSize: 13, fontWeight: 600, color: "var(--ink)", textAlign: "left" }}>
                            {matter.reference} — {matter.address}
                          </button>
                          <div style={{ fontSize: 11.5, color: "#8a3b1f", fontWeight: 600, marginTop: 2 }}>No activity for {idle} days</div>
                        </div>
                      ))}
                    </div>

                    {workload.length > 1 && (
                      <div className="ac-card" style={{ gridColumn: "1 / -1" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                          <h3 style={{ margin: 0 }}><Users size={12} /> Team workload</h3>
                          {settings.currentUser && <button className="ac-tablebtn" onClick={() => setMyMattersOnly(true)}>My matters</button>}
                        </div>
                        {workload.map((w) => (
                          <div key={w.name} style={{ padding: "7px 0" }}>
                            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, marginBottom: 4 }}>
                              <span style={{ fontWeight: w.name === settings.currentUser ? 700 : 500, color: "var(--ink-soft)" }}>{w.name}{w.name === settings.currentUser ? " (you)" : ""}</span>
                              <span style={{ fontFamily: "var(--font-mono)", color: "var(--slate)" }}>{w.count} open</span>
                            </div>
                            <div style={{ height: 6, background: "var(--paper)", borderRadius: 3, overflow: "hidden" }}>
                              <div style={{ height: "100%", width: `${(w.count / maxWorkload) * 100}%`, background: w.name === settings.currentUser ? "var(--brass)" : "var(--line)", borderRadius: 3 }} />
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })()}

            </div>
          )}

          {selected && (
            <MatterDetail
              matter={selected}
              allMatters={matters}
              settings={settings}
              onImportOutlook={() => importFromOutlook(selected.id)}
              onOpenSettings={() => setShowSettings(true)}
              onBack={() => setSelectedId(null)}
              onSetStage={(idx) => setStage(selected.id, idx)}
              onDecideStageRequest={(requestId, approve, note) => decideStageRequest(selected.id, requestId, approve, note)}
              onWithdrawStageRequest={(requestId) => withdrawStageRequest(selected.id, requestId)}
              currentUserId={authUser.id}
              onLoadStandardTasks={() => setShowStandardTasks(true)}
              activeTab={activeTab}
              setActiveTab={setActiveTab}
              onAddDoc={() => setShowAddDoc(true)}
              onAttachFile={(documentId, file) => attachDocumentFile(selected.id, documentId, file)}
              onOpenFile={(doc, download) => openDocumentFile(selected.id, doc, download)}
              onReportOnTitle={() => downloadReportOnTitle(selected)}
              onAddEmail={() => setShowAddEmail(true)}
              onAddNote={() => setShowAddNote(true)}
              onEdit={() => setShowEditMatter(true)}
              onAddEnquiry={() => setShowAddEnquiry(true)}
              onLoadStandardEnquiries={() => setShowStandardEnquiries(true)}
              onSetEnquiryStatus={(enquiryId, status) => setEnquiryStatus(selected.id, enquiryId, status)}
              onLogEnquiryReply={(enquiryId, payload) => logEnquiryReply(selected.id, enquiryId, payload)}
              onAddEnquiryComment={(enquiryId, comment) => addEnquiryComment(selected.id, enquiryId, comment)}
              onMatchEmail={(emailId) => matchEmailManually(selected.id, emailId)}
              onEmailEnquiries={() => setShowEmailEnquiries(true)}
              onAddSearch={() => setShowAddSearch(true)}
              onLoadStandardSearches={() => setShowStandardSearches(true)}
              onUpdateSearch={(s) => setUpdatingSearch(s)}
              onAddUndertaking={() => setShowAddUndertaking(true)}
              onDischargeUndertaking={(u) => setDischargingUndertaking(u)}
              onAddTask={() => setShowAddTask(true)}
              onCompleteTask={(taskId) => completeTask(selected.id, taskId)}
              onReopenTask={(taskId) => reopenTask(selected.id, taskId)}
              onToggleChecklistItem={(item) => toggleChecklistItem(selected.id, item)}
              onConfirmReview={() => setShowConfirmReview(true)}
              onResetReview={() => resetPreCompletionReview(selected.id)}
              staleDays={settings.staleDays}
              onOpenLinked={(id) => { setSelectedId(id); setActiveTab("overview"); }}
              onSaveField={(patch) => updateMatter(selected.id, (m) => ({ ...m, ...patch }))}
              saveState={saveState}
            />
          )}
        </div>
      </div>

      {showNewMatter && <NewMatterForm onClose={() => setShowNewMatter(false)} onCreate={addMatter} users={users} />}
      {showEditMatter && selected && <EditMatterForm matter={selected} allMatters={matters} users={users} onClose={() => setShowEditMatter(false)} onSave={(patch) => editMatterDetails(selected.id, patch)} />}
      {showAddDoc && selected && <AddDocForm onClose={() => setShowAddDoc(false)} onAdd={(d, file) => addDocument(selected.id, d, file)} />}
      {showAddEmail && selected && <AddEmailForm onClose={() => setShowAddEmail(false)} onAdd={(e) => addEmail(selected.id, e)} />}
      {showAddNote && selected && <AddNoteForm onClose={() => setShowAddNote(false)} onAdd={(text) => addNote(selected.id, text)} />}
      {showAddEnquiry && selected && <AddEnquiryForm onClose={() => setShowAddEnquiry(false)} onAdd={(q) => addEnquiry(selected.id, q)} />}
      {showStandardEnquiries && selected && <StandardEnquiriesModal onClose={() => setShowStandardEnquiries(false)} onAdd={(qs) => addStandardEnquiries(selected.id, qs)} />}
      {showEmailEnquiries && selected && <EmailEnquiriesModal matter={selected} onClose={() => setShowEmailEnquiries(false)} onSend={(payload) => emailEnquiries(selected.id, payload)} />}
      {showAddSearch && selected && <AddSearchForm onClose={() => setShowAddSearch(false)} onAdd={(s) => addSearch(selected.id, s)} />}
      {showStandardSearches && selected && <StandardSearchesModal onClose={() => setShowStandardSearches(false)} onAdd={(types) => addStandardSearches(selected.id, types)} />}
      {updatingSearch && selected && <UpdateSearchForm search={updatingSearch} onClose={() => setUpdatingSearch(null)} onSave={(patch) => updateSearch(selected.id, updatingSearch.id, patch)} />}
      {showAddUndertaking && selected && <AddUndertakingForm onClose={() => setShowAddUndertaking(false)} onAdd={(u) => addUndertaking(selected.id, u)} />}
      {dischargingUndertaking && selected && <DischargeUndertakingForm undertaking={dischargingUndertaking} onClose={() => setDischargingUndertaking(null)} onSave={(date) => dischargeUndertaking(selected.id, dischargingUndertaking.id, date)} />}
      {showAddTask && selected && <AddTaskForm onClose={() => setShowAddTask(false)} onAdd={(t) => addTask(selected.id, t)} />}
      {showConfirmReview && selected && (
        <ConfirmReviewForm
          matter={selected}
          defaultName={settings.currentUser}
          onClose={() => setShowConfirmReview(false)}
          onConfirm={(name) => { confirmPreCompletionReview(selected.id, name); setShowConfirmReview(false); }}
        />
      )}
      {showTasksPanel && (
        <GlobalTasksPanel
          matters={matters}
          settings={settings}
          onClose={() => setShowTasksPanel(false)}
          onOpenMatter={(id) => { setSelectedId(id); setActiveTab("tasks"); setShowTasksPanel(false); }}
          onCompleteTask={(matterId, taskId) => completeTask(matterId, taskId)}
        />
      )}
      {showSettings && (
        <SettingsPanel
          isAdmin={authUser.role === "admin"}
          settings={settings}
          matters={matters}
          onClose={() => setShowSettings(false)}
          onSave={saveSettings}
          onConnectOutlook={() => setShowOutlookConsent(true)}
          onDisconnectOutlook={() => saveSettings({ outlookConnected: false })}
        />
      )}
      {showChangePassword && <ChangePasswordForm onClose={() => setShowChangePassword(false)} />}
      {stageRequestDraft && (
        <StageRequestForm
          stageIndex={stageRequestDraft.stageIndex}
          onClose={() => setStageRequestDraft(null)}
          onSubmit={(note) => requestStage(stageRequestDraft.matterId, stageRequestDraft.stageIndex, note)}
        />
      )}
      {showStandardTasks && selected && (
        <StandardTasksForm
          matter={selected}
          onClose={() => setShowStandardTasks(false)}
          onAdd={async (tasks) => { await api.addTasks(selected.id, tasks); await afterMutation(); setShowStandardTasks(false); }}
        />
      )}
      {showStaff && (
        <StaffPanel
          users={users}
          currentUserId={authUser.id}
          onClose={() => setShowStaff(false)}
          onChanged={() => api.getUsers().then(setUsers).catch(() => {})}
        />
      )}
      {showImport && <ImportMattersForm onClose={() => setShowImport(false)} onImported={refreshList} />}
      {showOutlookConsent && (
        <OutlookConsentModal
          onCancel={() => setShowOutlookConsent(false)}
          onApprove={() => { saveSettings({ outlookConnected: true }); setShowOutlookConsent(false); }}
        />
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Matter detail                                                          */
/* ---------------------------------------------------------------------- */

function ReportOnTitleCard({ matter, onGenerate }) {
  const [busy, setBusy] = useState(false);
  const searches = matter.searches;
  const received = searches.filter((s) => s.dateReceived).length;
  const issues = searches.filter((s) => s.issue).length;
  const answered = matter.enquiries.filter((q) => q.status === "Answered").length;
  const pendingReview = matter.enquiries.filter((q) => q.status === "Pending Review").length;
  const ready = searches.length > 0 && received === searches.length && answered === matter.enquiries.length;
  const missing = [
    !matter.clientDetails.address && "client address",
    !matter.clientDetails.salutation && "\u201cDear \u2026\u201d",
    !matter.property.tenure && "tenure",
    !matter.property.titleNumber && "title number",
    !matter.property.registeredProprietor && "registered owner",
    isLeasehold(matter.property.tenure) && !matter.property.leaseTerm && "lease term",
    matter.type === "Purchase" && matter.money.deposit === "" && "deposit",
    matter.type === "Purchase" && matter.money.sdlt === "" && "SDLT",
  ].filter(Boolean);

  async function generate() {
    setBusy(true);
    try { await onGenerate(); } finally { setBusy(false); }
  }

  return (
    <div className="ac-card" style={{ marginBottom: 18 }}>
      <h3 style={{ marginBottom: 10 }}><FileSignature size={12} /> Report on Title</h3>
      <div className="ac-kv"><span className="k">Searches back</span><span>{received} of {searches.length}{issues ? ` · ${issues} issue${issues === 1 ? "" : "s"}` : ""}</span></div>
      <div className="ac-kv"><span className="k">Enquiries satisfactory</span><span>{answered} of {matter.enquiries.length}{pendingReview ? ` · ${pendingReview} to check` : ""}</span></div>
      <p style={{ fontSize: 12, color: ready ? "var(--success)" : "var(--slate)", margin: "8px 0 10px" }}>
        {ready
          ? "All searches and enquiries are in — ready to report."
          : searches.length === 0
            ? "No searches recorded yet. You can still produce a draft; gaps are highlighted in it."
            : "Not everything is in yet. You can still produce a draft; anything outstanding is highlighted in it."}
      </p>
      {missing.length > 0 && (
        <p style={{ fontSize: 12, color: "var(--slate)", margin: "0 0 10px" }}>
          Details not filled in yet (they'll be highlighted in the report): {missing.join(", ")}. Add them with <em>Edit details</em>.
        </p>
      )}
      <button className="ac-submit" type="button" onClick={generate} disabled={busy} style={{ width: "100%" }}>
        <Download size={14} /> {busy ? "Preparing…" : "Download draft (Word)"}
      </button>
      <p style={{ fontSize: 11, color: "var(--slate-light)", margin: "8px 0 0" }}>
        Pulls in the client, property, searches and enquiry replies. Highlighted parts need completing before it's sent.
      </p>
    </div>
  );
}

function StageRequestForm({ stageIndex, onClose, onSubmit }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(e) {
    e.preventDefault();
    setBusy(true); setError("");
    try { await onSubmit(note); } catch (err) { setError(err.message || "Couldn't send the request."); setBusy(false); }
  }
  return (
    <div className="ac-overlay center" onClick={onClose}>
      <form className="ac-modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="ac-modal-head">
          <h2>Request sign-off</h2>
          <button type="button" className="ac-iconbtn" onClick={onClose}><X size={18} /></button>
        </div>
        <p style={{ fontSize: 13.5, marginTop: 0 }}>
          Ask the fee earner to sign off moving this matter to <strong>{STAGES[stageIndex].name}</strong>. It moves once they approve.
        </p>
        <div className="ac-field">
          <label>Note for the fee earner (optional)</label>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. All searches back and clear; report sent to client" style={{ minHeight: 70 }} autoFocus />
        </div>
        {error && <p style={{ color: "var(--danger)", fontSize: 12.5 }}>{error}</p>}
        <button className="ac-submit" type="submit" disabled={busy}><Send size={14} /> {busy ? "Sending…" : "Send for sign-off"}</button>
      </form>
    </div>
  );
}

function StageRequestBanner({ matter, currentUserId, onDecide, onWithdraw }) {
  const r = matter.pendingStageRequest;
  const [declining, setDeclining] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const mine = r.requestedBy === currentUserId;
  const canDecide = matter.canSignOffStages && !mine;

  async function decide(approve) {
    setBusy(true);
    try { await onDecide(r.id, approve, note); setDeclining(false); setNote(""); }
    catch (err) { window.alert(err.message || "Couldn't record the decision."); }
    finally { setBusy(false); }
  }

  return (
    <div className="ac-signoff-banner">
      <div style={{ minWidth: 0 }}>
        <div className="txt">
          <ShieldCheck size={13} style={{ verticalAlign: -2 }} /> <strong>Sign-off requested</strong>
          {" "}by {mine ? "you" : r.requestedByName} to move from <strong>{STAGES[r.fromStage]?.name}</strong> to <strong>{STAGES[r.toStage].name}</strong>
          {" "}· {new Date(r.requestedAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
        </div>
        {r.note && <div className="note">“{r.note}”</div>}
        {!canDecide && !mine && <div className="note" style={{ fontStyle: "normal" }}>Waiting for the matter's fee earner to sign off.</div>}
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        {canDecide && !declining && (
          <>
            <button className="ac-tablebtn primary" disabled={busy} onClick={() => decide(true)}><Check size={12} /> Approve &amp; move</button>
            <button className="ac-tablebtn" disabled={busy} onClick={() => setDeclining(true)}>Decline…</button>
          </>
        )}
        {canDecide && declining && (
          <>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Reason (required)" style={{ minWidth: 220 }} autoFocus />
            <button className="ac-tablebtn" disabled={busy || !note.trim()} onClick={() => decide(false)}>Decline</button>
            <button className="ac-tablebtn" onClick={() => { setDeclining(false); setNote(""); }}>Cancel</button>
          </>
        )}
        {mine && <button className="ac-tablebtn" onClick={() => onWithdraw(r.id)}>Withdraw request</button>}
      </div>
    </div>
  );
}

/** Date each stage was last reached, from the "Moved to …" entries in the activity log. */
function stageReachedDates(matter) {
  const dates = {};
  for (const a of matter.activity || []) {
    if (a.type !== "stage") continue;
    const idx = a.text === "Matter opened at Instructed" ? 0 : STAGES.findIndex((s) => a.text === `Moved to ${s.name}`);
    if (idx >= 0 && (!dates[idx] || new Date(a.date) > new Date(dates[idx]))) dates[idx] = a.date;
  }
  if (!dates[0] && matter.keyDates?.instructed) dates[0] = matter.keyDates.instructed;
  return dates;
}

function StageTimeline({ matter, onSetStage }) {
  const currentIdx = matter.currentStageIndex;
  const reached = stageReachedDates(matter);
  const current = STAGES[currentIdx];
  const trackRef = useRef(null);

  // On narrow screens the track scrolls sideways — keep the current stage in view.
  useEffect(() => {
    const track = trackRef.current;
    const step = track?.children[currentIdx];
    if (track && step && track.scrollWidth > track.clientWidth) {
      track.scrollLeft = step.offsetLeft - track.clientWidth / 2 + step.clientWidth / 2;
    }
  }, [matter.id, currentIdx]);
  return (
    <div className="ac-timeline">
      <div className="ac-timeline-head">
        <span className="ac-tracker-title" style={{ padding: 0 }}>Matter progress</span>
        <span className="ac-timeline-now">
          Stage {currentIdx + 1} of {STAGES.length}: <strong>{current.name}</strong> — {current.hint}
        </span>
      </div>
      <div className="ac-timeline-track" ref={trackRef}>
        {STAGES.map((s, idx) => {
          const state = idx < currentIdx ? "done" : idx === currentIdx ? "current" : "todo";
          const requested = matter.pendingStageRequest?.toStage === idx;
          const date = idx <= currentIdx ? reached[idx] : null;
          return (
            <button key={s.name} type="button" className={`ac-tl-step ${state} ${requested ? "requested" : ""}`} onClick={() => onSetStage(idx)}
              title={requested ? `${s.name} — awaiting sign-off` : matter.stageMovesNeedSignoff && idx !== currentIdx ? `${s.name} — click to request sign-off to move here` : `${s.name} — ${s.hint}`}>
              <span className={`ac-stamp ${state === "todo" ? "" : state}`}>
                {state === "done" ? <Check size={12} /> : state === "current" ? <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#fff" }} /> : null}
              </span>
              <span className="ac-tl-label">{s.name}</span>
              {requested && <span className="ac-tl-date" style={{ color: "var(--brass)", fontWeight: 600 }}>awaiting sign-off</span>}
              {date && <span className="ac-tl-date" title={formatDate(date)}>{new Date(date).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function EnquiryCard({ enquiry: q, incomingEmails, onSetStatus, onLogReply, onAddComment }) {
  const [mode, setMode] = useState(null); // "reply" | "comment" | null
  const [reply, setReply] = useState({ text: "", date: new Date().toISOString().slice(0, 10), emailId: "", status: "Pending Review" });
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const st = enquiryStatus(q.status);

  function close() {
    setMode(null); setError("");
    setReply({ text: "", date: new Date().toISOString().slice(0, 10), emailId: "", status: "Pending Review" });
    setComment("");
  }

  async function run(fn) {
    setBusy(true); setError("");
    try { await fn(); close(); } catch (err) { setError(err.message || "Couldn't save."); } finally { setBusy(false); }
  }

  const chosenEmail = incomingEmails.find((e) => e.id === reply.emailId);

  return (
    <div className="ac-enq">
      <div className="ac-enq-head">
        <span className="ac-enq-num">{q.number}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="ac-enq-q">{q.question}</div>
          <div className="ac-enq-meta">
            Raised {formatDate(q.dateRaised)}
            {q.replies.length > 0 && ` · ${q.replies.length} repl${q.replies.length === 1 ? "y" : "ies"}`}
            {q.comments.length > 0 && ` · ${q.comments.length} comment${q.comments.length === 1 ? "" : "s"}`}
          </div>
        </div>
        <select className={`ac-enq-status ac-pill--${st.pill}`} value={q.status} onChange={(e) => onSetStatus(e.target.value)} title="Change status">
          {ENQUIRY_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
      </div>

      {(q.replies.length > 0 || q.comments.length > 0) && (
        <div className="ac-enq-log">
          {[
            // Chronological: replies by the day they were received, comments by the day written;
            // within a day, the order they were logged.
            ...q.replies.map((r) => ({ kind: "reply", sort: `${String(r.date).slice(0, 10)}|${new Date(r.createdAt).toISOString()}`, ...r })),
            ...q.comments.map((c) => ({ kind: "comment", sort: `${new Date(c.at).toISOString().slice(0, 10)}|${new Date(c.at).toISOString()}`, ...c })),
          ]
            .sort((a, b) => a.sort.localeCompare(b.sort))
            .map((item) => (
              <div key={`${item.kind}-${item.id}`} className={`ac-enq-entry ${item.kind}`}>
                <div className="ac-enq-entry-meta">
                  {item.kind === "reply" ? (
                    <>
                      <strong>Reply</strong> · received {formatDate(item.date)}
                      {item.emailSubject && <> · from email “{item.emailSubject}”</>}
                      {item.by && <> · logged by {item.by}</>}
                    </>
                  ) : (
                    <>
                      <strong>Comment</strong> · {item.by || "—"} · {new Date(item.at).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                    </>
                  )}
                </div>
                <div className="ac-enq-entry-text">{item.text}</div>
              </div>
            ))}
        </div>
      )}

      {mode === null && (
        <div className="ac-enq-actions">
          <button className="ac-tablebtn" onClick={() => setMode("reply")}><Mail size={12} /> Log reply</button>
          <button className="ac-tablebtn" onClick={() => setMode("comment")}><StickyNote size={12} /> Add comment</button>
        </div>
      )}

      {mode === "reply" && (
        <form className="ac-enq-form" onSubmit={(e) => { e.preventDefault(); run(() => onLogReply({ reply: reply.text, dateReceived: reply.date, emailId: reply.emailId || undefined, status: reply.status })); }}>
          <div className="ac-field">
            <label>Link an email on this matter (optional)</label>
            <select value={reply.emailId} onChange={(e) => {
              const em = incomingEmails.find((x) => x.id === e.target.value);
              setReply({ ...reply, emailId: e.target.value, date: em ? String(em.date).slice(0, 10) : reply.date });
            }}>
              <option value="">— None: type or paste the reply below —</option>
              {incomingEmails.map((em) => <option key={em.id} value={em.id}>{formatDate(em.date)} — {em.subject}</option>)}
            </select>
          </div>
          <div className="ac-field">
            <label>Reply</label>
            <textarea value={reply.text} onChange={(e) => setReply({ ...reply, text: e.target.value })}
              placeholder={chosenEmail ? "Leave blank to use the email's text, or paste just the relevant part" : "Paste or type the other side's reply"} style={{ minHeight: 70 }} autoFocus />
          </div>
          <div className="ac-row2">
            <div className="ac-field">
              <label>Received</label>
              <input type="date" value={reply.date} onChange={(e) => setReply({ ...reply, date: e.target.value })} />
            </div>
            <div className="ac-field">
              <label>Status after this reply</label>
              <select value={reply.status} onChange={(e) => setReply({ ...reply, status: e.target.value })}>
                {ENQUIRY_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>
          </div>
          {error && <p style={{ color: "var(--danger)", fontSize: 12.5 }}>{error}</p>}
          <div className="ac-enq-actions">
            <button className="ac-tablebtn primary" type="submit" disabled={busy || (!reply.text.trim() && !reply.emailId)}><Check size={12} /> {busy ? "Saving…" : "Save reply"}</button>
            <button className="ac-tablebtn" type="button" onClick={close}>Cancel</button>
          </div>
        </form>
      )}

      {mode === "comment" && (
        <form className="ac-enq-form" onSubmit={(e) => { e.preventDefault(); run(() => onAddComment(comment)); }}>
          <div className="ac-field">
            <label>Comment</label>
            <textarea value={comment} onChange={(e) => setComment(e.target.value)} placeholder="e.g. Reply doesn't cover the extension — chase for building regs sign-off" style={{ minHeight: 60 }} autoFocus />
          </div>
          {error && <p style={{ color: "var(--danger)", fontSize: 12.5 }}>{error}</p>}
          <div className="ac-enq-actions">
            <button className="ac-tablebtn primary" type="submit" disabled={busy || !comment.trim()}><Check size={12} /> {busy ? "Saving…" : "Save comment"}</button>
            <button className="ac-tablebtn" type="button" onClick={close}>Cancel</button>
          </div>
        </form>
      )}
    </div>
  );
}

function MatterDetail({ matter, allMatters, settings, onImportOutlook, onOpenSettings, onBack, onSetStage, onDecideStageRequest, onWithdrawStageRequest, currentUserId, onLoadStandardTasks, activeTab, setActiveTab, onAddDoc, onAttachFile, onOpenFile, onReportOnTitle, onAddEmail, onAddNote, onEdit, onAddEnquiry, onLoadStandardEnquiries, onSetEnquiryStatus, onLogEnquiryReply, onAddEnquiryComment, onMatchEmail, onEmailEnquiries, onAddSearch, onLoadStandardSearches, onUpdateSearch, onAddUndertaking, onDischargeUndertaking, onAddTask, onCompleteTask, onReopenTask, onToggleChecklistItem, onConfirmReview, onResetReview, staleDays, onOpenLinked, onSaveField, saveState }) {
  const [notesDraft, setNotesDraft] = useState(matter.notes || "");
  useEffect(() => setNotesDraft(matter.notes || ""), [matter.id]);

  return (
    <div>
      <div className="ac-detail-head">
        <button className="ac-backlink" onClick={onBack}><ArrowLeft size={14} /> Back to matters</button>
        <div className="ac-detail-top">
          <div>
            <div className="ac-detail-ref">N° {matter.reference}</div>
            <h2 className="ac-detail-addr">{matter.address}</h2>
            <div className="ac-detail-meta">
              <TypeTag type={matter.type} />
              <StagePill idx={matter.currentStageIndex} />
              <span className="ac-detail-price"><PoundSterling size={11} style={{ verticalAlign: -1 }} /> {formatMoney(matter.price)}</span>
              <span style={{ fontSize: 12.5, color: "var(--slate)" }}>Client: <strong style={{ color: "var(--ink)" }}>{matter.client}</strong></span>
            </div>
            {matter.linkedMatters.length > 0 && (
              <div className="ac-linked-bar">
                <span><Link2 size={12} style={{ verticalAlign: -2 }} /> Linked:</span>
                {matter.linkedMatters.map((l) => (
                  <button key={l.id} type="button" className="ac-linked-chip" onClick={() => onOpenLinked(l.id)} title={`Open ${l.reference} — ${l.address}`}>
                    <TypeTag type={l.type} />
                    <span className="addr">{l.address}</span>
                    <ChevronRight size={12} />
                  </button>
                ))}
              </div>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div className="ac-savebadge">{saveState === "saving" ? "Saving…" : saveState === "saved" ? <><Check size={12} /> Saved</> : ""}</div>
            <button className="ac-addbtn" onClick={onEdit}><FileSignature size={13} /> Edit details</button>
          </div>
        </div>
        <div className="ac-tabs">
          {[
            ["overview", <><Clock size={13} /> Overview</>],
            ["enquiries", <><FileSearch size={13} /> Enquiries ({matter.enquiries.length})</>],
            ["searches", <><ShieldCheck size={13} /> Searches ({matter.searches.length})</>],
            ["undertakings", <><Gavel size={13} /> Undertakings ({matter.undertakings.length})</>],
            ["tasks", <><ListChecks size={13} /> Tasks ({matter.tasks.filter((t) => t.status === "Open").length})</>],
            ["documents", <><FileText size={13} /> Documents ({matter.documents.length})</>],
            ["emails", <><Mail size={13} /> Emails ({matter.emails.length})</>],
          ].map(([k, label]) => (
            <button key={k} className={`ac-tab ${activeTab === k ? "active" : ""}`} onClick={() => setActiveTab(k)} style={{ display: "flex", alignItems: "center", gap: 5, whiteSpace: "nowrap" }}>{label}</button>
          ))}
        </div>
      </div>

      {activeTab === "overview" && (
        <div className="ac-detail-body">
          {matter.pendingStageRequest && (
            <StageRequestBanner
              matter={matter}
              currentUserId={currentUserId}
              onDecide={onDecideStageRequest}
              onWithdraw={onWithdrawStageRequest}
            />
          )}
          <StageTimeline matter={matter} onSetStage={onSetStage} />
          <div className="ac-col-main">
            {(() => {
              const attention = needsAttention(matter, staleDays);
              const sdlt = sdltInfo(matter);
              if (attention.length === 0 && !sdlt) return null;
              return (
                <div className="ac-card" style={{ borderColor: attention.length ? "#e2a06a" : "var(--line)", background: attention.length ? "#fdf1ea" : "var(--card)" }}>
                  <h3><AlertTriangle size={12} /> Needs attention</h3>
                  {attention.map((r, i) => (
                    <div key={i} style={{ fontSize: 12.5, color: "#8a3b1f", padding: "5px 0", borderBottom: i < attention.length - 1 || sdlt ? "1px dashed var(--line)" : "none" }}>⚠ {r}</div>
                  ))}
                  {sdlt && (
                    <div style={{ fontSize: 12.5, color: sdlt.overdue ? "#8a3b1f" : sdlt.dueSoon ? "#8a3b1f" : "var(--ink-soft)", padding: "5px 0" }}>
                      {sdlt.filed ? `SDLT return filed (deadline was ${formatDate(sdlt.deadline)})` : sdlt.overdue ? `⚠ SDLT return is overdue — was due ${formatDate(sdlt.deadline)}` : sdlt.dueSoon ? `⚠ SDLT return due ${formatDate(sdlt.deadline)} — ${sdlt.daysLeft} day${sdlt.daysLeft === 1 ? "" : "s"} left` : `SDLT return due ${formatDate(sdlt.deadline)}`}
                    </div>
                  )}
                </div>
              );
            })()}

            {matter.linkedMatters.length > 0 && (
              <div className="ac-card">
                <h3><Link2 size={12} /> Chain</h3>
                {matter.linkedMatters.map((linked) => {
                  const lid = linked.id;
                  const dateMismatch = matter.keyDates.targetCompletion && linked.targetCompletion && matter.keyDates.targetCompletion !== linked.targetCompletion;
                  return (
                    <div key={lid} style={{ padding: "9px 0", borderBottom: "1px dashed var(--line)" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                        <button onClick={() => onOpenLinked(lid)} style={{ background: "none", border: "none", padding: 0, fontWeight: 600, fontSize: 13, color: "var(--ink)", cursor: "pointer", textAlign: "left" }}>{linked.address}</button>
                        <StagePill idx={linked.currentStageIndex} />
                      </div>
                      <div style={{ fontSize: 11.5, color: "var(--slate)", marginTop: 2 }}>{linked.reference} · {linked.client} · target completion {formatDate(linked.targetCompletion)}</div>
                      {dateMismatch && <div style={{ fontSize: 11.5, color: "#8a3b1f", marginTop: 3 }}>⚠ Target completion dates don't match across the chain — align before exchange.</div>}
                    </div>
                  );
                })}
              </div>
            )}

            <div className="ac-card">
              <h3><Users size={12} /> Client</h3>
              <div className="ac-kv"><span className="k">Name</span><span className="v">{matter.client}</span></div>
              <div className="ac-kv"><span className="k">Correspondence address</span><span className="v" style={{ whiteSpace: "pre-line", textAlign: "right" }}>{matter.clientDetails.address || "—"}</span></div>
              <div className="ac-kv"><span className="k">Email</span><span className="v mono">{matter.clientDetails.email || "—"}</span></div>
              <div className="ac-kv"><span className="k">Phone</span><span className="v mono">{matter.clientDetails.phone || "—"}</span></div>
              <div className="ac-kv"><span className="k">Letters start</span><span className="v">{matter.clientDetails.salutation ? `Dear ${matter.clientDetails.salutation}` : "—"}</span></div>
            </div>

            <div className="ac-card">
              <h3><Building2 size={12} /> Property &amp; title</h3>
              <div className="ac-kv"><span className="k">Tenure</span><span className="v">{matter.property.tenure || "—"}</span></div>
              <div className="ac-kv"><span className="k">Title number</span><span className="v mono">{matter.property.titleNumber || "—"}</span></div>
              <div className="ac-kv"><span className="k">Registered owner</span><span className="v">{matter.property.registeredProprietor || "—"}</span></div>
              {isLeasehold(matter.property.tenure) && (
                <>
                  <div className="ac-kv"><span className="k">Lease term</span><span className="v">{matter.property.leaseTerm || "—"}</span></div>
                  <div className="ac-kv"><span className="k">Ground rent</span><span className="v">{matter.property.groundRent || "—"}</span></div>
                  <div className="ac-kv"><span className="k">Service charge</span><span className="v">{matter.property.serviceCharge || "—"}</span></div>
                </>
              )}
              {matter.type !== "Sale" && (
                <>
                  <div className="ac-kv"><span className="k">Deposit</span><span className="v mono">{matter.money.deposit !== "" ? formatMoney(matter.money.deposit) : "—"}</span></div>
                  <div className="ac-kv"><span className="k">SDLT payable</span><span className="v mono">{matter.money.sdlt !== "" ? formatMoney(matter.money.sdlt) : "—"}</span></div>
                </>
              )}
              {matter.parties.lender && (
                <div className="ac-kv"><span className="k">Mortgage conditions</span><span className="v" style={{ textAlign: "right" }}>{matter.money.mortgageConditions || "—"}</span></div>
              )}
            </div>

            <div className="ac-card">
              <h3><Users size={12} /> Parties &amp; team</h3>
              <div className="ac-kv"><span className="k">Fee earner</span><span className="v">{matter.feeEarner || "—"}</span></div>
              <div className="ac-kv"><span className="k">Supervisor</span><span className="v">{matter.supervisor || "—"}</span></div>
              <div className="ac-kv"><span className="k">Other side's solicitor</span><span className="v">{matter.parties.otherSideSolicitor || "—"}</span></div>
              <div className="ac-kv"><span className="k">Their email</span><span className="v mono">{matter.parties.otherSideSolicitorEmail || "—"}</span></div>
              <div className="ac-kv"><span className="k">Estate agent</span><span className="v">{matter.parties.estateAgent || "—"}</span></div>
              <div className="ac-kv"><span className="k">Lender</span><span className="v">{matter.parties.lender || "—"}</span></div>
            </div>

            <div className="ac-card">
              <h3><Calendar size={12} /> Key dates</h3>
              <div className="ac-kv"><span className="k">Instructed</span><span className="v mono">{formatDate(matter.keyDates.instructed)}</span></div>
              <div className="ac-kv"><span className="k">Target exchange</span><span className="v mono">{formatDate(matter.keyDates.targetExchange)}</span></div>
              <div className="ac-kv"><span className="k">Actual exchange</span><span className="v mono">{formatDate(matter.keyDates.actualExchange)}</span></div>
              <div className="ac-kv"><span className="k">Target completion</span><span className="v mono">{formatDate(matter.keyDates.targetCompletion)}</span></div>
              <div className="ac-kv"><span className="k">Actual completion</span><span className="v mono">{formatDate(matter.keyDates.actualCompletion)}</span></div>
              {(matter.type === "Purchase" || matter.type === "Remortgage") && (() => {
                const mtg = mortgageExpiryInfo(matter);
                const warn = mtg && (mtg.conflict || mtg.expired || mtg.expiringSoon);
                return (
                  <div className="ac-kv" style={warn ? { background: "#fdf1ea", margin: "0 -18px", padding: "6px 18px" } : {}}>
                    <span className="k" style={warn ? { color: "#8a3b1f", fontWeight: 600, display: "flex", alignItems: "center", gap: 4 } : {}}>
                      {warn && <AlertTriangle size={11} />} Mortgage offer expiry
                    </span>
                    <span className="v mono" style={warn ? { color: "#8a3b1f", fontWeight: 700 } : {}}>{formatDate(matter.keyDates.mortgageOfferExpiry)}</span>
                  </div>
                );
              })()}
            </div>

            <div className="ac-card">
              <h3><StickyNote size={12} /> File notes</h3>
              <textarea
                className="ac-notes-box"
                style={{ width: "100%", border: "1px solid var(--line)", borderRadius: 6, padding: 10, background: "var(--card)", minHeight: 90, outline: "none" }}
                value={notesDraft}
                onChange={(e) => setNotesDraft(e.target.value)}
                onBlur={() => onSaveField({ notes: notesDraft })}
                placeholder="Attendance notes, chain details, anything the next fee-earner should know…"
              />
            </div>

            <div className="ac-card">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <h3 style={{ margin: 0 }}><Clock size={12} /> Activity</h3>
                <button className="ac-addbtn" onClick={onAddNote}><Plus size={12} /> Log update</button>
              </div>
              {matter.activity.slice(0, 10).map((a) => (
                <div key={a.id} className="ac-activity-item">
                  <div className="ac-activity-dot" style={a.type === "note" ? { background: "var(--success)" } : a.type === "edit" ? { background: "var(--slate-light)" } : {}} />
                  <div>
                    <div className="ac-activity-text">{a.text}</div>
                    <div className="ac-activity-date">{formatDate(a.date)}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="ac-col-side">
            {(matter.type === "Purchase" || matter.type === "Remortgage") && <ReportOnTitleCard matter={matter} onGenerate={onReportOnTitle} />}
            <div className="ac-card" style={{ marginBottom: 18 }}>
              <h3 style={{ marginBottom: 10 }}>Workstreams</h3>
              {(() => {
                const w = workstreamStatus(matter);
                const rows = [
                  ["Searches", w.searches],
                  ["Enquiries", w.enquiries],
                  ["Mortgage", w.mortgage],
                ];
                const label = { ready: "Ready", progress: "In progress", pending: "Not started", blocked: "Blocked", "n/a": "Not required" };
                const cls = { ready: "closed", progress: "progress", pending: "setup", blocked: "issue", "n/a": "setup" };
                return (
                  <>
                    {rows.map(([name, status]) => {
                      const isMortgageConflict = name === "Mortgage" && status === "blocked";
                      return (
                        <div key={name}>
                          <div className="ac-kv">
                            <span className="k">{name}</span>
                            <span className={`ac-pill ac-pill--${cls[status]}`}>{isMortgageConflict ? "Expires too soon" : label[status]}</span>
                          </div>
                          {name === "Mortgage" && w.mortgageExpiry && (
                            <div style={{ fontSize: 11, color: isMortgageConflict ? "#8a3b1f" : "var(--slate-light)", textAlign: "right", marginTop: -6, marginBottom: 6 }}>
                              Offer expires {formatDate(w.mortgageExpiry)}
                            </div>
                          )}
                        </div>
                      );
                    })}
                    <div style={{
                      marginTop: 10, padding: "8px 10px", borderRadius: 3, fontSize: 12.5, fontWeight: 600, textAlign: "center",
                      background: w.readyToExchange ? "var(--success-bg)" : "var(--paper)", color: w.readyToExchange ? "var(--success)" : "var(--slate)",
                    }}>
                      {w.readyToExchange ? "✓ Ready to exchange" : "Not yet ready to exchange"}
                    </div>
                  </>
                );
              })()}
            </div>

            <div className="ac-card" style={{ marginBottom: 18 }}>
              <h3>Pre-Exchange Review</h3>
              {matter.preCompletionReview.confirmedBy ? (
                <div>
                  <div style={{ background: "var(--success-bg)", color: "var(--success)", borderRadius: 3, padding: "9px 10px", fontSize: 12.5, fontWeight: 600, display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
                    <Check size={13} /> Reviewed by {matter.preCompletionReview.confirmedBy} on {formatDate(matter.preCompletionReview.confirmedDate)}
                  </div>
                  <button className="ac-tablebtn" onClick={onResetReview}>Something changed — reset review</button>
                </div>
              ) : (
                <>
                  <p style={{ fontSize: 11.5, color: "var(--slate)", marginTop: 0, marginBottom: 10 }}>
                    Check the file over before exchange — this is the point contracts become legally binding. Confirming this signs off that it's ready to proceed.
                  </p>
                  {PRE_COMPLETION_CHECKLIST.map((item) => (
                    <label key={item} style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 12.5, fontWeight: 400, color: "var(--ink-soft)", padding: "5px 0", lineHeight: 1.4, cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={matter.preCompletionReview.checkedItems.includes(item)}
                        onChange={() => onToggleChecklistItem(item)}
                        style={{ width: "auto", marginTop: 2, flexShrink: 0 }}
                      />
                      {item}
                    </label>
                  ))}
                  <div style={{ fontSize: 11, color: "var(--slate-light)", margin: "8px 0 10px" }}>
                    {matter.preCompletionReview.checkedItems.length} of {PRE_COMPLETION_CHECKLIST.length} checked
                  </div>
                  <button
                    className="ac-submit"
                    style={{ marginTop: 0 }}
                    disabled={matter.preCompletionReview.checkedItems.length < PRE_COMPLETION_CHECKLIST.length}
                    onClick={onConfirmReview}
                  >
                    <Check size={14} /> Confirm reviewed &amp; ready to exchange
                  </button>
                </>
              )}
            </div>

          </div>
        </div>
      )}

      {activeTab === "enquiries" && (
        <div className="ac-detail-body" style={{ gridTemplateColumns: "1fr" }}>
          <div className="ac-col-main">
            <div className="ac-section-head">
              <h2>Pre-contract enquiries</h2>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="ac-addbtn" onClick={onLoadStandardEnquiries}><FileSearch size={13} /> Use standard template</button>
                <button className="ac-addbtn" onClick={onAddEnquiry}><Plus size={13} /> Add enquiry</button>
                <button
                  className="ac-addbtn"
                  style={{ background: "var(--brass)" }}
                  onClick={onEmailEnquiries}
                  disabled={!matter.enquiries.some((q) => q.status === "Outstanding")}
                >
                  <Send size={13} /> Email raised enquiries to other side
                </button>
              </div>
            </div>

            {matter.enquiries.length === 0 && <p style={{ color: "var(--slate)", fontSize: 13 }}>No enquiries raised yet.</p>}

            {matter.enquiries.length > 0 && (
              <div className="ac-enq-summary">
                {ENQUIRY_STATUSES.map((st) => (
                  <span key={st.value}><span className={`ac-pill ac-pill--${st.pill}`}>{st.label}</span> {matter.enquiries.filter((q) => q.status === st.value).length}</span>
                ))}
              </div>
            )}
            {matter.enquiries.map((q) => (
              <EnquiryCard
                key={q.id}
                enquiry={q}
                incomingEmails={matter.emails.filter((e) => e.direction === "in")}
                onSetStatus={(status) => onSetEnquiryStatus(q.id, status)}
                onLogReply={(payload) => onLogEnquiryReply(q.id, payload)}
                onAddComment={(comment) => onAddEnquiryComment(q.id, comment)}
              />
            ))}
            {!matter.parties.otherSideSolicitorEmail && matter.enquiries.length > 0 && (
              <p style={{ fontSize: 11.5, color: "var(--slate)", marginTop: 10 }}>
                No email address is on file for the other side's solicitor — add one via "Edit details" before emailing enquiries.
              </p>
            )}
          </div>
        </div>
      )}

      {activeTab === "searches" && (
        <div className="ac-detail-body" style={{ gridTemplateColumns: "1fr" }}>
          <div className="ac-col-main">
            <div className="ac-section-head">
              <h2>Searches</h2>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="ac-addbtn" onClick={onLoadStandardSearches}><ShieldCheck size={13} /> Use standard template</button>
                <button className="ac-addbtn" onClick={onAddSearch}><Plus size={13} /> Add search</button>
              </div>
            </div>

            {matter.searches.length > 0 && (
              <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
                {["ordered", "overdue", "received", "issue"].map((phase) => {
                  const n = matter.searches.filter((s) => searchStatus(s) === phase).length;
                  if (!n) return null;
                  return <span key={phase} className={`ac-pill ac-pill--${phase === "ordered" ? "setup" : phase === "overdue" ? "critical" : phase === "received" ? "closed" : "issue"}`}>{n} {SEARCH_STATUS_LABEL[phase].toLowerCase()}</span>;
                })}
              </div>
            )}

            {matter.searches.length === 0 && <p style={{ color: "var(--slate)", fontSize: 13 }}>No searches ordered yet.</p>}

            {matter.searches.length > 0 && (
              <table className="ac-table">
                <thead>
                  <tr>
                    <th>Search</th>
                    <th style={{ width: 100 }}>Ordered</th>
                    <th style={{ width: 100 }}>Expected</th>
                    <th style={{ width: 100 }}>Received</th>
                    <th style={{ width: 120 }}>Status</th>
                    <th style={{ width: 70 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {matter.searches.map((s) => {
                    const st = searchStatus(s);
                    return (
                      <React.Fragment key={s.id}>
                        <tr className={st === "issue" ? "ac-row-issue" : ""}>
                          <td>{s.type}</td>
                          <td className="mono">{formatDate(s.dateOrdered)}</td>
                          <td className="mono">{formatDate(s.expectedReturn)}</td>
                          <td className="mono">{formatDate(s.dateReceived)}</td>
                          <td><span className={`ac-pill ac-pill--${st === "ordered" ? "setup" : st === "overdue" ? "critical" : st === "received" ? "closed" : "issue"}`}>{SEARCH_STATUS_LABEL[st]}</span></td>
                          <td><button className="ac-tablebtn" onClick={() => onUpdateSearch(s)}>Update</button></td>
                        </tr>
                        {s.issue && s.issueNotes && (
                          <tr className="ac-row-issue">
                            <td colSpan={6} style={{ fontSize: 12, color: "#8a3b1f", paddingTop: 0 }}>⚠ {s.issueNotes}</td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {activeTab === "undertakings" && (
        <div className="ac-detail-body" style={{ gridTemplateColumns: "1fr" }}>
          <div className="ac-col-main">
            <div className="ac-section-head">
              <h2>Undertakings</h2>
              <button className="ac-addbtn" onClick={onAddUndertaking}><Plus size={13} /> Add undertaking</button>
            </div>
            <p style={{ fontSize: 11.5, color: "var(--slate)", marginTop: -8, marginBottom: 14 }}>
              A breach of an undertaking is a professional conduct matter — keep this list current and don't close the file with anything still outstanding here.
            </p>

            {matter.undertakings.length === 0 && <p style={{ color: "var(--slate)", fontSize: 13 }}>No undertakings on this file.</p>}

            {matter.undertakings.length > 0 && (
              <table className="ac-table">
                <thead>
                  <tr>
                    <th style={{ width: 90 }}>Direction</th>
                    <th>Description</th>
                    <th style={{ width: 140 }}>Party</th>
                    <th style={{ width: 100 }}>Given</th>
                    <th style={{ width: 120 }}>Status</th>
                    <th style={{ width: 80 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {matter.undertakings.map((u) => (
                    <tr key={u.id} className={u.status === "Outstanding" ? "ac-row-issue" : ""}>
                      <td><span className="ac-typetag">{u.direction === "given" ? "Given" : "Received"}</span></td>
                      <td>{u.description}</td>
                      <td>{u.party}</td>
                      <td className="mono">{formatDate(u.dateGiven)}</td>
                      <td><span className={`ac-pill ac-pill--${u.status === "Discharged" ? "closed" : "issue"}`}>{u.status}</span></td>
                      <td>{u.status === "Outstanding" && <button className="ac-tablebtn" onClick={() => onDischargeUndertaking(u)}>Discharge</button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {activeTab === "tasks" && (
        <div className="ac-detail-body" style={{ gridTemplateColumns: "1fr" }}>
          <div className="ac-col-main">
            <div className="ac-section-head">
              <h2>Tasks &amp; reminders</h2>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="ac-addbtn" onClick={onLoadStandardTasks}><ListChecks size={13} /> Use standard tasks</button>
                <button className="ac-addbtn" onClick={onAddTask}><Plus size={13} /> Add task</button>
              </div>
            </div>

            {matter.tasks.filter((t) => t.status === "Open").length === 0 && matter.tasks.filter((t) => t.status === "Done").length === 0 && (
              <p style={{ color: "var(--slate)", fontSize: 13 }}>No tasks on this file.</p>
            )}

            {matter.tasks.filter((t) => t.status === "Open").length > 0 && (
              <>
                {matter.tasks.filter((t) => t.status === "Open").sort((a, b) => (a.dueDate || "9999").localeCompare(b.dueDate || "9999")).map((t) => {
                  const overdue = t.dueDate && new Date(t.dueDate) < new Date();
                  return (
                    <div key={t.id} className={`ac-doc-row ${overdue ? "ac-row-issue" : ""}`} style={{ background: overdue ? "#fdf1ea" : "var(--card)" }}>
                      <div className="ac-doc-icon" style={overdue ? { background: "#f6ddd0", color: "#8a3b1f" } : {}}><ListChecks size={16} /></div>
                      <div style={{ flex: 1 }}>
                        <div className="ac-doc-name">{t.description}</div>
                        <div className="ac-doc-meta" style={overdue ? { color: "#8a3b1f", fontWeight: 600 } : {}}>{t.dueDate ? `${overdue ? "Overdue — was due" : "Due"} ${formatDate(t.dueDate)}` : "No due date"}</div>
                      </div>
                      <button className="ac-tablebtn" onClick={() => onCompleteTask(t.id)}>Mark done</button>
                    </div>
                  );
                })}
              </>
            )}

            {matter.tasks.filter((t) => t.status === "Done").length > 0 && (
              <>
                <h3 style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--slate)", margin: "20px 0 10px" }}>Completed</h3>
                {matter.tasks.filter((t) => t.status === "Done").map((t) => (
                  <div key={t.id} className="ac-doc-row" style={{ opacity: 0.7 }}>
                    <div className="ac-doc-icon" style={{ background: "var(--success-bg)", color: "var(--success)" }}><Check size={16} /></div>
                    <div style={{ flex: 1 }}>
                      <div className="ac-doc-name" style={{ textDecoration: "line-through" }}>{t.description}</div>
                      <div className="ac-doc-meta">Completed {formatDate(t.dateCompleted)}</div>
                    </div>
                    <button className="ac-tablebtn" onClick={() => onReopenTask(t.id)}>Reopen</button>
                  </div>
                ))}
              </>
            )}
          </div>
        </div>
      )}

      {activeTab === "documents" && (
        <div className="ac-detail-body" style={{ gridTemplateColumns: "1fr" }}>
          <div className="ac-col-main">
            <div className="ac-section-head">
              <h2>Documents</h2>
              <button className="ac-addbtn" onClick={onAddDoc}><Plus size={13} /> Add document</button>
            </div>
            {matter.documents.length === 0 && <p style={{ color: "var(--slate)", fontSize: 13 }}>No documents recorded yet.</p>}
            {matter.documents.map((d) => (
              <div key={d.id} className="ac-doc-row">
                <div className="ac-doc-icon"><FileText size={16} /></div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="ac-doc-name">{d.name}</div>
                  <div className="ac-doc-meta">{d.category} · {formatDate(d.date)}</div>
                  {d.fileName && <div className="ac-doc-file"><Paperclip size={11} /> {d.fileName} · {formatFileSize(d.fileSize)}</div>}
                  {d.notes && <div className="ac-doc-notes">{d.notes}</div>}
                </div>
                <div className="ac-doc-actions">
                  {d.fileName ? (
                    <>
                      <button className="ac-tablebtn" onClick={() => onOpenFile(d, false)}>View</button>
                      <button className="ac-tablebtn" onClick={() => onOpenFile(d, true)}><Download size={12} /> Download</button>
                    </>
                  ) : (
                    <label className="ac-tablebtn" style={{ cursor: "pointer" }}>
                      <Paperclip size={12} /> Attach file
                      <input type="file" accept={DOC_FILE_EXTENSIONS.join(",")} style={{ display: "none" }}
                        onChange={(e) => { const file = e.target.files[0]; e.target.value = ""; if (file) onAttachFile(d.id, file); }} />
                    </label>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === "emails" && (
        <div className="ac-detail-body" style={{ gridTemplateColumns: "1fr" }}>
          <div className="ac-col-main">
            <div className="ac-card" style={{ marginBottom: 18 }}>
              <h3><Plug size={12} /> Matter mailbox</h3>
              {settings.outlookConnected ? (
                <>
                  <div className="ac-kv"><span className="k">Outlook</span><span className="v" style={{ color: "var(--success)", display: "flex", alignItems: "center", gap: 5, justifyContent: "flex-end" }}><CheckCircle2 size={13} /> Connected</span></div>
                  <div className="ac-kv"><span className="k">Auto-filing</span><span className="v">{settings.autoFile ? "On" : "Off"}</span></div>
                  <MailboxAddress reference={matter.reference} domain={settings.domain} />
                  <button className="ac-addbtn" style={{ marginTop: 10, width: "100%", justifyContent: "center" }} onClick={onImportOutlook}>
                    <Download size={13} /> Import from Outlook
                  </button>
                  <p style={{ fontSize: 11, color: "var(--slate-light)", marginTop: 8, marginBottom: 0 }}>
                    This adds a placeholder entry so you can see where imported mail would appear — a real integration reads and files actual messages via the Microsoft Graph API.
                  </p>
                </>
              ) : (
                <>
                  <p style={{ fontSize: 12.5, color: "var(--slate)", marginTop: 0 }}>
                    Connect Outlook to file emails to this matter automatically, either by CC'ing its dedicated address or with a "Save to matter" button inside Outlook itself.
                  </p>
                  <MailboxAddress reference={matter.reference} domain={settings.domain} />
                  <button className="ac-addbtn" style={{ marginTop: 10, width: "100%", justifyContent: "center" }} onClick={onOpenSettings}>
                    <Plug size={13} /> Connect Outlook in Settings
                  </button>
                </>
              )}
            </div>

            <div className="ac-section-head">
              <h2>Emails</h2>
              <button className="ac-addbtn" onClick={onAddEmail}><Plus size={13} /> Log email</button>
            </div>
            {matter.emails.length === 0 && <p style={{ color: "var(--slate)", fontSize: 13 }}>No emails logged yet.</p>}
            {matter.emails.map((e) => (
              <div key={e.id} className="ac-email-row">
                <div className={`ac-email-dir ${e.direction}`}>{e.direction === "in" ? "In" : "Out"}</div>
                <div style={{ flex: 1 }}>
                  <div className="ac-email-subject">{e.subject}</div>
                  <div className="ac-email-meta">{e.direction === "in" ? `From ${e.from}` : `To ${e.to}`} · {formatDate(e.date)}</div>
                  <div className="ac-email-body">{e.body}</div>
                  {e.direction === "in" && matter.enquiries.length > 0 && (
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8, alignItems: "center" }}>
                      {matter.enquiries.some((q) => q.status === "Outstanding") && (
                        <button className="ac-tablebtn" onClick={() => onMatchEmail(e.id)}>
                          <FileSearch size={11} style={{ marginRight: 4, verticalAlign: -2 }} />Check for numbered replies
                        </button>
                      )}
                      <select
                        className="ac-tablebtn"
                        value=""
                        onChange={(ev) => {
                          if (!ev.target.value) return;
                          onLogEnquiryReply(ev.target.value, { emailId: e.id }).catch((err) => window.alert(err.message || "Couldn't log the reply."));
                        }}
                        title="Log this whole email as the reply to one enquiry"
                      >
                        <option value="">Log as reply to enquiry…</option>
                        {matter.enquiries.map((q) => (
                          <option key={q.id} value={q.id}>
                            {q.number}. {q.question.length > 60 ? `${q.question.slice(0, 60)}…` : q.question}{q.replies.some((r) => r.emailId === e.id) ? " (already logged)" : ""}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                  {e.direction === "in" && (() => {
                    const linked = matter.enquiries.filter((q) => q.replies.some((r) => r.emailId === e.id));
                    return linked.length > 0 && (
                      <div style={{ fontSize: 11.5, color: "var(--success)", marginTop: 6 }}>
                        <Check size={11} style={{ verticalAlign: -2 }} /> Logged as reply to enquir{linked.length === 1 ? "y" : "ies"} {linked.map((q) => q.number).join(", ")}
                      </div>
                    );
                  })()}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function MailboxAddress({ reference, domain }) {
  const [copied, setCopied] = useState(false);
  const address = `matters+${reference.toLowerCase()}@${domain}`;

  function copy() {
    try {
      navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch (e) {
      /* clipboard unavailable — address is still visible to copy by hand */
    }
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, background: "var(--paper)", border: "1px solid var(--line)", borderRadius: 6, padding: "7px 10px" }}>
      <span style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, color: "var(--ink-soft)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{address}</span>
      <button type="button" className="ac-tablebtn" onClick={copy} style={{ flexShrink: 0 }}>{copied ? "Copied" : <Copy size={11} />}</button>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* New matter form                                                        */
/* ---------------------------------------------------------------------- */

function NewMatterForm({ onClose, onCreate, users }) {
  const [f, setF] = useState({
    address: "", client: "", type: "Purchase", price: "",
    otherSideSolicitor: "", otherSideSolicitorEmail: "", estateAgent: "", lender: "",
    targetExchange: "", targetCompletion: "", feeEarnerId: "", supervisorId: "", mortgageOfferExpiry: "",
    clientDetails: { address: "", email: "", phone: "", salutation: "" },
    property: { tenure: "", titleNumber: "", registeredProprietor: "", leaseTerm: "", groundRent: "", serviceCharge: "" },
  });
  const [error, setError] = useState("");
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const setIn = (group, k) => (e) => setF((prev) => ({ ...prev, [group]: { ...prev[group], [k]: e.target.value } }));

  function submit(e) {
    e.preventDefault();
    if (!f.address.trim() || !f.client.trim()) {
      setError("Property address and client name are both required.");
      return;
    }
    setError("");
    onCreate({
      address: f.address.trim(),
      client: f.client.trim(),
      type: f.type,
      price: f.price ? Number(f.price) : "",
      feeEarnerId: f.feeEarnerId,
      supervisorId: f.supervisorId,
      parties: {
        otherSideSolicitor: f.otherSideSolicitor,
        otherSideSolicitorEmail: f.otherSideSolicitorEmail,
        estateAgent: f.estateAgent,
        lender: f.lender,
      },
      keyDates: {
        instructed: new Date().toISOString().slice(0, 10),
        targetExchange: f.targetExchange,
        targetCompletion: f.targetCompletion,
        actualExchange: "",
        actualCompletion: "",
        mortgageOfferExpiry: f.mortgageOfferExpiry,
      },
      clientDetails: f.clientDetails,
      property: f.property,
    });
  }

  return (
    <div className="ac-overlay" onClick={onClose}>
      <form className="ac-panel" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="ac-panel-head">
          <h2>Open new matter</h2>
          <button type="button" className="ac-iconbtn" onClick={onClose}><X size={18} /></button>
        </div>

        <div className="ac-field">
          <label>Property address</label>
          <input value={f.address} onChange={set("address")} placeholder="14 Mill Race Lane, Winchcombe, GL54 5LX" />
        </div>
        <div className="ac-row2">
          <div className="ac-field">
            <label>Client name</label>
            <input value={f.client} onChange={set("client")} placeholder="R & J Faulkner" />
          </div>
          <div className="ac-field">
            <label>Matter type</label>
            <select value={f.type} onChange={set("type")}>
              {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        </div>
        <div className="ac-field">
          <label>Price</label>
          <input type="number" value={f.price} onChange={set("price")} placeholder="465000" />
        </div>

        <div className="ac-fieldset-title">Client contact</div>
        <ClientDetailsFields value={f.clientDetails} onChange={setIn} />

        <div className="ac-fieldset-title">Property &amp; title</div>
        <PropertyFields value={f.property} onChange={setIn} />

        <div className="ac-fieldset-title">Our team</div>
        <div className="ac-row2">
          <div className="ac-field">
            <label>Fee earner</label>
            <select value={f.feeEarnerId} onChange={set("feeEarnerId")}>
              <option value="">— Select —</option>
              {users.filter((u) => (u.active !== false && isFeeEarnerRole(u.role)) || u.id === f.feeEarnerId).map((u) => <option key={u.id} value={u.id}>{u.name}{u.active === false ? " (deactivated)" : ""}</option>)}
            </select>
          </div>
          <div className="ac-field">
            <label>Supervisor</label>
            <select value={f.supervisorId} onChange={set("supervisorId")}>
              <option value="">— Select —</option>
              {users.filter((u) => (u.active !== false && isFeeEarnerRole(u.role)) || u.id === f.supervisorId).map((u) => <option key={u.id} value={u.id}>{u.name}{u.active === false ? " (deactivated)" : ""}</option>)}
            </select>
          </div>
        </div>

        <div className="ac-fieldset-title">Other side</div>
        <div className="ac-row2">
          <div className="ac-field">
            <label>Their solicitor</label>
            <input value={f.otherSideSolicitor} onChange={set("otherSideSolicitor")} placeholder="Hedley & Bourne LLP" />
          </div>
          <div className="ac-field">
            <label>Their email</label>
            <input value={f.otherSideSolicitorEmail} onChange={set("otherSideSolicitorEmail")} placeholder="conveyancing@…" />
          </div>
        </div>
        <div className="ac-row2">
          <div className="ac-field">
            <label>Estate agent</label>
            <input value={f.estateAgent} onChange={set("estateAgent")} />
          </div>
          <div className="ac-field">
            <label>Lender</label>
            <input value={f.lender} onChange={set("lender")} />
          </div>
        </div>

        <div className="ac-fieldset-title">Target dates (optional)</div>
        <div className="ac-row2">
          <div className="ac-field">
            <label>Target exchange</label>
            <input type="date" value={f.targetExchange} onChange={set("targetExchange")} />
          </div>
          <div className="ac-field">
            <label>Target completion</label>
            <input type="date" value={f.targetCompletion} onChange={set("targetCompletion")} />
          </div>
        </div>
        <div className="ac-field">
          <label>Mortgage offer expiry (if known)</label>
          <input type="date" value={f.mortgageOfferExpiry} onChange={set("mortgageOfferExpiry")} />
        </div>

        {error && <div style={{ color: "var(--danger)", fontSize: 12.5, marginBottom: 10 }}>{error}</div>}
        <button className="ac-submit" type="submit" onClick={submit}><FileSignature size={14} /> Open matter</button>
      </form>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Settings & Outlook integration                                         */
/* ---------------------------------------------------------------------- */

function SettingsPanel({ isAdmin, settings, matters, onClose, onSave, onConnectOutlook, onDisconnectOutlook }) {
  const [domain, setDomain] = useState(settings.domain);
  const [staleDays, setStaleDays] = useState(settings.staleDays);
  const [currentUser, setCurrentUser] = useState(settings.currentUser);
  const feeEarners = [...new Set(matters.map((m) => m.feeEarner).filter(Boolean))];

  return (
    <div className="ac-overlay" onClick={onClose}>
      <div className="ac-panel" onClick={(e) => e.stopPropagation()}>
        <div className="ac-panel-head">
          <h2>Settings &amp; integrations</h2>
          <button type="button" className="ac-iconbtn" onClick={onClose}><X size={18} /></button>
        </div>

        <div className="ac-card">
          <h3><Users size={12} /> Your identity</h3>
          <p style={{ fontSize: 12.5, color: "var(--ink-soft)", marginTop: 0 }}>
            Used to filter the matter list to "My matters" — this prototype has no real login, so this is just a display preference.
          </p>
          <div className="ac-field" style={{ marginBottom: 0 }}>
            <label>Your name</label>
            <input
              list="fee-earner-suggestions"
              value={currentUser}
              onChange={(e) => setCurrentUser(e.target.value)}
              onBlur={() => onSave({ currentUser })}
              placeholder="e.g. Sarah Ncube"
            />
            <datalist id="fee-earner-suggestions">
              {feeEarners.map((n) => <option key={n} value={n} />)}
            </datalist>
          </div>
        </div>

        <div className="ac-card">
          <h3><Plug size={12} /> Outlook / Microsoft 365</h3>
          <div className="ac-kv">
            <span className="k">Status</span>
            <span className="v" style={{ display: "flex", alignItems: "center", gap: 5, justifyContent: "flex-end", color: settings.outlookConnected ? "var(--success)" : "var(--slate)" }}>
              {settings.outlookConnected ? <><CheckCircle2 size={13} /> Connected</> : "Not connected"}
            </span>
          </div>

          {settings.outlookConnected ? (
            <>
              <p style={{ fontSize: 12.5, color: "var(--ink-soft)", marginTop: 10 }}>
                Firm mailbox access is authorised via Microsoft Graph. Emails sent to a matter's dedicated address, or filed with the Outlook add-in, will save to the matching matter automatically.
              </p>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, fontWeight: 500, textTransform: "none", color: "var(--ink)", margin: "12px 0" }}>
                <input type="checkbox" checked={settings.autoFile} onChange={(e) => onSave({ autoFile: e.target.checked })} style={{ width: "auto" }} />
                Automatically file emails sent to matter addresses
              </label>
              <button type="button" className="ac-tablebtn" onClick={onDisconnectOutlook} style={{ color: "var(--danger)", borderColor: "var(--danger)" }}>Disconnect Outlook</button>
            </>
          ) : (
            <>
              <p style={{ fontSize: 12.5, color: "var(--ink-soft)", marginTop: 10, marginBottom: 12 }}>
                Connecting requires your firm's Microsoft 365 admin to approve access via Azure AD — once approved, this covers the whole firm, not just one user.
              </p>
              <button type="button" className="ac-submit" onClick={onConnectOutlook}><Plug size={14} /> Connect Outlook</button>
            </>
          )}
        </div>

        <div className="ac-card">
          <h3>Matter mailbox addressing</h3>
          <p style={{ fontSize: 12.5, color: "var(--ink-soft)", marginTop: 0 }}>Each matter gets a dedicated filing address built from its reference and this domain.</p>
          <div className="ac-field" style={{ marginBottom: 8 }}>
            <label>Firm domain</label>
            <input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="yourfirm.co.uk" onBlur={() => onSave({ domain })} />
          </div>
          <div style={{ fontSize: 11.5, fontFamily: "var(--font-mono)", color: "var(--slate)" }}>e.g. matters+cv-2026-0041@{domain || "yourfirm.co.uk"}</div>
        </div>

        <div className="ac-card">
          <h3><Bell size={12} /> Review reminders</h3>
          <p style={{ fontSize: 12.5, color: "var(--ink-soft)", marginTop: 0 }}>If a matter has no logged activity for this many days, it's flagged as needing a review — shown on the file, in the sidebar, and in Tasks &amp; reminders.</p>
          <div className="ac-field" style={{ marginBottom: 0 }}>
            <label>Flag files inactive for more than (days)</label>
            <input type="number" min="1" value={staleDays} onChange={(e) => setStaleDays(e.target.value)} onBlur={() => onSave({ staleDays: Number(staleDays) || 14 })} style={{ width: 100 }} />
          </div>
        </div>

        <div className="ac-card">
          <h3><ShieldCheck size={12} /> Stage sign-off</h3>
          <p style={{ fontSize: 12.5, color: "var(--ink-soft)", marginTop: 0 }}>
            When on, only the matter's fee earner (or their supervisor) can move it to another stage. Secretaries, assistants and admins send a sign-off request instead, which the fee earner approves or declines.
          </p>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, textTransform: "none", fontWeight: 500, color: "var(--ink)" }}>
            <input type="checkbox" checked={settings.requireStageSignoff !== false} disabled={!isAdmin}
              onChange={(e) => onSave({ requireStageSignoff: e.target.checked })} style={{ width: "auto" }} />
            Stage moves need the fee earner's sign-off
          </label>
          {!isAdmin && <p style={{ fontSize: 11.5, color: "var(--slate)", marginBottom: 0 }}>Only an admin can change this.</p>}
        </div>

        <p style={{ fontSize: 11, color: "var(--slate-light)" }}>
          This prototype simulates the connection flow so the interface and data model are ready — a production build would perform real OAuth against Microsoft Graph and a backend service to receive and file live messages.
        </p>
      </div>
    </div>
  );
}

function OutlookConsentModal({ onCancel, onApprove }) {
  return (
    <div className="ac-overlay center" onClick={onCancel}>
      <div className="ac-modal" onClick={(e) => e.stopPropagation()}>
        <div className="ac-modal-head">
          <h2>Connect to Outlook</h2>
          <button type="button" className="ac-iconbtn" onClick={onCancel}><X size={18} /></button>
        </div>
        <p style={{ fontSize: 12.5, color: "var(--slate)", marginTop: -6 }}>
          In production, this would redirect to your Microsoft 365 sign-in and consent screen. This demo simulates that step so you can see the intended flow.
        </p>
        <div style={{ background: "var(--paper)", border: "1px solid var(--line)", borderRadius: 8, padding: 14, margin: "14px 0" }}>
          <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 8 }}>V J Crawford Conveyancing's case management system is requesting permission to:</div>
          {[
            "Read mail in mailboxes this app is given access to",
            "Send mail as the signed-in firm mailbox",
            "Read basic mailbox settings",
          ].map((perm) => (
            <div key={perm} style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 12.5, color: "var(--ink-soft)", padding: "5px 0" }}>
              <Check size={13} style={{ marginTop: 2, flexShrink: 0, color: "var(--success)" }} /> {perm}
            </div>
          ))}
        </div>
        <p style={{ fontSize: 11, color: "var(--slate-light)", marginBottom: 16 }}>Your firm's Microsoft 365 administrator would need to approve this for the whole organisation before it can be used.</p>
        <div style={{ display: "flex", gap: 10 }}>
          <button type="button" className="ac-tablebtn" style={{ flex: 1, padding: "10px 0" }} onClick={onCancel}>Cancel</button>
          <button type="button" className="ac-submit" style={{ flex: 2, marginTop: 0 }} onClick={onApprove}>Approve (demo)</button>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Add document form                                                      */
/* ---------------------------------------------------------------------- */

function AddDocForm({ onClose, onAdd }) {
  const [f, setF] = useState({ name: "", category: DOC_CATEGORIES[0], date: new Date().toISOString().slice(0, 10), notes: "" });
  const [file, setFile] = useState(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  function pickFile(e) {
    const picked = e.target.files[0] || null;
    if (picked) {
      const problem = checkDocFile(picked);
      if (problem) {
        setError(problem);
        e.target.value = "";
        setFile(null);
        return;
      }
      if (!f.name.trim()) setF({ ...f, name: picked.name.replace(/\.[^.]+$/, "") });
    }
    setError("");
    setFile(picked);
  }

  async function submit(e) {
    e.preventDefault();
    if (saving) return;
    if (!f.name.trim()) {
      setError("Document name is required.");
      return;
    }
    setError("");
    setSaving(true);
    try {
      await onAdd(f, file);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="ac-overlay center" onClick={onClose}>
      <form className="ac-modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="ac-modal-head">
          <h2>Add document</h2>
          <button type="button" className="ac-iconbtn" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="ac-field">
          <label>File (optional, up to {DOC_MAX_FILE_MB} MB)</label>
          <input type="file" accept={DOC_FILE_EXTENSIONS.join(",")} onChange={pickFile} />
        </div>
        <div className="ac-field">
          <label>Document name</label>
          <input value={f.name} onChange={set("name")} placeholder="Local Authority Search" autoFocus />
        </div>
        <div className="ac-row2">
          <div className="ac-field">
            <label>Category</label>
            <select value={f.category} onChange={set("category")}>
              {DOC_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="ac-field">
            <label>Date</label>
            <input type="date" value={f.date} onChange={set("date")} />
          </div>
        </div>
        <div className="ac-field">
          <label>Notes</label>
          <textarea value={f.notes} onChange={set("notes")} placeholder="Anything worth flagging about this document…" />
        </div>
        {error && <div style={{ color: "var(--danger)", fontSize: 12.5, marginBottom: 10 }}>{error}</div>}
        <button className="ac-submit" type="submit" disabled={saving}><Paperclip size={14} /> {saving ? (file ? "Uploading…" : "Saving…") : "Add to file"}</button>
      </form>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Add email form                                                         */
/* ---------------------------------------------------------------------- */

function AddEmailForm({ onClose, onAdd }) {
  const [f, setF] = useState({ direction: "in", from: "", to: "", subject: "", date: new Date().toISOString().slice(0, 10), body: "" });
  const [error, setError] = useState("");
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  function submit(e) {
    e.preventDefault();
    if (!f.subject.trim()) {
      setError("Subject is required.");
      return;
    }
    setError("");
    onAdd(f);
  }

  return (
    <div className="ac-overlay center" onClick={onClose}>
      <form className="ac-modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="ac-modal-head">
          <h2>Log email</h2>
          <button type="button" className="ac-iconbtn" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="ac-row2">
          <div className="ac-field">
            <label>Direction</label>
            <select value={f.direction} onChange={set("direction")}>
              <option value="in">Received</option>
              <option value="out">Sent</option>
            </select>
          </div>
          <div className="ac-field">
            <label>Date</label>
            <input type="date" value={f.date} onChange={set("date")} />
          </div>
        </div>
        <div className="ac-field">
          <label>{f.direction === "in" ? "From" : "To"}</label>
          <input value={f.direction === "in" ? f.from : f.to} onChange={f.direction === "in" ? set("from") : set("to")} placeholder="conveyancing@theirfirm.co.uk" />
        </div>
        <div className="ac-field">
          <label>Subject</label>
          <input value={f.subject} onChange={set("subject")} placeholder="Re: Pre-contract enquiries" autoFocus />
        </div>
        <div className="ac-field">
          <label>Summary</label>
          <textarea value={f.body} onChange={set("body")} placeholder="Brief summary of the email content…" />
        </div>
        {error && <div style={{ color: "var(--danger)", fontSize: 12.5, marginBottom: 10 }}>{error}</div>}
        <button className="ac-submit" type="submit" onClick={submit}><Send size={14} /> Log email</button>
      </form>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Edit matter details                                                    */
/* ---------------------------------------------------------------------- */

function ClientDetailsFields({ value, onChange }) {
  return (
    <>
      <div className="ac-field">
        <label>Correspondence address</label>
        <textarea value={value.address} onChange={onChange("clientDetails", "address")} placeholder="If different from the property" style={{ minHeight: 60 }} />
      </div>
      <div className="ac-row2">
        <div className="ac-field">
          <label>Email</label>
          <input type="email" value={value.email} onChange={onChange("clientDetails", "email")} />
        </div>
        <div className="ac-field">
          <label>Phone</label>
          <input value={value.phone} onChange={onChange("clientDetails", "phone")} />
        </div>
      </div>
      <div className="ac-field">
        <label>Letters start "Dear …"</label>
        <input value={value.salutation} onChange={onChange("clientDetails", "salutation")} placeholder="e.g. Mr and Mrs Faulkner" />
      </div>
    </>
  );
}

function PropertyFields({ value, onChange }) {
  return (
    <>
      <div className="ac-row2">
        <div className="ac-field">
          <label>Tenure</label>
          <select value={value.tenure} onChange={onChange("property", "tenure")}>
            <option value="">— Select —</option>
            {TENURES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div className="ac-field">
          <label>Title number</label>
          <input value={value.titleNumber} onChange={onChange("property", "titleNumber")} placeholder="e.g. GR123456" />
        </div>
      </div>
      <div className="ac-field">
        <label>Registered owner</label>
        <input value={value.registeredProprietor} onChange={onChange("property", "registeredProprietor")} />
      </div>
      {isLeasehold(value.tenure) && (
        <>
          <div className="ac-field">
            <label>Lease term</label>
            <input value={value.leaseTerm} onChange={onChange("property", "leaseTerm")} placeholder="e.g. 125 years from 1 January 2005 (104 remaining)" />
          </div>
          <div className="ac-row2">
            <div className="ac-field">
              <label>Ground rent</label>
              <input value={value.groundRent} onChange={onChange("property", "groundRent")} placeholder="e.g. £250 a year, doubling every 25 years" />
            </div>
            <div className="ac-field">
              <label>Service charge</label>
              <input value={value.serviceCharge} onChange={onChange("property", "serviceCharge")} placeholder="e.g. £1,200 a year" />
            </div>
          </div>
        </>
      )}
    </>
  );
}

/**
 * Linked-matter picker for the Edit form. Lists the matters already linked
 * plus the loaded list, and searches the whole firm (server-side) so any
 * matter can be linked, not just the current page of the list.
 */
function ChainPicker({ matter, allMatters, selectedIds, onToggle }) {
  const [term, setTerm] = useState("");
  const [results, setResults] = useState(null);

  useEffect(() => {
    if (!term.trim()) { setResults(null); return; }
    const handle = setTimeout(() => {
      api.getMatters({ search: term.trim(), limit: 20 })
        .then((r) => setResults(r.matters.map((m) => ({ id: m.id, reference: m.reference, address: m.address, client: m.client }))))
        .catch(() => setResults([]));
    }, 300);
    return () => clearTimeout(handle);
  }, [term]);

  // Already-linked first (always shown, so they can be unticked), then search results or the loaded list.
  const known = new Map();
  for (const l of matter.linkedMatters) known.set(l.id, l);
  for (const m of results ?? allMatters) if (!known.has(m.id)) known.set(m.id, m);
  const options = [...known.values()].filter((m) => m.id !== matter.id);

  return (
    <div className="ac-field">
      <label>Linked matters (same chain, or the same client's sale and purchase)</label>
      <div className="ac-search" style={{ marginTop: 4 }}>
        <Search size={14} color="var(--slate-light)" />
        <input placeholder="Search any matter by address, client or reference…" value={term} onChange={(e) => setTerm(e.target.value)} />
      </div>
      {results && results.length === 0 && <p style={{ fontSize: 12, color: "var(--slate)" }}>No matters match that search.</p>}
      <div style={{ display: "flex", flexDirection: "column", gap: 7, marginTop: 4 }}>
        {options.map((m) => (
          <label key={m.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, fontWeight: 500, textTransform: "none", color: "var(--ink)" }}>
            <input type="checkbox" checked={selectedIds.includes(m.id)} onChange={() => onToggle(m.id)} style={{ width: "auto" }} />
            {m.reference} — {m.address} ({m.client})
          </label>
        ))}
      </div>
    </div>
  );
}

function EditMatterForm({ matter, allMatters, users, onClose, onSave }) {
  const [f, setF] = useState({
    address: matter.address,
    client: matter.client,
    type: matter.type,
    price: matter.price,
    feeEarnerId: matter.feeEarnerId || "",
    supervisorId: matter.supervisorId || "",
    otherSideSolicitor: matter.parties.otherSideSolicitor,
    otherSideSolicitorEmail: matter.parties.otherSideSolicitorEmail,
    estateAgent: matter.parties.estateAgent,
    lender: matter.parties.lender,
    targetExchange: matter.keyDates.targetExchange,
    targetCompletion: matter.keyDates.targetCompletion,
    actualExchange: matter.keyDates.actualExchange,
    actualCompletion: matter.keyDates.actualCompletion,
    mortgageOfferExpiry: matter.keyDates.mortgageOfferExpiry,
    linkedMatterIds: matter.linkedMatterIds,
    clientDetails: { ...matter.clientDetails },
    property: { ...matter.property },
    money: { ...matter.money },
  });
  const setIn = (group, k) => (e) => setF((prev) => ({ ...prev, [group]: { ...prev[group], [k]: e.target.value } }));
  const [error, setError] = useState("");
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  function toggleLink(id) {
    setF((prev) => ({
      ...prev,
      linkedMatterIds: prev.linkedMatterIds.includes(id) ? prev.linkedMatterIds.filter((x) => x !== id) : [...prev.linkedMatterIds, id],
    }));
  }

  function submit(e) {
    e.preventDefault();
    if (!f.address.trim() || !f.client.trim()) {
      setError("Property address and client name are both required.");
      return;
    }
    onSave({
      address: f.address.trim(),
      client: f.client.trim(),
      type: f.type,
      price: f.price === "" ? "" : Number(f.price),
      feeEarnerId: f.feeEarnerId,
      supervisorId: f.supervisorId,
      linkedMatterIds: f.linkedMatterIds,
      parties: {
        otherSideSolicitor: f.otherSideSolicitor,
        otherSideSolicitorEmail: f.otherSideSolicitorEmail,
        estateAgent: f.estateAgent,
        lender: f.lender,
      },
      keyDates: {
        ...matter.keyDates,
        targetExchange: f.targetExchange,
        targetCompletion: f.targetCompletion,
        actualExchange: f.actualExchange,
        actualCompletion: f.actualCompletion,
        mortgageOfferExpiry: f.mortgageOfferExpiry,
      },
      clientDetails: f.clientDetails,
      property: f.property,
      money: {
        ...f.money,
        deposit: f.money.deposit === "" ? "" : Number(f.money.deposit),
        sdlt: f.money.sdlt === "" ? "" : Number(f.money.sdlt),
      },
    });
  }

  return (
    <div className="ac-overlay" onClick={onClose}>
      <form className="ac-panel" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="ac-panel-head">
          <h2>Edit matter details</h2>
          <button type="button" className="ac-iconbtn" onClick={onClose}><X size={18} /></button>
        </div>

        <div className="ac-field">
          <label>Property address</label>
          <input value={f.address} onChange={set("address")} />
        </div>
        <div className="ac-row2">
          <div className="ac-field">
            <label>Client name</label>
            <input value={f.client} onChange={set("client")} />
          </div>
          <div className="ac-field">
            <label>Matter type</label>
            <select value={f.type} onChange={set("type")}>
              {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        </div>
        <div className="ac-field">
          <label>Price</label>
          <input type="number" value={f.price} onChange={set("price")} />
        </div>

        <div className="ac-fieldset-title">Client contact</div>
        <ClientDetailsFields value={f.clientDetails} onChange={setIn} />

        <div className="ac-fieldset-title">Property &amp; title</div>
        <PropertyFields value={f.property} onChange={setIn} />

        <div className="ac-fieldset-title">Money</div>
        <div className="ac-row2">
          <div className="ac-field">
            <label>Deposit (£)</label>
            <input type="number" min="0" step="0.01" value={f.money.deposit} onChange={setIn("money", "deposit")} />
          </div>
          <div className="ac-field">
            <label>SDLT payable (£)</label>
            <input type="number" min="0" step="0.01" value={f.money.sdlt} onChange={setIn("money", "sdlt")} placeholder="0 if none due" />
          </div>
        </div>
        <div className="ac-field">
          <label>Mortgage offer special conditions</label>
          <textarea value={f.money.mortgageConditions} onChange={setIn("money", "mortgageConditions")} placeholder="Leave blank if none / not applicable" />
        </div>

        <div className="ac-fieldset-title">Our team</div>
        <div className="ac-row2">
          <div className="ac-field">
            <label>Fee earner</label>
            <select value={f.feeEarnerId} onChange={set("feeEarnerId")}>
              <option value="">— Select —</option>
              {users.filter((u) => (u.active !== false && isFeeEarnerRole(u.role)) || u.id === f.feeEarnerId).map((u) => <option key={u.id} value={u.id}>{u.name}{u.active === false ? " (deactivated)" : ""}</option>)}
            </select>
          </div>
          <div className="ac-field">
            <label>Supervisor</label>
            <select value={f.supervisorId} onChange={set("supervisorId")}>
              <option value="">— Select —</option>
              {users.filter((u) => (u.active !== false && isFeeEarnerRole(u.role)) || u.id === f.supervisorId).map((u) => <option key={u.id} value={u.id}>{u.name}{u.active === false ? " (deactivated)" : ""}</option>)}
            </select>
          </div>
        </div>

        <div className="ac-fieldset-title">Other side</div>
        <div className="ac-row2">
          <div className="ac-field">
            <label>Their solicitor</label>
            <input value={f.otherSideSolicitor} onChange={set("otherSideSolicitor")} />
          </div>
          <div className="ac-field">
            <label>Their email</label>
            <input value={f.otherSideSolicitorEmail} onChange={set("otherSideSolicitorEmail")} />
          </div>
        </div>
        <div className="ac-row2">
          <div className="ac-field">
            <label>Estate agent</label>
            <input value={f.estateAgent} onChange={set("estateAgent")} />
          </div>
          <div className="ac-field">
            <label>Lender</label>
            <input value={f.lender} onChange={set("lender")} />
          </div>
        </div>

        <div className="ac-fieldset-title">Key dates</div>
        <div className="ac-row2">
          <div className="ac-field">
            <label>Target exchange</label>
            <input type="date" value={f.targetExchange} onChange={set("targetExchange")} />
          </div>
          <div className="ac-field">
            <label>Target completion</label>
            <input type="date" value={f.targetCompletion} onChange={set("targetCompletion")} />
          </div>
        </div>
        <div className="ac-row2">
          <div className="ac-field">
            <label>Actual exchange</label>
            <input type="date" value={f.actualExchange} onChange={set("actualExchange")} />
          </div>
          <div className="ac-field">
            <label>Actual completion</label>
            <input type="date" value={f.actualCompletion} onChange={set("actualCompletion")} />
          </div>
        </div>
        <div className="ac-field">
          <label>Mortgage offer expiry</label>
          <input type="date" value={f.mortgageOfferExpiry} onChange={set("mortgageOfferExpiry")} />
        </div>

        <div className="ac-fieldset-title">Chain</div>
        <ChainPicker
          matter={matter}
          allMatters={allMatters}
          selectedIds={f.linkedMatterIds}
          onToggle={toggleLink}
        />

        {error && <div style={{ color: "var(--danger)", fontSize: 12.5, marginBottom: 10 }}>{error}</div>}
        <button className="ac-submit" type="submit" onClick={submit}><Check size={14} /> Save changes</button>
      </form>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Log update / case note                                                 */
/* ---------------------------------------------------------------------- */

function AddNoteForm({ onClose, onAdd }) {
  const [text, setText] = useState("");
  const [error, setError] = useState("");

  function submit(e) {
    e.preventDefault();
    if (!text.trim()) {
      setError("Enter a note before logging it.");
      return;
    }
    onAdd(text.trim());
  }

  return (
    <div className="ac-overlay center" onClick={onClose}>
      <form className="ac-modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="ac-modal-head">
          <h2>Log an update</h2>
          <button type="button" className="ac-iconbtn" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="ac-field">
          <label>Note</label>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="e.g. Called client re: mortgage offer, they confirmed acceptance. Chasing seller's solicitor for search results tomorrow."
            style={{ minHeight: 110 }}
            autoFocus
          />
        </div>
        <p style={{ fontSize: 11.5, color: "var(--slate)", margin: "0 0 14px" }}>
          This is added to the matter's activity timeline with today's date — a running case diary alongside documents and emails.
        </p>
        {error && <div style={{ color: "var(--danger)", fontSize: 12.5, marginBottom: 10 }}>{error}</div>}
        <button className="ac-submit" type="submit" onClick={submit}><StickyNote size={14} /> Add to timeline</button>
      </form>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Enquiries                                                               */
/* ---------------------------------------------------------------------- */

function AddEnquiryForm({ onClose, onAdd }) {
  const [question, setQuestion] = useState("");
  const [error, setError] = useState("");

  function submit(e) {
    e.preventDefault();
    if (!question.trim()) {
      setError("Enter the enquiry text before adding it.");
      return;
    }
    onAdd(question.trim());
  }

  return (
    <div className="ac-overlay center" onClick={onClose}>
      <form className="ac-modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="ac-modal-head">
          <h2>Add enquiry</h2>
          <button type="button" className="ac-iconbtn" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="ac-field">
          <label>Enquiry</label>
          <textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="e.g. Please confirm whether any disputes have arisen with neighbouring owners in the last 3 years."
            style={{ minHeight: 90 }}
            autoFocus
          />
        </div>
        {error && <div style={{ color: "var(--danger)", fontSize: 12.5, marginBottom: 10 }}>{error}</div>}
        <button className="ac-submit" type="submit" onClick={submit}><FileSearch size={14} /> Add enquiry</button>
      </form>
    </div>
  );
}


function StandardEnquiriesModal({ onClose, onAdd }) {
  const allQuestions = STANDARD_ENQUIRIES.flatMap((g) => g.items);
  const defaultSelected = new Set(
    STANDARD_ENQUIRIES.filter((g) => g.category !== "Leasehold only").flatMap((g) => g.items)
  );
  const [selected, setSelected] = useState(defaultSelected);

  function toggle(q) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(q) ? next.delete(q) : next.add(q);
      return next;
    });
  }

  function toggleCategory(items, allOn) {
    setSelected((prev) => {
      const next = new Set(prev);
      items.forEach((q) => (allOn ? next.delete(q) : next.add(q)));
      return next;
    });
  }

  function submit(e) {
    e.preventDefault();
    if (selected.size === 0) return;
    onAdd(allQuestions.filter((q) => selected.has(q)));
  }

  return (
    <div className="ac-overlay center" onClick={onClose}>
      <form className="ac-modal" onClick={(e) => e.stopPropagation()} onSubmit={submit} style={{ width: 600 }}>
        <div className="ac-modal-head">
          <h2>Standard pre-contract enquiries</h2>
          <button type="button" className="ac-iconbtn" onClick={onClose}><X size={18} /></button>
        </div>
        <p style={{ fontSize: 11.5, color: "var(--slate)", marginTop: -6, marginBottom: 14 }}>
          A general-purpose set of common residential enquiries. Review and tailor to the specific property before sending — this is a starting point, not a substitute for judgement on the file. Leasehold questions are unticked by default.
        </p>
        <div style={{ maxHeight: 380, overflowY: "auto", border: "1px solid var(--line)", borderRadius: 8, padding: "4px 14px" }}>
          {STANDARD_ENQUIRIES.map((g) => {
            const allOn = g.items.every((q) => selected.has(q));
            return (
              <div key={g.category} style={{ padding: "10px 0", borderBottom: "1px solid var(--line)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <span style={{ fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--slate)" }}>{g.category}</span>
                  <button type="button" className="ac-tablebtn" onClick={() => toggleCategory(g.items, allOn)}>{allOn ? "Deselect all" : "Select all"}</button>
                </div>
                {g.items.map((q) => (
                  <label key={q} style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 12.5, fontWeight: 400, textTransform: "none", color: "var(--ink-soft)", padding: "5px 0", lineHeight: 1.4 }}>
                    <input type="checkbox" checked={selected.has(q)} onChange={() => toggle(q)} style={{ width: "auto", marginTop: 2, flexShrink: 0 }} />
                    {q}
                  </label>
                ))}
              </div>
            );
          })}
        </div>
        <button className="ac-submit" type="submit" onClick={submit}><FileSearch size={14} /> Add {selected.size} enquir{selected.size === 1 ? "y" : "ies"}</button>
      </form>
    </div>
  );
}

function StandardTasksForm({ matter, onClose, onAdd }) {
  const groups = Object.entries(STANDARD_TASKS[matter.type] || {})
    .map(([idx, items]) => ({ idx: Number(idx), stage: STAGES[Number(idx)].name, items }))
    .sort((a, b) => a.idx - b.idx);
  const existing = new Set(matter.tasks.map((t) => t.description.trim().toLowerCase()));
  const isExisting = (t) => existing.has(t.toLowerCase());
  // Pre-tick everything from the current stage onwards that isn't already on the file.
  const [selected, setSelected] = useState(
    () => new Set(groups.filter((g) => g.idx >= matter.currentStageIndex).flatMap((g) => g.items).filter((t) => !isExisting(t)))
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function toggle(t) {
    setSelected((prev) => { const next = new Set(prev); next.has(t) ? next.delete(t) : next.add(t); return next; });
  }
  function toggleGroup(items, allOn) {
    setSelected((prev) => {
      const next = new Set(prev);
      items.filter((t) => !isExisting(t)).forEach((t) => (allOn ? next.delete(t) : next.add(t)));
      return next;
    });
  }

  async function submit(e) {
    e.preventDefault();
    if (!selected.size) return;
    setBusy(true); setError("");
    try {
      await onAdd(groups.flatMap((g) => g.items).filter((t) => selected.has(t)).map((description) => ({ description })));
    } catch (err) {
      setError(err.message || "Couldn't add the tasks.");
      setBusy(false);
    }
  }

  return (
    <div className="ac-overlay center" onClick={onClose}>
      <form className="ac-modal" onClick={(e) => e.stopPropagation()} onSubmit={submit} style={{ width: 640 }}>
        <div className="ac-modal-head">
          <h2>Standard tasks — {matter.type.toLowerCase()}</h2>
          <button type="button" className="ac-iconbtn" onClick={onClose}><X size={18} /></button>
        </div>
        <p style={{ fontSize: 11.5, color: "var(--slate)", marginTop: -6, marginBottom: 14 }}>
          Tasks for the current stage ({STAGES[matter.currentStageIndex].name}) onwards are pre-selected. Tasks already on this file are greyed out. Add due dates afterwards where you need reminders.
        </p>
        <div style={{ maxHeight: 420, overflowY: "auto", border: "1px solid var(--line)", borderRadius: 4, padding: "4px 14px" }}>
          {groups.map((g) => {
            const available = g.items.filter((t) => !isExisting(t));
            const allOn = available.length > 0 && available.every((t) => selected.has(t));
            return (
              <div key={g.idx} style={{ padding: "10px 0", borderBottom: "1px solid var(--line)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <span style={{ fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: g.idx === matter.currentStageIndex ? "var(--brass)" : "var(--slate)" }}>
                    {g.idx + 1}. {g.stage}{g.idx === matter.currentStageIndex ? " (current)" : ""}
                  </span>
                  {available.length > 0 && <button type="button" className="ac-tablebtn" onClick={() => toggleGroup(g.items, allOn)}>{allOn ? "Deselect all" : "Select all"}</button>}
                </div>
                {g.items.map((t) => (
                  <label key={t} style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 12.5, fontWeight: 400, textTransform: "none", color: isExisting(t) ? "var(--slate-light)" : "var(--ink-soft)", padding: "5px 0", lineHeight: 1.4 }}>
                    <input type="checkbox" disabled={isExisting(t)} checked={!isExisting(t) && selected.has(t)} onChange={() => toggle(t)} style={{ width: "auto", marginTop: 2, flexShrink: 0 }} />
                    {t}{isExisting(t) ? " (already on file)" : ""}
                  </label>
                ))}
              </div>
            );
          })}
        </div>
        {error && <p style={{ color: "var(--danger)", fontSize: 12.5 }}>{error}</p>}
        <button className="ac-submit" type="submit" disabled={busy || !selected.size}><ListChecks size={14} /> {busy ? "Adding…" : `Add ${selected.size} task${selected.size === 1 ? "" : "s"}`}</button>
      </form>
    </div>
  );
}

function StandardSearchesModal({ onClose, onAdd }) {
  const allTypes = STANDARD_SEARCHES.flatMap((g) => g.items);
  const defaultSelected = new Set(
    STANDARD_SEARCHES.filter((g) => g.category.startsWith("Core")).flatMap((g) => g.items)
  );
  const [selected, setSelected] = useState(defaultSelected);

  function toggle(t) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(t) ? next.delete(t) : next.add(t);
      return next;
    });
  }

  function toggleCategory(items, allOn) {
    setSelected((prev) => {
      const next = new Set(prev);
      items.forEach((t) => (allOn ? next.delete(t) : next.add(t)));
      return next;
    });
  }

  function submit(e) {
    e.preventDefault();
    if (selected.size === 0) return;
    onAdd(allTypes.filter((t) => selected.has(t)));
  }

  return (
    <div className="ac-overlay center" onClick={onClose}>
      <form className="ac-modal" onClick={(e) => e.stopPropagation()} onSubmit={submit} style={{ width: 600 }}>
        <div className="ac-modal-head">
          <h2>Standard searches</h2>
          <button type="button" className="ac-iconbtn" onClick={onClose}><X size={18} /></button>
        </div>
        <p style={{ fontSize: 11.5, color: "var(--slate)", marginTop: -6, marginBottom: 14 }}>
          The three core searches are pre-selected — regional searches depend on the property's location, so review those against the title and local knowledge before ordering. All are added with today's order date and a 14-day expected return, editable afterward.
        </p>
        <div style={{ maxHeight: 380, overflowY: "auto", border: "1px solid var(--line)", borderRadius: 4, padding: "4px 14px" }}>
          {STANDARD_SEARCHES.map((g) => {
            const allOn = g.items.every((t) => selected.has(t));
            return (
              <div key={g.category} style={{ padding: "10px 0", borderBottom: "1px solid var(--line)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <span style={{ fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--slate)" }}>{g.category}</span>
                  <button type="button" className="ac-tablebtn" onClick={() => toggleCategory(g.items, allOn)}>{allOn ? "Deselect all" : "Select all"}</button>
                </div>
                {g.items.map((t) => (
                  <label key={t} style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 12.5, fontWeight: 400, textTransform: "none", color: "var(--ink-soft)", padding: "5px 0", lineHeight: 1.4 }}>
                    <input type="checkbox" checked={selected.has(t)} onChange={() => toggle(t)} style={{ width: "auto", marginTop: 2, flexShrink: 0 }} />
                    {t}
                  </label>
                ))}
              </div>
            );
          })}
        </div>
        <button className="ac-submit" type="submit" onClick={submit}><ShieldCheck size={14} /> Order {selected.size} search{selected.size === 1 ? "" : "es"}</button>
      </form>
    </div>
  );
}

function EmailEnquiriesModal({ matter, onClose, onSend }) {
  const outstanding = matter.enquiries.filter((q) => q.status === "Outstanding");
  const [to, setTo] = useState(matter.parties.otherSideSolicitorEmail || "");
  const defaultBody =
    `Dear Sirs,\n\nWe act for our client in connection with the above matter and raise the following pre-contract enquiries:\n\n` +
    outstanding.map((q) => `${q.number}. ${q.question}`).join("\n\n") +
    `\n\nWe should be grateful for your replies at your earliest convenience.\n\nKind regards`;
  const [subject, setSubject] = useState(`Pre-contract enquiries – ${matter.reference} – ${matter.address}`);
  const [body, setBody] = useState(defaultBody);
  const [error, setError] = useState("");

  function openInEmailClient() {
    const mailto = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    window.open(mailto, "_blank");
  }

  function submit(e) {
    e.preventDefault();
    if (!to.trim()) {
      setError("Enter the recipient's email address.");
      return;
    }
    openInEmailClient();
    onSend({ to: to.trim(), subject, body, count: outstanding.length });
  }

  return (
    <div className="ac-overlay center" onClick={onClose}>
      <form className="ac-modal" onClick={(e) => e.stopPropagation()} onSubmit={submit} style={{ width: 560 }}>
        <div className="ac-modal-head">
          <h2>Email enquiries to other side</h2>
          <button type="button" className="ac-iconbtn" onClick={onClose}><X size={18} /></button>
        </div>
        <p style={{ fontSize: 11.5, color: "var(--slate)", marginTop: -6, marginBottom: 14 }}>
          This opens your email client with the {outstanding.length} outstanding enquir{outstanding.length === 1 ? "y" : "ies"} pre-filled, and logs a copy on this file. You'll still need to hit send from your own mailbox.
        </p>
        <div className="ac-field">
          <label>To</label>
          <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="conveyancing@theirfirm.co.uk" />
        </div>
        <div className="ac-field">
          <label>Subject</label>
          <input value={subject} onChange={(e) => setSubject(e.target.value)} />
        </div>
        <div className="ac-field">
          <label>Message</label>
          <textarea value={body} onChange={(e) => setBody(e.target.value)} style={{ minHeight: 220, fontFamily: "var(--font-mono)", fontSize: 12 }} />
        </div>
        {error && <div style={{ color: "var(--danger)", fontSize: 12.5, marginBottom: 10 }}>{error}</div>}
        <button className="ac-submit" type="submit" onClick={submit}><Send size={14} /> Open in email client & log</button>
      </form>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Searches                                                                */
/* ---------------------------------------------------------------------- */

function AddSearchForm({ onClose, onAdd }) {
  const [f, setF] = useState({ type: SEARCH_TYPES[0], customType: "", dateOrdered: new Date().toISOString().slice(0, 10), expectedReturn: "" });
  const [error, setError] = useState("");
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  function submit(e) {
    e.preventDefault();
    const type = f.type === "Other" ? f.customType.trim() : f.type;
    if (!type) {
      setError("Enter a search name.");
      return;
    }
    onAdd({ type, dateOrdered: f.dateOrdered, expectedReturn: f.expectedReturn });
  }

  return (
    <div className="ac-overlay center" onClick={onClose}>
      <form className="ac-modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="ac-modal-head">
          <h2>Add search</h2>
          <button type="button" className="ac-iconbtn" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="ac-field">
          <label>Search type</label>
          <select value={f.type} onChange={set("type")}>
            {SEARCH_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        {f.type === "Other" && (
          <div className="ac-field">
            <label>Search name</label>
            <input value={f.customType} onChange={set("customType")} placeholder="e.g. Coal Authority Search" autoFocus />
          </div>
        )}
        <div className="ac-row2">
          <div className="ac-field">
            <label>Date ordered</label>
            <input type="date" value={f.dateOrdered} onChange={set("dateOrdered")} />
          </div>
          <div className="ac-field">
            <label>Expected return</label>
            <input type="date" value={f.expectedReturn} onChange={set("expectedReturn")} />
          </div>
        </div>
        {error && <div style={{ color: "var(--danger)", fontSize: 12.5, marginBottom: 10 }}>{error}</div>}
        <button className="ac-submit" type="submit" onClick={submit}><ShieldCheck size={14} /> Add search</button>
      </form>
    </div>
  );
}

const IMPORT_TEMPLATE_HEADERS = [
  "Reference", "Address", "Client", "Type", "Price", "Stage", "Fee Earner", "Supervisor",
  "Other Side Solicitor", "Other Side Solicitor Email", "Estate Agent", "Lender",
  "Date Instructed", "Target Exchange", "Target Completion", "Actual Exchange", "Actual Completion",
  "Mortgage Offer Expiry", "Notes",
  "Client Address", "Client Email", "Client Phone", "Salutation", "Tenure", "Title Number",
  "Registered Proprietor", "Lease Term", "Ground Rent", "Service Charge", "Deposit", "SDLT", "Mortgage Conditions",
];
const IMPORT_TEMPLATE_EXAMPLE = [
  "", "14 Example Road, Bath, BA1 1AA", "J & K Example", "Purchase", "£350,000", "Searches", "", "",
  "Smith & Co LLP", "conveyancing@smithco.example", "Example Estates", "Nationwide",
  "01/09/2026", "20/11/2026", "04/12/2026", "", "", "31/01/2027", "Imported from the old system",
  "22 Current Street, Bath, BA2 2BB", "j.example@example.com", "07700 900123", "Mr and Mrs Example", "Freehold", "AV123456",
  "Alan Seller", "", "", "", "£35,000", "£7,500", "",
];
const MAX_IMPORT_ROWS = 1000;

function downloadImportTemplate() {
  const csv = Papa.unparse([IMPORT_TEMPLATE_HEADERS, IMPORT_TEMPLATE_EXAMPLE]);
  const url = URL.createObjectURL(new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = "matters-import-template.csv";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function ImportMattersForm({ onClose, onImported }) {
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState(null);
  const [check, setCheck] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [imported, setImported] = useState(null);

  function pickFile(e) {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    setError(""); setCheck(null); setRows(null); setFileName(file.name);
    if (!/\.csv$/i.test(file.name)) {
      setError("Please choose a .csv file. In Excel: File → Save As → \"CSV UTF-8 (Comma delimited)\".");
      return;
    }
    Papa.parse(file, {
      header: true,
      skipEmptyLines: "greedy",
      transformHeader: (h) => h.replace(/^\ufeff/, "").trim(),
      complete: async (result) => {
        const data = result.data;
        if (!data.length) return setError("That file has no rows under the header line.");
        if (data.length > MAX_IMPORT_ROWS) return setError(`That file has ${data.length} rows — import at most ${MAX_IMPORT_ROWS} at a time. Split it into smaller files.`);
        setRows(data);
        setBusy(true);
        try {
          setCheck(await api.importMatters(data, true));
        } catch (err) {
          setError(err.message || "Couldn't check the file.");
        } finally {
          setBusy(false);
        }
      },
      error: () => setError("Couldn't read that file."),
    });
  }

  async function runImport() {
    setBusy(true);
    setError("");
    try {
      const result = await api.importMatters(rows, false);
      setImported(result.imported);
      onImported();
    } catch (err) {
      setError(err.message || "The import failed — nothing was imported.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ac-overlay center" onClick={busy ? undefined : onClose}>
      <div className="ac-modal wide" onClick={(e) => e.stopPropagation()}>
        <div className="ac-modal-head">
          <h2>Import matters</h2>
          <button type="button" className="ac-iconbtn" onClick={onClose} disabled={busy}><X size={18} /></button>
        </div>

        {imported !== null ? (
          <>
            <p style={{ fontSize: 14 }}><CheckCircle2 size={15} style={{ verticalAlign: -3, color: "var(--success)" }} /> {imported} matter{imported === 1 ? "" : "s"} imported.</p>
            <button className="ac-submit" type="button" onClick={onClose}><Check size={14} /> Done</button>
          </>
        ) : (
          <>
            <ol style={{ fontSize: 13, lineHeight: 1.55, paddingLeft: 18, margin: "0 0 14px" }}>
              <li>
                <button type="button" className="ac-tablebtn" onClick={downloadImportTemplate} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                  <Download size={12} /> Download the template
                </button>{" "}
                and fill in one row per matter (or use your own spreadsheet with similar column names).
              </li>
              <li><strong>Address</strong>, <strong>Client</strong> and <strong>Type</strong> (Sale, Purchase or Remortgage) are required. Dates as DD/MM/YYYY. Stage as a name (e.g. <em>Searches</em>) or number 1–12. Fee earner and supervisor by name or email. Leave Reference blank to get a new CV- number.</li>
              <li>In Excel, save it with <em>File → Save As → CSV UTF-8</em>, then choose it below. You'll see a check before anything is saved.</li>
            </ol>

            <div className="ac-field">
              <label>Spreadsheet (.csv, up to {MAX_IMPORT_ROWS} rows)</label>
              <input type="file" accept=".csv,text/csv" onChange={pickFile} disabled={busy} />
            </div>

            {busy && !check && <p style={{ fontSize: 13, color: "var(--slate)" }}>Checking {fileName}…</p>}
            {error && <p style={{ fontSize: 13, color: "var(--danger)" }}>{error}</p>}

            {check && (
              <div style={{ fontSize: 13 }}>
                <p style={{ margin: "6px 0" }}>
                  <strong>{check.valid}</strong> matter{check.valid === 1 ? "" : "s"} ready to import
                  {check.errors.length > 0 && <> · <strong style={{ color: "var(--danger)" }}>{check.errors.length}</strong> row{check.errors.length === 1 ? "" : "s"} with problems</>}
                </p>
                {check.ignoredHeaders.length > 0 && (
                  <p style={{ margin: "6px 0", color: "var(--slate)" }}>Columns not recognised (will be ignored): {check.ignoredHeaders.join(", ")}</p>
                )}
                {check.errors.length > 0 && (
                  <>
                    <p style={{ margin: "10px 0 0" }}>Fix these rows in your spreadsheet, save it again, and re-choose the file. Nothing is imported until every row is OK.</p>
                    <table className="ac-import-errors">
                      <tbody>
                        {check.errors.slice(0, 200).map((e) => (
                          <tr key={e.row}><td>Row {e.row}</td><td>{e.messages.map((m, i) => <div key={i}>{m}</div>)}</td></tr>
                        ))}
                      </tbody>
                    </table>
                    {check.errors.length > 200 && <p style={{ color: "var(--slate)" }}>…and {check.errors.length - 200} more rows.</p>}
                  </>
                )}
                {check.errors.length === 0 && check.valid > 0 && (
                  <button className="ac-submit" type="button" onClick={runImport} disabled={busy} style={{ marginTop: 12 }}>
                    <Upload size={14} /> {busy ? "Importing…" : `Import ${check.valid} matter${check.valid === 1 ? "" : "s"}`}
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

const ROLE_LABELS = { secretary: "Secretary", assistant: "Assistant", fee_earner: "Fee earner", supervisor: "Supervisor", admin: "Admin" };
const isSupportRole = (role) => role === "secretary" || role === "assistant";
const isFeeEarnerRole = (role) => role === "fee_earner" || role === "supervisor";
const AUDIT_VERBS = { "password reset": "reset the password for" };

/** Readable temporary password (no 0/O/1/l look-alikes), 12 characters. */
function makeTempPassword() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const bytes = new Uint32Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

function StaffForm({ initial, users, selfId, onCancel, onSave, isNew }) {
  const [f, setF] = useState({ name: "", email: "", role: "fee_earner", supervisorId: "", password: isNew ? makeTempPassword() : "", ...initial });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    if (!f.name.trim() || !f.email.trim()) return setError("Name and email are required.");
    if (isNew && f.password.length < 10) return setError("The temporary password must be at least 10 characters.");
    setSaving(true);
    setError("");
    try {
      await onSave(f);
    } catch (err) {
      setError(err.message || "Couldn't save.");
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} style={{ marginTop: 10 }}>
      <div className="ac-row2">
        <div className="ac-field"><label>Name</label><input value={f.name} onChange={set("name")} autoFocus /></div>
        <div className="ac-field"><label>Email (their login)</label><input type="email" value={f.email} onChange={set("email")} /></div>
      </div>
      <div className="ac-row2">
        <div className="ac-field">
          <label>Role</label>
          <select value={f.role} onChange={set("role")}>
            {Object.entries(ROLE_LABELS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </select>
        </div>
        <div className="ac-field">
          <label>{isSupportRole(f.role) ? "Works for (fee earner)" : "Supervisor"}</label>
          <select value={f.supervisorId || ""} onChange={set("supervisorId")}>
            <option value="">— None —</option>
            {users
              .filter((u) => u.active && u.id !== selfId && (!isSupportRole(f.role) || isFeeEarnerRole(u.role)))
              .map((u) => <option key={u.id} value={u.id}>{u.name} ({ROLE_LABELS[u.role]})</option>)}
          </select>
        </div>
      </div>
      {isNew && (
        <div className="ac-field">
          <label>Temporary password — give this to them; they can change it after logging in</label>
          <div style={{ display: "flex", gap: 6 }}>
            <input value={f.password} onChange={set("password")} style={{ fontFamily: "var(--font-mono)" }} />
            <button type="button" className="ac-tablebtn" onClick={() => setF({ ...f, password: makeTempPassword() })}>New</button>
          </div>
        </div>
      )}
      {error && <p style={{ color: "var(--danger)", fontSize: 12.5 }}>{error}</p>}
      <div style={{ display: "flex", gap: 8 }}>
        <button className="ac-submit" type="submit" disabled={saving} style={{ flex: 1 }}><Check size={14} /> {saving ? "Saving…" : isNew ? "Add staff member" : "Save"}</button>
        <button className="ac-tablebtn" type="button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

function StaffPanel({ users, currentUserId, onClose, onChanged }) {
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [notice, setNotice] = useState(null);
  const [audit, setAudit] = useState([]);
  const nameOf = (id) => users.find((u) => u.id === id)?.name;

  const loadAudit = useCallback(() => api.getStaffAudit().then(setAudit).catch(() => {}), []);
  useEffect(() => { loadAudit(); }, [loadAudit]);

  async function afterChange(message) {
    await onChanged();
    await loadAudit();
    setNotice(message);
  }

  async function add(f) {
    await api.createUser({ name: f.name, email: f.email, role: f.role, supervisorId: f.supervisorId || null, password: f.password });
    setAdding(false);
    await afterChange({ text: `${f.name} added. Their login is ${f.email.trim().toLowerCase()} with temporary password:`, secret: f.password });
  }

  async function save(id, f) {
    await api.updateUser(id, { name: f.name, email: f.email, role: f.role, supervisorId: f.supervisorId || null });
    setEditingId(null);
    await afterChange({ text: `${f.name} updated.` });
  }

  async function setActive(u, active) {
    if (!active && !window.confirm(`Deactivate ${u.name}? They'll be logged out straight away and won't be able to log in. Their matters stay as they are.`)) return;
    try {
      await api.updateUser(u.id, { active });
      await afterChange({ text: `${u.name} ${active ? "reactivated" : "deactivated"}.` });
    } catch (err) {
      window.alert(err.message);
    }
  }

  async function resetPassword(u) {
    const password = makeTempPassword();
    if (!window.confirm(`Set a new temporary password for ${u.name}? Their current password will stop working.`)) return;
    try {
      await api.resetUserPassword(u.id, password);
      await afterChange({ text: `New temporary password for ${u.name}:`, secret: password });
    } catch (err) {
      window.alert(err.message);
    }
  }

  return (
    <div className="ac-overlay" onClick={onClose}>
      <div className="ac-panel wide" onClick={(e) => e.stopPropagation()}>
        <div className="ac-panel-head">
          <h2>Staff</h2>
          <button type="button" className="ac-iconbtn" onClick={onClose}><X size={18} /></button>
        </div>

        <div className="ac-role-guide">
          <strong>Secretary / Assistant</strong> — works for a fee earner and sees their matters. Stage moves go to the fee earner for sign-off. <br />
          <strong>Fee earner</strong> — runs their own matters, moves stages and signs off their team's requests. <br />
          <strong>Supervisor</strong> — a fee earner who also oversees others; can sign off on their matters too. <br />
          <strong>Admin</strong> — system role: sees every matter, manages staff, imports and settings. Doesn't sign off stage moves.
        </div>

        {notice && (
          <div className="ac-card" style={{ background: "var(--success-bg)", borderColor: "var(--success)", padding: "10px 14px" }}>
            <div style={{ fontSize: 13 }}>{notice.text}</div>
            {notice.secret && (
              <>
                <div style={{ fontFamily: "var(--font-mono)", fontSize: 16, margin: "6px 0", userSelect: "all" }}>{notice.secret}</div>
                <div style={{ fontSize: 11.5, color: "var(--slate)" }}>Copy it now and give it to them securely — it won't be shown again.</div>
              </>
            )}
            <button className="ac-tablebtn" style={{ marginTop: 6 }} onClick={() => setNotice(null)}>Dismiss</button>
          </div>
        )}

        {adding ? (
          <div className="ac-staff-row">
            <div className="ac-staff-name">New staff member</div>
            <StaffForm isNew users={users} onCancel={() => setAdding(false)} onSave={add} />
          </div>
        ) : (
          <button className="ac-newbtn" style={{ marginBottom: 14 }} onClick={() => { setAdding(true); setNotice(null); }}><Plus size={15} /> Add staff member</button>
        )}

        {users.map((u) => (
          <div key={u.id} className={`ac-staff-row ${u.active ? "" : "inactive"}`}>
            <div className="ac-staff-top">
              <div style={{ minWidth: 0 }}>
                <div className="ac-staff-name">{u.name}{u.id === currentUserId ? " (you)" : ""}</div>
                <div className="ac-staff-meta">{u.email}</div>
                <div className="ac-staff-meta">
                  {ROLE_LABELS[u.role]}{u.supervisor_id ? ` · ${isSupportRole(u.role) ? "works for" : "supervised by"} ${nameOf(u.supervisor_id) || "—"}` : ""}
                </div>
              </div>
              <span className={`ac-pill ${u.active ? "ac-pill--closed" : "ac-pill--setup"}`}>{u.active ? "Active" : "Deactivated"}</span>
            </div>
            {editingId === u.id ? (
              <StaffForm
                users={users}
                selfId={u.id}
                initial={{ name: u.name, email: u.email, role: u.role, supervisorId: u.supervisor_id || "" }}
                onCancel={() => setEditingId(null)}
                onSave={(f) => save(u.id, f)}
              />
            ) : (
              <div className="ac-staff-actions">
                <button className="ac-tablebtn" onClick={() => { setEditingId(u.id); setNotice(null); }}>Edit</button>
                {u.active && <button className="ac-tablebtn" onClick={() => resetPassword(u)}>Reset password</button>}
                {u.id !== currentUserId && (
                  u.active
                    ? <button className="ac-tablebtn" onClick={() => setActive(u, false)}>Deactivate</button>
                    : <button className="ac-tablebtn" onClick={() => setActive(u, true)}>Reactivate</button>
                )}
              </div>
            )}
          </div>
        ))}

        <div className="ac-fieldset-title" style={{ marginTop: 20 }}>Recent changes</div>
        {audit.length === 0 && <p style={{ fontSize: 12.5, color: "var(--slate)" }}>No staff changes recorded yet.</p>}
        {audit.slice(0, 30).map((a) => (
          <div key={a.id} className="ac-audit-row">
            <span style={{ fontFamily: "var(--font-mono)", color: "var(--slate)" }}>{new Date(a.occurred_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
            {" · "}<strong>{a.actor_name || "Someone"}</strong> {AUDIT_VERBS[a.action] || a.action} <strong>{a.target_name || "a former user"}</strong>
            {a.details && a.details !== a.action && a.action !== "password reset" && <span style={{ color: "var(--slate)" }}> — {a.details}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

function ChangePasswordForm({ onClose }) {
  const [f, setF] = useState({ current: "", next: "", confirm: "" });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError("");
    if (f.next.length < 10) return setError("New password must be at least 10 characters.");
    if (f.next !== f.confirm) return setError("The new passwords don't match.");
    setSaving(true);
    try {
      await api.changePassword(f.current, f.next);
      setDone(true);
    } catch (err) {
      setError(err.message || "Couldn't change your password.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="ac-overlay center" onClick={onClose}>
      <form className="ac-modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="ac-modal-head">
          <h2>Change password</h2>
          <button type="button" className="ac-iconbtn" onClick={onClose}><X size={18} /></button>
        </div>
        {done ? (
          <>
            <p style={{ fontSize: 13.5 }}>Your password has been changed. Use the new one next time you log in.</p>
            <button className="ac-submit" type="button" onClick={onClose}><Check size={14} /> Done</button>
          </>
        ) : (
          <>
            <div className="ac-field">
              <label>Current password</label>
              <input type="password" autoComplete="current-password" value={f.current} onChange={(e) => setF({ ...f, current: e.target.value })} required />
            </div>
            <div className="ac-field">
              <label>New password (at least 10 characters)</label>
              <input type="password" autoComplete="new-password" value={f.next} onChange={(e) => setF({ ...f, next: e.target.value })} required />
            </div>
            <div className="ac-field">
              <label>Confirm new password</label>
              <input type="password" autoComplete="new-password" value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} required />
            </div>
            {error && <p style={{ color: "var(--danger)", fontSize: 13 }}>{error}</p>}
            <button className="ac-submit" type="submit" disabled={saving}><Check size={14} /> {saving ? "Saving…" : "Change password"}</button>
          </>
        )}
      </form>
    </div>
  );
}

function UpdateSearchForm({ search, onClose, onSave }) {
  const [f, setF] = useState({
    expectedReturn: search.expectedReturn || "",
    dateReceived: search.dateReceived || "",
    issue: search.issue || false,
    issueNotes: search.issueNotes || "",
  });

  function submit(e) {
    e.preventDefault();
    onSave(f);
  }

  return (
    <div className="ac-overlay center" onClick={onClose}>
      <form className="ac-modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="ac-modal-head">
          <h2>{search.type}</h2>
          <button type="button" className="ac-iconbtn" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="ac-row2">
          <div className="ac-field">
            <label>Expected return</label>
            <input type="date" value={f.expectedReturn} onChange={(e) => setF({ ...f, expectedReturn: e.target.value })} />
          </div>
          <div className="ac-field">
            <label>Date received</label>
            <input type="date" value={f.dateReceived} onChange={(e) => setF({ ...f, dateReceived: e.target.value })} />
          </div>
        </div>
        <div className="ac-field" style={{ display: "flex", alignItems: "center", gap: 8, flexDirection: "row" }}>
          <input type="checkbox" id="issue-flag" checked={f.issue} onChange={(e) => setF({ ...f, issue: e.target.checked })} style={{ width: "auto" }} />
          <label htmlFor="issue-flag" style={{ margin: 0, textTransform: "none", fontSize: 13, fontWeight: 500, color: "var(--ink)" }}>Flag an issue with this search</label>
        </div>
        {f.issue && (
          <div className="ac-field">
            <label>Issue notes</label>
            <textarea value={f.issueNotes} onChange={(e) => setF({ ...f, issueNotes: e.target.value })} placeholder="What's the issue and what needs to happen next?" style={{ minHeight: 80 }} />
          </div>
        )}
        <button className="ac-submit" type="submit" onClick={submit}><Check size={14} /> Save</button>
      </form>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Undertakings                                                            */
/* ---------------------------------------------------------------------- */

function AddUndertakingForm({ onClose, onAdd }) {
  const [f, setF] = useState({ direction: "given", description: "", party: "", dateGiven: new Date().toISOString().slice(0, 10) });
  const [error, setError] = useState("");
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  function submit(e) {
    e.preventDefault();
    if (!f.description.trim() || !f.party.trim()) {
      setError("Enter both a description and the other party.");
      return;
    }
    onAdd(f);
  }

  return (
    <div className="ac-overlay center" onClick={onClose}>
      <form className="ac-modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="ac-modal-head">
          <h2>Add undertaking</h2>
          <button type="button" className="ac-iconbtn" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="ac-field">
          <label>Direction</label>
          <select value={f.direction} onChange={set("direction")}>
            <option value="given">Given by us</option>
            <option value="received">Received from the other side</option>
          </select>
        </div>
        <div className="ac-field">
          <label>Description</label>
          <textarea value={f.description} onChange={set("description")} placeholder="e.g. To redeem the existing mortgage from completion monies and forward confirmation of discharge." style={{ minHeight: 80 }} autoFocus />
        </div>
        <div className="ac-row2">
          <div className="ac-field">
            <label>{f.direction === "given" ? "Given to" : "Received from"}</label>
            <input value={f.party} onChange={set("party")} placeholder="Their firm name" />
          </div>
          <div className="ac-field">
            <label>Date</label>
            <input type="date" value={f.dateGiven} onChange={set("dateGiven")} />
          </div>
        </div>
        {error && <div style={{ color: "var(--danger)", fontSize: 12.5, marginBottom: 10 }}>{error}</div>}
        <button className="ac-submit" type="submit" onClick={submit}><Gavel size={14} /> Add undertaking</button>
      </form>
    </div>
  );
}

function DischargeUndertakingForm({ undertaking, onClose, onSave }) {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));

  function submit(e) {
    e.preventDefault();
    onSave(date);
  }

  return (
    <div className="ac-overlay center" onClick={onClose}>
      <form className="ac-modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="ac-modal-head">
          <h2>Discharge undertaking</h2>
          <button type="button" className="ac-iconbtn" onClick={onClose}><X size={18} /></button>
        </div>
        <p style={{ fontSize: 13, color: "var(--ink-soft)", background: "var(--paper)", border: "1px solid var(--line)", borderRadius: 6, padding: 10, marginBottom: 14 }}>{undertaking.description}</p>
        <div className="ac-field">
          <label>Date discharged</label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} autoFocus />
        </div>
        <button className="ac-submit" type="submit" onClick={submit}><Check size={14} /> Mark discharged</button>
      </form>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Tasks & reminders                                                      */
/* ---------------------------------------------------------------------- */

function ConfirmReviewForm({ matter, defaultName, onClose, onConfirm }) {
  const [name, setName] = useState(defaultName || "");
  const [error, setError] = useState("");

  function submit(e) {
    e.preventDefault();
    if (!name.trim()) {
      setError("Enter your name to confirm.");
      return;
    }
    onConfirm(name.trim());
  }

  return (
    <div className="ac-overlay center" onClick={onClose}>
      <form className="ac-modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="ac-modal-head">
          <h2>Confirm pre-exchange review</h2>
          <button type="button" className="ac-iconbtn" onClick={onClose}><X size={18} /></button>
        </div>
        <p style={{ fontSize: 12.5, color: "var(--ink-soft)", marginTop: 0 }}>
          This confirms all {PRE_COMPLETION_CHECKLIST.length} checklist items have been reviewed on {matter.reference} — {matter.address} — and the file is ready to exchange contracts.
        </p>
        <div className="ac-field">
          <label>Reviewed by</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" autoFocus />
        </div>
        {error && <div style={{ color: "var(--danger)", fontSize: 12.5, marginBottom: 10 }}>{error}</div>}
        <button className="ac-submit" type="submit" onClick={submit}><Check size={14} /> Confirm review</button>
      </form>
    </div>
  );
}

function AddTaskForm({ onClose, onAdd }) {
  const [f, setF] = useState({ description: "", dueDate: "" });
  const [error, setError] = useState("");
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  function submit(e) {
    e.preventDefault();
    if (!f.description.trim()) {
      setError("Enter what needs to be done.");
      return;
    }
    onAdd(f);
  }

  return (
    <div className="ac-overlay center" onClick={onClose}>
      <form className="ac-modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="ac-modal-head">
          <h2>Add task</h2>
          <button type="button" className="ac-iconbtn" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="ac-field">
          <label>What needs to be done</label>
          <textarea value={f.description} onChange={set("description")} placeholder="e.g. Chase mortgage offer, confirm buildings insurance is in place" style={{ minHeight: 70 }} autoFocus />
        </div>
        <div className="ac-field">
          <label>Due date</label>
          <input type="date" value={f.dueDate} onChange={set("dueDate")} />
        </div>
        {error && <div style={{ color: "var(--danger)", fontSize: 12.5, marginBottom: 10 }}>{error}</div>}
        <button className="ac-submit" type="submit" onClick={submit}><ListChecks size={14} /> Add task</button>
      </form>
    </div>
  );
}

function GlobalTasksPanel({ matters, settings, onClose, onOpenMatter, onCompleteTask }) {
  const today = new Date();
  const openTasks = allOpenTasks(matters);
  const stale = staleFiles(matters, settings.staleDays);

  return (
    <div className="ac-overlay" onClick={onClose}>
      <div className="ac-panel" onClick={(e) => e.stopPropagation()} style={{ width: 520 }}>
        <div className="ac-panel-head">
          <h2>Tasks &amp; reminders</h2>
          <button type="button" className="ac-iconbtn" onClick={onClose}><X size={18} /></button>
        </div>

        <h3 style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--slate)", margin: "0 0 10px" }}>Open tasks ({openTasks.length})</h3>
        {openTasks.length === 0 && <p style={{ color: "var(--slate)", fontSize: 13, marginBottom: 20 }}>Nothing outstanding — everything's up to date.</p>}
        {openTasks.map((t) => {
          const overdue = t.dueDate && new Date(t.dueDate) < today;
          return (
            <div key={t.id} className="ac-doc-row" style={{ background: overdue ? "#fdf1ea" : "var(--card)", marginBottom: 10 }}>
              <div className="ac-doc-icon" style={overdue ? { background: "#f6ddd0", color: "#8a3b1f" } : {}}><ListChecks size={16} /></div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="ac-doc-name">{t.description}</div>
                <button onClick={() => onOpenMatter(t.matterId)} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontSize: 11.5, color: "var(--brass)", fontWeight: 600 }}>
                  {t.matterRef} — {t.matterAddr}
                </button>
                <div className="ac-doc-meta" style={overdue ? { color: "#8a3b1f", fontWeight: 600 } : {}}>{t.dueDate ? `${overdue ? "Overdue — was due" : "Due"} ${formatDate(t.dueDate)}` : "No due date"}</div>
              </div>
              <button className="ac-tablebtn" onClick={() => onCompleteTask(t.matterId, t.id)}>Done</button>
            </div>
          );
        })}

        <h3 style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--slate)", margin: "24px 0 10px" }}>Files needing review ({stale.length})</h3>
        <p style={{ fontSize: 11.5, color: "var(--slate-light)", marginTop: -4, marginBottom: 12 }}>Matters with no logged activity for {settings.staleDays}+ days.</p>
        {stale.length === 0 && <p style={{ color: "var(--slate)", fontSize: 13 }}>Every open file has been touched recently.</p>}
        {stale.map(({ matter, idle }) => (
          <div key={matter.id} className="ac-doc-row" style={{ background: "#fdf1ea", marginBottom: 10 }}>
            <div className="ac-doc-icon" style={{ background: "#f6ddd0", color: "#8a3b1f" }}><AlertTriangle size={16} /></div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <button onClick={() => onOpenMatter(matter.id)} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontSize: 13, fontWeight: 600, color: "var(--ink)", textAlign: "left" }}>
                {matter.reference} — {matter.address}
              </button>
              <div className="ac-doc-meta" style={{ color: "#8a3b1f", fontWeight: 600 }}>No activity for {idle} days</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
