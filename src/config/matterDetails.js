/**
 * The details recorded on a matter beyond its core fields, by department
 * and type (the deceased on a probate file, the marriage on a divorce…).
 * Stored in matters.details (JSONB). Each field: { key, label, kind, options? }
 * where kind is text | date | money | percent | bool | select. The same
 * definitions drive validation here and the details card on screen.
 */
const { DETAIL_FIELDS: PRIVATE_CLIENT } = require("./privateClient");
const { DETAIL_FIELDS: FAMILY } = require("./family");

const BY_DEPARTMENT = { private_client: PRIVATE_CLIENT, family: FAMILY };

function detailFieldsFor(department, type) {
  const fields = BY_DEPARTMENT[department];
  return (fields && Object.hasOwn(fields, type) && fields[type]) || [];
}

module.exports = { detailFieldsFor };
