/**
 * Probate Word drafts: the estate account, the letter notifying an asset
 * holder (or creditor) of the death, and the letter sending a beneficiary
 * their payment with a form of receipt. As with the other drafts, anything
 * the system doesn't hold is a yellow-highlighted [placeholder].
 */
const { Document, Packer, Paragraph, AlignmentType } = require("docx");
const { helpers } = require("./letters");

const { FONT, formatDate, money, num, runs, para, bold, letterTop, signOff, statementTable } = helpers;

const deceasedName = (ctx) => ctx.details.deceasedName || null;
const late = (ctx) => (deceasedName(ctx) ? `the late ${deceasedName(ctx)}` : { ph: "the late [name]" });
const heading = (textValue, size = 28) => new Paragraph({ children: runs([textValue], { bold: true, size }), spacing: { before: 200, after: 160 } });
const bracket = (v) => `(${money(v)})`;

async function pack(ctx, title, children) {
  const doc = new Document({
    creator: ctx.firm.name,
    title: `${title} — ${ctx.matter.reference}`,
    styles: { default: { document: { run: { font: FONT, size: 22 } } } },
    sections: [{ properties: { page: { margin: { top: 1000, bottom: 1000, left: 1100, right: 1100 } } }, children }],
  });
  return Packer.toBuffer(doc);
}

/** Estate account: capital account, then distribution of the residue. */
async function estateAccount(ctx) {
  const { details: d, items, beneficiaries, summary: s } = ctx;
  const assets = items.filter((i) => i.kind === "asset" && !i.passes_outside_will);
  const outside = items.filter((i) => i.kind === "asset" && i.passes_outside_will);
  const liabilities = items.filter((i) => i.kind === "liability");
  const valueOf = (i) => (i.value_realised !== null && i.value_realised !== undefined ? num(i.value_realised) : num(i.value_at_death));
  const describe = (i) => [i.description, i.holder ? ` — ${i.holder}` : ""].join("");

  const capital = [
    { label: "Assets", amount: "", total: true },
    ...assets.map((i) => ({ label: describe(i), amount: money(valueOf(i)), indent: true })),
    { label: "Total assets", amount: money(s.distribution.realised), total: true },
    { label: "Less: liabilities and expenses", amount: "", total: true },
    ...liabilities.map((i) => ({ label: describe(i), amount: bracket(valueOf(i)), indent: true })),
    { label: d.ihtPaid ? "Inheritance tax paid" : "Inheritance tax (estimate)", amount: bracket(s.distribution.iht), indent: true },
    { label: "Net estate for distribution", amount: money(s.distribution.forDistribution), total: true },
  ];

  const gifts = beneficiaries.filter((b) => b.gift_type !== "Share of residue");
  const shares = beneficiaries.filter((b) => b.gift_type === "Share of residue");
  const entitlement = Object.fromEntries(s.distribution.beneficiaries.map((b) => [b.id, b]));
  const distribution = [
    { label: "Net estate for distribution", amount: money(s.distribution.forDistribution) },
    ...gifts.map((b) => ({ label: `Less: ${b.gift_type.toLowerCase()} to ${b.name}${b.description ? ` (${b.description})` : ""}`, amount: bracket(num(b.amount)), indent: true })),
    { label: "Residuary estate", amount: money(s.distribution.residue), total: true },
    ...shares.map((b) => ({ label: `${b.name} — ${num(b.share_percent)}% of residue`, amount: money(entitlement[b.id]?.entitlement || 0), indent: true })),
  ];
  const payments = beneficiaries.map((b) => ({
    label: `${b.name}: entitled ${money(entitlement[b.id]?.entitlement || 0)}, paid ${money(num(b.paid_amount))}${b.paid_on ? ` on ${formatDate(b.paid_on)}` : ""}`,
    amount: money(entitlement[b.id]?.balance || 0),
  }));

  return pack(ctx, "Estate account", [
    para([{ ph: "DRAFT — check every figure against the ledger before sending to the executors" }]),
    heading(`Estate of ${deceasedName(ctx) || "[the deceased]"}, deceased`, 32),
    para([
      "Date of death: ", d.dateOfDeath ? formatDate(d.dateOfDeath) : { ph: "date of death" },
      "    Grant: ", d.grantType || { ph: "type of grant" },
      d.grantIssued ? ` issued ${formatDate(d.grantIssued)}` : "",
    ]),
    para([`Personal representatives: `, d.personalRepresentatives || { ph: "names" }]),
    para([`Our reference: ${ctx.matter.reference}`]),
    heading("Capital account"),
    statementTable(capital),
    heading("Distribution account"),
    statementTable(distribution),
    ...(beneficiaries.length ? [heading("Payments to beneficiaries"), statementTable([...payments.map((p) => ({ ...p })), { label: "Balance still to pay", amount: money(s.distribution.beneficiaries.reduce((t, b) => t + Math.max(0, b.balance), 0)), total: true }])] : []),
    ...(outside.length ? [
      heading("Assets passing outside the will (not included above)", 24),
      ...outside.map((i) => para(`${describe(i)}: ${money(num(i.value_at_death))}`)),
    ] : []),
    heading("Approval", 24),
    para("We approve this account and authorise distribution in accordance with it."),
    ...(String(d.personalRepresentatives || "").split(/,| and /).map((x) => x.trim()).filter(Boolean).length
      ? String(d.personalRepresentatives).split(/,| and /).map((x) => x.trim()).filter(Boolean)
      : ["[Personal representative]"]).flatMap((name) => [
      para(""),
      para(["Signed: ______________________________    Date: ______________"]),
      para([name.startsWith("[") ? { ph: "Personal representative" } : name]),
    ]),
  ]);
}

