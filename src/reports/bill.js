/**
 * A bill (invoice) as a Word document: the firm, the client, the matter,
 * the narrative, profit costs, disbursements, VAT and total — with the time
 * recorded behind it as a schedule. Drafts are clearly marked DRAFT.
 */
const {
  Document, Packer, Paragraph, TextRun, AlignmentType,
  Table, TableRow, TableCell, WidthType, BorderStyle, ShadingType,
} = require("docx");

const FONT = "Calibri";
const money = (n) => `£${Number(n).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDate = (d) => (d ? new Date(`${String(d).slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }) : "");
const hours = (units) => `${Math.floor(units / 10)}h ${String((units % 10) * 6).padStart(2, "0")}m`;

const run = (text, opts = {}) => new TextRun({ text, font: FONT, ...opts });
const ph = (text) => run(`[${text}]`, { highlight: "yellow" });
const para = (children, opts = {}) => new Paragraph({ children: Array.isArray(children) ? children : [children], spacing: { after: 120 }, ...opts });

function moneyTable(rows) {
  const line = { style: BorderStyle.SINGLE, size: 4, color: "B8B2A3" };
  const none = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: { top: line, bottom: line, left: none, right: none, insideHorizontal: { style: BorderStyle.DOTTED, size: 2, color: "D8D2C3" }, insideVertical: none },
    rows: rows.map((r) => new TableRow({
      children: [
        new TableCell({
          width: { size: 72, type: WidthType.PERCENTAGE },
          shading: r.total ? { type: ShadingType.CLEAR, color: "auto", fill: "E8E4DA" } : undefined,
          margins: { top: 60, bottom: 60, left: 100, right: 100 },
          children: [para(run(r.label, { bold: !!r.total, size: 21 }), { spacing: { after: 0 } })],
        }),
        new TableCell({
          width: { size: 28, type: WidthType.PERCENTAGE },
          shading: r.total ? { type: ShadingType.CLEAR, color: "auto", fill: "E8E4DA" } : undefined,
          margins: { top: 60, bottom: 60, left: 100, right: 100 },
          children: [para(run(money(r.amount), { bold: !!r.total, size: 21 }), { alignment: AlignmentType.RIGHT, spacing: { after: 0 } })],
        }),
      ],
    })),
  });
}

function timeSchedule(entries) {
  const cell = (text, width, opts = {}) => new TableCell({
    width: { size: width, type: WidthType.PERCENTAGE },
    margins: { top: 40, bottom: 40, left: 80, right: 80 },
    children: [para(run(text, { size: 18, ...opts }), { spacing: { after: 0 }, alignment: opts.right ? AlignmentType.RIGHT : undefined })],
  });
  const header = new TableRow({
    tableHeader: true,
    children: [cell("Date", 14, { bold: true }), cell("By", 16, { bold: true }), cell("Work done", 44, { bold: true }), cell("Time", 12, { bold: true }), cell("Value", 14, { bold: true, right: true })],
  });
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [header, ...entries.map((e) => new TableRow({
      children: [
        cell(fmtDate(e.work_date), 14), cell(e.user_name || "", 16),
        cell(`${e.activity}${e.description ? ` — ${e.description}` : ""}`, 44),
        cell(hours(e.units), 12), cell(money(e.amount), 14, { right: true }),
      ],
    }))],
  });
}

/** { bill, matter (row), firm: { name }, entries: [...], feeEarner: name|null } → Buffer */
async function buildBill({ bill, matter, firm, entries, feeEarner }) {
  const disbursements = Array.isArray(bill.disbursements) ? bill.disbursements : [];
  const draft = bill.status !== "issued";
  const rows = [{ label: "Our charges (profit costs)", amount: bill.profit_costs }];
  for (const d of disbursements) rows.push({ label: `${d.description}${d.vat ? "" : " (no VAT)"}`, amount: d.amount });
  rows.push({ label: "VAT at 20%", amount: bill.vat });
  rows.push({ label: "Total due", amount: bill.total, total: true });

  const addressLines = (matter.client_address || "").split(/\r?\n|,\s*/).filter(Boolean);
  const children = [
    ...(draft ? [para(run("DRAFT — not yet issued", { bold: true, color: "B03A2E" }))] : []),
    new Paragraph({ children: [run(firm.name, { bold: true, size: 32 })], spacing: { after: 40 } }),
    para([ph("Firm address, telephone, email, SRA number, VAT registration number")]),
    new Paragraph({ children: [run(draft ? "Bill (draft)" : `Bill no. ${bill.bill_number}`, { bold: true, size: 28 })], spacing: { before: 200, after: 80 } }),
    para([run(`Date: ${draft ? "—" : fmtDate(bill.bill_date)}`)]),
    para([run(`Our ref: ${matter.reference}${feeEarner ? ` / ${feeEarner}` : ""}`)]),
    para(""),
    para(run(matter.client, { bold: true }), { spacing: { after: 0 } }),
    ...(addressLines.length ? addressLines.map((l) => para(run(l), { spacing: { after: 0 } })) : [para([ph("Client's address")])]),
    para(""),
    para([run("Re: ", { bold: true }), run(matter.address)]),
    para(run(bill.narrative || "For our professional charges in connection with the above matter, including all attendances, correspondence and work done.")),
    moneyTable(rows),
    para(""),
    para(run("Please pay within 30 days. Before sending money, call us on a number you already have to check our bank details — we will never change them by email.", { size: 20 })),
  ];
  if (entries.length) {
    children.push(new Paragraph({ children: [run("Schedule of time", { bold: true })], spacing: { before: 300, after: 100 } }), timeSchedule(entries));
  }

  const doc = new Document({
    creator: firm.name,
    title: `${draft ? "Draft bill" : `Bill ${bill.bill_number}`} — ${matter.reference}`,
    styles: { default: { document: { run: { font: FONT, size: 22 } } } },
    sections: [{ properties: { page: { margin: { top: 1000, bottom: 1000, left: 1100, right: 1100 } } }, children }],
  });
  return Packer.toBuffer(doc);
}

module.exports = { buildBill };
