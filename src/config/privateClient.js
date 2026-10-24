/**
 * Wills, Trusts & Probate: the details recorded on each type of matter,
 * the estate register's categories, and the inheritance tax estimate.
 *
 * DETAIL_FIELDS drive both the server's validation and the screen's
 * "details" card, so a field is added in one place.
 */

const PROBATE = "Probate / estate administration";
const WILL = "Will";
const LPA = "Lasting power of attorney";
const TRUST = "Trust";

const DETAIL_FIELDS = {
  [PROBATE]: [
    { key: "deceasedName", label: "Deceased's full name", kind: "text" },
    { key: "dateOfDeath", label: "Date of death", kind: "date" },
    { key: "deceasedAddress", label: "Last address", kind: "text" },
    { key: "dateOfBirth", label: "Date of birth", kind: "date" },
    { key: "maritalStatus", label: "Marital status at death", kind: "select", options: ["Married / civil partner", "Widowed / surviving civil partner", "Divorced", "Single", "Cohabiting"] },
    { key: "dateOfWill", label: "Date of will (blank if intestate)", kind: "date" },
    { key: "grantType", label: "Grant", kind: "select", options: ["Probate", "Letters of administration", "Letters of administration with will annexed"] },
    { key: "personalRepresentatives", label: "Executors / administrators", kind: "text" },
    { key: "grantApplied", label: "Grant applied for", kind: "date" },
    { key: "grantIssued", label: "Grant issued", kind: "date" },
    { key: "ihtRoute", label: "IHT reporting", kind: "select", options: ["Excepted estate (no IHT account)", "IHT400 account"] },
    { key: "transferredNrbPct", label: "Unused nil-rate band transferred from spouse (%)", kind: "percent" },
    { key: "transferredRnrbPct", label: "Unused residence nil-rate band transferred (%)", kind: "percent" },
    { key: "homeToDescendants", label: "Home (or share) passes to children / grandchildren", kind: "bool" },
    { key: "lifetimeGifts", label: "Chargeable gifts in the 7 years before death (£)", kind: "money" },
    { key: "reliefs", label: "Business / agricultural property relief claimed (£)", kind: "money" },
    { key: "ihtPaid", label: "IHT paid (£)", kind: "money" },
    { key: "section27Published", label: "Section 27 notices published", kind: "date" },
  ],
  [WILL]: [
    { key: "testator", label: "Testator(s)", kind: "text" },
    { key: "willType", label: "Kind of will", kind: "select", options: ["Single will", "Mirror wills", "Will with trust provisions", "Codicil"] },
    { key: "executors", label: "Executors", kind: "text" },
    { key: "guardians", label: "Guardians", kind: "text" },
    { key: "capacityNote", label: "Capacity / undue influence note", kind: "text" },
    { key: "dateSigned", label: "Date signed", kind: "date" },
    { key: "witnesses", label: "Witnesses", kind: "text" },
    { key: "certaintyRegistered", label: "Registered with Certainty", kind: "bool" },
  ],
  [LPA]: [
    { key: "donor", label: "Donor", kind: "text" },
    { key: "lpaTypes", label: "LPA type(s)", kind: "select", options: ["Property & financial affairs", "Health & welfare", "Both"] },
    { key: "attorneys", label: "Attorneys", kind: "text" },
    { key: "replacementAttorneys", label: "Replacement attorneys", kind: "text" },
    { key: "howAct", label: "How attorneys act", kind: "select", options: ["Jointly", "Jointly and severally", "Jointly for some decisions, severally for others"] },
    { key: "certificateProvider", label: "Certificate provider", kind: "text" },
    { key: "dateSigned", label: "Date signed by donor", kind: "date" },
    { key: "sentToOpg", label: "Sent to the OPG", kind: "date" },
    { key: "opgReference", label: "OPG reference", kind: "text" },
    { key: "registered", label: "Registered", kind: "date" },
  ],
  [TRUST]: [
    { key: "trustName", label: "Name of the trust", kind: "text" },
    { key: "trustType", label: "Kind of trust", kind: "select", options: ["Discretionary", "Interest in possession (life interest)", "Bare trust", "Trust for a vulnerable beneficiary", "Will trust"] },
    { key: "settlor", label: "Settlor", kind: "text" },
    { key: "trustees", label: "Trustees", kind: "text" },
    { key: "dateCreated", label: "Date created", kind: "date" },
    { key: "trsReference", label: "Trust Registration Service reference", kind: "text" },
    { key: "trustValue", label: "Value at creation (£)", kind: "money" },
  ],
};

const ASSET_CATEGORIES = [
  "Property (main residence)", "Other property", "Bank / building society", "Investments / shares", "Premium Bonds / NS&I",
  "Pension", "Life insurance", "Personal possessions", "Vehicle", "Business interest", "Money owed to the deceased", "Other asset",
];
const LIABILITY_CATEGORIES = ["Funeral", "Mortgage", "Credit card / loan", "Household bills", "Care fees", "Income tax", "Administration expense", "Other debt"];
// Paid out by the executors but not deductible from the estate for IHT.
const NOT_IHT_DEDUCTIBLE = new Set(["Administration expense"]);
const ITEM_STATUSES = {
  asset: ["To notify", "Notified", "Valued", "Collected / transferred"],
  liability: ["To notify", "Notified", "Agreed", "Paid"],
};
const GIFT_TYPES = ["Specific gift", "Pecuniary legacy", "Share of residue"];

// Inheritance tax (rates and bands frozen until April 2030).
const IHT = { nilRateBand: 325000, residenceNilRateBand: 175000, taperThreshold: 2000000, rate: 0.4, charityRate: 0.36 };

