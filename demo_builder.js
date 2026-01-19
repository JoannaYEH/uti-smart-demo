// demo_builder.js  (TW Core friendly + no sandbox-noise reading)
import { FHIR_BASE, EXT_URL, LS_KEY } from "./config.js";
// 目的：
// 1) 用 transaction Bundle 一次建立一組 FHIR 資源：Patient + Encounter + Observation(Temp)
// 2) 將回傳的 resource ids 存在 localStorage，後續讀取只用精準 id GET，避免沙盒雜資料干擾
// 3) 保留 Patient.extension(valueString) 內的 demoCase，讓現有規則引擎 evaluateUtiCase 可直接沿用


// === Demo cases（沿用你原本 demoCase 格式，給規則引擎吃） ===
const DEMOS = [
  {
    title: "UTI-1a",
    gender: "female",
    expected: "1a",
    demoCase: {
      admitDate: "2025-12-10",
      labDate: "2025-12-13",
      symptomDates: [],
      ageYears: 40,
      tempC: 38.6,
      catheterPeriods: [{ start: "2025-12-10", end: "2025-12-13" }],
      urinaryRetentionDate: "2025-12-12",
      hasBladderScanOrStraightCath: true,
      nursingNoteText: "膀胱掃描顯示尿量 120 mL，評估單導。",
      infantKeywordsHit: false,
      urinaryOtherSymptom: null
    }
  },
  {
    title: "UTI-1b",
    gender: "male",
    expected: "1b",
    demoCase: {
      admitDate: "2025-12-10",
      labDate: "2025-12-13",
      symptomDates: [],
      ageYears: 30,
      tempC: 38.3,
      catheterPeriods: [],
      urinaryRetentionDate: "2025-12-12",
      hasBladderScanOrStraightCath: true,
      nursingNoteText: "病人排尿困難，膀胱掃描尿量 150 mL，已評估單導。",
      infantKeywordsHit: false,
      urinaryOtherSymptom: null
    }
  },
  {
    title: "UTI-2a",
    gender: "female",
    expected: "2a",
    demoCase: {
      admitDate: "2025-12-01",
      labDate: "2025-12-04",
      symptomDates: ["2025-12-04"],
      ageYears: 0.3,
      tempC: 35.8,
      catheterPeriods: [{ start: "2025-12-01", end: "2025-12-04" }],
      infantKeywordsHit: true,
      urinaryRetentionDate: null,
      hasBladderScanOrStraightCath: false,
      nursingNoteText: "",
      urinaryOtherSymptom: null
    }
  },
  {
    title: "UTI-2b",
    gender: "male",
    expected: "2b",
    demoCase: {
      admitDate: "2025-12-01",
      labDate: "2025-12-04",
      symptomDates: ["2025-12-05"],
      ageYears: 0.8,
      tempC: 38.2,
      catheterPeriods: [],
      infantKeywordsHit: true,
      urinaryRetentionDate: null,
      hasBladderScanOrStraightCath: false,
      nursingNoteText: "",
      urinaryOtherSymptom: null
    }
  },
  {
    title: "EX-AdmDay12",
    gender: "female",
    expected: "exclude",
    demoCase: {
      admitDate: "2025-12-10",
      labDate: "2025-12-11",
      symptomDates: ["2025-12-11"],
      ageYears: 50,
      tempC: 38.5,
      catheterPeriods: [{ start: "2025-12-10", end: "2025-12-13" }],
      infantKeywordsHit: false,
      urinaryRetentionDate: null,
      hasBladderScanOrStraightCath: false,
      nursingNoteText: "",
      urinaryOtherSymptom: true
    }
  },
  {
    title: "EX->65FeverOnly",
    gender: "male",
    expected: "exclude",
    demoCase: {
      admitDate: "2025-12-10",
      labDate: "2025-12-13",
      symptomDates: [],
      ageYears: 70,
      tempC: 38.6,
      catheterPeriods: [],
      urinaryRetentionDate: null,
      hasBladderScanOrStraightCath: false,
      nursingNoteText: "",
      urinaryOtherSymptom: false
    }
  }
];
// === Optional SMART auth header（有 SMART Launch 才會拿到 token；沒有就空，不會影響 demo） ===
async function getAuthHeaderOptional() {
  try {
    if (!window.FHIR?.oauth2?.ready) return {};
    const client = await FHIR.oauth2.ready();
    const token = client?.state?.tokenResponse?.access_token;
    if (token) return { Authorization: `Bearer ${token}` };
  } catch {}
  return {};
}
// === uuid helper（瀏覽器環境通用） ===
function uuidv4() {
  // RFC4122-ish v4
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
    const r = (crypto.getRandomValues(new Uint8Array(1))[0] & 15);
    const v = (c === "x") ? r : ((r & 3) | 8);
    return v.toString(16);
  });
}
function isoDateTime(dateStr, fallbackHour = 8) {
  // dateStr: "YYYY-MM-DD" -> "YYYY-MM-DDT08:00:00+08:00"
  // 用固定時間是為了避免 server 對 date-only/dateTime 的差異造成解析問題
  if (!dateStr) return null;
  return `${dateStr}T${String(fallbackHour).padStart(2, "0")}:00:00+08:00`;
}

