import { evaluateUtiCase } from "./uti_rules.js";
import { getStoredDemoPatients } from "./demo_builder.js";

const FHIR_BASE = "https://thas.mohw.gov.tw/v/r4/fhir";
const EXT_URL = "https://cch.org.tw/fhir/StructureDefinition/uti-demo-input";

const FALLBACK_DEMO_PATIENTS = [
  { title: "UTI-1a", patientId: "672841", expected: "1a" },
  { title: "UTI-1b", patientId: "672842", expected: "1b" },
  { title: "UTI-2a", patientId: "672843", expected: "2a" },
  { title: "UTI-2b", patientId: "672844", expected: "2b" },
  { title: "EX-AdmDay12", patientId: "672845", expected: "exclude" },
  { title: "EX->65FeverOnly", patientId: "672846", expected: "exclude" }
];

function el(id) { return document.getElementById(id); }

async function fetchJson(url) {
  const r = await fetch(url, { headers: { "Accept": "application/fhir+json" } });
  if (!r.ok) throw new Error(`GET ${url} -> ${r.status}`);
  return await r.json();
}

function extractDemoCase(patient) {
  const exts = patient.extension || [];
  const ext = exts.find(e => e.url === EXT_URL);
  if (!ext || !ext.valueString) return null;
  try { return JSON.parse(ext.valueString); } catch { return null; }
}

function mainReason(result) {
  const rs = result.reasons || [];
  const cls = rs.find(x => x.step === "classify");
  if (cls && cls.ok === false) return cls.reason || "classify_failed";
  const adm = rs.find(x => x.step === "admission_day3");
  if (adm && adm.ok === false) return "exclude: admission day < 3";
  const inf = rs.find(x => x.step === "infection_day");
  if (inf && inf.ok === false) return "exclude: no symptom in ±3d window";
  return result.ok ? "included" : "excluded";
}

function escapeHtml(s) {
  return (s || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function renderRow(demo, patientRef, result) {
  const tbody = el("rows");
  const tr = document.createElement("tr");

  const got = result.ok ? result.category : "exclude";
  const match = got === demo.expected;

  tr.innerHTML = `
    <td><div><b>${demo.title}</b></div><div class="mono">expected: ${demo.expected}</div></td>
    <td class="mono">${patientRef}</td>
    <td>${result.ok ? `<span class="ok">✅ ${got}</span>` : `<span class="bad">❌ exclude</span>`}
        <div class="mono">match: ${match ? "✅" : "⚠️"}</div>
    </td>
    <td class="mono">${result.infectionDay ?? ""}</td>
    <td class="mono">${result.hasCatheter ?? ""}</td>
    <td class="mono">${mainReason(result)}</td>
    <td>
      <details>
        <summary>展開</summary>
        <pre class="mono" style="white-space:pre-wrap;margin:8px 0 0;">${escapeHtml(JSON.stringify(result.reasons || [], null, 2))}</pre>
      </details>
    </td>
  `;
  tbody.appendChild(tr);
}

function getDemoPatientsFromStorageOrFallback() {
  const stored = getStoredDemoPatients();
  const list = stored?.patients?.length ? stored.patients : null;

  // stored.patients 可能包含 patientRef/title/expected，我們只取 cohort 需要的欄位
  if (list) {
    console.log("Using stored demo patients from localStorage:", list);
    return list.map(p => ({
      title: p.title ?? p.patientRef ?? "Demo",
      patientId: (p.patientId ?? "").toString(),
      expected: p.expected ?? "unknown"
    }));
  }

  console.log("No stored demo patients. Using fallback fixed IDs.");
  return FALLBACK_DEMO_PATIENTS;
}

async function run() {
  el("fhir-base").textContent = FHIR_BASE;
  el("rows").innerHTML = "";

  const DEMO_PATIENTS = getDemoPatientsFromStorageOrFallback();

  for (const demo of DEMO_PATIENTS) {
    const patientRef = `Patient/${demo.patientId}`;
    try {
      const pat = await fetchJson(`${FHIR_BASE}/Patient/${demo.patientId}`);
      const demoCase = extractDemoCase(pat);

      if (!demoCase) {
        renderRow(demo, patientRef, { ok: false, reasons: [{ step: "load_demoCase", ok: false, reason: "missing_extension" }] });
        continue;
      }

      const input = JSON.parse(JSON.stringify(demoCase));
      const result = evaluateUtiCase(input);
      renderRow(demo, patientRef, result);

    } catch (e) {
      renderRow(demo, patientRef, { ok: false, reasons: [{ step: "fetch_patient", ok: false, error: String(e) }] });
    }
  }
}

el("btn-run").addEventListener("click", run);
run();
