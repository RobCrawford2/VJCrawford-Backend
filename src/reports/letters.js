/**
 * Standard documents generated from a matter as Word drafts: the completion
 * statement and the routine letters sent on most files. Like the Report on
 * Title, anything the system doesn't hold is a yellow-highlighted
 * [placeholder] for the fee earner to complete before sending.
 */
const {
  Document, Packer, Paragraph, TextRun, AlignmentType,
  Table, TableRow, TableCell, WidthType, BorderStyle, ShadingType,
} = require("docx");

const FONT = "Calibri";
const VAT_RATE = 0.2;

const formatDate = (d) =>
  d ? new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/London" }) : null;
const money = (n) =>
  n === null || n === undefined || n === "" ? null : `£${Number(n).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const num = (n) => (n === null || n === undefined || n === "" ? 0 : Number(n));

function runs(parts, opts = {}) {
  return parts.filter((p) => p !== null && p !== undefined && p !== "").map((part) =>
    typeof part === "string"
      ? new TextRun({ text: part, font: FONT, ...opts })
      : new TextRun({ text: `[${part.ph}]`, font: FONT, highlight: "yellow", ...opts })
  );
}
const para = (parts, opts = {}) => new Paragraph({ children: runs(Array.isArray(parts) ? parts : [parts], opts.run), spacing: { after: 160 }, ...opts.p });
const bold = (parts) => para(parts, { run: { bold: true } });
const bullet = (parts) => new Paragraph({ children: runs(Array.isArray(parts) ? parts : [parts]), bullet: { level: 0 }, spacing: { after: 80 } });
const orPh = (value, placeholder) => (value ? value : { ph: placeholder });

const typeWord = (m) => (m.type === "Sale" ? "sale" : m.type === "Purchase" ? "purchase" : "remortgage");

/** Letterhead, date, addressee block, reference and subject line. */
function letterTop(ctx, { to, subject, salutation }) {
  const { matter: m, firm, feeEarner } = ctx;
  return [
    para([{ ph: "DRAFT — check and complete every highlighted section, then delete this line before sending" }]),
    new Paragraph({ children: runs([firm.name], { bold: true, size: 32 }), spacing: { after: 40 } }),
    para([{ ph: "Firm address, telephone, email, SRA number" }]),
    para(formatDate(new Date()), { p: { alignment: AlignmentType.RIGHT } }),
    ...to.map((line) => new Paragraph({ children: runs(Array.isArray(line) ? line : [line]) })),
    para(""),
    para([`Our ref: ${m.reference}${feeEarner ? ` / ${feeEarner}` : ""}`]),
    para(["Dear ", salutation, ","]),
    new Paragraph({ children: runs([subject], { bold: true }), spacing: { before: 80, after: 200 } }),
  ];
}

function signOff(ctx) {
  return [
    para(""),
    para("Yours sincerely,"),
    para(""),
    para([orPh(ctx.feeEarner, "fee earner name")]),
    para([ctx.firm.name]),
  ];
}

/** Client's name and correspondence address as address lines. */
function clientAddress(m) {
  const lines = [m.client];
  if (m.client_address) lines.push(...m.client_address.split(/\r?\n|,\s*/).filter(Boolean).map((l) => l.trim()));
  else lines.push({ ph: "Client's correspondence address" });
  return lines.map((l) => (typeof l === "string" ? l : [l]));
}

function costLines(m) {
  const costs = Array.isArray(m.costs) ? m.costs : [];
  const vat = costs.filter((c) => c.vat).reduce((s, c) => s + num(c.amount), 0) * VAT_RATE;
  const net = costs.reduce((s, c) => s + num(c.amount), 0);
  return { costs, vat: Math.round(vat * 100) / 100, net, total: Math.round((net + vat) * 100) / 100 };
}

// ---------------------------------------------------------------------------
// Completion statement
// ---------------------------------------------------------------------------

function statementTable(rows) {
  const border = { style: BorderStyle.SINGLE, size: 4, color: "B8B2A3" };
  const none = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: { top: border, bottom: border, left: none, right: none, insideHorizontal: { style: BorderStyle.DOTTED, size: 2, color: "D8D2C3" }, insideVertical: none },
    rows: rows.map((r) => new TableRow({
      children: [
        new TableCell({
          width: { size: 70, type: WidthType.PERCENTAGE },
          shading: r.total ? { type: ShadingType.CLEAR, color: "auto", fill: "E8E4DA" } : undefined,
          margins: { top: 60, bottom: 60, left: 100, right: 100 },
          children: [new Paragraph({ children: runs(Array.isArray(r.label) ? r.label : [r.label], { bold: !!r.total, size: 21 }), indent: r.indent ? { left: 280 } : undefined })],
        }),
        new TableCell({
          width: { size: 30, type: WidthType.PERCENTAGE },
          shading: r.total ? { type: ShadingType.CLEAR, color: "auto", fill: "E8E4DA" } : undefined,
          margins: { top: 60, bottom: 60, left: 100, right: 100 },
          children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: runs([r.amount === null ? { ph: "amount" } : r.amount], { bold: !!r.total, size: 21 }) })],
        }),
      ],
    })),
  });
}

function completionStatement(ctx) {
  const m = ctx.matter;
  const c = costLines(m);
  const rows = [];
  const add = (label, amount, opts = {}) => rows.push({ label, amount, ...opts });
  const sign = (v) => (v < 0 ? `(${money(-v)})` : money(v));
  let balance = 0;

  if (m.type === "Purchase") {
    add("Purchase price", money(m.price));
    add(["Stamp Duty Land Tax"], m.sdlt === null || m.sdlt === undefined ? null : money(m.sdlt));
    c.costs.forEach((x) => add(`${x.description}${x.vat ? "" : " (no VAT)"}`, money(x.amount), { indent: true }));
    if (c.vat) add("VAT at 20%", money(c.vat), { indent: true });
    const total = num(m.price) + num(m.sdlt) + c.total;
    add("Total required", money(total), { total: true });
    if (m.lender || m.mortgage_advance) add(`Less: mortgage advance${m.lender ? ` from ${m.lender}` : ""}`, m.mortgage_advance === null ? null : `(${money(m.mortgage_advance)})`);
    add(`Less: money received from you so far${m.deposit ? " (including the deposit)" : ""}`, `(${money(num(m.funds_received))})`);
    balance = total - num(m.mortgage_advance) - num(m.funds_received);
    add(balance >= 0 ? "Balance required from you before completion" : "Balance due to you", money(Math.abs(balance)), { total: true });
  } else if (m.type === "Sale") {
    add("Sale price", money(m.price));
    add("Less: redemption of your mortgage", m.redemption_amount === null || m.redemption_amount === undefined ? null : `(${money(m.redemption_amount)})`);
    add("Less: estate agent's fee (including VAT)", m.agent_fee === null || m.agent_fee === undefined ? null : `(${money(m.agent_fee)})`);
    c.costs.forEach((x) => add(`Less: ${x.description}${x.vat ? "" : " (no VAT)"}`, `(${money(x.amount)})`, { indent: true }));
    if (c.vat) add("Less: VAT at 20%", `(${money(c.vat)})`, { indent: true });
    if (num(m.funds_received)) add("Add: money received from you on account", money(m.funds_received));
    balance = num(m.price) - num(m.redemption_amount) - num(m.agent_fee) - c.total + num(m.funds_received);
    add(balance >= 0 ? "Balance due to you on completion" : "Balance required from you", money(Math.abs(balance)), { total: true });
  } else {
    add(`New mortgage advance${m.lender ? ` from ${m.lender}` : ""}`, m.mortgage_advance === null || m.mortgage_advance === undefined ? null : money(m.mortgage_advance));
    add("Less: redemption of your existing mortgage", m.redemption_amount === null || m.redemption_amount === undefined ? null : `(${money(m.redemption_amount)})`);
    c.costs.forEach((x) => add(`Less: ${x.description}${x.vat ? "" : " (no VAT)"}`, `(${money(x.amount)})`, { indent: true }));
    if (c.vat) add("Less: VAT at 20%", `(${money(c.vat)})`, { indent: true });
    if (num(m.funds_received)) add("Add: money received from you on account", money(m.funds_received));
    balance = num(m.mortgage_advance) - num(m.redemption_amount) - c.total + num(m.funds_received);
    add(balance >= 0 ? "Balance due to you on completion" : "Balance required from you", money(Math.abs(balance)), { total: true });
  }

  const children = [
    para([{ ph: "DRAFT — check every figure against the ledger and redemption statement before sending" }]),
    new Paragraph({ children: runs([ctx.firm.name], { bold: true, size: 32 }), spacing: { after: 40 } }),
    new Paragraph({ children: runs(["Completion statement"], { bold: true, size: 28 }), spacing: { before: 120, after: 80 } }),
    para([`${m.type} of ${m.address}`]),
    para([`Client: ${m.client}`]),
    para([`Our ref: ${m.reference}`, "   ·   ", "Completion date: ", m.target_completion ? formatDate(m.target_completion) : { ph: "completion date" }]),
    statementTable(rows),
    para(""),
  ];
  if (m.type === "Purchase" && balance > 0) {
    children.push(para([
      "Please send the balance of ", money(balance), " to our client account so that it is cleared ",
      { ph: "number" }, " working days before completion. We will only ever give you our bank details in person or by post — ",
      "always call us on a number you already have to check them before sending money, and never act on an email telling you our details have changed.",
    ]));
  } else if (balance > 0) {
    children.push(para([
      "We will send the balance to the bank account you have given us, once we have verified it with you by phone. ",
      "We will never ask you to change your bank details by email.",
    ]));
  }
  children.push(para("Figures are based on the information we hold today and may change, for example if the redemption figure or completion date changes."));
  return children;
}

// ---------------------------------------------------------------------------
// Letters
// ---------------------------------------------------------------------------

const LETTERS = {
  "client-care": {
    title: "Client care letter",
    build(ctx) {
      const { matter: m, supervisor } = ctx;
      const c = costLines(m);
      const body = [
        ...letterTop(ctx, { to: clientAddress(m), subject: `Your ${typeWord(m)} of ${m.address}`, salutation: orPh(m.client_salutation, "client salutation") }),
        para(`Thank you for instructing us to act for you in the ${typeWord(m)} of ${m.address}${m.price ? ` for ${money(m.price)}` : ""}. This letter sets out who will deal with your matter, our charges, and what we need from you.`),
        bold("Who will deal with your matter"),
        para([orPh(ctx.feeEarner, "fee earner"), " will have day-to-day conduct of your matter", supervisor ? `, supervised by ${supervisor}` : "", ". If they are unavailable, another member of our team will help."]),
        bold("Our charges"),
      ];
      if (c.costs.length) {
        c.costs.forEach((x) => body.push(bullet(`${x.description}: ${money(x.amount)}${x.vat ? " plus VAT" : ""}`)));
        body.push(para(`Total, including VAT of ${money(c.vat)}: ${money(c.total)}.`));
      } else {
        body.push(para([{ ph: "Set out the fee, VAT and expected disbursements (or refer to the enclosed estimate)" }]));
      }
      body.push(
        para("If the transaction becomes more complicated than expected we will tell you before any extra cost is incurred."),
        bold("What we need from you"),
        bullet("Proof of your identity and address, so we can carry out the checks the law requires."),
        bullet("Evidence of where the money for this transaction is coming from (source of funds)."),
        bullet("The signed copy of this letter and our terms of business."),
        bold("Protecting your money"),
        para("Criminals target home buyers and sellers by email. We will never change our bank details by email. Before sending us any money, call us on a number you already have to check the details."),
        bold("Complaints"),
        para([{ ph: "Complaints procedure, Legal Ombudsman details and time limits" }]),
        ...signOff(ctx),
      );
      return body;
    },
  },

  "agent-initial": {
    title: "Initial letter to estate agent",
    build(ctx) {
      const m = ctx.matter;
      return [
        ...letterTop(ctx, { to: [m.estate_agent || { ph: "estate agent" }].map((l) => [l]).concat([[{ ph: "agent's address" }]]), subject: `${m.address}${m.price ? ` — ${money(m.price)}` : ""}`, salutation: "Sirs" }),
        para(`We confirm that we act for ${m.client} in connection with the ${typeWord(m)} of the above property.`),
        para(["Please send us a copy of the memorandum of sale, including the details of the other party and their solicitors", m.other_side_solicitor ? ` (we understand these are ${m.other_side_solicitor})` : "", ", and let us know of any chain."]),
        para("We will keep you informed of progress. Please contact us if you have any questions."),
        ...signOff(ctx),
      ];
    },
  },

  "other-side-initial": {
    title: "Initial letter to other side's solicitors",
    build(ctx) {
      const m = ctx.matter;
      const buying = m.type === "Purchase";
      return [
        ...letterTop(ctx, { to: [[orPh(m.other_side_solicitor, "other side's solicitors")], [{ ph: "their address / email" }]], subject: `${m.address}${m.price ? ` — ${money(m.price)}` : ""}`, salutation: "Colleagues" }),
        para(`We act for ${m.client}, the ${buying ? "buyer" : "seller"}, in this matter and understand that you act for the ${buying ? "seller" : "buyer"}.`),
        buying
          ? para("Please send us the draft contract and contract pack, including official copies of the title, the Property Information Form (TA6), the Fittings and Contents Form (TA10) and, if leasehold, the Leasehold Information Form (TA7) and lease.")
          : para("We enclose the draft contract and contract pack and look forward to receiving your enquiries."),
        para(["Our client's target exchange date is ", m.target_exchange ? formatDate(m.target_exchange) : { ph: "date" }, " with completion on ", m.target_completion ? formatDate(m.target_completion) : { ph: "date" }, "."]),
        para("Please confirm that you are a member of the Law Society's Conveyancing Quality Scheme (or equivalent) and that you will deal with this matter under the Law Society Conveyancing Protocol."),
        ...signOff(ctx),
      ];
    },
  },

  "exchange-confirmation": {
    title: "Exchange confirmation to client",
    build(ctx) {
      const m = ctx.matter;
      return [
        ...letterTop(ctx, { to: clientAddress(m), subject: `Your ${typeWord(m)} of ${m.address} — contracts exchanged`, salutation: orPh(m.client_salutation, "client salutation") }),
        para(["We are pleased to confirm that contracts were exchanged on ", m.actual_exchange ? formatDate(m.actual_exchange) : { ph: "date of exchange" }, ". You are now legally bound to ", m.type === "Purchase" ? "buy" : "sell", " the property."]),
        para(["Completion is fixed for ", m.target_completion ? formatDate(m.target_completion) : { ph: "completion date" }, "."]),
        ...(m.type === "Purchase"
          ? [
              para("Your buildings insurance should now be in place. On completion we will send the purchase money, and the estate agent will release the keys once we confirm completion."),
              para(["Before completion we will send you a completion statement showing any balance due. Please make sure it reaches our client account ", { ph: "number" }, " working days before completion."]),
            ]
          : [
              para("Please make sure you have vacated the property, and that it is left as agreed in the contract, by the time completion takes place. Leave the keys with the estate agent."),
              para("On completion we will redeem your mortgage and send the balance of the sale proceeds to your verified bank account."),
            ]),
        ...signOff(ctx),
      ];
    },
  },

  "completion-confirmation": {
    title: "Completion confirmation to client",
    build(ctx) {
      const m = ctx.matter;
      return [
        ...letterTop(ctx, { to: clientAddress(m), subject: `Your ${typeWord(m)} of ${m.address} — completed`, salutation: orPh(m.client_salutation, "client salutation") }),
        para(["We are pleased to confirm that your ", typeWord(m), " completed on ", m.actual_completion ? formatDate(m.actual_completion) : { ph: "completion date" }, "."]),
        ...(m.type === "Purchase"
          ? [
              para("The keys are available from the estate agent. We will now pay the Stamp Duty Land Tax and register you as the owner at HM Land Registry, and will send you a copy of the updated title once registration is complete."),
            ]
          : m.type === "Sale"
            ? [para(["We have redeemed your mortgage and ", { ph: "sent the balance of £… to your account ending …" }, ". Please let us know when it arrives."])]
            : [para("The new mortgage has been drawn down and your previous mortgage redeemed. We will register the new charge at HM Land Registry and confirm once this is complete.")]),
        para("Thank you for instructing us. It has been a pleasure to act for you."),
        ...signOff(ctx),
      ];
    },
  },

  "redemption-request": {
    title: "Redemption statement request to lender",
    build(ctx) {
      const m = ctx.matter;
      return [
        ...letterTop(ctx, { to: [[{ ph: "Existing lender's name" }], [{ ph: "lender's redemptions address" }]], subject: `Redemption statement — ${m.client} — ${m.address}`, salutation: "Sirs" }),
        para(["Mortgage account number: ", { ph: "account number" }]),
        para(`We act for ${m.client} in connection with the ${m.type === "Remortgage" ? "remortgage" : "sale"} of the above property.`),
        para(["Please let us have a redemption statement for completion on ", m.target_completion ? formatDate(m.target_completion) : { ph: "completion date" }, ", showing the daily rate of interest after that date and your bank details for payment."]),
        para("We enclose our client's signed authority for you to deal with us."),
        ...signOff(ctx),
      ];
    },
  },
};

const DOCUMENTS = {
  "completion-statement": { title: "Completion statement", build: completionStatement },
  ...LETTERS,
};

/** ctx: { matter, firm: { name }, feeEarner: name|null, supervisor: name|null } */
async function buildDocument(template, ctx) {
  const def = DOCUMENTS[template];
  if (!def) return null;
  const doc = new Document({
    creator: ctx.firm.name,
    title: `${def.title} — ${ctx.matter.address}`,
    styles: { default: { document: { run: { font: FONT, size: 22 } } } },
    sections: [{ properties: { page: { margin: { top: 1000, bottom: 1000, left: 1100, right: 1100 } } }, children: def.build(ctx) }],
  });
  return { title: def.title, buffer: await Packer.toBuffer(doc) };
}

const TEMPLATE_LIST = Object.entries(DOCUMENTS).map(([key, d]) => ({ key, title: d.title }));

module.exports = { buildDocument, TEMPLATE_LIST, costLines };
