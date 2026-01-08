import { evaluateUtiCase } from "./uti_rules.js";
import { getStoredDemoPatients } from "./demo_builder.js";

import { FHIR_BASE, FHIR_BASE_DISPLAY, EXT_URL } from "./config.js";


// 如果 localStorage 沒有，就用這份固定 patientId
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


// 從 Patient.extension 抽 demoCase JSON
function extractDemoCase(patient) {
  const exts = patient.extension || [];
  // 1) 先用完全相等
  let ext = exts.find(e => e.url === EXT_URL);

  // 2) 容錯：只要包含 uti-demo-input 就算（避免 EXT_URL 字串微小不一致）
  if (!ext) {
    ext = exts.find(e => (e.url || "").includes("uti-demo-input"));
  }

  if (!ext) {
    return { ok: false, reason: "missing_extension", urls: exts.map(e => e.url).filter(Boolean) };
  }

  const s = ext.valueString;
  if (!s) {
    return { ok: false, reason: "missing_valueString", url: ext.url };
  }

  try {
    return { ok: true, demoCase: JSON.parse(s), url: ext.url };
  } catch (e) {
    return { ok: false, reason: "valueString_not_json", url: ext.url, head: String(s).slice(0, 120) };
  }
}

function escapeHtml(s) {
  return (s || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function genderZh(g) {
  if (g === "male") return "男";
  if (g === "female") return "女";
  if (g === "other") return "其他";
  if (g === "unknown") return "未知";
  return "—";
}

function fmtList(arr) {
  if (!arr || arr.length === 0) return "—";
  return arr.join(", ");
}

function symptomSummary(demoCase) {
  const age = demoCase.ageYears;
  const temp = demoCase.tempC;

  const tempAbn =
    (age < 1)
      ? (temp != null && (temp >= 38.1 || temp <= 35.9))
      : (temp != null && temp >= 38.1);

  // demo 先以 labDate 當作體溫異常日（之後再改成 tempAbnormalDates）
  const tempDays = tempAbn ? [demoCase.labDate].filter(Boolean) : [];

  // 把「尿滯留徵象」視為其他徵象的一種，加入徵象日
  const retentionDay =
    (demoCase.hasBladderScanOrStraightCath && demoCase.urinaryRetentionDate)
      ? [demoCase.urinaryRetentionDate]
      : [];

  const nurseDays = Array.from(new Set([
    ...(demoCase.symptomDates || []),
    ...retentionDay
  ])).sort();

  return { tempAbn, tempDays, nurseDays };
}


function inferSymptomSignal(demoCase, result) {
  const age = demoCase.ageYears;
  const temp = demoCase.tempC;

  if (age < 1) {
    const tempFlag = (temp != null) && (temp >= 38.1 || temp <= 35.9);
    const kw = !!demoCase.infantKeywordsHit;
    return `嬰兒：體溫${tempFlag ? "✅" : "❌"}＋關鍵字${kw ? "✅" : "❌"}｜導管${result.hasCatheter ? "✅" : "❌"}`;
  }

  const fever = (temp != null) && (temp >= 38.1);
  const hasSymptom =  (demoCase.symptomDates && demoCase.symptomDates.length > 0)
  || (demoCase.hasBladderScanOrStraightCath && (demoCase.urinaryRetentionDate || "").length > 0);
  const gt65NoCath = (age > 65) && (result.hasCatheter === false);
  const other = !!demoCase.urinaryOtherSymptom;

  if (gt65NoCath) {
    const otherSym = !!demoCase.urinaryOtherSymptom
    || (!!demoCase.hasBladderScanOrStraightCath && !!demoCase.urinaryRetentionDate);
    return `≥1歲：發燒${fever ? "✅" : "❌"}；徵象${otherSym ? "✅" : "❌"}｜導管${result.hasCatheter ? "✅" : "❌"}`;
  }
  return `≥1歲：發燒${fever ? "✅" : "❌"}；徵象${hasSymptom ? "✅" : "❌"}｜導管${result.hasCatheter ? "✅" : "❌"}`;

}

function keyReason(result) {
  const rs = result.reasons || [];
  const cls = rs.find(x => x.step === "classify");
  if (cls && cls.ok === false) return cls.reason || "classify_failed";

  const adm = rs.find(x => x.step === "admission_day3");
  if (adm && adm.ok === false) return `排除：入院第 ${adm.dayIndex} 天 (<3)`;

  const inf = rs.find(x => x.step === "infection_day");
  if (inf && inf.ok === false) return "排除：±3天徵象不足";

  return result.ok ? `收案：${result.category}；感染日=${result.infectionDay ?? "—"}`
  : "排除";
}

function excludeLabel(result) {
  const rs = result.reasons || [];

  const adm = rs.find(x => x.step === "admission_day3");
  if (adm && adm.ok === false) {
    return "❌ 入院兩日內為社區感染 排除";
  }

  const cls = rs.find(x => x.step === "classify");
  if (cls && cls.ok === false) {
    if (cls.reason === "age_gt_65_no_catheter_fever_only") {
      return "❌ >65 歲 無導管 只有發燒沒有其他徵兆 不收案";
    }
    // 其他 classify 失敗就回傳原 reason（避免漏掉）
    return `❌ ${cls.reason || "不符合收案條件"}`;
  }

  const inf = rs.find(x => x.step === "infection_day");
  if (inf && inf.ok === false) {
    return "❌ ±3 天內無徵象 排除";
  }

  return "❌ 排除";
}


function compactReasons(result) {
  const rs = result.reasons || [];
  const pick = [
    "infection_day",
    "admission_day3",
    "catheter",
    "classify",
    "urinary_retention_symptomdate",
    "urinary_retention"
  ];
  return rs.filter(x => pick.includes(x.step));
}

function renderRow(demo, patientRef, patient, demoCase, result) {
  
  result = result ?? { ok: false, reasons: [{ step: "guard", ok: false, reason: "result_undefined" }] };

  const tbody = el("rows");
  const tr = document.createElement("tr");

  const got = result.ok ? result.category : "exclude";
  const match = got === demo.expected;

  tr.innerHTML = `
    <td>
      <b>${demo.title}</b>
      <div class="mono">expected: ${demo.expected}</div>
      <div class="mono">match: ${match ? "✅" : "⚠️"}</div>
    </td>
    <td class="mono">${patientRef}</td>
    <td class="mono">${demoCase.ageYears ?? "—"}</td>
    <td>${genderZh(patient.gender)}</td>
    <td class="mono">${demoCase.labDate ?? "—"}</td>
    <td class="mono">${result.infectionDay ?? "—"}</td>
    ${(() => {
      const s = symptomSummary(demoCase);
      return `
        <td class="mono">
          體溫異常：${s.tempAbn ? "✅" : "❌"} ${fmtList(s.tempDays)}
          <br/>
          其他徵象：${(s.nurseDays.length ? "✅" : "❌")} ${fmtList(s.nurseDays)}
        </td>
      `;
    })()}
    <td>
      ${
        result.ok
          ? `<span class="ok">✅ ${got}</span>`
          : `<span class="bad">${excludeLabel(result)}</span>`
      }
    </td>
    <td class="mono">${inferSymptomSignal(demoCase, result)}</td>
    <td>
      <details>
        <summary>展開</summary>
        <pre class="mono" style="white-space:pre-wrap;margin-top:6px;">
          ${escapeHtml(JSON.stringify(compactReasons(result), null, 2))}
        </pre>
      </details>
    </td>
  `;
  tbody.appendChild(tr);
}


function renderFatal(msg) {
  const tbody = el("rows");
  const tr = document.createElement("tr");
  tr.innerHTML = `<td colspan="10" class="mono" style="color:#c00;">${escapeHtml(msg)}</td>`;
  tbody.appendChild(tr);
}

function getList() {
  const stored = getStoredDemoPatients();
  const list = stored?.patients?.length ? stored.patients : null;
  return list ?? FALLBACK;
}


// 主流程（顯示 base → 決定 demo 清單 → 抓 patient → 解析 demoCase → 跑規則 → render）
async function run() {
  // 先塞一列，保證你看到「JS 有跑」
  // Step 0: UI 先顯示 Loading，避免空白
  el("rows").innerHTML = "";
  renderFatal("Loading…（若一直停在這裡，請看 Console 錯誤）");

  try {
    // Step 1: 顯示給評審看的 base（THAS 直連）
    el("fhir-base").textContent = FHIR_BASE_DISPLAY;
    el("rows").innerHTML = "";

    // Step 2: 取得 demo patient 清單
    // - 先看 localStorage（demo_builder 建完會存）
    // - 沒有就用 FALLBACK 固定 id
    const DEMO_PATIENTS = getList();

    // Step 3: 逐一跑每個 demo patient
    for (const demo of DEMO_PATIENTS) {
      const pid = String(demo.patientId ?? "");
      const patientRef = `Patient/${pid}`;

      let patient = { gender: "unknown" };
      let demoCase = {};

      try {
        // Step 3-1: 【FHIR】抓 Patient
        patient  = await fetchJson(`${FHIR_BASE}/Patient/${pid}`);
        // Step 3-2: 從 extension 取出 demoCase JSON
        const ex  = extractDemoCase(patient);

        if (!ex.ok) {
          // extension 不存在/或不是 JSON：直接在表格上顯示錯誤
          renderRow(demo, patientRef, patient, {}, { ok: false, reasons: [{ step: "load_demoCase", ok: false, ...ex }]  });
          continue;
        }

        // Step 3-3: 跑規則引擎（重要：深拷貝避免 evaluate 修改 input）
        demoCase = ex.demoCase;

        const input = JSON.parse(JSON.stringify(demoCase));
        const result = evaluateUtiCase(input);

        // Step 3-4: 畫到表格
        renderRow(demo, patientRef, patient, demoCase, result);

      } catch (e) {
        // Step 3-5: 任何抓取/解析錯誤，都落到這裡顯示在表格
        renderRow(demo, patientRef, patient, demoCase, { ok: false, reasons: [{ step: "fetch_patient", ok: false, error: String(e) }] });
      }
    }
  } catch (e) {
    // Step 4: cohort.js 整支異常
    el("rows").innerHTML = "";
    renderFatal("cohort.js crashed: " + String(e));
    console.error(e);
  }
}
// Step 5: 綁定按鈕＆自動跑一次
el("btn-run").addEventListener("click", run);
run();
