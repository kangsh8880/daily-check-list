// ============================================================================
// 점검 이력 조회 - 날짜/부품/점검자/결과 필터 + 상세보기
// ============================================================================
let ALL_PARTS=[], ALL_TYPES=[], ALL_INSPECTORS=[], RANGE_INSPECTIONS=[];

document.addEventListener("DOMContentLoaded", async function(){
  const insp = DCL.initPage("history.html", null);
  if (!insp) return;

  const today = DCL.today();
  document.getElementById("filterStartDate").value = shiftDate(today, -29);
  document.getElementById("filterEndDate").value = today;

  document.getElementById("rangeTodayBtn").addEventListener("click", function(){ setRange(today, today); });
  document.getElementById("range7Btn").addEventListener("click", function(){ setRange(shiftDate(today,-6), today); });
  document.getElementById("range30Btn").addEventListener("click", function(){ setRange(shiftDate(today,-29), today); });
  document.getElementById("filterStartDate").addEventListener("change", loadRange);
  document.getElementById("filterEndDate").addEventListener("change", loadRange);
  document.getElementById("filterPartCode").addEventListener("change", function(){ syncPartSelect("filterPartCode", "filterPartName"); });
  document.getElementById("filterPartName").addEventListener("change", function(){ syncPartSelect("filterPartName", "filterPartCode"); });
  document.getElementById("filterInspector").addEventListener("change", renderTable);
  document.getElementById("filterResult").addEventListener("change", renderTable);

  await loadMasters();
  await loadRange();
});

// dateStr(YYYY-MM-DD)에 UTC 자정 기준으로 일수를 더함/뺌 (타임존 흔들림 방지)
function shiftDate(dateStr, days){
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0,10);
}

function setRange(start, end){
  document.getElementById("filterStartDate").value = start;
  document.getElementById("filterEndDate").value = end;
  loadRange();
}

async function loadMasters(){
  [ALL_PARTS, ALL_TYPES, ALL_INSPECTORS] = await Promise.all([
    DCL.select("parts", q => q.eq("is_deleted", false)),
    DCL.select("part_types", q => q.eq("is_active", true).order("type_name")),
    DCL.select("inspectors", q => q.eq("is_active", true).order("name"))
  ]);
  const sel = document.getElementById("filterInspector");
  sel.innerHTML = `<option value="">${DCL.t("common.all")}</option>` + ALL_INSPECTORS.map(i=>`<option value="${i.id}">${esc(i.name)}</option>`).join("");

  const byCode = ALL_PARTS.slice().sort((a,b)=>String(a.part_code||"").localeCompare(String(b.part_code||"")));
  const byName = ALL_PARTS.slice().sort((a,b)=>String(a.part_name||"").localeCompare(String(b.part_name||"")));
  const codeSel = document.getElementById("filterPartCode");
  const nameSel = document.getElementById("filterPartName");
  codeSel.innerHTML = `<option value="">${DCL.t("common.all")}</option>` + byCode.map(p=>`<option value="${p.id}">${esc(p.part_code||"-")}</option>`).join("");
  nameSel.innerHTML = `<option value="">${DCL.t("common.all")}</option>` + byName.map(p=>`<option value="${p.id}">${esc(p.part_name||"-")}</option>`).join("");
}

// 부품코드/부품명 select는 1개 부품을 가리키는 짝(id 동일)이므로, 한쪽을 고르면 다른 쪽도 같은 부품으로 맞춘다.
function syncPartSelect(sourceId, targetId){
  document.getElementById(targetId).value = document.getElementById(sourceId).value;
  renderTable();
}

// 날짜 범위는 서버(Supabase) 조회 시점에 필터링 (데이터량 방어) - 부품/점검자/결과는 클라이언트에서 필터링
async function loadRange(){
  const start = document.getElementById("filterStartDate").value;
  const end = document.getElementById("filterEndDate").value;
  if (!start || !end) return;
  if (start > end) { DCL.toast(DCL.t("page.history.startAfterEnd"), "err"); return; }
  document.getElementById("historyBody").innerHTML = `<tr><td colspan="8" class="empty-state">${DCL.t("common.loading")}</td></tr>`;
  RANGE_INSPECTIONS = await DCL.select("inspections", q => q.gte("inspect_date", start).lte("inspect_date", end).order("inspected_at", {ascending:false}));
  renderTable();
}