// === 最小版導管 Procedure 產生器 ===
// 只做：code + subject + encounter + performedPeriod(start/end)
// code 這裡先用 SNOMED「Urinary catheterization」概念作示範（評審重點在結構，不是 code 精準度）
// 若你想改成 TW Core 指定 code/系統，我們之後再精修
function buildCatheterProcedure(demoCase, uPatient, uEncounter) {
  // 1) 兼容不同欄位命名
  let periods =
    demoCase?.catheterPeriods ??
    demoCase?.catheter_periods ??
    demoCase?.catheterPeriod ??
    demoCase?.catheter_period ??
    null;

  // 2) 兼容：periods 可能被存成 JSON 字串
  if (typeof periods === "string") {
    try { periods = JSON.parse(periods); } catch { periods = null; }
  }

  // 3) 若仍無 periods，嘗試從 start/end 欄位拼出一段
  if (!periods) {
    const s = demoCase?.catheterStart || demoCase?.catheter_start;
    const e = demoCase?.catheterEnd || demoCase?.catheter_end;
    if (s) periods = [{ start: s, end: e || null }];
  }

  // 4) periods 必須是 array 且至少一段有 start
  if (!Array.isArray(periods) || periods.length === 0) return null;
  const p0 = periods.find(p => p?.start) || null;
  if (!p0) return null;

  return {
    resourceType: "Procedure",
    status: "completed",
    code: {
      coding: [{
        system: "http://snomed.info/sct",
        code: "278977008",
        display: "Urinary catheterization"
      }],
      text: "導尿/導管"
    },
    subject: { reference: uPatient },
    encounter: { reference: uEncounter },
    performedPeriod: {
      start: isoDateTime(p0.start, 10),
      end: p0.end ? isoDateTime(p0.end, 10) : undefined
    }
  };
}


