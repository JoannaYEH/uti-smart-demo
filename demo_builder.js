// demo_builder.js
import { FHIR_BASE, EXT_URL, LS_KEY } from "./config.js";

const DEMOS = [
  { title: "UTI-1a", gender:"female", expected: "1a", demoCase: {
    admitDate:"2025-12-10", labDate:"2025-12-13", symptomDates:[],
    ageYears:40, tempC:38.6,
    catheterPeriods:[{start:"2025-12-10", end:"2025-12-13"}],
    urinaryRetentionDate:"2025-12-13", hasBladderScanOrStraightCath:true,
    nursingNoteText:"膀胱掃描顯示尿量 120 mL，評估單導。",
    infantKeywordsHit:false, urinaryOtherSymptom:null
  }},
  { title: "UTI-1b", gender:"male", expected: "1b", demoCase: {
    admitDate:"2025-12-10", labDate:"2025-12-13", symptomDates:[],
    ageYears:30, tempC:38.3,
    catheterPeriods:[],
    urinaryRetentionDate:"2025-12-13", hasBladderScanOrStraightCath:true,
    nursingNoteText:"病人排尿困難，膀胱掃描尿量 150 mL，已評估單導。",
    infantKeywordsHit:false, urinaryOtherSymptom:null
  }},
  { title: "UTI-2a", gender:"female", expected: "2a", demoCase: {
    admitDate:"2025-12-01", labDate:"2025-12-04", symptomDates:["2025-12-04"],
    ageYears:0.3, tempC:35.8,
    catheterPeriods:[{start:"2025-12-01", end:"2025-12-04"}],
    infantKeywordsHit:true,
    urinaryRetentionDate:null, hasBladderScanOrStraightCath:false,
    nursingNoteText:"", urinaryOtherSymptom:null
  }},
  { title: "UTI-2b", gender:"male", expected: "2b", demoCase: {
    admitDate:"2025-12-01", labDate:"2025-12-04", symptomDates:["2025-12-05"],
    ageYears:0.8, tempC:38.2,
    catheterPeriods:[],
    infantKeywordsHit:true,
    urinaryRetentionDate:null, hasBladderScanOrStraightCath:false,
    nursingNoteText:"", urinaryOtherSymptom:null
  }},
  { title: "EX-AdmDay12", gender:"female", expected: "exclude", demoCase: {
    admitDate:"2025-12-10", labDate:"2025-12-11", symptomDates:["2025-12-11"],
    ageYears:50, tempC:38.5,
    catheterPeriods:[{start:"2025-12-10", end:"2025-12-13"}],
    infantKeywordsHit:false,
    urinaryRetentionDate:null, hasBladderScanOrStraightCath:false,
    nursingNoteText:"", urinaryOtherSymptom:true
  }},
  { title: "EX->65FeverOnly", gender:"male", expected: "exclude", demoCase: {
    admitDate:"2025-12-10",
    labDate:"2025-12-13",
    // ✅ 只有發燒：沒有任何其他徵象日
    symptomDates: [],
    ageYears:70,
    tempC:38.6,
    // ✅ 無導管
    catheterPeriods: [],
    infantKeywordsHit:false,
    // ✅ 不要尿滯留徵象（否則會被視為其他泌尿徵象）
    urinaryRetentionDate:null,
    hasBladderScanOrStraightCath:false,
    nursingNoteText:"",
    // ✅ 明確表示沒有其他泌尿徵象（對 >65 無導管 的關鍵）
    urinaryOtherSymptom:false
  }},
];

async function getAuthHeader() {
  // 如果這頁是經 SMART Launch 進來的，FHIR.oauth2.ready() 會成功，拿得到 token
  try {
    const client = await FHIR.oauth2.ready();
    const token = client?.state?.tokenResponse?.access_token;
    if (token) return { Authorization: `Bearer ${token}` };
  } catch {}
  // 沒有也沒關係：你已驗證 THAS 可匿名寫入
  return {};
}

async function postPatient(demo, authHeader) {
  const patient = {
    resourceType: "Patient",
    name: [{ family: "Demo", given: [demo.title] }],
    gender: demo.gender || "unknown",
    birthDate: "1970-01-01",
    extension: [{
      url: EXT_URL,
      valueString: JSON.stringify(demo.demoCase)
    }]
  };

  const r = await fetch(`${FHIR_BASE}/Patient`, {
    method: "POST",
    headers: {
      "Content-Type": "application/fhir+json",
      "Accept": "application/fhir+json",
      ...authHeader
    },
    body: JSON.stringify(patient)
  });

  if (!r.ok) {
    const text = await r.text();
    throw new Error(`POST Patient failed: ${r.status} ${text.slice(0, 200)}`);
  }
  return await r.json();
}

export async function buildSixDemoPatients() {
  const auth = await getAuthHeader();
  const created = [];

  for (const demo of DEMOS) {
    const pat = await postPatient(demo, auth);
    created.push({
      title: demo.title,
      expected: demo.expected,
      patientId: pat.id,
      patientRef: `Patient/${pat.id}`
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


export async function buildOrRebuildDemoPatients() {
  
  return await buildSixDemoPatients();//getStoredDemoPatients();
}