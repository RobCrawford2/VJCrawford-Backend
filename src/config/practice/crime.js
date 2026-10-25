/**
 * Crime: police station attendances, magistrates' and Crown Court cases,
 * and appeals.
 */
const { addDays, addBusinessDays, addHours, daysBetween, ukToday } = require("../../utils/workingDays");
const fmt = require("../../utils/format");
const { row } = require("./shared");

const POLICE = "Police station";
const MAGS = "Magistrates' court";
const CROWN = "Crown Court";
const APPEAL = "Appeal";

const COMMON = [
  { key: "clientDob", label: "Client's date of birth", kind: "date" },
  { key: "offenceSummary", label: "Allegation", kind: "text" },
  { key: "urn", label: "URN / police reference", kind: "text" },
  { key: "legalAid", label: "Funding", kind: "select", options: ["Legal aid applied for", "Representation order granted", "Legal aid refused", "Private", "Police station scheme (free)"] },
  { key: "maat", label: "MAAT reference", kind: "text" },
  { key: "custodyStatus", label: "Custody status", kind: "select", options: ["Not in custody", "Police bail", "Court bail", "Remanded in custody", "Released under investigation"] },
  { key: "bailConditions", label: "Bail conditions", kind: "text" },
];

const details = {
  [POLICE]: [
    { key: "policeStation", label: "Police station", kind: "text" },
    { key: "custodyNumber", label: "Custody record number", kind: "text" },
    { key: "relevantTime", label: "Relevant time (arrival at the station)", kind: "datetime" },
    { key: "interviewAt", label: "Interview", kind: "datetime" },
    { key: "advice", label: "Interview advice", kind: "select", options: ["Answer questions", "Prepared statement", "No comment"] },
    { key: "outcome", label: "Outcome", kind: "select", options: ["Charged", "Released under investigation", "Bail to return", "No further action", "Caution / conditional caution", "Remanded"] },
    { key: "bailReturnDate", label: "Answer police bail on", kind: "date" },
    { key: "firstHearing", label: "First court hearing (if charged)", kind: "date" },
    ...COMMON,
  ],
  [MAGS]: [
    { key: "court", label: "Court", kind: "text" },
    { key: "firstHearing", label: "First hearing", kind: "date" },
    { key: "venue", label: "Venue", kind: "select", options: ["Summary only", "Either way — kept in the magistrates' court", "Either way — sent to the Crown Court"] },
    { key: "remandedFrom", label: "Remanded in custody from", kind: "date" },
    { key: "initialDisclosure", label: "Initial disclosure served", kind: "date" },
    { key: "trialDate", label: "Trial", kind: "date" },
    { key: "verdictDate", label: "Verdict / plea entered", kind: "date" },
    { key: "sentenceDate", label: "Sentence", kind: "date" },
    ...COMMON,
  ],
  [CROWN]: [
    { key: "court", label: "Crown Court", kind: "text" },
    { key: "firstHearing", label: "First hearing (magistrates')", kind: "date" },
    { key: "sentDate", label: "Sent to the Crown Court", kind: "date" },
    { key: "remandedFrom", label: "Remanded in custody from", kind: "date" },
    { key: "ptphDate", label: "Plea and trial preparation hearing", kind: "date" },
    { key: "initialDisclosure", label: "Initial disclosure served", kind: "date" },
    { key: "defenceStatementServed", label: "Defence statement served", kind: "date" },
    { key: "trialDate", label: "Trial", kind: "date" },
    { key: "verdictDate", label: "Verdict / plea entered", kind: "date" },
    { key: "sentenceDate", label: "Sentence", kind: "date" },
    ...COMMON,
  ],
  [APPEAL]: [
    { key: "appealRoute", label: "Appeal", kind: "select", options: ["Magistrates' → Crown Court", "Crown Court → Court of Appeal (conviction)", "Crown Court → Court of Appeal (sentence)"] },
    { key: "decisionDate", label: "Date of conviction / sentence appealed", kind: "date" },
    { key: "noticeLodged", label: "Notice of appeal lodged", kind: "date" },
    { key: "hearingDate", label: "Appeal hearing", kind: "date" },
    { key: "outcome", label: "Outcome", kind: "select", options: ["Pending", "Allowed", "Dismissed", "Sentence varied", "Abandoned"] },
    ...COMMON,
  ],
};

