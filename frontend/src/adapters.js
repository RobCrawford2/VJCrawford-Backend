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
    replies: (q.replies || []).map((r) => ({
      id: r.id, text: r.reply, date: r.date_received, by: r.created_by_name || "",
      emailId: r.source_email_id, emailSubject: r.source_email_subject || "", createdAt: r.created_at,
    })),
    comments: (q.comments || []).map((c) => ({ id: c.id, text: c.comment, at: c.created_at, by: c.created_by_name || "" })),
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
  return {
    id: t.id, description: t.description, dueDate: t.due_date || "", status: t.status, dateCompleted: t.date_completed || "",
    assignedTo: t.assigned_to || "", assignedToName: t.assigned_to_name || "",
  };
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
const numOrBlank = (v) => (v !== null && v !== undefined ? Number(v) : "");

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
      os1PriorityExpiry: m.os1_priority_expiry || "",
    },
    clientDetails: {
      address: m.client_address || "",
      email: m.client_email || "",
      phone: m.client_phone || "",
      salutation: m.client_salutation || "",
    },
    property: {
      tenure: m.tenure || "",
      titleNumber: m.title_number || "",
      registeredProprietor: m.registered_proprietor || "",
      leaseTerm: m.lease_term || "",
      groundRent: m.ground_rent || "",
      serviceCharge: m.service_charge || "",
      leaseYearsRemaining: m.lease_years_remaining ?? "",
    },
    money: {
      deposit: m.deposit !== null && m.deposit !== undefined ? Number(m.deposit) : "",
      sdlt: m.sdlt !== null && m.sdlt !== undefined ? Number(m.sdlt) : "",
      mortgageConditions: m.mortgage_conditions || "",
      depositReceivedDate: m.deposit_received_date || "",
      sdltBuyerType: m.sdlt_buyer_type || "",
      sdltNonResident: !!m.sdlt_non_resident,
      mortgageAdvance: numOrBlank(m.mortgage_advance),
      redemptionAmount: numOrBlank(m.redemption_amount),
      agentFee: numOrBlank(m.agent_fee),
      fundsReceived: numOrBlank(m.funds_received),
      costs: Array.isArray(m.costs) ? m.costs.map((c) => ({ description: c.description, amount: Number(c.amount), vat: !!c.vat })) : [],
    },
    // Client's bank details, newest first: [0] is the current set unless superseded.
    bankDetails: (m.bankDetails || []).map((b) => ({
      id: b.id, accountName: b.account_name, sortCode: b.sort_code, accountNumber: b.account_number, bankName: b.bank_name || "",
      status: b.status, enteredByName: b.entered_by_name || "", enteredAt: b.entered_at,
      verifiedByName: b.verified_by_name || "", verifiedAt: b.verified_at, verificationMethod: b.verification_method || "",
      verificationNote: b.verification_note || "",
    })),
    notes: m.notes || "",
    documents: (m.documents || []).map(adaptDocument),
    emails: (m.emails || []).map(adaptEmail),
    enquiries: (m.enquiries || []).map(adaptEnquiry),
    searches: (m.searches || []).map(adaptSearch),
    undertakings: (m.undertakings || []).map(adaptUndertaking),
    tasks: (m.tasks || []).map(adaptTask),
    activity: (m.activity || []).map(adaptActivity),
    linkedMatterIds: (m.linkedMatters || []).map((l) => l.id),
    // Summary of each linked matter, from the detail endpoint — so links work
    // even when the linked matter isn't in the currently loaded list page.
    linkedMatters: (m.linkedMatters || []).map((l) => ({
      id: l.id, reference: l.reference, address: l.address, client: l.client, type: l.type,
      currentStageIndex: l.current_stage_index, targetCompletion: l.target_completion || "",
    })),
    // Stage sign-off (only on the detail endpoint's response).
    pendingStageRequest: m.pendingStageRequest
      ? {
          id: m.pendingStageRequest.id, toStage: m.pendingStageRequest.to_stage, fromStage: m.pendingStageRequest.from_stage,
          note: m.pendingStageRequest.note || "", requestedBy: m.pendingStageRequest.requested_by,
          requestedByName: m.pendingStageRequest.requested_by_name || "", requestedAt: m.pendingStageRequest.requested_at,
        }
      : null,
    canSignOffStages: !!m.canSignOffStages,
    stageMovesNeedSignoff: !!m.stageMovesNeedSignoff,
    preCompletionReview: {
      checkedItems: Array.isArray(m.pre_exchange_checklist) ? m.pre_exchange_checklist : [],
      confirmedBy: m.pre_exchange_confirmed_by || "",
      confirmedDate: m.pre_exchange_confirmed_date || "",
    },
  };
}


/** Flattens the clientDetails / property / money groups into API field names. */
function detailFields(f) {
  const out = {};
  if (f.clientDetails) {
    out.clientAddress = f.clientDetails.address;
    out.clientEmail = f.clientDetails.email;
    out.clientPhone = f.clientDetails.phone;
    out.clientSalutation = f.clientDetails.salutation;
  }
  if (f.property) {
    out.tenure = f.property.tenure;
    out.titleNumber = f.property.titleNumber;
    out.registeredProprietor = f.property.registeredProprietor;
    out.leaseTerm = f.property.leaseTerm;
    out.groundRent = f.property.groundRent;
    out.serviceCharge = f.property.serviceCharge;
    if ("leaseYearsRemaining" in f.property) out.leaseYearsRemaining = f.property.leaseYearsRemaining === "" ? "" : Number(f.property.leaseYearsRemaining);
  }
  if (f.money) {
    out.deposit = f.money.deposit;
    out.sdlt = f.money.sdlt;
    out.mortgageConditions = f.money.mortgageConditions;
    if ("depositReceivedDate" in f.money) out.depositReceivedDate = f.money.depositReceivedDate;
    if ("sdltBuyerType" in f.money) out.sdltBuyerType = f.money.sdltBuyerType;
    if ("sdltNonResident" in f.money) out.sdltNonResident = !!f.money.sdltNonResident;
    for (const k of ["mortgageAdvance", "redemptionAmount", "agentFee", "fundsReceived"]) if (k in f.money) out[k] = f.money[k];
    if ("costs" in f.money) out.costs = f.money.costs;
  }
  return out;
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
    ...detailFields(f),
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
    if ("os1PriorityExpiry" in patch.keyDates) out.os1PriorityExpiry = patch.keyDates.os1PriorityExpiry;
  }
  Object.assign(out, detailFields(patch));
  return out;
}

/** A row from GET /tasks (open tasks across matters). */
export function adaptTaskRow(t) {
  return {
    id: t.id, description: t.description, dueDate: t.due_date || "", assignedTo: t.assigned_to || "",
    assignedToName: t.assigned_to_name || "", matterId: t.matter_id, matterRef: t.reference, matterAddr: t.address,
  };
}
