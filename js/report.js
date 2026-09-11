// ============================================================================
// 일일보고 - 1)전일 점검현황 2)금일 점검계획 현황 3)명일 점검계획 준비사항
// 조회일(REF_DATE)을 기준으로 세 블록이 함께 이동한다 (조회일=금일, 전일=조회일-1, 명일=조회일+1).
// 관리자(admin) 전용 화면.
// ============================================================================
let ALL_PARTS=[], ALL_TYPES=[], ALL_INSPECTORS=[], ALL_ASSIGNMENTS=[], ALL_ACTIONS=[];
let RANGE_INSPECTIONS=[];
let REF_DATE = "";
let STATE = { y:{}, t:{}, tmr:{} }; // 팝업 렌더링에 쓰는 최근 계산 결과 보관

const SEV_BADGE = { MINOR:()=>`<span class="badge badge-gray">${DCL.t("sev.MINOR")}</span>`, MAJOR:()=>`<span class="badge badge-yellow">${DCL.t("sev.MAJOR")}</span>`, CRITICAL:()=>`<span class="badge badge-red">${DCL.t("sev.CRITICAL")}</span>` };
const STATUS_BADGE = { OPEN:()=>`<span class="badge badge-red">${DCL.t("status.OPEN")}</span>`, IN_PROGRESS:()=>`<span class="badge badge-yellow">${DCL.t("status.IN_PROGRESS")}</span>`, DONE:()=>`<span class="badge badge-blue">${DCL.t("status.DONE")}</span>`, APPROVED:()=>`<span class="badge badge-green">${DCL.t("status.APPROVED")}</span>`, REJECTED:()=>`<span class="badge badge-red">${DCL.t("status.REJECTED")}</span>` };

document.addEventListener("DOMContentLoaded", async function(){
  const insp = DCL.initPage("report.html", { roles:["admin"] });
  if (!insp) return;

  REF_DATE = DCL.today();
  document.getElementById("refDateInput").value = REF_DATE;

  document.getElementById("refDateInput").addEventListener("change", function(){
    if (!this.value) return;
    REF_DATE = this.value;
    reloadAndRender();
  });
  document.getElementById("prevDayBtn").addEventListener("click", function(){ setRefDate(shiftDate(REF_DATE, -1)); });
  document.getElementById("nextDayBtn").addEventListener("click", function(){ setRefDate(shiftDate(REF_DATE, 1)); });
  document.getElementById("todayBtn").addEventListener("click", function(){ setRefDate(DCL.today()); });

  wireKpiTileClicks();

  await loadMasters();
  await reloadAndRender();
});

function setRefDate(dateStr){
  REF_DATE = dateStr;
  document.getElementById("refDateInput").value = dateStr;
  reloadAndRender();
}

// dateStr(YYYY-MM-DD)에 UTC 자정 기준으로 일수를 더함/뺌 (타임존 흔들림 방지, history.js와 동일한 방식)
function shiftDate(dateStr, days){
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0,10);
}

// ---- 점검주기(cycle_type) 대상 판정 - dashboard.js와 동일한 로직 (부품유형/배정과 무관하게
// 사용중(IN_USE) 부품 전체를 "대상"으로 본다) ------------------------------------------------
function targetPartIds(){
  return ALL_PARTS.filter(p => p.status === "IN_USE").map(p=>p.id);
}
function duePartIdsOn(dateStr){
  const partMap = Object.fromEntries(ALL_PARTS.map(p=>[p.id,p]));
  return targetPartIds().filter(id => DCL.isDueOn(partMap[id], dateStr));
}

async function loadMasters(){
  [ALL_PARTS, ALL_TYPES, ALL_INSPECTORS, ALL_ASSIGNMENTS, ALL_ACTIONS] = await Promise.all([
    DCL.select("parts", q => q.eq("is_deleted", false)),
    DCL.select("part_types", q => q.eq("is_active", true)),
    DCL.select("inspectors", q => q.eq("is_active", true).order("name")),
    DCL.select("assignments", q => q.eq("is_active", true)),
    DCL.select("actions", q => q.order("created_at", {ascending:false}))
  ]);
}

