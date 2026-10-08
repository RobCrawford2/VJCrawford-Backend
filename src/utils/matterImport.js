/**
 * Validation for bulk matter import (POST /matters/import). Rows arrive as
 * plain objects keyed by whatever headers the spreadsheet had; this maps
 * those headers onto matter fields, cleans up values (UK dates, "£1,000"
 * prices, stage names) and reports every problem per row, so the whole file
 * can be checked before anything is written.
 */

const { STAGE_NAMES } = require("./stages");

// Field → accepted header spellings (compared after lower-casing and
// stripping everything but letters and digits).
const FIELDS = {
  reference: ["reference", "ref", "matterreference", "matterref", "fileref", "filereference", "matternumber", "matterno"],
  address: ["address", "propertyaddress", "property"],
  client: ["client", "clientname", "clients", "clientnames"],
  type: ["type", "mattertype", "transactiontype", "transaction"],
  price: ["price", "purchaseprice", "saleprice", "propertyprice", "value", "amount"],
  stage: ["stage", "currentstage", "status"],
  feeEarner: ["feeearner", "feeearneremail", "handler", "assignedto", "caseworker"],
  supervisor: ["supervisor", "supervisoremail", "supervisingpartner", "partner"],
  otherSideSolicitor: ["othersidesolicitor", "othersidefirm", "othersolicitor", "sellerssolicitor", "buyerssolicitor"],
  otherSideSolicitorEmail: ["othersidesolicitoremail", "othersideemail", "othersolicitoremail"],
  estateAgent: ["estateagent", "agent"],
  lender: ["lender", "mortgagelender", "mortgagee"],
  dateInstructed: ["dateinstructed", "instructed", "instructiondate", "dateopened", "opened", "opendate"],
  targetExchange: ["targetexchange", "targetexchangedate", "exchangetarget"],
  targetCompletion: ["targetcompletion", "targetcompletiondate", "completiontarget"],
  // Plain "Exchange Date" / "Completion Date" are deliberately not accepted:
  // in a live caseload they could mean target or actual, so the user has to
  // say which (they'll show as unrecognised columns).
  actualExchange: ["actualexchange", "actualexchangedate", "exchanged", "dateexchanged"],
  actualCompletion: ["actualcompletion", "actualcompletiondate", "completed", "datecompleted"],
  mortgageOfferExpiry: ["mortgageofferexpiry", "mortgageexpiry", "offerexpiry", "mortgageofferexpirydate"],
  notes: ["notes", "note", "comments", "comment"],
};

const DATE_FIELDS = ["dateInstructed", "targetExchange", "targetCompletion", "actualExchange", "actualCompletion", "mortgageOfferExpiry"];

const normalizeHeader = (h) => String(h).toLowerCase().replace(/[^a-z0-9]/g, "");
const normalizeStage = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, "");

const HEADER_LOOKUP = new Map();
for (const [field, aliases] of Object.entries(FIELDS)) {
  for (const a of aliases) HEADER_LOOKUP.set(a, field);
}

/** Which matter field each spreadsheet header maps to (null = ignored). */
function mapHeaders(headers) {
  const mapping = {};
  for (const h of headers) mapping[h] = HEADER_LOOKUP.get(normalizeHeader(h)) || null;
  return mapping;
}

