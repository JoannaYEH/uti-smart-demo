import { evaluateUtiCase } from "./uti_rules.js";

(async () => {
  const statusEl = document.getElementById("status");
  const outEl = document.getElementById("output");

  // 先跑規則引擎：不依賴 FHIR（這是你要的）
  const demoCase = {
    admitDate: "2025-12-10",     // 入院日 day1
    labDate: "2025-12-13",       // 檢驗日
    symptomDates: ["2025-12-12"],// 徵象在 -1 天 => 感染日=12/12
    ageYears: 70,
    tempC: 38.5,
    catheterPeriods: [],         // 無導管 => 走 1b
    infantKeywordsHit: false,
    urinaryOtherSymptom: true    // >65 無導管：必須有其他泌尿道徵象
  };

  const result = evaluateUtiCase(demoCase);

  statusEl.innerHTML = result.ok
    ? `✅ 規則引擎可運作：category=${result.category}, infectionDay=${result.infectionDay}`
    : `❌ 未收案（請看 reasons）`;

  outEl.textContent = JSON.stringify({ demoCase, result }, null, 2);
})();