// 조회일이 바뀔 때마다(최초 로드 포함) 전일~명일 구간의 점검 기록을 다시 조회한 뒤 3블록을 렌더한다.
// (과거 조회일도 동일하게 지원 - inspections 조회 구간만 그 시점 기준으로 이동)
async function reloadAndRender(){
  const yesterday = shiftDate(REF_DATE, -1);
  const tomorrow = shiftDate(REF_DATE, 1);
  RANGE_INSPECTIONS = await DCL.select("inspections", q => q.gte("inspect_date", yesterday).lte("inspect_date", tomorrow));
  renderBlockLabels();
  renderBlock1(yesterday);
  renderBlock2(REF_DATE);
  renderBlock3(tomorrow);
}

function dateSuffix(dateStr){
  const wd = new Date(dateStr + "T00:00:00Z").getUTCDay();
  return DCL.t("page.report.blockDateSuffix", { date: dateStr, weekday: DCL.weekdayLabel(wd) });
}
function renderBlockLabels(){
  document.getElementById("block1DateLabel").textContent = dateSuffix(shiftDate(REF_DATE,-1));
  document.getElementById("block2DateLabel").textContent = dateSuffix(REF_DATE);
  document.getElementById("block3DateLabel").textContent = dateSuffix(shiftDate(REF_DATE,1));
}

// ---- 1. 전일 점검현황 ----------------------------------------------------------
function renderBlock1(yesterday){
  const dueIds = duePartIdsOn(yesterday);
  const yInspections = RANGE_INSPECTIONS.filter(i=>i.inspect_date===yesterday);
  const doneIds = new Set(yInspections.map(i=>i.part_id));
  const doneCnt = dueIds.filter(id=>doneIds.has(id)).length;
  const targetCnt = dueIds.length;
  const rate = targetCnt ? (doneCnt/targetCnt*100) : 0;

  document.getElementById("kpiYRate").textContent = DCL.fmtPercent(rate);
  document.getElementById("kpiYRateSub").textContent = DCL.t("page.report.rateSub", { done: DCL.fmtCount(doneCnt), target: DCL.fmtCount(targetCnt) });

  const abnList = yInspections.filter(i=>i.overall_result==="ABNORMAL");
  document.getElementById("kpiYAbn").textContent = DCL.fmtCount(abnList.length);

  // 미조치/미승인: 조회일(전일) 이전에 등록된 조치 중, 현재 상태 기준으로 아직 미해결인 건수(누적).
  // 조치 상태 변경 이력은 별도 테이블로 기록되지 않으므로, 과거 시점 스냅샷이 아닌 "현재 상태" 기준 집계다.
  const openActions = ALL_ACTIONS.filter(a => (a.created_at||"").slice(0,10) <= yesterday && ["OPEN","IN_PROGRESS"].includes(a.status));
  const unapprovedActions = ALL_ACTIONS.filter(a => (a.created_at||"").slice(0,10) <= yesterday && a.status === "DONE");
  document.getElementById("kpiYOpen").textContent = DCL.fmtCount(openActions.length);
  document.getElementById("kpiYUnapproved").textContent = DCL.fmtCount(unapprovedActions.length);

  STATE.y = { yesterday, dueIds, doneIds, yInspections, abnList, openActions, unapprovedActions };
}

// ---- 2. 금일 점검계획 현황 ------------------------------------------------------
function renderBlock2(today){
  const dueIds = duePartIdsOn(today);
  const tInspections = RANGE_INSPECTIONS.filter(i=>i.inspect_date===today);
  const doneIds = new Set(tInspections.map(i=>i.part_id));
  const doneCnt = dueIds.filter(id=>doneIds.has(id)).length;
  const targetCnt = dueIds.length;
  const remainCnt = targetCnt - doneCnt;
  const rate = targetCnt ? (doneCnt/targetCnt*100) : 0;

  document.getElementById("kpiTTarget").textContent = DCL.fmtCount(targetCnt);
  document.getElementById("kpiTDone").textContent = DCL.fmtCount(doneCnt);
  document.getElementById("kpiTRemain").textContent = DCL.fmtCount(remainCnt);
  document.getElementById("kpiTRate").textContent = DCL.fmtPercent(rate);

  const remainList = dueIds.filter(id=>!doneIds.has(id));
  STATE.t = { today, dueIds, doneIds, remainList, tInspections };

  renderByInspectorTable(dueIds, doneIds);
}