const n = (v) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? 0 : Number(v));
const round2 = (v) => Math.round(v * 100) / 100;

/**
 * Totals, inheritance tax estimate and distribution for an estate.
 * items: estate_items rows; beneficiaries: estate_beneficiaries rows; d: pc_details.
 * An estimate for the fee earner to check — it doesn't gross up specific
 * gifts or deal with gifts with reservation, quick succession relief etc.
 */
function estateSummary(items, beneficiaries, d = {}) {
  const assets = items.filter((i) => i.kind === "asset");
  const liabilities = items.filter((i) => i.kind === "liability");
  const grossEstate = assets.reduce((s, a) => s + n(a.value_at_death), 0);
  const outsideWill = assets.filter((a) => a.passes_outside_will).reduce((s, a) => s + n(a.value_at_death), 0);
  // Liabilities use the same columns: value_at_death = amount owed, value_realised = amount actually paid.
  const known = (v) => v !== null && v !== undefined && v !== "";
  const ihtDebts = liabilities.filter((l) => !NOT_IHT_DEDUCTIBLE.has(l.category)).reduce((s, l) => s + n(l.value_at_death), 0);
  const allDebts = liabilities.reduce((s, l) => s + n(known(l.value_realised) ? l.value_realised : l.value_at_death), 0);
  const netEstate = grossEstate - ihtDebts;

  // What passes under the will (or intestacy), and who to.
  const willEstate = netEstate - outsideWill;
  const gifts = beneficiaries.filter((b) => b.gift_type !== "Share of residue");
  const residueShares = beneficiaries.filter((b) => b.gift_type === "Share of residue");
  const giftsTotal = gifts.reduce((s, b) => s + n(b.amount), 0);
  const residueForIht = Math.max(0, willEstate - giftsTotal);
  const exemptValue = (b) => (b.gift_type === "Share of residue" ? (residueForIht * n(b.share_percent)) / 100 : n(b.amount));
  const spouseExempt = beneficiaries.filter((b) => b.exemption === "spouse").reduce((s, b) => s + exemptValue(b), 0);
  const charityExempt = beneficiaries.filter((b) => b.exemption === "charity").reduce((s, b) => s + exemptValue(b), 0);

  const nrb = IHT.nilRateBand * (1 + Math.min(100, n(d.transferredNrbPct)) / 100);
  let rnrb = 0;
  if (d.homeToDescendants) {
    const home = assets.filter((a) => a.category === "Property (main residence)").reduce((s, a) => s + n(a.value_at_death), 0);
    const max = IHT.residenceNilRateBand * (1 + Math.min(100, n(d.transferredRnrbPct)) / 100);
    const taper = Math.max(0, (netEstate - IHT.taperThreshold) / 2);
    rnrb = Math.max(0, Math.min(home, max - taper));
  }
  const chargeable = Math.max(0, netEstate - spouseExempt - charityExempt - n(d.reliefs) + n(d.lifetimeGifts));
  const taxable = Math.max(0, chargeable - nrb - rnrb);
  // 36% when at least 10% of the "baseline" (the estate after reliefs, exemptions other than charity, and the nil-rate band) goes to charity.
  const baseline = Math.max(0, netEstate - spouseExempt - n(d.reliefs) + n(d.lifetimeGifts) - nrb);
  const rate = charityExempt > 0 && baseline > 0 && charityExempt >= baseline * 0.1 ? IHT.charityRate : IHT.rate;
  const ihtDue = round2(taxable * rate);

  // Distribution (estate account): realised values where known, less everything paid out incl. IHT and expenses.
  const realised = assets.filter((a) => !a.passes_outside_will).reduce((s, a) => s + n(known(a.value_realised) ? a.value_realised : a.value_at_death), 0);
  const ihtForAccount = n(d.ihtPaid) || ihtDue;
  const forDistribution = realised - allDebts - ihtForAccount;
  const residue = forDistribution - giftsTotal;
  const totalShares = residueShares.reduce((s, b) => s + n(b.share_percent), 0);

  return {
    grossEstate: round2(grossEstate), outsideWill: round2(outsideWill), debts: round2(ihtDebts), allDebts: round2(allDebts),
    netEstate: round2(netEstate),
    iht: {
      nilRateBand: round2(nrb), residenceNilRateBand: round2(rnrb), spouseExempt: round2(spouseExempt), charityExempt: round2(charityExempt),
      reliefs: n(d.reliefs), lifetimeGifts: n(d.lifetimeGifts), chargeable: round2(chargeable), taxable: round2(taxable), rate, due: ihtDue,
      paid: n(d.ihtPaid),
    },
    distribution: {
      realised: round2(realised), payments: round2(allDebts), iht: round2(ihtForAccount), forDistribution: round2(forDistribution),
      legacies: round2(giftsTotal), residue: round2(residue), totalShares: round2(totalShares),
      beneficiaries: beneficiaries.map((b) => {
        const entitlement = b.gift_type === "Share of residue" ? (Math.max(0, residue) * n(b.share_percent)) / 100 : n(b.amount);
        return { id: b.id, entitlement: round2(entitlement), paid: round2(n(b.paid_amount)), balance: round2(entitlement - n(b.paid_amount)) };
      }),
    },
  };
}

module.exports = {
  PROBATE, WILL, LPA, TRUST, DETAIL_FIELDS, ASSET_CATEGORIES, LIABILITY_CATEGORIES, ITEM_STATUSES, GIFT_TYPES, IHT, estateSummary,
};