/** PACE detention clock from the relevant time. */
function paceClock(relevantTime) {
  return {
    firstReview: addHours(relevantTime, 6),
    secondReview: addHours(relevantTime, 15),
    limit24: addHours(relevantTime, 24),
    limit36: addHours(relevantTime, 36),
    limit96: addHours(relevantTime, 96),
  };
}

/** Custody time limit: magistrates' 56 days (summary) / 70 (either way); Crown Court 182 days from sending. */
function custodyTimeLimit(matter, d) {
  if (d.custodyStatus !== "Remanded in custody") return null;
  if (matter.type === CROWN && d.sentDate) return { date: addDays(d.sentDate, 182), basis: "182 days from sending to the Crown Court" };
  const from = d.remandedFrom || d.firstHearing;
  if (!from) return null;
  if (matter.type === MAGS || matter.type === CROWN) {
    const summary = d.venue === "Summary only";
    return { date: addDays(from, summary ? 56 : 70), basis: summary ? "56 days (summary only) to the start of trial" : "70 days to trial (56 if venue decided by day 56)" };
  }
  return null;
}

function pleaCredit(matter, d, today) {
  if (d.verdictDate) return null;
  if (!d.firstHearing || today <= d.firstHearing) return { fraction: "one third", when: "if guilty plea is indicated at the first stage (first hearing)" };
  if (d.trialDate && today >= d.trialDate) return { fraction: "one tenth", when: "on the first day of trial" };
  return { fraction: "one quarter at most", when: "after the first stage; reducing to one tenth on the day of trial" };
}

function insights(matter) {
  const d = matter.details || {};
  const today = ukToday();
  const now = new Date().toLocaleString("sv-SE", { timeZone: "Europe/London" }).slice(0, 16).replace(" ", "T");
  const cards = [];
  const attention = [];

  if (matter.type === POLICE && d.relevantTime) {
    const c = paceClock(d.relevantTime);
    const decided = !!d.outcome;
    const mark = (t) => (decided ? fmt.dateTime(t) : `${fmt.dateTime(t)}${t < now ? " — passed" : ""}`);
    cards.push({
      title: "PACE clock", icon: "Clock",
      rows: [
        row("Relevant time", fmt.dateTime(d.relevantTime)),
        row("First review (6 hours)", mark(c.firstReview)),
        row("Second review (15 hours), then every 9 hours", mark(c.secondReview)),
        row("24-hour limit", mark(c.limit24), { strong: true, warn: !decided && c.limit24 < now }),
        row("Superintendent's extension (36 hours, indictable offences)", mark(c.limit36)),
        row("Warrant of further detention (96 hours maximum)", mark(c.limit96)),
      ],
      note: "Times in UK local time — check by hand if the clocks change. Request the custody record and disclosure before advising.",
    });
  }
  if (matter.type === POLICE && d.outcome === "Bail to return" && d.bailReturnDate) {
    const left = daysBetween(today, d.bailReturnDate);
    if (left >= 0 && left <= 3) attention.push(`Client answers police bail ${fmt.date(d.bailReturnDate)} (${fmt.relative(left)}) — arrange attendance`);
  }

  const ctl = custodyTimeLimit(matter, d);
  if (ctl && !d.verdictDate) {
    const left = daysBetween(today, ctl.date);
    cards.push({ title: "Custody time limit", icon: "Hourglass", rows: [row("Expires", `${fmt.date(ctl.date)} (${fmt.relative(left)})`, { strong: true, warn: left <= 14 }), row("Basis", ctl.basis)], note: "The prosecution must apply to extend before expiry; otherwise the client must be bailed." });
    if (left <= 14) attention.push(left < 0 ? `Custody time limit expired ${fmt.date(ctl.date)} — the client should be bailed` : `Custody time limit expires ${fmt.date(ctl.date)} (${fmt.relative(left)}) — watch for a prosecution extension application`);
  }

  if ((matter.type === MAGS || matter.type === CROWN) && !d.verdictDate) {
    const rows = [];
    if (matter.type === CROWN && d.sentDate && !d.ptphDate) rows.push(row("PTPH usually within 28 days of sending", fmt.date(addDays(d.sentDate, 28))));
    if (d.initialDisclosure) {
      const due = addDays(d.initialDisclosure, matter.type === CROWN ? 28 : 14);
      const left = daysBetween(today, due);
      rows.push(row(matter.type === CROWN ? "Defence statement due (28 days)" : "Defence statement, if given (14 days — voluntary)", d.defenceStatementServed ? `served ${fmt.date(d.defenceStatementServed)}` : `${fmt.date(due)} (${fmt.relative(left)})`, { strong: matter.type === CROWN, warn: matter.type === CROWN && !d.defenceStatementServed && left <= 7 }));
      if (matter.type === CROWN && !d.defenceStatementServed && left <= 7) attention.push(left < 0 ? `Defence statement was due ${fmt.date(due)} — serve it / apply to extend (adverse inferences)` : `Defence statement due ${fmt.date(due)} (${fmt.relative(left)})`);
    }
    if (d.trialDate) rows.push(row("Trial", `${fmt.date(d.trialDate)} (${fmt.relative(daysBetween(today, d.trialDate))})`));
    const credit = pleaCredit(matter, d, today);
    if (credit) rows.push(row("Credit for a guilty plea now", `${credit.fraction} — ${credit.when}`));
    if (rows.length) cards.push({ title: "Case timetable", icon: "Gavel", rows, note: "Sentencing Council guideline on reduction for a guilty plea; the first stage is normally the first hearing at which a plea is sought." });
  }

  if ((matter.type === MAGS || matter.type === CROWN) && (d.sentenceDate || d.verdictDate)) {
    const from = d.sentenceDate || d.verdictDate;
    const due = matter.type === MAGS ? addBusinessDays(from, 15) : addDays(from, 28);
    const left = daysBetween(today, due);
    cards.push({ title: "Appeal deadline", icon: "Hourglass", rows: [row(matter.type === MAGS ? "Appeal to the Crown Court (15 business days)" : "Appeal to the Court of Appeal (28 days)", `${fmt.date(due)} (${fmt.relative(left)})`, { strong: true, warn: left >= 0 && left <= 7 })] });
  }

  if (matter.type === APPEAL && d.decisionDate) {
    const toCrown = d.appealRoute === "Magistrates' → Crown Court";
    const due = toCrown ? addBusinessDays(d.decisionDate, 15) : addDays(d.decisionDate, 28);
    const left = daysBetween(today, due);
    cards.push({ title: "Appeal deadline", icon: "Hourglass", rows: [row(toCrown ? "Notice of appeal (15 business days)" : "Notice and grounds (28 days)", d.noticeLodged ? `lodged ${fmt.date(d.noticeLodged)}` : `${fmt.date(due)} (${fmt.relative(left)})`, { strong: true, warn: !d.noticeLodged && left <= 7 })], note: "Out of time? An application to extend time needs good reasons." });
    if (!d.noticeLodged && left <= 7) attention.push(left < 0 ? `Time to appeal ran out on ${fmt.date(due)} — apply to extend` : `Notice of appeal due ${fmt.date(due)} (${fmt.relative(left)})`);
  }
  return { cards, attention };
}

