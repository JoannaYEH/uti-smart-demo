// 離線 demo 的主程式

import { evaluateUtiCase } from "./uti_rules.js";

const DEMOS = [
  {
    id: "case_1a_catheter_ge1_fever_retention",
    title: "✅ 1a：≥1歲 + 有導管(≥3日) + 發燒 + 尿滯留徵象(±3天內)",
    expected: "1a",
    case: {
      admitDate: "2025-12-10",
      labDate: "2025-12-13",
      symptomDates: [],

      ageYears: 40,
      tempC: 38.6,

      // 導管 4 天，感染日落在期間內 => 有導管
      catheterPeriods: [{ start: "2025-12-10", end: "2025-12-13" }],

      // 尿滯留徵象：補進 symptomDates（-1）=> 感染日=12/12
      urinaryRetentionDate: "2025-12-12",
      hasBladderScanOrStraightCath: true,
      nursingNoteText: "膀胱掃描顯示尿量 120 mL，評估單導。",

      infantKeywordsHit: false,
      urinaryOtherSymptom: null
    }
  },

  {
    id: "case_1b_nocatheter_ge1_fever_retention",
    title: "✅ 1b：≥1歲 + 無導管 + 發燒 + 尿滯留徵象(±3天內)",
    expected: "1b",
    case: {
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
    id: "case_2a_infant_catheter_hypothermia_keywords",
    title: "✅ 2a：<1歲 + 有導管(≥3日) + 低體溫/發燒 + 關鍵字(嗜睡/嘔吐/呼吸暫停)",
    expected: "2a",
    case: {
      admitDate: "2025-12-01",
      labDate: "2025-12-04",
      // <1歲仍需要 ±3 天內有徵象；這裡用 symptomDates 直接給
      symptomDates: ["2025-12-04"],

      ageYears: 0.3,
      tempC: 35.8,

      catheterPeriods: [{ start: "2025-12-01", end: "2025-12-04" }],

      infantKeywordsHit: true,

      // 尿滯留對嬰兒不主打，但欄位留空不影響
      urinaryRetentionDate: null,
      hasBladderScanOrStraightCath: false,
      nursingNoteText: "",
      urinaryOtherSymptom: null
    }
  },

  {
    id: "case_2b_infant_nocatheter_fever_keywords",
    title: "✅ 2b：<1歲 + 無導管 + 發燒/低體溫 + 關鍵字(嗜睡/嘔吐/呼吸暫停)",
    expected: "2b",
    case: {
      admitDate: "2025-12-01",
      labDate: "2025-12-04",
      symptomDates: ["2025-12-05"], // 0~+3 => 感染日=檢驗日 12/04

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
    id: "exclude_admit_day_1_2",
    title: "❌ 排除：感染日落在入院第1–2天（直接排除）",
    expected: "exclude",
    case: {
      admitDate: "2025-12-10",
      labDate: "2025-12-11",
      symptomDates: ["2025-12-11"], // 感染日=檢驗日=12/11 => 入院第2天

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
    id: "exclude_gt65_nocatheter_fever_only",
    title: "❌ 排除：>65 無導管只有發燒，無其他泌尿徵象（不收案）",
    expected: "exclude",
    case: {
      admitDate: "2025-12-10",
      labDate: "2025-12-13",
      symptomDates: ["2025-12-13"], // 有徵象窗（用發燒那天當成 symptomDates 也可）

      ageYears: 70,
      tempC: 38.6,

      catheterPeriods: [],

      // 沒有尿滯留、也沒有其他泌尿徵象
      urinaryRetentionDate: null,
      hasBladderScanOrStraightCath: false,
      nursingNoteText: "",
      urinaryOtherSymptom: false,

      infantKeywordsHit: false
    }
  }
];

function ensureUi() {
  // 在 index.html 既有的 status/output 上方插入一個 panel
  let panel = document.getElementById("demo-panel");
  if (panel) return panel;

  panel = document.createElement("div");
  panel.id = "demo-panel";
  panel.style.marginBottom = "16px";
  panel.style.padding = "12px";
  panel.style.border = "1px solid #ddd";
  panel.style.borderRadius = "10px";
  panel.style.background = "#fff";

  const label = document.createElement("label");
  label.textContent = "選擇 Demo 案例：";
  label.style.fontWeight = "700";
  label.style.marginRight = "8px";

  const select = document.createElement("select");
  select.id = "demo-select";
  select.style.padding = "6px 10px";
  select.style.borderRadius = "8px";
  select.style.border = "1px solid #ccc";
  select.style.minWidth = "520px";

  for (const d of DEMOS) {
    const opt = document.createElement("option");
    opt.value = d.id;
    opt.textContent = d.title;
    select.appendChild(opt);
  }

  const hint = document.createElement("div");
  hint.id = "demo-hint";
  hint.style.marginTop = "10px";
  hint.style.fontSize = "14px";
  hint.style.color = "#555";

  panel.appendChild(label);
  panel.appendChild(select);
  panel.appendChild(hint);

  const statusEl = document.getElementById("status");
  statusEl.parentNode.insertBefore(panel, statusEl);

  return panel;
}

function renderResult(demo, result) {
  const statusEl = document.getElementById("status");
  const outEl = document.getElementById("output");
  const hintEl = document.getElementById("demo-hint");

  const expected = demo.expected;
  const got = result.ok ? result.category : "exclude";
  const pass = expected === got;

  hintEl.textContent = `預期：${expected}｜實際：${got}｜感染日：${result.infectionDay ?? "(無)"}｜導管：${result.hasCatheter ?? "(無)"}｜比對：${pass ? "✅" : "⚠️"}`;

  statusEl.innerHTML = result.ok
    ? `✅ 收案成功：category=${result.category}, infectionDay=${result.infectionDay}`
    : `❌ 未收案（請看 reasons）`;

  outEl.textContent = JSON.stringify(
    { selected: demo.id, title: demo.title, expected: demo.expected, input: demo.case, result },
    null,
    2
  );
}

function runSelected(id) {
  const demo = DEMOS.find(d => d.id === id) || DEMOS[0];

  // 深拷貝避免 evaluate 內部修改 input 造成下次選取被污染
  const input = JSON.parse(JSON.stringify(demo.case));
  const result = evaluateUtiCase(input);
  renderResult(demo, result);
}

(function main() {
  ensureUi();
  const select = document.getElementById("demo-select");

  select.addEventListener("change", () => runSelected(select.value));

  // default run
  runSelected(select.value);
})();
