// cohort.js (clean + no-search + TW Core evidence friendly)
//
// 核心原則：
// 1) 不使用任何 FHIR search（避免沙盒雜資料）
// 2) 只用 demo_builder.js 建立後存進 localStorage 的「精準 resource id」讀取
// 3) 若沒有結構化 id（舊資料），自動 fallback 到 Patient.extension demoCase
// 4) 規則引擎 evaluateUtiCase 不動

import { evaluateUtiCase } from "./uti_rules.js";
import { getStoredDemoPatients, buildOrRebuildDemoPatients } from "./demo_builder.js";
import { FHIR_BASE, FHIR_BASE_DISPLAY, EXT_URL } from "./config.js";

const EXCLUDE_REASON_MAP = {
  // >=1歲相關
  "no_fever_for_age_ge_1": "≥1歲需符合發燒（≥38.1°C）",
  "age_gt_65_no_catheter_fever_only": ">65歲且無導管：僅發燒、缺乏其他泌尿道徵象",

  // <1歲相關
  "infant_temp_not_ok": "<1歲需符合體溫異常（≥38.1 或 ≤35.9°C）",
  "infant_keywords_not_hit": "<1歲需符合嬰幼兒徵象關鍵字條件",

  // 徵象/感染日相關（若你未來要在 decisionLabel 用到也可）
  "no_symptom_in_window": "檢驗日前後±3天內未偵測到徵象",
  // 可以根據你 uti_rules 的 reason 值再加
};

// 工具函式：把 reason code 轉成人話
function humanReason(reasonCode) {
  if (!reasonCode) return "不符合收案條件";
  return EXCLUDE_REASON_MAP[reasonCode] || reasonCode;
}

