/**
 * Stamp Duty Land Tax for residential purchases in England and Northern
 * Ireland. Rates as in force from 1 April 2025 — update RATES (and
 * RATES_AS_OF) here if HMRC changes them. Scotland (LBTT) and Wales (LTT)
 * have their own taxes and aren't covered.
 *
 * This is a guide for the fee earner, not a substitute for checking the
 * HMRC calculator on unusual transactions (mixed use, linked transactions,
 * shared ownership, multiple dwellings, companies, etc.).
 */

export const RATES_AS_OF = "1 April 2025";

const RATES = {
  // [upper limit of band, rate %]
  standard: [[125000, 0], [250000, 2], [925000, 5], [1500000, 10], [Infinity, 12]],
  firstTime: [[300000, 0], [500000, 5]],
  firstTimeMaxPrice: 500000,
  additionalSurcharge: 5, // higher rates for additional dwellings
  additionalMinPrice: 40000,
  nonResidentSurcharge: 2,
};

export const BUYER_TYPES = [
  { value: "standard", label: "Standard (moving home / only property)" },
  { value: "first_time", label: "First-time buyer (all buyers first-time, buying to live in)" },
  { value: "additional", label: "Additional property (second home / buy-to-let)" },
];

/**
 * calculateSdlt(price, { buyerType, nonResident }) →
 *   { total, bands: [{ from, to, rate, taxable, tax }], notes: [] }
 */
export function calculateSdlt(price, { buyerType = "standard", nonResident = false } = {}) {
  const p = Number(price);
  if (!Number.isFinite(p) || p <= 0) return { total: 0, bands: [], notes: ["Enter the purchase price."] };

  const notes = [];
  let bands = RATES.standard;
  let surcharge = 0;

  if (buyerType === "first_time") {
    if (p <= RATES.firstTimeMaxPrice) {
      bands = RATES.firstTime;
      notes.push("First-time buyer relief applied.");
    } else {
      notes.push(`First-time buyer relief doesn't apply above £${RATES.firstTimeMaxPrice.toLocaleString("en-GB")} — standard rates used.`);
    }
  }
  if (buyerType === "additional") {
    if (p >= RATES.additionalMinPrice) {
      surcharge += RATES.additionalSurcharge;
      notes.push(`Higher rates for additional dwellings: +${RATES.additionalSurcharge}% on each band.`);
    } else {
      notes.push(`No surcharge — the higher rates don't apply below £${RATES.additionalMinPrice.toLocaleString("en-GB")}.`);
    }
  }
  if (nonResident) {
    surcharge += RATES.nonResidentSurcharge;
    notes.push(`Non-UK resident surcharge: +${RATES.nonResidentSurcharge}% on each band.`);
  }

  const out = [];
  let from = 0;
  let total = 0;
  for (const [upper, baseRate] of bands) {
    if (p <= from) break;
    const taxable = Math.min(p, upper) - from;
    const rate = baseRate + surcharge;
    // HMRC rounds the total down to the whole pound.
    const tax = (taxable * rate) / 100;
    out.push({ from, to: Math.min(p, upper), rate, taxable, tax });
    total += tax;
    from = upper;
  }
  return { total: Math.floor(total), bands: out, notes };
}