function renderByInspectorTable(dueIds, doneIds){
  const dueSet = new Set(dueIds);
  const rows = ALL_INSPECTORS.map(insp=>{
    const myPartIds = ALL_ASSIGNMENTS.filter(a=>a.inspector_id===insp.id).map(a=>a.part_id);
    const myDueIds = myPartIds.filter(id=>dueSet.has(id));
    if (!myDueIds.length) return null;
    const myDoneCnt = myDueIds.filter(id=>doneIds.has(id)).length;
    const myRemainCnt = myDueIds.length - myDoneCnt;
    const myRate = myDueIds.length ? (myDoneCnt/myDueIds.length*100) : 0;
    return { name: insp.name, assigned: myDueIds.length, done: myDoneCnt, remain: myRemainCnt, rate: myRate };
  }).filter(Boolean).sort((a,b)=> b.remain - a.remain || a.name.localeCompare(b.name));

  const body = document.getElementById("byInspectorBody");
  body.innerHTML = rows.length ? rows.map(r=>`
    <tr>
      <td>${esc(r.name)}</td>
      <td class="mono">${DCL.fmtCount(r.assigned)}</td>
      <td class="mono">${DCL.fmtCount(r.done)}</td>
      <td class="mono ${r.remain>0?'text-red':''}">${DCL.fmtCount(r.remain)}</td>
      <td class="mono">${DCL.fmtPercent(r.rate)}</td>
    </tr>`).join("")
    : `<tr><td colspan="5" class="empty-state">${DCL.t("page.report.emptyList")}</td></tr>`;
}

// ---- 3. 명일 점검계획 준비사항 --------------------------------------------------
// 부품/조치 목록은 화면에 항상 펼쳐두지 않고, 아래 두 KPI 타일 클릭 시 공용 팝업으로만 보여준다.
function renderBlock3(tomorrow){
  const dueIds = duePartIdsOn(tomorrow);
  document.getElementById("kpiTmrTarget").textContent = DCL.fmtCount(dueIds.length);

  const dueActions = ALL_ACTIONS.filter(a => a.due_date === tomorrow && ["OPEN","IN_PROGRESS"].includes(a.status));
  document.getElementById("kpiTmrDueAction").textContent = DCL.fmtCount(dueActions.length);

  STATE.tmr = { tomorrow, dueIds, dueActions };
}

// ---- KPI 타일 클릭 → 상세 목록 팝업 (대시보드 구축 원칙 - 공용 모달 재사용) ------------------
function wireKpiTileClicks(){
  document.querySelectorAll(".kpi-tile[data-kpi]").forEach(function(tile){
    tile.addEventListener("click", function(){ openKpiListModal(tile.dataset.kpi); });
  });
}

