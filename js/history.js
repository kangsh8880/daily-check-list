// ============================================================================
// 점검 이력 조회 - 날짜/부품/점검자/결과 필터 + 상세보기
// ============================================================================
let ALL_PARTS=[], ALL_TYPES=[], ALL_INSPECTORS=[], RANGE_INSPECTIONS=[], RANGE_ACTIONS=[];

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
  document.getElementById("historyBody").innerHTML = `<tr><td colspan="9" class="empty-state">${DCL.t("common.loading")}</td></tr>`;
  RANGE_INSPECTIONS = await DCL.select("inspections", q => q.gte("inspect_date", start).lte("inspect_date", end).order("inspected_at", {ascending:false}));
  // 목록에서 "이상" 판정 건마다 조치 진행 상황(대기/조치중/완료-승인대기/승인완료/반려)이 한눈에 보이도록,
  // 해당 기간의 이상 판정 점검에 연결된 조치를 한 번에 조회해 둔다 (건별로 매번 조회하지 않음).
  const abnIds = RANGE_INSPECTIONS.filter(i=>i.overall_result==="ABNORMAL").map(i=>i.id);
  RANGE_ACTIONS = abnIds.length ? await DCL.select("actions", q => q.in("inspection_id", abnIds)) : [];
  renderTable();
}

// 점검(inspection) 1건에 이상 항목이 여러 개면 조치도 여러 건 연결될 수 있다. 목록의 "조치현황"
// 배지는 그중 가장 "처리가 필요한" 상태를 대표로 보여준다 (반려·미착수 조치가 하나라도 있으면
// 승인완료 건이 섞여 있어도 그 상태를 우선 노출해 놓치지 않도록).
const ACTION_STATUS_PRIORITY = ["REJECTED","OPEN","IN_PROGRESS","DONE","APPROVED"];
function worstActionStatus(actions){
  if (!actions.length) return null;
  let worst = actions[0].status;
  actions.forEach(a=>{ if (ACTION_STATUS_PRIORITY.indexOf(a.status) < ACTION_STATUS_PRIORITY.indexOf(worst)) worst = a.status; });
  return worst;
}
function actionStatusBadge(actions){
  if (!actions || !actions.length) return `<span class="text-mute">-</span>`;
  const worst = worstActionStatus(actions);
  const cls = { OPEN:"badge-red", IN_PROGRESS:"badge-yellow", DONE:"badge-blue", APPROVED:"badge-green", REJECTED:"badge-red" }[worst] || "badge-gray";
  const label = DCL.t("status."+worst);
  const more = actions.length > 1 ? ` <span class="text-mute fs-xs">(${DCL.t("page.history.actionCountSuffix",{n:actions.length})})</span>` : "";
  return `<span class="badge ${cls}">${esc(label)}</span>${more}`;
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
  if (!list.length) { body.innerHTML = `<tr><td colspan="9" class="empty-state">${DCL.t("page.history.emptyList")}</td></tr>`; return; }
  body.innerHTML = list.map(i=>{
    const p = partMap[i.part_id] || {};
    const t = typeMap[p.part_type_id];
    const insp = inspMap[i.inspector_id];
    const resultBadge = i.overall_result === "ABNORMAL" ? `<span class="badge badge-red">${DCL.t("result.ABNORMAL")}</span>` : `<span class="badge badge-green">${DCL.t("result.NORMAL")}</span>`;
    const myActions = RANGE_ACTIONS.filter(a=>a.inspection_id===i.id);
    return `<tr>
      <td class="text-mute">${DCL.fmtDateTime(i.inspected_at)}</td>
      <td class="mono"><b>${esc(p.part_code||"-")}</b></td>
      <td>${esc(p.part_name||"-")}</td>
      <td class="text-mute">${esc(t?t.type_name:"-")}</td>
      <td>${esc(insp?insp.name:"-")}</td>
      <td>${resultBadge}</td>
      <td>${actionStatusBadge(myActions)}</td>
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

  // "조치 관리" 화면 밖에서도 이 점검 건이 누구에게 배정되어, 누가 실제로 조치를 완료했고,
  // 누가 언제 승인/반려했는지(반려면 사유까지) 전체 처리 이력을 이 상세 팝업 하나로 바로 확인할 수 있어야
  // 한다 - 목록의 "조치현황" 배지는 상태만 보여주므로, 담당자·조치내용·승인자 등 과정 정보는 여기서 채운다.
  const statusBadgeCls = { OPEN:"badge-red", IN_PROGRESS:"badge-yellow", DONE:"badge-blue", APPROVED:"badge-green", REJECTED:"badge-red" };
  const actionRows = actions.length ? actions.map(a=>{
    const statusLabel = DCL.t("status."+a.status) || a.status;
    // 점검자와 조치 담당자는 다를 수 있으므로 별도 표기. 담당자가 아직 미배정이면 담당자가
    // 지정되기 전까지는 점검자를 그대로 조치자로 표기한다.
    const assigneeName = a.assignee_id ? esc(inspMap[a.assignee_id]?.name || "-") : esc(insp?.name || DCL.t("common.unassigned"));
    const completedByName = a.completed_by ? esc(inspMap[a.completed_by]?.name || "-") : "";
    const approvedByName = a.approved_by ? esc(inspMap[a.approved_by]?.name || "-") : "";

    let fields = `<div>${DCL.t("common.col.actionAssignee")}: <b>${assigneeName}</b></div>`;
    if (a.due_date) fields += `<div>${DCL.t("common.col.dueDate")}: ${DCL.fmtDate(a.due_date)}</div>`;
    if (a.completed_by) fields += `<div>${DCL.t("page.history.completedByLabel")}: <b>${completedByName}</b> (${DCL.fmtDateTime(a.completed_at)})</div>`;
    if (a.action_taken) fields += `<div>${DCL.t("page.actions.actionTakenViewLabel")}: ${esc(a.action_taken)}</div>`;
    if (a.approved_by) fields += `<div>${DCL.t("page.history.approvedByLabel")}: <b>${approvedByName}</b> (${DCL.fmtDateTime(a.approved_at)})</div>`;
    if (a.status === "REJECTED" && a.reject_reason) fields += `<div>${DCL.t("page.history.rejectReasonShortLabel")}: <span style="color:var(--accent-red);">${esc(a.reject_reason)}</span></div>`;

    return `<div style="border:1px solid var(--border); border-radius:8px; padding:8px 12px; margin-top:8px;">
      <div class="flex-between"><b>${esc(a.issue_desc)}</b><span class="badge ${statusBadgeCls[a.status]||'badge-gray'}">${esc(statusLabel)}</span></div>
      <div class="text-mute fs-xs" style="margin-top:6px; display:grid; grid-template-columns:1fr 1fr; gap:3px 12px;">${fields}</div>
    </div>`;
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
