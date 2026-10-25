/**
 * Family Word drafts: the financial remedy asset schedule, laid out like
 * the court's ES2 — each item under the party who owns it, capital and
 * pensions kept separate, then the proposed division and its net effect.
 */
const {
  Document, Packer, Paragraph, Table, TableRow, TableCell, WidthType, BorderStyle, ShadingType, AlignmentType,
} = require("docx");
const { helpers } = require("./letters");

const { FONT, formatDate, money, runs, para } = helpers;
const { proposedPercent } = require("../config/family");

const heading = (t, size = 26) => new Paragraph({ children: runs([t], { bold: true, size }), spacing: { before: 240, after: 120 } });
const fmt = (v) => (Math.abs(v) < 0.005 ? "—" : v < 0 ? `(${money(-v)})` : money(v));

function grid(header, rows) {
  const border = { style: BorderStyle.SINGLE, size: 4, color: "B8B2A3" };
  const cell = (textValue, { bold = false, right = false, shade = false, width } = {}) => new TableCell({
    width: width ? { size: width, type: WidthType.PERCENTAGE } : undefined,
    shading: shade ? { type: ShadingType.CLEAR, color: "auto", fill: "E8E4DA" } : undefined,
    margins: { top: 50, bottom: 50, left: 90, right: 90 },
    children: [new Paragraph({ alignment: right ? AlignmentType.RIGHT : AlignmentType.LEFT, children: runs([textValue], { bold, size: 19 }) })],
  });
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: { top: border, bottom: border, left: border, right: border, insideHorizontal: { style: BorderStyle.DOTTED, size: 2, color: "D8D2C3" }, insideVertical: border },
    rows: [
      new TableRow({ tableHeader: true, children: header.map((h, i) => cell(h, { bold: true, right: i > 0, shade: true, width: i === 0 ? 40 : 15 })) }),
      ...rows.map((r) => new TableRow({ children: r.cells.map((c, i) => cell(c, { bold: !!r.total, right: i > 0, shade: !!r.total })) })),
    ],
  });
}

async function assetScheduleDoc(ctx) {
  const { matter: m, details: d, items, schedule: s } = ctx;
  const client = m.client;
  const other = d.otherParty || "Other party";
  const header = ["", client, other, "Joint", "Total"];
  const sign = (i) => (i.kind === "liability" ? -1 : 1);
  const row = (i) => {
    const v = sign(i) * Number(i.value);
    return { cells: [`${i.description}${i.source ? ` (${i.source})` : ""}`, fmt(i.owner === "client" ? v : 0), fmt(i.owner === "other" ? v : 0), fmt(i.owner === "joint" ? v : 0), fmt(v)] };
  };
  const totalRow = (label, g) => ({ total: true, cells: [label, fmt(g.byOwner.client), fmt(g.byOwner.other), fmt(g.byOwner.joint), fmt(g.total)] });
  const capitalItems = items.filter((i) => i.kind !== "pension");
  const pensionItems = items.filter((i) => i.kind === "pension");

  const proposal = (label, g) => [
    { cells: [label, client, other, "", "Total"], total: true },
    { cells: ["Now (joint items split equally)", fmt(g.clientNow), fmt(g.otherNow), "", fmt(g.total)] },
    { cells: ["Proposed", fmt(g.clientProposed), fmt(g.otherProposed), "", fmt(g.total)] },
    { cells: ["Proposed share", g.clientProposedPercent === null ? "—" : `${g.clientProposedPercent}%`, g.clientProposedPercent === null ? "—" : `${Math.round((100 - g.clientProposedPercent) * 100) / 100}%`, "", ""] },
  ];
  const changes = items.filter((i) => proposedPercent(i) !== (i.owner === "client" ? 100 : i.owner === "joint" ? 50 : 0));

  const doc = new Document({
    creator: ctx.firm.name,
    title: `Asset schedule — ${m.reference}`,
    styles: { default: { document: { run: { font: FONT, size: 21 } } } },
    sections: [{
      properties: { page: { margin: { top: 900, bottom: 900, left: 900, right: 900 } } },
      children: [
        para([{ ph: "DRAFT — check every figure against Form E and the disclosure before relying on it" }]),
        heading(`${client} and ${other}: schedule of assets`, 30),
        para([[d.caseNumber && `Case number ${d.caseNumber}`, d.court].filter(Boolean).join(" · ") || { ph: "case number and court" }]),
        para(`Prepared by ${ctx.firm.name} for ${client} on ${formatDate(new Date())}. Our reference ${m.reference}.`),
        heading("Capital"),
        grid(header, [
          ...capitalItems.filter((i) => i.kind === "asset").map(row),
          ...capitalItems.filter((i) => i.kind === "liability").map(row),
          totalRow("Net capital", s.capital),
        ]),
        heading("Pensions (cash equivalent transfer values)"),
        pensionItems.length
          ? grid(header, [...pensionItems.map(row), totalRow("Total pensions", s.pensions)])
          : para("No pensions entered."),
        heading("Proposed division"),
        grid(["", client, other, "", ""], [...proposal("Capital", s.capital), ...(pensionItems.length ? proposal("Pensions", s.pensions) : [])]),
        ...(changes.length ? [
          heading("How the proposal differs from ownership now", 22),
          ...changes.map((i) => para(`${i.description}: ${proposedPercent(i)}% to ${client}, ${Math.round((100 - proposedPercent(i)) * 100) / 100}% to ${other}${i.notes ? ` — ${i.notes}` : ""}`)),
        ] : []),
        para(""),
        para("Pension values are cash equivalents and are not directly comparable with capital; consider a pension on divorce expert's report before offsetting."),
      ],
    }],
  });
  return Packer.toBuffer(doc);
}

module.exports = { assetScheduleDoc };