// === 建立一組乾淨、可追溯的 FHIR 資源（transaction bundle） ===
// 只做你要展示 TW Core 相容性的最小組合：Patient + Encounter + Observation(體溫) + Procedure(導管, optional)
async function postDemoBundle(demo, authHeader) {
  // 用 urn:uuid 在同一個 bundle 內互相參照（避免「先 POST Patient 再抓 id」的多次往返）
  const uPatient = `urn:uuid:${uuidv4()}`;
  const uEncounter = `urn:uuid:${uuidv4()}`;
  const uTempObs = `urn:uuid:${uuidv4()}`;
  const uProc = `urn:uuid:${uuidv4()}`;
  const demoCase = demo.demoCase || {};
  // Patient：仍保留 extension (demoCase JSON)，讓現有規則引擎可直接沿用
  const patient = {
    resourceType: "Patient",
    name: [{ family: "Demo", given: [demo.title] }],
    gender: demo.gender || "unknown",
    birthDate: "1970-01-01",
    extension: [{
      url: EXT_URL,
      valueString: JSON.stringify(demoCase)
    }]
  };
  // Encounter：住院/就醫事件（用 Encounter.period.start 表示入院日）
  // （這是你要展示「非 extension、結構化資料」的第一個證據）
  const encounter = {
    resourceType: "Encounter",
    status: "finished",
    subject: { reference: uPatient },
    period: {
      start: isoDateTime(demoCase.admitDate, 9),
      end: isoDateTime(demoCase.labDate || demoCase.admitDate, 18)
    }
  };
  // Observation：體溫（vital-signs）
  // LOINC 8310-5 Body temperature（用於展示結構化資料；你規則仍吃 demoCase.tempC）
  const tempC = (demoCase.tempC != null) ? Number(demoCase.tempC) : null;
  const tempObs = {
    resourceType: "Observation",
    status: "final",
    category: [{
      coding: [{ system: "http://terminology.hl7.org/CodeSystem/observation-category", code: "vital-signs" }]
    }],
    code: {
      coding: [{ system: "http://loinc.org", code: "8310-5", display: "Body temperature" }],
      text: "體溫"
    },
    subject: { reference: uPatient },
    encounter: { reference: uEncounter },
    effectiveDateTime: isoDateTime(demoCase.labDate || demoCase.admitDate, 10),
    valueQuantity: (tempC == null) ? undefined : { value: tempC, unit: "°C", system: "http://unitsofmeasure.org", code: "Cel" }
  };

  // 新增：最小版導管 Procedure（若沒有 catheterPeriods，就不建立）
  const catheterProc = buildCatheterProcedure(demoCase, uPatient, uEncounter);
  const entry = [
    { fullUrl: uPatient, resource: patient, request: { method: "POST", url: "Patient" } },
    { fullUrl: uEncounter, resource: encounter, request: { method: "POST", url: "Encounter" } },
    { fullUrl: uTempObs, resource: tempObs, request: { method: "POST", url: "Observation" } }
  ];
  if (catheterProc) {
    entry.push({ fullUrl: uProc, resource: catheterProc, request: { method: "POST", url: "Procedure" } });
  }

  // Transaction bundle：同一包建立，回應會回傳每筆 location（含 resource id）
  const bundle = {
    resourceType: "Bundle",
    type: "transaction",
    entry
  };
  const r = await fetch(`${FHIR_BASE}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/fhir+json",
      "Accept": "application/fhir+json",
      ...authHeader
    },
    body: JSON.stringify(bundle)
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`POST Bundle(transaction) failed: ${r.status} ${text.slice(0, 300)}`);
  }
  const resp = await r.json();
  // 解析 transaction-response：依 entry 順序取 response.location
  // location 形式通常像： "Patient/123/_history/1"
  function pickId(entryResp, expectedType) {
    const loc = entryResp?.response?.location || "";
    const m = loc.match(/^([A-Za-z]+)\/([^\/]+)(?:\/|$)/);
    if (!m) return null;
    const typ = m[1];
    const id = m[2];
    if (expectedType && typ !== expectedType) return null;
    return id;
  }
  const patientId = pickId(resp?.entry?.[0], "Patient");
  const encounterId = pickId(resp?.entry?.[1], "Encounter");
  const tempObsId = pickId(resp?.entry?.[2], "Observation");
  const procedureId = catheterProc ? pickId(resp?.entry?.[3], "Procedure") : null;
  // const procedureId = catheterProc ? pickId(resp?.entry?.[resp.entry.length - 1], "Procedure") : null;
  if (!patientId) {
    throw new Error(`Bundle response parsing failed: patientId missing. location=${resp?.entry?.[0]?.response?.location || ""}`);
  }
  return {
    patientId,
    encounterId,
    tempObsId, // 體溫 Observation id
    procedureId// 導管 Procedure id（可能 null
  };
}
// === 對外 export：建立 6 位 demo 病患（每位都會建立 Patient+Encounter+TempObs） ===
export async function buildSixDemoPatients() {
  const auth = await getAuthHeaderOptional();
  const created = [];
  for (const demo of DEMOS) {
    const ids = await postDemoBundle(demo, auth);
    created.push({
      title: demo.title,
      expected: demo.expected,
      patientId: ids.patientId,
      patientRef: `Patient/${ids.patientId}`,
      // 這兩個是「TW Core 結構化證據」：後續 cohort.js 會用精準 id GET（不 search）
      encounterId: ids.encounterId,
      tempObsId: ids.tempObsId,
      // 新增：導管 Procedure 證據（若該 demoCase 有 catheterPeriods 才會有值）
      catheterProcId: ids.procedureId
    });
  }
  const payload = {
    generatedAt: new Date().toISOString(),
    fhirBase: FHIR_BASE,
    extensionUrl: EXT_URL,
    patients: created
  };
  localStorage.setItem(LS_KEY, JSON.stringify(payload));
  return payload;
}
export function getStoredDemoPatients() {
  const raw = localStorage.getItem(LS_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}
// 有資料就沿用；沒有才建立（避免每次都重建、越建越亂）
export async function buildOrRebuildDemoPatients() {
  const stored = getStoredDemoPatients();
  if (stored?.patients?.length) return stored;
  return await buildSixDemoPatients();
}