function el(id) { return document.getElementById(id); }
function esc(s) {
  return (s ?? "").toString()
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

async function getAuthStatusText() {
  try {
    if (!window.FHIR?.oauth2?.ready) return "未取得（匿名模式）";
    const client = await FHIR.oauth2.ready();
    const token = client?.state?.tokenResponse?.access_token;
    return token ? "已取得（SMART Launch）" : "未取得（匿名模式）";
  } catch {
    return "未取得（匿名模式）";
  }
}

async function fetchById(resourceType, id) {
  if (!id) return null;
  const r = await fetch(`${FHIR_BASE}/${resourceType}/${id}`, {
    headers: { Accept: "application/fhir+json" }
  });
  if (!r.ok) throw new Error(`GET ${resourceType}/${id} -> ${r.status}`);
  return await r.json();
}

function extractDemoCaseFromPatient(patient) {
  const exts = patient?.extension || [];
  let ext = exts.find(e => e.url === EXT_URL);
  if (!ext) ext = exts.find(e => (e.url || "").includes("uti-demo-input"));
  if (!ext?.valueString) return null;
  try { return JSON.parse(ext.valueString); } catch { return null; }
}

function findReason(result, step) {
  return (result?.reasons || []).find(r => r.step === step) || null;
}

// 讓「徵象日」更接近原本：symptomDates +（若尿滯留命中則當作徵象日）
function getSymptomDays(demoCase, result) {
  const days = new Set([...(demoCase.symptomDates || [])]);

  // 優先用 reasons 裡「把尿滯留當徵象日」的 step（若規則有產生）
  const rSym = findReason(result, "urinary_retention_symptomdate");
  if (rSym?.ok && rSym.symptomDate) days.add(rSym.symptomDate);

  // 次選：用 demoCase 的 urinaryRetentionDate（你原始資料）
  if (demoCase.hasBladderScanOrStraightCath && demoCase.urinaryRetentionDate) {
    days.add(demoCase.urinaryRetentionDate);
  }

  return Array.from(days).filter(Boolean).sort();
}

/**
 * 收案條件摘要（修正版）
 * 目標：跟 rules 的 reasons 對齊，讓內容看起來「跟原本一樣合理」
 *
 * 會輸出四段（若資料存在）：
 * 1) 入院第3天：✅/❌
 * 2) 感染日判定（±3天徵象）：✅/❌ + infectionDay
 * 3) 導管相關：有/無 + 導管區間(若 reasons 有)
 * 4) 分類：1a/1b/2a/2b 或 排除原因（例如 >65 無導管僅發燒）
 */
function summarizeCriteria(demoCase, result) {
  const lines = [];

  // 1) 入院第3天（院內感染排除社區感染）
  const rAdm = findReason(result, "admission_day3");
  if (rAdm) {
    // lines.push(`${rAdm.ok ? "✅" : "❌"} 入院第3天（排除社區感染）`);
    if (rAdm.ok) {
      lines.push(`✅ 入院第${esc(rAdm.dayIndex)}天（達門檻≥${esc(rAdm.threshold)}天，排除社區感染）`);
    } else {
      // ✅ 關鍵：因為 rules 在 admission_day3 失敗就直接 return，不會有 classify reason
      // 所以我們在顯示層直接補上「評審看得懂」的排除原因
      lines.push(`❌ 不收案（社區感染：入院第${esc(rAdm.dayIndex)}天，未達≥${esc(rAdm.threshold)}天）`);
    }
  }

  // 2) 感染日（±3 天徵象）
  const rInf = findReason(result, "infection_day");
  if (rInf) {
    const day = result?.infectionDay || rInf.infectionDay || "—";
    lines.push(`${rInf.ok ? "✅" : "❌"} 感染日（±3天徵象）＝${day}`);
  }

  // 3) 導管相關（你原本 UI 很重視）
  const rCat = findReason(result, "catheter");
  if (rCat) {
    // 盡量抓出你 rules 可能提供的資訊；沒有就用 demoCase
    const hasCatheter = (result?.hasCatheter ?? rCat.hasCatheter);
    if (hasCatheter === true) {
      // 依 rule 描述導管相關性
      const rr = rCat.rule || "";
      let msg = "✅有導管（符合導管相關條件）";
      if (rr === "infection_during_catheter_3days") msg = "✅有導管（導管≥3天且感染日在置放期間內）";
      if (rr === "infection_day_after_removal_3days") msg = "✅有導管（導管≥3天且感染日在拔除後隔天）";
      lines.push(msg);
    } else if (hasCatheter === false) {
      lines.push("❌無導管");
    } else {
      lines.push("導管狀態—");
    }
  } else {
    // fallback：用 demoCase.catheterPeriods
    const has = Array.isArray(demoCase.catheterPeriods) && demoCase.catheterPeriods.length > 0;
    lines.push(` ${has ? "✅有導管" : "❌無導管"}`);
  }

  // 4) 分類（1a/1b/2a/2b 或 排除）
  const rCls = findReason(result, "classify");
  if (result?.ok) {
    lines.push(`✅ 分類：${result.category}`);
  } else if (rCls && rCls.ok === false) {
    // 顯示你原本很在意的排除理由
    const reason = rCls.reason || "不符合收案條件";
    lines.push(`❌ 分類：不收案 ${humanReason(reason)}`);
  } else {
    lines.push("❌ 分類：不收案 ");
  }

  return lines.join("<br/>");
}

function decisionLabel(result) {
  if (result?.ok) return `<span style="color:#16a34a;font-weight:600">✅ ${esc(result.category)}</span>`;
  return `<span style="color:#dc2626;font-weight:600">❌ 不收案</span>`;
  // if (result?.ok) {
  //   return `<span style="color:#16a34a;font-weight:600">✅ ${esc(result.category)}</span>`;
  // }

  // // 1) admission_day3 失敗：社區感染排除（你 rules 會 early return）
  // const rAdm = findReason(result, "admission_day3");
  // if (rAdm && rAdm.ok === false) {
  //   const dayIndex = rAdm.dayIndex ?? "—";
  //   return `<span style="color:#dc2626;font-weight:600">❌ 不收案（社區感染：入院第${esc(dayIndex)}天）</span>`;
  // }

  // // 2) symptom_window 失敗：±3天內無徵象且無體溫異常
  // const rSw = findReason(result, "symptom_window");
  // if (rSw && rSw.ok === false) {
  //   return `<span style="color:#dc2626;font-weight:600">❌ 不收案（±3天內無徵象/體溫異常）</span>`;
  // }

  // // 3) classify 失敗：用 humanReason 轉中文
  // const rCls = findReason(result, "classify");
  // if (rCls && rCls.ok === false) {
  //   return `<span style="color:#dc2626;font-weight:600">❌ 不收案（${esc(humanReason(rCls.reason))}）</span>`;
  // }

  // return `<span style="color:#dc2626;font-weight:600">❌ 不收案</span>`;
}

// 把「TW Core 證據」放到細節，不新增欄位
async function buildEvidenceHtml(demo) {
  const items = [];
  if (demo.encounterId) {
    items.push({
      id: `Encounter/${demo.encounterId}`,
      note: "就醫/住院事件：用於計算入院第幾天"
    });
  }
  if (demo.tempObsId) {
    items.push({
      id: `Observation/${demo.tempObsId}`,
      note: "生命徵象：體溫，用於發燒/低溫判斷"
    });
  }
  if (demo.catheterProcId) {
    items.push({
      id: `Procedure/${demo.catheterProcId}`,
      note: "處置：導尿/導管，用於判斷導管相關性"
    });
  }

  const rows = items.length
    ? items.map(x => `
        <div class="evidence-item">
          <div class="evidence-id">${esc(x.id)}</div>
          <div class="evidence-note">${esc(x.note)}</div>
        </div>
      `).join("")
    : `<div class="evidence-desc">此案例未建立結構化資源（僅使用 Patient extension 示範資料）。</div>`;

  return `
    <div class="detail-panel">
      <div class="evidence-card">
        <div class="evidence-title">FHIR Resources</div>
        <div class="evidence-desc">
          本示範個案於 FHIR 沙盒建立的資料 ID（可追溯）。
        </div>
        ${rows}
      </div>
    </div>
  `;
  // lines.push(`<b>FHIR Resources</b>`);
  // lines.push(`<span class="note">為本示範個案於 FHIR 沙盒建立的資料 ID；「判斷依據」保留原始判斷過程供追溯</span>`);

  // // Encounter / Observation（你原本就有）
  // if (demo.encounterId) lines.push(`Encounter/${esc(demo.encounterId)}<span class="note">（就醫/住院事件：用於計算入院第幾天）</span>`);
  // if (demo.tempObsId) lines.push(`Observation/${esc(demo.tempObsId)}<span class="note">（生命徵象：體溫，用於發燒/低溫判斷）</span>`);

  // // ✅ 新增：Procedure（導管）
  // // 注意：你的 localStorage 欄位叫 catheterProcId
  // if (demo.catheterProcId) lines.push(`Procedure/${esc(demo.catheterProcId)}<span class="note">（處置：導尿/導管，用於判斷導管相關性）</span>`);

  // // 如果沒有任何 FHIR id，顯示 fallback
  // if (!demo.encounterId && !demo.tempObsId && !demo.catheterProcId) {
  //   lines.push(`<span class="note">(此案例僅使用 Patient extension 示範資料)</span>`);
  // }

  // return `
  //   <div class="mono" style="font-size:12px;color:#334155;margin-bottom:6px;line-height:1.35;">
  //     ${lines.join("<br/>")}
  //   </div>
  // `;
}

// 辨識是否正在自動建立 demo（避免重複觸發）
let __AUTO_BUILDING__ = false;

async function run() {
  const tbody = el("rows");
  if (!tbody) return;
  tbody.innerHTML = "";

  const baseEl = el("fhir-base");
  if (baseEl) baseEl.textContent = FHIR_BASE_DISPLAY;

  const authEl = el("auth-status");
  if (authEl) authEl.textContent = await getAuthStatusText();

  // const stored = getStoredDemoPatients();
  // if (!stored?.patients?.length) {
  //   const tr = document.createElement("tr");
  //   tr.innerHTML = `<td colspan="10" class="mono" style="color:#c00">尚未建立 demo 病患，請先點「建立/重建 Demo 資料」</td>`;
  //   tbody.appendChild(tr);
  //   return;
  // }

  let stored = getStoredDemoPatients();

  // 若沒有 localStorage，就自動建立一次 demo
  if (!stored?.patients?.length) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="9" class="mono" style="color:#666">首次開啟：正在自動建立 6 位示範病人資料…</td>`;
    tbody.appendChild(tr);

     // 已經在建立了，避免重複觸發；保留畫面提示即可
    if (__AUTO_BUILDING__) return;
    __AUTO_BUILDING__ = true;

    try {
      // 建立 demo（成功後 demo_builder.js 應該會寫入 localStorage）
      await buildOrRebuildDemoPatients();

      // 重新讀一次 localStorage
      stored = getStoredDemoPatients();
    } catch (e) {
      tr.innerHTML = `<td colspan="9" class="mono" style="color:#c00">自動建立示範資料失敗：${esc(e.message)}<br/>請改用離線展示或稍後再試。</td>`;
      return;
    } finally {
      __AUTO_BUILDING__ = false;
    }
  }

  // 仍然沒有資料就直接終止（保險）
  if (!stored?.patients?.length) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="9" class="mono" style="color:#c00">無法取得示範病人資料（localStorage 仍為空）</td>`;
    tbody.appendChild(tr);
    return;
  }

  //  清掉「自動建立中」提示列，避免殘留在表格
  tbody.innerHTML = "";

  for (const demo of stored.patients) {
    const tr = document.createElement("tr");

    try {
      // 1) 只讀自己建的 Patient（精準 id，不 search）
      const patient = await fetchById("Patient", demo.patientId);
      const demoCase = extractDemoCaseFromPatient(patient);

      if (!demoCase) {
        tr.innerHTML = `
          <td>
            <div style="font-weight:600;">${esc(demo.title)}</div>
            <div class="mono" style="font-size:12px;color:#475569;">
              ${esc(demo.patientRef)}
            </div>
          </td>
          <td colspan="8" style="color:#c00">❌ 找不到 demoCase extension</td>
        `;
        tbody.appendChild(tr);
        continue;
      }

      // 2) 跑規則（不改引擎）
      const input = JSON.parse(JSON.stringify(demoCase));
      const result = evaluateUtiCase(input);

      // 3) 準備 UI 欄位值（對齊你的 10 欄 th）
      const age = (demoCase.ageYears ?? "—");
      const sex = genderZh(patient?.gender);
      const labDate = demoCase.labDate ?? "—";
      const infectionDay = result?.infectionDay ?? "—";
      const symptomDays = getSymptomDays(demoCase, result);
      const symptomText = symptomDays.length ? symptomDays.join(", ") : "—";

      const criteriaHtml = summarizeCriteria(demoCase, result);

      // 4) 細節：先放 Evidence（不破版），再放 reasons
      const evidenceHtml = await buildEvidenceHtml(demo);
      const detailHtml = `
        ${evidenceHtml}
        <details>
          <summary> 判斷依據（原始紀錄）</summary>
          
          <pre class="mono" style="white-space:pre-wrap;margin-top:6px;">${esc(JSON.stringify(result?.reasons || [], null, 2))}</pre>
        </details>
      `;

      // === 這裡一定要輸出 10 個 <td>，對齊你的 <th> ===
      tr.innerHTML = `
        <td>
          <div style="font-weight:600;">${esc(demo.title)}</div>
          <div class="mono" style="font-size:12px;color:#475569;">
            ${esc(demo.patientRef)}
          </div>
        </td>
        <td class="mono">${esc(age)}</td>
        <td>${esc(sex)}</td>
        <td class="mono">${esc(labDate)}</td>
        <td class="mono">${esc(infectionDay)}</td>
        <td class="mono">${esc(symptomText)}</td>
        <td>${decisionLabel(result)}</td>
        <td class="mono">${criteriaHtml}</td>
        <td>${detailHtml}</td>
      `;

      tbody.appendChild(tr);

    } catch (e) {
      tr.innerHTML = `
        <td>
          <div style="font-weight:600;">${esc(demo.title)}</div>
          <div class="mono" style="font-size:12px;color:#475569;">
            ${esc(demo.patientRef)}
          </div>
        </td>
        <td colspan="9" style="color:#c00">❌ 錯誤：${esc(e.message)}</td>
      `;
      tbody.appendChild(tr);
    }
  }
}

if (el("btn-run")) el("btn-run").addEventListener("click", run);
run();