const charges = {
  key: "charges",
  title: "Charges",
  singular: "charge",
  icon: "Gavel",
  intro: "Each charge or allegation, how it's classified, the plea and the outcome.",
  fields: [
    { key: "offence", label: "Offence", kind: "text", required: true },
    { key: "legislation", label: "Contrary to", kind: "text" },
    { key: "dateOfOffence", label: "Date of offence", kind: "date" },
    { key: "classification", label: "Classification", kind: "select", options: ["Summary only", "Either way", "Indictable only"], required: true },
    { key: "plea", label: "Plea", kind: "select", options: ["Not entered", "Not guilty", "Guilty", "Guilty — on a basis"] },
    { key: "outcome", label: "Outcome", kind: "select", options: ["Pending", "Convicted", "Acquitted", "Discontinued / withdrawn", "Dismissed", "Lie on file"] },
    { key: "sentence", label: "Sentence", kind: "text" },
  ],
  summary(items) {
    const has = (c) => items.some((i) => i.classification === c);
    const venue = has("Indictable only") ? "Crown Court (indictable only)" : has("Either way") ? "Either way — allocation decides" : items.length ? "Magistrates' court" : "—";
    return {
      rows: [
        row("Charges", String(items.length)),
        row("Venue", venue, { strong: true }),
        row("Not guilty pleas", String(items.filter((i) => i.plea === "Not guilty").length)),
        row("Pending", String(items.filter((i) => !i.outcome || i.outcome === "Pending").length)),
      ],
    };
  },
};

module.exports = { details, lists: [charges], insights, paceClock, custodyTimeLimit };