/** Letter to a bank / insurer / creditor notifying them of the death. */
async function deathNotificationLetter(ctx, item) {
  const d = ctx.details;
  const isDebt = item.kind === "liability";
  const addressLines = item.holder_address ? item.holder_address.split(/\r?\n|,\s*/).map((l) => l.trim()).filter(Boolean) : null;
  return pack(ctx, "Notification of death", [
    ...letterTop(ctx, {
      to: [[item.holder || { ph: "Name of the organisation" }], ...(addressLines ? addressLines : [[{ ph: "address" }]])],
      subject: `${deceasedName(ctx) || "[name]"}, deceased${d.dateOfDeath ? ` — died ${formatDate(d.dateOfDeath)}` : ""}${item.reference ? ` — your reference ${item.reference}` : ""}`,
      salutation: "Sir or Madam",
    }),
    para(["We act for the executors of ", late(ctx), d.deceasedAddress ? `, of ${d.deceasedAddress},` : "", " who died on ", d.dateOfDeath ? formatDate(d.dateOfDeath) : { ph: "date of death" }, ". We enclose a copy of the death certificate", d.dateOfWill ? " and the will" : "", "."]),
    ...(isDebt
      ? [
          para(["We understand that the deceased owed you money in respect of ", item.description, item.reference ? ` (reference ${item.reference})` : "", ". Please let us have a statement of the amount owed at the date of death, and of any interest or charges since."]),
          para("Please note that payment can only be made once the executors have obtained the grant and have the funds available; please freeze any interest and charges in the meantime."),
        ]
      : [
          para(["We understand the deceased held ", item.description, item.reference ? ` (reference ${item.reference})` : "", " with you. Please:"]),
          para("1. note the death on your records and stop any direct debits or standing orders;"),
          para("2. let us know the balance or value at the date of death, including any interest accrued to that date, and whether it was held jointly;"),
          para("3. tell us whether you will need to see the grant of representation, and what forms you need to close or transfer it; and"),
          para("4. send us details of any other accounts or policies the deceased held with you."),
        ]),
    para("Please address all further correspondence to us, quoting our reference."),
    ...signOff(ctx),
  ]);
}

/** Letter sending a beneficiary their payment, with a form of receipt to sign and return. */
async function paymentLetter(ctx, b) {
  const entitlement = ctx.summary.distribution.beneficiaries.find((x) => x.id === b.id);
  const amount = num(b.paid_amount) || entitlement?.entitlement || 0;
  const what = b.gift_type === "Share of residue" ? `your ${num(b.share_percent)}% share of the residuary estate` : b.gift_type === "Specific gift" ? `the gift of ${b.description || "[item]"}` : "your legacy";
  return pack(ctx, "Payment to beneficiary", [
    ...letterTop(ctx, {
      to: [[b.name], [{ ph: "beneficiary's address" }]],
      subject: `Estate of ${deceasedName(ctx) || "[name]"}, deceased`,
      salutation: b.name,
    }),
    para(["As you know, we act for the executors of ", late(ctx), ". We are pleased to say the executors are now able to make a payment to you of ", what, "."]),
    b.gift_type === "Specific gift"
      ? para(["Please contact us to arrange collection or delivery of ", b.description || { ph: "the item" }, "."])
      : para(["We ", { ph: "enclose a cheque / have transferred" }, " ", money(amount), b.gift_type === "Share of residue" && Math.abs((entitlement?.balance || 0) - amount) > 0.005 ? " as an interim payment" : "", "."]),
    para("Please sign and return the receipt below so that the executors have a record of the payment."),
    ...signOff(ctx),
    new Paragraph({ children: [], pageBreakBefore: true }),
    heading("Receipt"),
    para(["Estate of ", deceasedName(ctx) || { ph: "name" }, ", deceased"]),
    para(["I, ", b.name, ", acknowledge receipt from the executors of ", b.gift_type === "Specific gift" ? (b.description || { ph: "the item" }) : money(amount), " in ", b.gift_type === "Share of residue" && Math.abs((entitlement?.balance || 0) - amount) > 0.005 ? "part payment of" : "full satisfaction of", " ", what, "."]),
    para(""),
    para("Signed: ______________________________"),
    para("Date: ______________________________"),
  ]);
}

module.exports = { estateAccount, deathNotificationLetter, paymentLetter };