/** Accepts DD/MM/YYYY (UK, also with - or .), D/M/YY, or YYYY-MM-DD. Returns YYYY-MM-DD or null. */
function parseDate(value) {
  const v = String(value).trim();
  let y, m, d;
  let match = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/);
  if (match) {
    [, y, m, d] = match.map(Number);
  } else if ((match = v.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/))) {
    [, d, m, y] = match.map(Number);
    if (y < 100) y += 2000;
  } else {
    return null;
  }
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function parsePrice(value) {
  const cleaned = String(value).replace(/[£,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  return Number(cleaned);
}

function parseStage(value) {
  const v = String(value).trim();
  if (/^\d+$/.test(v)) {
    // Spreadsheets will number stages 1..12, as the UI does ("Stage 4 of 12").
    const n = Number(v);
    return n >= 1 && n <= STAGE_NAMES.length ? n - 1 : null;
  }
  const idx = STAGE_NAMES.findIndex((s) => normalizeStage(s) === normalizeStage(v));
  return idx >= 0 ? idx : null;
}

function parseType(value) {
  const v = String(value).trim().toLowerCase();
  if (v === "sale" || v === "sell" || v === "selling") return "Sale";
  if (v === "purchase" || v === "buy" || v === "buying") return "Purchase";
  if (v === "remortgage" || v === "re-mortgage") return "Remortgage";
  return null;
}

/**
 * Validates and cleans every row.
 *   rows:  [{ <header>: <value>, ... }]
 *   users: the firm's users ({ id, name, email, active }) for fee earner / supervisor lookup
 *   existingReferences: Set of references already in the firm
 * Returns { matters: [...clean rows], errors: [{ row, messages }] } — row
 * numbers are spreadsheet rows (header = 1, first data row = 2).
 */
function validateRows(rows, { users, existingReferences }) {
  const headers = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const mapping = mapHeaders(headers);

  const byEmail = new Map(users.map((u) => [u.email.toLowerCase(), u]));
  const byName = new Map();
  for (const u of users) {
    const key = u.name.trim().toLowerCase();
    byName.set(key, byName.has(key) ? "ambiguous" : u);
  }
  function findUser(value) {
    const v = String(value).trim().toLowerCase();
    return byEmail.get(v) || byName.get(v) || null;
  }

  const seenReferences = new Set();
  const matters = [];
  const errors = [];

  rows.forEach((raw, i) => {
    const rowNumber = i + 2;
    const messages = [];
    const m = {};
    const headerFor = {};
    for (const [header, value] of Object.entries(raw)) {
      const field = mapping[header];
      if (field && value !== null && value !== undefined && String(value).trim() !== "") {
        m[field] = String(value).trim();
        headerFor[field] = header;
      }
    }
    if (!Object.keys(m).length) return; // blank line

    if (!m.address) messages.push("Address is missing.");
    if (!m.client) messages.push("Client is missing.");
    if (!m.type) messages.push("Type is missing (Sale, Purchase or Remortgage).");
    else if (!(m.type = parseType(m.type))) messages.push("Type must be Sale, Purchase or Remortgage.");

    if (m.reference) {
      const key = m.reference.toLowerCase();
      if (existingReferences.has(key)) messages.push(`Reference ${m.reference} is already in the system.`);
      else if (seenReferences.has(key)) messages.push(`Reference ${m.reference} appears more than once in this file.`);
      seenReferences.add(key);
    }

    if (m.price !== undefined) {
      const price = parsePrice(m.price);
      if (price === null) messages.push(`Price "${m.price}" isn't a number.`);
      else m.price = price;
    }

    if (m.stage !== undefined) {
      const stage = parseStage(m.stage);
      if (stage === null) messages.push(`Stage "${m.stage}" isn't recognised. Use a stage name (e.g. Searches) or number 1–${STAGE_NAMES.length}.`);
      else m.stage = stage;
    } else {
      m.stage = 0;
    }

    for (const field of DATE_FIELDS) {
      if (m[field] === undefined) continue;
      const date = parseDate(m[field]);
      if (!date) messages.push(`${headerFor[field]} "${m[field]}" isn't a valid date (use DD/MM/YYYY).`);
      else m[field] = date;
    }

    for (const field of ["feeEarner", "supervisor"]) {
      if (m[field] === undefined) continue;
      const user = findUser(m[field]);
      const label = field === "feeEarner" ? "Fee earner" : "Supervisor";
      if (user === "ambiguous") messages.push(`${label} "${m[field]}" matches more than one person — use their email address.`);
      else if (!user) messages.push(`${label} "${m[field]}" isn't a member of staff. Use their name or email as it appears in the system.`);
      else if (!user.active) messages.push(`${label} "${m[field]}" is deactivated.`);
      else m[`${field}Id`] = user.id;
      delete m[field];
    }

    if (messages.length) errors.push({ row: rowNumber, messages });
    else matters.push({ row: rowNumber, ...m });
  });

  const ignoredHeaders = headers.filter((h) => !mapping[h]);
  return { matters, errors, ignoredHeaders };
}

module.exports = { validateRows, parseDate, parsePrice, parseStage };
