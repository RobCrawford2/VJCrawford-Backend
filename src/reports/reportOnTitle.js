/**
 * Builds a draft Report on Title (Word .docx) for a purchase or remortgage
 * from the matter's own data: client and property details, search results
 * and enquiry replies. Anything the system doesn't hold (tenure, title
 * number, deposit, SDLT…) is left as a highlighted [placeholder] for the
 * fee earner to complete — the output is a starting draft for a solicitor
 * to check and edit, not something to send unread.
 */
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  Table, TableRow, TableCell, WidthType, BorderStyle, ShadingType,
} = require("docx");

const FONT = "Calibri";

// Plain-English notes on what each common search covers, shown under the results table.
const SEARCH_NOTES = {
  "local authority search": "covers planning and building control history, road adoption, and local authority notices or proposals affecting the property",
  "water & drainage search": "confirms whether the property is connected to the public mains water supply and sewers, and whether any public sewers run within its boundaries",
  "environmental search": "assesses the risk of land contamination from past or present nearby uses, and flags other environmental risks such as flooding and ground stability",
  "coal mining search": "reports on past, present and planned coal mining in the area and any related subsidence claims",
  "chancel repair search": "assesses whether the property may be liable to contribute to the cost of repairing a parish church chancel",
  "flood risk search": "assesses the risk of flooding to the property from rivers, the sea, surface water and groundwater",
  "highways search": "confirms whether the roads and footpaths adjoining the property are maintained at public expense",
  "commons registration search": "confirms whether the land is registered as common land or a town or village green",
};

const formatDate = (d) =>
  d ? new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/London" }) : null;
