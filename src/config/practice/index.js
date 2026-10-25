/**
 * The departments built from configuration: employment, litigation,
 * personal injury, corporate and crime. Each module exports
 *
 *   details   { [type]: [field] }          the details card (see matterDetails.js)
 *   lists     [list]                        registers kept on the matter (offers, charges…)
 *   insights  (matter, lists) → { cards, attention }
 *
 * A list: { key, title, singular, icon, types?, fields: [field + required? / table?],
 *           summary(rows, matter) → { rows: [{ label, value, strong?, warn? }], note?, attention? } }
 * where `rows` are the stored items ({ id, ...data }). Cards: { title, icon, rows, note? }.
 * The screens render all of this generically, so most changes are made here.
 */
const PRACTICE = {
  employment: require("./employment"),
  litigation: require("./litigation"),
  personal_injury: require("./personalInjury"),
  corporate: require("./corporate"),
  crime: require("./crime"),
};

const practiceFor = (department) => (Object.hasOwn(PRACTICE, department) ? PRACTICE[department] : null);

function listsFor(department, type) {
  const p = practiceFor(department);
  return (p?.lists || []).filter((l) => !l.types || l.types.includes(type));
}

function detailsFor(department) {
  return practiceFor(department)?.details || {};
}

module.exports = { practiceFor, listsFor, detailsFor, PRACTICE };
