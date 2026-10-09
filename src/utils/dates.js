// Today's date in the UK (YYYY-MM-DD), whatever timezone the server runs in.
// Render runs on UTC, so between midnight and 1am in summer `new Date()`'s
// UTC date would be yesterday.
const UK_DATE = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" });

function ukToday() {
  return UK_DATE.format(new Date());
}

module.exports = { ukToday };