async function openKpiListModal(kind){
  const partMap = Object.fromEntries(ALL_PARTS.map(p=>[p.id,p]));
  const inspMap = Object.fromEntries(ALL_INSPECTORS.map(i=>[i.id,i]));
  let title = "", head = "", rows = "";

  if (kind === "y_rate") {
    title = DCL.t("page.report.rateModalTitle");
    head = `<tr><th>${DCL.t("common.col.partCode")}</th><th>${DCL.t("common.col.partName")}</th><th>${DCL.t("common.col.status")}</th></tr>`;
    rows = STATE.y.dueIds.map(id=>{
      const p = partMap[id]; if (!p) return "";
      const done = STATE.y.doneIds.has(id);
      return `<tr><td class="mono"><b>${esc(p.part_code)}</b></td><td>${esc(p.part_name)}</td><td>${done ? `<span class="badge badge-green">${DCL.t("page.inspect.doneComplete")}</span>` : `<span class="badge badge-yellow">${DCL.t("page.inspect.notDoneYet")}</span>`}</td></tr>`;
    }).join("");
  } else if (kind === "y_abn") {
    title = DCL.t("page.report.abnModalTitle");
    head = `<tr><th>${DCL.t("common.col.partCode")}</th><th>${DCL.t("common.col.partName")}</th><th>${DCL.t("common.inspectorLabel")}</th><th>${DCL.t("common.col.note")}</th></tr>`;
    const abnIds = STATE.y.abnList.map(i=>i.id);
    // 비고란: 점검 메모(note, 대부분 미입력)가 아니라 실제로 "이상"으로 판정된 점검항목명과 측정값을 표시
    const abnResults = abnIds.length
      ? await DCL.select("inspection_results", q => q.in("inspection_id", abnIds).eq("judge_result", "ABNORMAL"))
      : [];
    const resultsByInspection = {};
    abnResults.forEach(r=>{ (resultsByInspection[r.inspection_id]=resultsByInspection[r.inspection_id]||[]).push(r); });
    rows = STATE.y.abnList.map(i=>{
      const p = partMap[i.part_id];
      const items = (resultsByInspection[i.id]||[])
        .map(r=>`${esc(r.item_name)}: ${esc(r.input_value ?? "-")}`)
        .join(", ");
      return `<tr><td class="mono"><b>${p?esc(p.part_code):"-"}</b></td><td>${p?esc(p.part_name):"-"}</td><td class="text-mute">${esc(inspMap[i.inspector_id]?.name||"-")}</td><td class="text-mute" style="max-width:260px;">${items || "-"}</td></tr>`;
    }).join("");
  } else if (kind === "y_open") {
    title = DCL.t("page.report.openActionModalTitle");
    head = `<tr><th>${DCL.t("common.col.part")}</th><th>${DCL.t("page.actions.colIssue")}</th><th>${DCL.t("common.severityLabel")}</th><th>${DCL.t("common.col.assignee")}</th><th>${DCL.t("common.col.dueDate")}</th><th>${DCL.t("common.col.status")}</th></tr>`;
    rows = STATE.y.openActions.map(a=>{
      const p = partMap[a.part_id];
      const assigneeName = a.assignee_id ? esc(inspMap[a.assignee_id]?.name||"-") : DCL.t("common.unassigned");
      return `<tr><td><b>${p?esc(p.part_name):"-"}</b><div class="text-mute mono fs-xs">${p?esc(p.part_code):""}</div></td><td style="max-width:220px;">${esc(a.issue_desc)}</td><td>${SEV_BADGE[a.severity]?SEV_BADGE[a.severity]():"-"}</td><td>${assigneeName}</td><td>${DCL.fmtDate(a.due_date)}</td><td>${STATUS_BADGE[a.status]?STATUS_BADGE[a.status]():"-"}</td></tr>`;
    }).join("");
  } else if (kind === "y_unapproved") {
    title = DCL.t("page.report.unapprovedModalTitle");
    head = `<tr><th>${DCL.t("common.col.part")}</th><th>${DCL.t("page.actions.colIssue")}</th><th>${DCL.t("common.col.assignee")}</th><th>${DCL.t("page.report.completedAtCol")}</th></tr>`;
    rows = STATE.y.unapprovedActions.map(a=>{
      const p = partMap[a.part_id];
      const assigneeName = a.assignee_id ? esc(inspMap[a.assignee_id]?.name||"-") : DCL.t("common.unassigned");
      return `<tr><td><b>${p?esc(p.part_name):"-"}</b><div class="text-mute mono fs-xs">${p?esc(p.part_code):""}</div></td><td style="max-width:220px;">${esc(a.issue_desc)}</td><td>${assigneeName}</td><td>${DCL.fmtDate(a.completed_at)}</td></tr>`;
    }).join("");
  } else if (kind === "t_remain") {
    title = DCL.t("page.report.remainModalTitle");
    head = `<tr><th>${DCL.t("common.col.partCode")}</th><th>${DCL.t("common.col.partName")}</th><th>${DCL.t("common.col.assignee")}</th></tr>`;
    const assignByPart = {};
    ALL_ASSIGNMENTS.forEach(a=>{ (assignByPart[a.part_id]=assignByPart[a.part_id]||[]).push(a.inspector_id); });
    rows = STATE.t.remainList.map(id=>{
      const p = partMap[id]; if (!p) return "";
      const names = (assignByPart[id]||[]).map(iid=>inspMap[iid]?.name).filter(Boolean).join(", ") || DCL.t("common.unassigned");
      return `<tr><td class="mono"><b>${esc(p.part_code)}</b></td><td>${esc(p.part_name)}</td><td class="text-mute">${esc(names)}</td></tr>`;
    }).join("");
  } else if (kind === "t_rate") {
    title = DCL.t("page.report.todayTargetModalTitle");
    head = `<tr><th>${DCL.t("common.col.partCode")}</th><th>${DCL.t("common.col.partName")}</th><th>${DCL.t("common.col.status")}</th></tr>`;
    rows = STATE.t.dueIds.map(id=>{
      const p = partMap[id]; if (!p) return "";
      const done = STATE.t.doneIds.has(id);
      return `<tr><td class="mono"><b>${esc(p.part_code)}</b></td><td>${esc(p.part_name)}</td><td>${done ? `<span class="badge badge-green">${DCL.t("page.inspect.doneComplete")}</span>` : `<span class="badge badge-yellow">${DCL.t("page.inspect.notDoneYet")}</span>`}</td></tr>`;
    }).join("");
  } else if (kind === "t_done") {
    title = DCL.t("page.report.todayDoneModalTitle");
    head = `<tr><th>${DCL.t("common.col.partCode")}</th><th>${DCL.t("common.col.partName")}</th><th>${DCL.t("common.inspectorLabel")}</th><th>${DCL.t("common.resultLabel")}</th></tr>`;
    rows = STATE.t.tInspections.map(i=>{
      const p = partMap[i.part_id];
      const resultBadge = i.overall_result === "ABNORMAL" ? `<span class="badge badge-red">${DCL.t("result.ABNORMAL")}</span>` : `<span class="badge badge-green">${DCL.t("result.NORMAL")}</span>`;
      return `<tr><td class="mono"><b>${p?esc(p.part_code):"-"}</b></td><td>${p?esc(p.part_name):"-"}</td><td class="text-mute">${esc(inspMap[i.inspector_id]?.name||"-")}</td><td>${resultBadge}</td></tr>`;
    }).join("");
  } else if (kind === "tmr_parts") {
    title = DCL.t("page.report.tomorrowPartsTitle");
    head = `<tr><th>${DCL.t("common.col.partCode")}</th><th>${DCL.t("common.col.partName")}</th><th>${DCL.t("common.col.type")}</th><th>${DCL.t("common.col.assignee")}</th></tr>`;
    const typeMap = Object.fromEntries(ALL_TYPES.map(t=>[t.id,t]));
    const assignByPart = {};
    ALL_ASSIGNMENTS.forEach(a=>{ (assignByPart[a.part_id]=assignByPart[a.part_id]||[]).push(a.inspector_id); });
    rows = STATE.tmr.dueIds.map(id=>{
      const p = partMap[id]; if (!p) return "";
      const t = typeMap[p.part_type_id];
      const names = (assignByPart[id]||[]).map(iid=>inspMap[iid]?.name).filter(Boolean);
      const assigneeHtml = names.length ? esc(names.join(", ")) : `<span class="badge badge-red">${DCL.t("common.unassignedBadge")}</span>`;
      return `<tr><td class="mono"><b>${esc(p.part_code)}</b></td><td>${esc(p.part_name)}</td><td class="text-mute">${esc(t?t.type_name:"-")}</td><td>${assigneeHtml}</td></tr>`;
    }).join("");
  } else if (kind === "tmr_actions") {
    title = DCL.t("page.report.tomorrowActionsTitle");
    head = `<tr><th>${DCL.t("common.col.part")}</th><th>${DCL.t("page.actions.colIssue")}</th><th>${DCL.t("common.severityLabel")}</th><th>${DCL.t("common.col.assignee")}</th></tr>`;
    rows = STATE.tmr.dueActions.map(a=>{
      const p = partMap[a.part_id];
      const assigneeName = a.assignee_id ? esc(inspMap[a.assignee_id]?.name||"-") : `<span class="badge badge-red">${DCL.t("common.unassignedBadge")}</span>`;
      return `<tr><td><b>${p?esc(p.part_name):"-"}</b><div class="text-mute mono fs-xs">${p?esc(p.part_code):""}</div></td><td style="max-width:260px;">${esc(a.issue_desc)}</td><td>${SEV_BADGE[a.severity]?SEV_BADGE[a.severity]():"-"}</td><td>${assigneeName}</td></tr>`;
    }).join("");
  }

  document.getElementById("kpiListModalTitle").textContent = title;
  document.getElementById("kpiListModalHead").innerHTML = head;
  document.getElementById("kpiListModalBody").innerHTML = rows || `<tr><td colspan="6" class="empty-state">${DCL.t("page.report.emptyList")}</td></tr>`;
  DCL.openModal("kpiListModalOverlay");
}

function esc(s){ return String(s??"").replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
