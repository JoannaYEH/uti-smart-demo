// uti_rules.js
// UTI rule-tree engine (front-end runnable, explainable output)

function toDateOnly(d) {
  // accept "YYYY-MM-DD" or Date
  if (d instanceof Date) return d;
  return new Date(d + "T00:00:00");
}

function daysBetween(a, b) {
  // b - a in days (integer)
  const ms = toDateOnly(b) - toDateOnly(a);
  return Math.floor(ms / (24 * 3600 * 1000));
}

function addDays(dateStr, n) {
  const d = toDateOnly(dateStr);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

function inRange(dateStr, startStr, endStr) {
  const t = toDateOnly(dateStr).getTime();
  return t >= toDateOnly(startStr).getTime() && t <= toDateOnly(endStr).getTime();
}

function pickEarliest(dates) {
  if (!dates || dates.length === 0) return null;
  return dates.slice().sort()[0];
}

/**
 * Determine infection day based on symptom dates within window around lab date.
 * Rules:
 * - window: labDate-3 ~ labDate+3 must contain symptom(s)
 * - if earliest symptom is on/after labDate (0~+3) => infectionDay = labDate
 * - if earliest symptom is before labDate (-3~-1) => infectionDay = earliestSymptomDay
 */
export function computeInfectionDay(labDate, symptomDates) {
  const start = addDays(labDate, -3);
  const end = addDays(labDate, 3);
  const inWindow = (symptomDates || []).filter(d => inRange(d, start, end)).sort();
  if (inWindow.length === 0) {
    return { ok: false, reason: "no_symptom_in_window", window: { start, end }, inWindow: [] };
  }
  const earliest = inWindow[0];
  const diff = daysBetween(labDate, earliest); // earliest - labDate
  // If earliest >= labDate => diff >= 0, infectionDay = labDate
  if (diff >= 0) {
    return { ok: true, infectionDay: labDate, rule: "symptom_after_or_on_lab", window: { start, end }, inWindow };
  }
  // earliest < labDate => diff < 0, infectionDay = earliest
  return { ok: true, infectionDay: earliest, rule: "symptom_before_lab", window: { start, end }, inWindow };
}

/**
 * Admission day rule:
 * - admitDay = day 1
 * - evaluate only if infectionDay >= admitDate + 2 days (i.e., day 3 or later)
 */
export function passesAdmissionDay3(admitDate, infectionDay) {
  const dayIndex = daysBetween(admitDate, infectionDay) + 1; // admit day = 1
  const ok = dayIndex >= 3;
  return { ok, dayIndex, threshold: 3 };
}

/**
 * Catheter rule:
 * Input catheterPeriods: [{start:"YYYY-MM-DD", end:"YYYY-MM-DD"}] inclusive
 * "Has catheter for case" if:
 * 1) infectionDay is within a period AND insertionDays>=3 (inclusive count)
 * OR
 * 2) infectionDay is exactly one day after end, AND total days>=3
 */
export function catheterStatus(infectionDay, catheterPeriods) {
  const periods = catheterPeriods || [];
  for (const p of periods) {
    const start = p.start;
    const end = p.end;
    const totalDays = daysBetween(start, end) + 1; // inclusive
    const inPeriod = inRange(infectionDay, start, end);
    const dayAfterRemoval = addDays(end, 1) === infectionDay;
    if (totalDays >= 3 && (inPeriod || dayAfterRemoval)) {
      return {
        hasCatheter: true,
        rule: inPeriod ? "infection_during_catheter_3days" : "infection_day_after_removal_3days",
        matchedPeriod: p,
        totalDays
      };
    }
  }
  return { hasCatheter: false, rule: "no_catheter_meeting_rule" };
}

/**
 * Age group and symptom/temperature conditions.
 * caseData:
 * {
 *  ageYears: number,
 *  tempC: number | null,
 *  infantKeywordsHit: boolean, // for age < 1
 *  urinaryOtherSymptom: boolean // for age>=1 and >65 without catheter
 * }
 */
export function classifyByAgeAndSymptoms(caseData, hasCatheter) {
  const age = caseData.ageYears;
  const temp = caseData.tempC;

  if (age < 1) {
    const tempOk = (temp != null) && (temp >= 38.1 || temp <= 35.9);
    const kwOk = !!caseData.infantKeywordsHit;
    if (!tempOk) return { ok: false, reason: "infant_temp_not_ok" };
    if (!kwOk) return { ok: false, reason: "infant_keywords_not_hit" };
    return { ok: true, category: hasCatheter ? "2a" : "2b" };
  }

  // age >= 1
  const feverOk = (temp != null) && (temp >= 38.1);
  if (!feverOk) return { ok: false, reason: "no_fever_for_age_ge_1" };

  if (!hasCatheter && age > 65) {
    // Special rule: >65 without catheter needs additional urinary symptoms besides fever
    if (!caseData.urinaryOtherSymptom) {
      return { ok: false, reason: "age_gt_65_no_catheter_fever_only" };
    }
  }

  return { ok: true, category: hasCatheter ? "1a" : "1b" };
}

/**
 * Main evaluation entry.
 * input:
 * {
 *  admitDate: "YYYY-MM-DD",
 *  labDate: "YYYY-MM-DD",
 *  symptomDates: ["YYYY-MM-DD", ...],     // already extracted "symptom present" dates
 *  ageYears: number,
 *  tempC: number,
 *  catheterPeriods: [{start,end}],
 *  infantKeywordsHit: boolean,
 *  urinaryOtherSymptom: boolean
 * }
 */
export function evaluateUtiCase(input) {
  const reasons = [];

  // A) infection day based on symptom window around lab date
  const inf = computeInfectionDay(input.labDate, input.symptomDates);
  reasons.push({ step: "infection_day", ...inf });
  if (!inf.ok) return { ok: false, reasons };

  // A) admission day >= 3
  const adm = passesAdmissionDay3(input.admitDate, inf.infectionDay);
  reasons.push({ step: "admission_day3", ...adm, admitDate: input.admitDate, infectionDay: inf.infectionDay });
  if (!adm.ok) return { ok: false, reasons };

  // B) catheter
  const cath = catheterStatus(inf.infectionDay, input.catheterPeriods);
  reasons.push({ step: "catheter", ...cath, infectionDay: inf.infectionDay });

  // C) classify
  const cls = classifyByAgeAndSymptoms(input, cath.hasCatheter);
  reasons.push({ step: "classify", ...cls, hasCatheter: cath.hasCatheter });
  if (!cls.ok) return { ok: false, reasons };

  return {
    ok: true,
    infectionDay: inf.infectionDay,
    category: cls.category,
    hasCatheter: cath.hasCatheter,
    reasons
  };
}
