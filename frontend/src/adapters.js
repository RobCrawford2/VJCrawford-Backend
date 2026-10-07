/**
 * The UI (MatterDetail and every modal/form component) was built against a
 * specific local shape — camelCase, nested `parties`/`keyDates` objects,
 * free-text fee-earner names. The backend, correctly, uses snake_case
 * columns and real user IDs for fee earner / supervisor. These functions
 * translate one to the other so the existing UI code didn't need touching.
 */

export function userName(users, id) {
  const u = users.find((x) => x.id === id);
  return u ? u.name : "";
}

function adaptDocument(d) {
  return {
    id: d.id, name: d.name, category: d.category, date: d.doc_date || "", notes: d.notes || "",
    fileName: d.file_name || "", fileSize: d.file_size || 0,
  };
}
function adaptEmail(e) {
  return { id: e.id, direction: e.direction, from: e.from_address || "", to: e.to_address || "", subject: e.subject, body: e.body || "", date: e.email_date };
}
function adaptEnquiry(q) {
  return {
    id: q.id, number: q.number, question: q.question, dateRaised: q.date_raised, status: q.status,
    answer: q.answer || "", dateAnswered: q.date_answered || "", autoFilled: q.auto_filled,
    sourceEmailId: q.source_email_id, followUpNotes: q.follow_up_notes || "",
  };
}
function adaptSearch(s) {
  return {
    id: s.id, type: s.type, dateOrdered: s.date_ordered || "", expectedReturn: s.expected_return || "",
    dateReceived: s.date_received || "", issue: s.issue, issueNotes: s.issue_notes || "",
  };
}
function adaptUndertaking(u) {
  return {
    id: u.id, direction: u.direction, description: u.description, party: u.party || "",
    dateGiven: u.date_given || "", status: u.status, dateDischarged: u.date_discharged || "",
  };
}
function adaptTask(t) {
  return { id: t.id, description: t.description, dueDate: t.due_date || "", status: t.status, dateCompleted: t.date_completed || "" };
}
function adaptActivity(a) {
  return { id: a.id, type: a.type, text: a.text, date: a.occurred_at };
}

/**
 * Converts a matter row from the API (either the full GET /matters/:id
 * detail, or a GET /matters list-summary row — both share the same
 * top-level columns) into the shape every existing component expects.
 *
 * Known limitation: list-summary rows don't include nested sub-resources
 * (documents/emails/enquiries/searches/undertakings/tasks/activity), so
 * those default to empty arrays here. That means the sidebar's "needs
 * attention" icon can under-report for rows that haven't been opened yet —
 * it can still see stage/date/mortgage-expiry issues (those are columns on
 * the matter itself) but not e.g. an outstanding enquiry, since that lives
 * in a joined table the list endpoint doesn't fetch for performance reasons.
 * A future enhancement would have the backend return a precomputed
 * attention flag per row; out of scope for this pass.
 */
export function adaptMatter(m, users) {
  return {
    id: m.id,
    reference: m.reference,
    address: m.address,
    client: m.client,
    type: m.type,
    price: m.price !== null && m.price !== undefined ? Number(m.price) : "",
    currentStageIndex: m.current_stage_index,
    feeEarner: userName(users, m.fee_earner_id),
    feeEarnerId: m.fee_earner_id || "",
    supervisor: userName(users, m.supervisor_id),
    supervisorId: m.supervisor_id || "",
    parties: {
      otherSideSolicitor: m.other_side_solicitor || "",
      otherSideSolicitorEmail: m.other_side_solicitor_email || "",
      estateAgent: m.estate_agent || "",
      lender: m.lender || "",
    },
    keyDates: {
      instructed: m.date_instructed || "",
      targetExchange: m.target_exchange || "",
      targetCompletion: m.target_completion || "",
      actualExchange: m.actual_exchange || "",
      actualCompletion: m.actual_completion || "",
      mortgageOfferExpiry: m.mortgage_offer_expiry || "",
    },
    notes: m.notes || "",
    documents: (m.documents || []).map(adaptDocument),
    emails: (m.emails || []).map(adaptEmail),
    enquiries: (m.enquiries || []).map(adaptEnquiry),
    searches: (m.searches || []).map(adaptSearch),
    undertakings: (m.undertakings || []).map(adaptUndertaking),
    tasks: (m.tasks || []).map(adaptTask),
    activity: (m.activity || []).map(adaptActivity),
    linkedMatterIds: (m.linkedMatters || []).map((l) => l.id),
    preCompletionReview: {
      checkedItems: Array.isArray(m.pre_exchange_checklist) ? m.pre_exchange_checklist : [],
      confirmedBy: m.pre_exchange_confirmed_by || "",
      confirmedDate: m.pre_exchange_confirmed_date || "",
    },
  };
}

/** Converts the New Matter form's payload into the shape POST /matters expects. */
export function toApiNewMatter(f) {
  return {
    address: f.address, client: f.client, type: f.type, price: f.price,
    feeEarnerId: f.feeEarnerId || null, supervisorId: f.supervisorId || null,
    otherSideSolicitor: f.parties?.otherSideSolicitor, otherSideSolicitorEmail: f.parties?.otherSideSolicitorEmail,
    estateAgent: f.parties?.estateAgent, lender: f.parties?.lender,
    targetExchange: f.keyDates?.targetExchange, targetCompletion: f.keyDates?.targetCompletion,
    mortgageOfferExpiry: f.keyDates?.mortgageOfferExpiry,
  };
}

/** Converts an EditMatterForm patch into the shape PATCH /matters/:id expects. */
export function toApiMatterPatch(patch) {
  const out = {};
  if ("address" in patch) out.address = patch.address;
  if ("client" in patch) out.client = patch.client;
  if ("type" in patch) out.type = patch.type;
  if ("price" in patch) out.price = patch.price;
  if ("feeEarnerId" in patch) out.feeEarnerId = patch.feeEarnerId || null;
  if ("supervisorId" in patch) out.supervisorId = patch.supervisorId || null;
  if ("notes" in patch) out.notes = patch.notes;
  if (patch.parties) {
    out.otherSideSolicitor = patch.parties.otherSideSolicitor;
    out.otherSideSolicitorEmail = patch.parties.otherSideSolicitorEmail;
    out.estateAgent = patch.parties.estateAgent;
    out.lender = patch.parties.lender;
  }
  if (patch.keyDates) {
    out.targetExchange = patch.keyDates.targetExchange;
    out.targetCompletion = patch.keyDates.targetCompletion;
    out.actualExchange = patch.keyDates.actualExchange;
    out.actualCompletion = patch.keyDates.actualCompletion;
    out.mortgageOfferExpiry = patch.keyDates.mortgageOfferExpiry;
  }
  return out;
}