function renderTable(){
  const partId = document.getElementById("filterPartCode").value || document.getElementById("filterPartName").value;
  const inspectorId = document.getElementById("filterInspector").value;
  const result = document.getElementById("filterResult").value;
  const partMap = Object.fromEntries(ALL_PARTS.map(p=>[p.id,p]));
  const typeMap = Object.fromEntries(ALL_TYPES.map(t=>[t.id,t]));
  const inspMap = Object.fromEntries(ALL_INSPECTORS.map(i=>[i.id,i]));

  let list = RANGE_INSPECTIONS.slice();
  if (inspectorId) list = list.filter(i=>i.inspector_id===inspectorId);
  if (result) list = list.filter(i=>i.overall_result===result);
  if (partId) list = list.filter(i=>i.part_id===partId);

  const abnCnt = list.filter(i=>i.overall_result==="ABNORMAL").length;
  document.getElementById("resultSummary").textContent = DCL.t("page.history.summary", {total: DCL.fmtCount(list.length), abn: DCL.fmtCount(abnCnt)});

  const body = document.getElementById("historyBody");
  if (!list.length) { body.innerHTML = `<tr><td colspan="8" class="empty-state">${DCL.t("page.history.emptyList")}</td></tr>`; return; }
  body.innerHTML = list.map(i=>{
    const p = partMap[i.part_id] || {};
    const t = typeMap[p.part_type_id];
    const insp = inspMap[i.inspector_id];
    const resultBadge = i.overall_result === "ABNORMAL" ? `<span class="badge badge-red">${DCL.t("result.ABNORMAL")}</span>` : `<span class="badge badge-green">${DCL.t("result.NORMAL")}</span>`;
    return `<tr>
      <td class="text-mute">${DCL.fmtDateTime(i.inspected_at)}</td>
      <td class="mono"><b>${esc(p.part_code||"-")}</b></td>
      <td>${esc(p.part_name||"-")}</td>
      <td class="text-mute">${esc(t?t.type_name:"-")}</td>
      <td>${esc(insp?insp.name:"-")}</td>
      <td>${resultBadge}</td>
      <td class="text-mute" style="max-width:200px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${esc(i.note||"-")}</td>
      <td><button class="btn btn-sm" onclick="showDetail('${i.id}')">${DCL.t("page.history.viewBtn")}</button></td>
    </tr>`;
  }).join("");
}

async function showDetail(id){
  const insp0 = RANGE_INSPECTIONS.find(i=>i.id===id);
  if (!insp0) return;
  const partMap = Object.fromEntries(ALL_PARTS.map(p=>[p.id,p]));
  const inspMap = Object.fromEntries(ALL_INSPECTORS.map(i=>[i.id,i]));
  const p = partMap[insp0.part_id] || {};
  const insp = inspMap[insp0.inspector_id];

  const body = document.getElementById("detailBody");
  body.innerHTML = `<div class="empty-state">${DCL.t("common.loading")}</div>`;
  DCL.openModal("detailModalOverlay");

  const [results, actions] = await Promise.all([
    DCL.select("inspection_results", q => q.eq("inspection_id", id)),
    DCL.select("actions", q => q.eq("inspection_id", id))
  ]);

  const resultRows = results.map(r=>{
    const badge = r.judge_result === "ABNORMAL" ? `<span class="badge badge-red">${DCL.t("result.ABNORMAL")}</span>` : `<span class="badge badge-green">${DCL.t("result.NORMAL")}</span>`;
    return `<tr><td>${esc(r.item_name)}</td><td class="mono">${esc(r.input_value||"-")}</td><td>${badge}</td></tr>`;
  }).join("");

  const actionRows = actions.length ? actions.map(a=>{
    const statusLabel = {OPEN:DCL.t("status.OPEN"), IN_PROGRESS:DCL.t("status.IN_PROGRESS"), DONE:DCL.t("status.DONE"), APPROVED:DCL.t("status.APPROVED"), REJECTED:DCL.t("status.REJECTED")}[a.status] || a.status;
    // 점검자와 조치 담당자는 다를 수 있으므로, 조치 상태 옆에 담당자 이름을 함께 표기한다.
    // 조치 담당자가 아직 미배정인 경우, 담당자가 지정되기 전까지는 점검자를 그대로
    // 조치자로 표기한다 (담당자가 지정되면 그 인원 이름으로 바뀐다).
    const assigneeName = a.assignee_id ? esc(inspMap[a.assignee_id]?.name || "-") : esc(insp?.name || DCL.t("common.unassigned"));
    return `<div class="text-mute fs-xs" style="margin-top:4px;">└ ${esc(a.issue_desc)} → <b>${esc(statusLabel)}</b> (${DCL.t("common.col.assignee")}: ${assigneeName})</div>`;
  }).join("") : "";

  body.innerHTML = `
    <div class="flex-between" style="margin-bottom:8px;">
      <div>
        <div class="mono fw-800 fs-md">${esc(p.part_code||"-")}</div>
        <div>${esc(p.part_name||"-")}</div>
      </div>
      <div class="text-mute fs-xs" style="text-align:right;">
        <div>${DCL.fmtDateTime(insp0.inspected_at)}</div>
        <div>${esc(insp?insp.name:"-")}</div>
      </div>
    </div>
    <div class="table-wrap">
      <table><thead><tr><th>${DCL.t("page.history.checklistItemCol")}</th><th>${DCL.t("page.history.measuredValueCol")}</th><th>${DCL.t("page.history.judgeCol")}</th></tr></thead>
      <tbody>${resultRows || `<tr><td colspan="3" class="empty-state">${DCL.t("page.history.noItemDetail")}</td></tr>`}</tbody></table>
    </div>
    ${insp0.note ? `<div class="form-row mt-14 mb-0"><label>${DCL.t("page.history.overallNote")}</label><div>${esc(insp0.note)}</div></div>` : ""}
    ${actionRows ? `<div class="divider"></div><div class="hint fs-xs fw-700" style="margin-bottom:4px;">${DCL.t("page.history.relatedAction")}</div>${actionRows}` : ""}
  `;
}

function esc(s){ return String(s??"").replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
