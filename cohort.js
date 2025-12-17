import { evaluateUtiCase } from "./uti_rules.js";
import { getStoredDemoPatients } from "./demo_builder.js";

import { FHIR_BASE, EXT_URL } from "./config.js";

const FALLBACK = [
  { title: "UTI-1a", patientId: "672841", expected: "1a" },
  { title: "UTI-1b", patientId: "672842", expected: "1b" },
  { title: "UTI-2a", patientId: "672843", expected: "2a" },
  { title: "UTI-2b", patientId: "672844", expected: "2b" },
  { title: "EX-AdmDay12", patientId: "672845", expected: "exclude" },
  { title: "EX->65FeverOnly", patientId: "672846", expected: "exclude" }
];

function el(id) { return document.getElementById(id); }

async function fetchJson(url) {
  const r = await fetch(url, { headers: { Accept: "application/fhir+json" } });
  if (!r.ok) throw new Error(`GET ${url} -> ${r.status}`);
  return r.json();
}

function extractDemoCase(patient) {
  const ext = (patient.extension || []).find(e => e.url === EXT_URL);
  if (!ext?.valueString) return null;
  try { return JSON.parse(ext.valueString); } catch { return null; }
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
    <td><b>${demo.title}</b><div class="mono">expected: ${demo.expected}</div></td>
    <td class="mono">${patientRef}</td>
    <td>${result.ok ? `<span class="ok">✅ ${got}</span>` : `<span class="bad">❌ exclude</span>`}
      <div class="mono">match: ${match ? "✅" : "⚠️"}</div>
    </td>
    <td class="mono">${result.infectionDay ?? ""}</td>
    <td class="mono">${result.hasCatheter ?? ""}</td>
    <td class="mono">${result.ok ? "included" : "excluded"}</td>
    <td>
      <details><summary>展開</summary>
        <pre class="mono" style="white-space:pre-wrap;margin:8px 0 0;">${escapeHtml(JSON.stringify(result.reasons || [], null, 2))}</pre>
      </details>
    </td>
  `;
  tbody.appendChild(tr);
}

function renderFatal(msg) {
  const tbody = el("rows");
  const tr = document.createElement("tr");
  tr.innerHTML = `<td colspan="7" class="mono" style="color:#c00;">${escapeHtml(msg)}</td>`;
  tbody.appendChild(tr);
}

function getList() {
  const stored = getStoredDemoPatients();
  const list = stored?.patients?.length ? stored.patients : null;
  return list ?? FALLBACK;
}

async function run() {
  // 先塞一列，保證你看到「JS 有跑」
  el("rows").innerHTML = "";
  renderFatal("Loading…（若一直停在這裡，請看 Console 錯誤）");

  try {
    el("fhir-base").textContent = FHIR_BASE;
    el("rows").innerHTML = "";

    const DEMO_PATIENTS = getList();

    for (const demo of DEMO_PATIENTS) {
      const pid = String(demo.patientId ?? "");
      const patientRef = `Patient/${pid}`;

      try {
        const pat = await fetchJson(`${FHIR_BASE}/Patient/${pid}`);
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
  } catch (e) {
    el("rows").innerHTML = "";
    renderFatal("cohort.js crashed: " + String(e));
    console.error(e);
  }
}

el("btn-run").addEventListener("click", run);
run();