const formatMoney = (n) =>
  n === null || n === undefined ? null : `£${Number(n).toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

/** Text with optional placeholders: parts are strings, or { ph: "…" } for a highlighted [placeholder]. */
function runs(parts, opts = {}) {
  return parts.map((part) =>
    typeof part === "string"
      ? new TextRun({ text: part, font: FONT, ...opts })
      : new TextRun({ text: `[${part.ph}]`, font: FONT, highlight: "yellow", ...opts })
  );
}
const para = (parts, opts = {}) =>
  new Paragraph({ children: runs(Array.isArray(parts) ? parts : [parts]), spacing: { after: 160 }, ...opts });
const heading = (text) =>
  new Paragraph({ children: runs([text], { bold: true, size: 26, color: "16212F" }), heading: HeadingLevel.HEADING_2, spacing: { before: 280, after: 120 } });
const bullet = (parts) =>
  new Paragraph({ children: runs(Array.isArray(parts) ? parts : [parts]), bullet: { level: 0 }, spacing: { after: 80 } });
/** Use a value if present, otherwise a placeholder. */
const orPh = (value, placeholder) => (value ? value : { ph: placeholder });

function cell(parts, { bold = false, shade = false, width } = {}) {
  return new TableCell({
    children: [new Paragraph({ children: runs(Array.isArray(parts) ? parts : [parts], { bold, size: 20 }) })],
    width: width ? { size: width, type: WidthType.PERCENTAGE } : undefined,
    shading: shade ? { type: ShadingType.CLEAR, color: "auto", fill: "E8E4DA" } : undefined,
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
  });
}

function searchesTable(searches) {
  const border = { style: BorderStyle.SINGLE, size: 4, color: "B8B2A3" };
  const header = new TableRow({
    tableHeader: true,
    children: [
      cell("Search", { bold: true, shade: true, width: 30 }),
      cell("Received", { bold: true, shade: true, width: 18 }),
      cell("Result", { bold: true, shade: true, width: 52 }),
    ],
  });
  const rows = searches.map((s) => {
    let result;
    if (!s.date_received) result = [{ ph: "Result awaited — update before sending" }];
    else if (s.issue) result = [s.issue_notes ? `Matter to note: ${s.issue_notes}` : "Matter to note: ", ...(s.issue_notes ? [] : [{ ph: "describe the issue" }])];
    else result = ["Nothing of concern revealed."];
    return new TableRow({
      children: [cell(s.type, { width: 30 }), cell(formatDate(s.date_received) || "Awaited", { width: 18 }), cell(result, { width: 52 })],
    });
  });
  return new Table({
    rows: [header, ...rows],
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: { top: border, bottom: border, left: border, right: border, insideHorizontal: border, insideVertical: border },
  });
}

function enquiryParagraphs(enquiries) {
  const out = [];
  for (const q of enquiries) {
    out.push(new Paragraph({ children: runs([`${q.number}. ${q.question}`], { bold: true }), spacing: { before: 120, after: 60 } }));
    let reply;
    if (q.status === "Answered" && q.answer) reply = [`Reply: ${q.answer}`];
    else if (q.status === "Pending Review") reply = [`Reply received (${q.answer || "see file"}) — `, { ph: "review this reply before sending" }];
    else reply = [{ ph: "Reply awaited — chase or remove before sending" }];
    out.push(new Paragraph({ children: runs(reply), spacing: { after: 60 }, indent: { left: 360 } }));
    out.push(new Paragraph({ children: runs(["Our comment: ", { ph: "add comment or delete" }], { italics: true }), spacing: { after: 120 }, indent: { left: 360 } }));
  }
  return out;
}

/**
 * matter: matters row; searches/enquiries: rows for that matter;
 * firm: { name }; feeEarner: { name } | null.
 */
async function buildReportOnTitle({ matter, searches, enquiries, firm, feeEarner }) {
  const isPurchase = matter.type === "Purchase";
  const today = formatDate(new Date());
  const price = formatMoney(matter.price);
  const signer = feeEarner?.name;

  const receivedSearches = searches.filter((s) => s.date_received);
  const issueSearches = searches.filter((s) => s.issue);
  const unanswered = enquiries.filter((q) => q.status !== "Answered");

  const children = [
    para([{ ph: "DRAFT — check and complete every highlighted section, then delete this line before sending" }]),
    new Paragraph({ children: runs([firm.name], { bold: true, size: 32 }), spacing: { after: 40 } }),
    para([{ ph: "Firm address, telephone, email, SRA number" }]),
    para(today, { alignment: AlignmentType.RIGHT }),
    new Paragraph({ children: runs(["PRIVATE & CONFIDENTIAL"], { bold: true }), spacing: { after: 160 } }),
    para([matter.client]),
    ...(matter.client_address
      ? matter.client_address.split(/\r?\n|,\s*/).filter(Boolean).map((line) => new Paragraph({ children: runs([line.trim()]) }))
      : [para([{ ph: "Client's correspondence address" }])]),
    para(""),
    para([`Our ref: ${matter.reference}${signer ? ` / ${signer}` : ""}`]),
    para(["Dear ", orPh(matter.client_salutation, "client salutation"), ","]),
    new Paragraph({
      children: runs([`Report on Title — ${matter.address}`], { bold: true, size: 28 }),
      spacing: { before: 120, after: 200 },
    }),

    heading("1. Introduction"),
    isPurchase
      ? para([
          `Thank you for instructing us in connection with your purchase of ${matter.address}`,
          price ? ` for ${price}` : "", ". ",
          `We have now investigated the legal title to the property, received the results of our searches, and raised enquiries with the seller's solicitors`,
          matter.other_side_solicitor ? `, ${matter.other_side_solicitor}` : "",
          ". This report summarises what we have found and what happens next.",
        ])
      : para([
          `Thank you for instructing us in connection with your remortgage of ${matter.address}`,
          matter.lender ? ` with ${matter.lender}` : "",
          ". We have now investigated the legal title to the property and received the results of our searches. This report summarises what we have found and what happens next.",
        ]),
    para("Please read it carefully. If anything is unclear, or does not match your own understanding of the property — for example its boundaries, access, or anything the seller has told you — please contact us before we proceed."),

    heading("2. The property and its title"),
    para(["Property: ", matter.address]),
    para(["Tenure: ", orPh(matter.tenure, "Freehold / Leasehold")]),
    ...(matter.tenure === "Leasehold" || matter.tenure === "Share of freehold"
      ? [
          para(["Lease term: ", orPh(matter.lease_term, "length of lease remaining")]),
          para(["Ground rent: ", orPh(matter.ground_rent, "ground rent and review terms")]),
          para(["Service charge: ", orPh(matter.service_charge, "service charge and what it covers")]),
        ]
      : []),
    para(["Title number: ", orPh(matter.title_number, "title number")]),
    para(["Registered owner: ", orPh(matter.registered_proprietor, "registered proprietor")]),
    para(["Boundaries: ", { ph: "Describe boundaries by reference to the enclosed title plan; ask the client to check them against the property on the ground" }]),
    para(["Rights and covenants: ", { ph: "Summarise rights of way, easements and restrictive covenants affecting the property, or confirm there are none of concern" }]),

    heading("3. Searches"),
    searches.length
      ? para(`We carried out ${searches.length} search${searches.length === 1 ? "" : "es"} against the property. ${receivedSearches.length === searches.length ? "All results have been received" : `${receivedSearches.length} of ${searches.length} results have been received so far`}${issueSearches.length ? `, and ${issueSearches.length} raised a matter we draw to your attention below` : ""}.`)
      : para([{ ph: "No searches are recorded on this file — confirm the search position" }]),
  ];

  if (searches.length) {
    children.push(searchesTable(searches));
    const notes = searches
      .map((s) => [s.type, SEARCH_NOTES[s.type.trim().toLowerCase()]])
      .filter(([, note]) => note);
    if (notes.length) {
      children.push(new Paragraph({ children: [], spacing: { after: 80 } }));
      for (const [type, note] of notes) children.push(bullet([`The ${type} ${note}.`]));
    }
  }

  children.push(
    heading("4. Enquiries of the seller"),
    enquiries.length
      ? para(`We raised ${enquiries.length} enquir${enquiries.length === 1 ? "y" : "ies"} with the ${isPurchase ? "seller's solicitors" : "relevant parties"}. ${unanswered.length ? `${unanswered.length} still ${unanswered.length === 1 ? "needs" : "need"} attention (highlighted below).` : "All have been answered."} The replies are summarised below.`)
      : para([{ ph: "No enquiries are recorded on this file — confirm the enquiries position or delete this section" }]),
    ...enquiryParagraphs(enquiries),
  );

  if (matter.lender) {
    children.push(
      heading("5. Your mortgage"),
      para([
        `Your mortgage offer is from ${matter.lender}. `,
        matter.mortgage_offer_expiry
          ? `It expires on ${formatDate(matter.mortgage_offer_expiry)}, and completion must take place before that date.`
          : { ph: "Offer expiry date" },
      ]),
      para(["We are also acting for the lender. Special conditions in the offer: ", orPh(matter.mortgage_conditions, "summarise special conditions, or state there are none")]),
      para("We must report anything that affects the lender's security to them; please let us know if anything about the property or your circumstances has changed since you applied for the mortgage."),
    );
  }

  let section = matter.lender ? 6 : 5;
  if (isPurchase) {
    children.push(
      heading(`${section++}. Exchange of contracts and completion`),
      para("Once you sign the contract and we exchange contracts with the seller's solicitors, you are legally bound to buy the property and the seller is bound to sell it. If you then withdraw, you are likely to lose your deposit and may be liable for further costs."),
      para(["Proposed exchange date: ", matter.target_exchange ? formatDate(matter.target_exchange) : { ph: "date" }]),
      para(["Proposed completion date: ", matter.target_completion ? formatDate(matter.target_completion) : { ph: "date" }]),
      para(["Deposit payable on exchange: ", orPh(formatMoney(matter.deposit), "amount (usually 10% of the price)")]),
      para(["Stamp Duty Land Tax: ", matter.sdlt === null || matter.sdlt === undefined ? { ph: "SDLT payable, or confirm none is due" } : Number(matter.sdlt) === 0 ? "none is payable" : formatMoney(matter.sdlt), " — we will submit the return", Number(matter.sdlt) > 0 || matter.sdlt === null || matter.sdlt === undefined ? " and pay this on your behalf" : "", " after completion."]),
      para("Buildings insurance: you should arrange buildings insurance to start from exchange of contracts."),
    );
  }

  children.push(
    heading(`${section++}. What we need from you`),
    ...(isPurchase
      ? [
          bullet("Read this report and let us know if you have any questions or concerns."),
          bullet("Sign and return the contract, the transfer deed (TR1) and the mortgage deed, where enclosed."),
          bullet(["Transfer the deposit of ", orPh(formatMoney(matter.deposit), "amount"), " to our client account in good time before exchange."]),
          bullet("Confirm you are happy for us to proceed to exchange on the dates above."),
        ]
      : [
          bullet("Read this report and let us know if you have any questions or concerns."),
          bullet("Sign and return the mortgage deed, where enclosed."),
          bullet(["Confirm the details of your existing mortgage so that we can obtain a redemption figure: ", { ph: "existing lender / account number" }]),
        ]),
    para(""),
    para("Yours sincerely,"),
    para(""),
    para([orPh(signer, "fee earner name")]),
    para([firm.name]),
  );

  const doc = new Document({
    creator: firm.name,
    title: `Report on Title — ${matter.address}`,
    styles: { default: { document: { run: { font: FONT, size: 22 } } } },
    sections: [{ properties: { page: { margin: { top: 1000, bottom: 1000, left: 1100, right: 1100 } } }, children }],
  });
  return Packer.toBuffer(doc);
}

module.exports = { buildReportOnTitle };
