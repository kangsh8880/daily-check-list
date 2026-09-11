// ============================================================================
// 대시보드 - KPI 타일(필터 미적용) + 추이차트(기간필터 적용)
// ============================================================================
let ALL_ASSIGNMENTS=[], ALL_PARTS=[], ALL_INSPECTIONS=[], ALL_ACTIONS=[], ALL_INSPECTORS=[];
let RATE_CHART=null, ABN_CHART=null, ACTION_CHART=null;
let KPI_NAMES = { rate:"점검율", abnormal:"이상 발견 건수", action:"조치 이행율" };
function refreshKpiNames(){
  KPI_NAMES = { rate: DCL.t("kpi.rate"), abnormal: DCL.t("kpi.abnormal"), action: DCL.t("kpi.action") };
}

document.addEventListener("DOMContentLoaded", async function(){
  const insp = DCL.initPage("dashboard.html", null);
  if (!insp) return;

  refreshKpiNames();
  // 차트 제목: KPI명 + " 추이" 동적 표시 (하드코딩 금지)
  document.getElementById("trendTitle1").textContent = DCL.t("common.trendTitle", {name: KPI_NAMES.rate});
  document.getElementById("trendTitle2").textContent = DCL.t("common.trendTitle", {name: KPI_NAMES.abnormal});
  document.getElementById("trendTitle3").textContent = DCL.t("common.trendTitle", {name: KPI_NAMES.action});

  document.getElementById("periodFilter").addEventListener("change", renderTrends);
  DCL.autoSelectFirst(document.getElementById("periodFilter"));

  await loadAll();
  renderTodayKpis();
  renderMyTaskKpis();
  renderTrends();
  wireKpiTileClicks();
});

async function loadAll(){
  const since = new Date(); since.setDate(since.getDate() - 91);
  const sinceStr = since.toISOString().slice(0,10);
  [ALL_ASSIGNMENTS, ALL_PARTS, ALL_INSPECTIONS, ALL_ACTIONS, ALL_INSPECTORS] = await Promise.all([
    DCL.select("assignments", q => q.eq("is_active", true)),
    DCL.select("parts", q => q.eq("is_deleted", false)),
    DCL.select("inspections", q => q.gte("inspect_date", sinceStr)),
    DCL.select("actions", q => q.gte("created_at", sinceStr)),
    DCL.select("inspectors", q => q.eq("is_active", true))
  ]);
}

// 점검율 "대상(분모)"은 담당자 배정 여부와 무관하게 사용중(IN_USE) 부품 전체로 판정.
// (담당자 배정은 "누가 점검할지"를 정하는 운영정보일 뿐, 점검율 집계 대상 여부와는 별개 개념)
function targetPartIds(){
  return ALL_PARTS.filter(p => p.status === "IN_USE").map(p=>p.id);
}

// 점검율 KPI에 왜 안 잡혔는지 근본원인 분류: 오늘이 점검주기 대상일이 아님 / 사용중 상태가 아님(보관중·폐기)
function classifyExcludedTodayInspections(todayInspections){
  const partMap = Object.fromEntries(ALL_PARTS.map(p=>[p.id,p]));
  const dueSet = new Set(duePartIdsOn(DCL.today()));
  let notDueCnt = 0, notInUseCnt = 0;
  todayInspections.forEach(i=>{
    if (dueSet.has(i.part_id)) return; // 정상 대상 -> 제외 아님
    const p = partMap[i.part_id];
    if (p && p.status !== "IN_USE") notInUseCnt++;
    else notDueCnt++;
  });
  return { notDueCnt, notInUseCnt };
}

// 배정된 부품 중 해당 날짜(dateStr)에 점검주기상 점검 대상인 부품만 필터링
function duePartIdsOn(dateStr){
  const partMap = Object.fromEntries(ALL_PARTS.map(p=>[p.id,p]));
  return targetPartIds().filter(id => DCL.isDueOn(partMap[id], dateStr));
}

// ---- 금일 KPI (필터 미적용) ---------------------------------------------------
let LAST_CTX = {};
function renderTodayKpis(){
  const today = DCL.today();
  const targetIds = duePartIdsOn(today);
  const todayInspections = ALL_INSPECTIONS.filter(i=>i.inspect_date===today);
  const doneIdsToday = new Set(todayInspections.map(i=>i.part_id));
  const doneCnt = targetIds.filter(id=>doneIdsToday.has(id)).length;
  const targetCnt = targetIds.length;
  const rate = targetCnt ? (doneCnt/targetCnt*100) : 0;
  // 점검율(대상/완료)과 별개로 "실제 점검 시행 건수"를 항상 함께 노출 (진행 현황 즉시 확인용)
  const rawTodayCount = todayInspections.length;

  document.getElementById("kpiRate").textContent = DCL.fmtPercent(rate);
  document.getElementById("kpiRateSub").textContent = DCL.t("page.dashboard.rateSub", { target: DCL.fmtCount(targetCnt), done: DCL.fmtCount(doneCnt), raw: DCL.fmtCount(rawTodayCount) });

  // 점검율 대상에서 빠진 점검 건이 있으면 근본원인을 배너로 안내 (오늘 점검주기 대상 아님 / 사용중 상태 아님)
  const excl = classifyExcludedTodayInspections(todayInspections);
  const warnEl = document.getElementById("assignWarnBanner");
  if (warnEl){
    const msgs = [];
    if (excl.notDueCnt > 0) msgs.push(DCL.t("page.dashboard.warnNotDue", { n: excl.notDueCnt }));
    if (excl.notInUseCnt > 0) msgs.push(DCL.t("page.dashboard.warnNotInUse", { n: excl.notInUseCnt }));
    if (msgs.length){
      warnEl.style.display = "";
      warnEl.innerHTML = `${DCL.t("page.dashboard.warnPrefix")} ${msgs.join(" · ")}`;
    } else {
      warnEl.style.display = "none";
    }
  }

  const partMap = Object.fromEntries(ALL_PARTS.map(p=>[p.id,p]));
  const inspMap = Object.fromEntries(ALL_INSPECTORS.map(i=>[i.id,i]));
  const assignByPart = {};
  ALL_ASSIGNMENTS.forEach(a=>{ (assignByPart[a.part_id]=assignByPart[a.part_id]||[]).push(a.inspector_id); });
  const missList = targetIds.filter(id=>!doneIdsToday.has(id)).map(id=>({
    part_id:id, part_code: partMap[id]?.part_code||"-", part_name: partMap[id]?.part_name||"-",
    inspectors: (assignByPart[id]||[]).map(iid=>inspMap[iid]?.name).filter(Boolean)
  }));
  document.getElementById("kpiMiss").textContent = DCL.fmtCount(missList.length);
  const missBody = document.getElementById("missBody");
  missBody.innerHTML = missList.length ? missList.map(m=>`
    <tr><td class="mono"><b>${esc(m.part_code)}</b></td><td>${esc(m.part_name)}</td><td class="text-mute">${esc(m.inspectors.join(", ")||DCL.t("common.unassigned"))}</td></tr>`).join("")
    : `<tr><td colspan="3" class="empty-state">${DCL.t("page.dashboard.missEmpty")}</td></tr>`;

  const abnormalToday = ALL_INSPECTIONS.filter(i=>i.inspect_date===today && i.overall_result==="ABNORMAL").length;
  document.getElementById("kpiAbn").textContent = DCL.fmtCount(abnormalToday);

  // 조치 이행율(최근 7일 고정 기준 - 타일은 필터 미적용)
  const d7 = new Date(); d7.setDate(d7.getDate()-7);
  const d7Str = d7.toISOString().slice(0,10);
  const recentActions = ALL_ACTIONS.filter(a => a.created_at >= d7Str);
  const approved = recentActions.filter(a=>a.status==="APPROVED").length;
  const actionRate = recentActions.length ? (approved/recentActions.length*100) : 0;
  const overdue = ALL_ACTIONS.filter(a=>["OPEN","IN_PROGRESS"].includes(a.status) && a.due_date && a.due_date < today);
  document.getElementById("kpiActionRate").textContent = DCL.fmtPercent(actionRate);
  document.getElementById("kpiActionSub").textContent = DCL.t("page.dashboard.actionSub", { approved: DCL.fmtCount(approved), total: DCL.fmtCount(recentActions.length), overdue: DCL.fmtCount(overdue.length) });

  const overdueBody = document.getElementById("overdueBody");
  overdueBody.innerHTML = overdue.length ? overdue.map(a=>{
    const p = partMap[a.part_id];
    const assigneeName = inspMap[a.assignee_id]?.name || DCL.t("common.unassigned");
    return `<tr><td><b>${p?esc(p.part_name):"-"}</b><div class="text-mute mono fs-xs">${p?esc(p.part_code):""}</div></td><td style="max-width:220px;">${esc(a.issue_desc)}</td><td class="text-mute">${esc(assigneeName)}</td><td class="text-red">${DCL.fmtDate(a.due_date)}</td></tr>`;
  }).join("") : `<tr><td colspan="4" class="empty-state">${DCL.t("page.dashboard.overdueEmpty")}</td></tr>`;

  LAST_CTX = {
    rate, targetCnt, doneCnt,
    missCnt: missList.length, missList: missList.map(m=>({part_name:m.part_name, part_code:m.part_code})),
    abnormalCnt: abnormalToday,
    actionOpenCnt: ALL_ACTIONS.filter(a=>["OPEN","IN_PROGRESS"].includes(a.status)).length,
    actionDoneRate: actionRate,
    overdueCnt: overdue.length,
    overdueList: overdue.map(a=>({ part_name: partMap[a.part_id]?.part_name||"-", issue_desc:a.issue_desc }))
  };
}

// ---- 개인별 오늘 할 일 (로그인한 본인의 점검/조치/승인 대상 건수를 KPI박스로 표시, 필터 미적용) ----
// 대시보드 구축 원칙: KPI 카드는 반드시 클릭 가능해야 하며, 클릭 시 상세 목록이 모달 팝업으로
// 표시되어야 한다 - 상단 4개 KPI와 동일한 패턴을 여기에도 적용한다(목록은 openKpiListModal에서 조회).
// 승인 박스는 관리자(admin) 역할에게만 노출한다 (조치 승인/반려는 관리자 권한 전용).
function myTaskCounts(){
  const insp = DCL.getCurrentInspector();
  const partMap = Object.fromEntries(ALL_PARTS.map(p=>[p.id,p]));
  const today = DCL.today();
  const myPartIds = ALL_ASSIGNMENTS.filter(a=>a.inspector_id===insp.id).map(a=>a.part_id);
  const myDueIds = myPartIds.filter(id => partMap[id] && DCL.isDueOn(partMap[id], today));
  const myOpenActions = ALL_ACTIONS.filter(a => a.assignee_id === insp.id && ["OPEN","IN_PROGRESS"].includes(a.status));
  const isAdmin = insp.role === "admin";
  const myApprovals = isAdmin ? ALL_ACTIONS.filter(a => a.status === "DONE") : [];

  // KPI박스 표시용 "실행한 건수 / 전체 건수" 계산.
  // - 점검할 항목: 분모 = 오늘 배정된 점검 대상 전체, 분자 = 그 중 이미 점검 완료한 건수.
  const doneIdsToday = new Set(ALL_INSPECTIONS.filter(i=>i.inspect_date===today).map(i=>i.part_id));
  const myInspectDoneCnt = myDueIds.filter(id=>doneIdsToday.has(id)).length;
  const myInspectTotalCnt = myDueIds.length;

  // - 조치할 항목: 분모 = 현재 나에게 배정된 미해결(OPEN/IN_PROGRESS) 조치 전체 건수(스냅샷, myOpenActions와 동일 기준).
  //   분자 = 오늘 내가 실제로 "조치완료 등록"한 건수. actions.completed_by/completed_at(fn_complete_action이
  //   기록)을 사용 - 오늘 등록한 건은 등록 즉시 상태가 DONE으로 바뀌어 위 분모(OPEN/IN_PROGRESS) 목록에서는
  //   빠지므로, 분모와 분자를 서로 다른 조건으로 각각 집계해야 "오늘 몇 건을 처리했는지"가 드러난다.
  const myActionTotalCnt = myOpenActions.length;
  const myActionDoneTodayCnt = ALL_ACTIONS.filter(a => a.completed_by === insp.id && (a.completed_at||"").slice(0,10) === today).length;

  // - 승인할 항목: 조치 승인/반려는 관리자 공통 권한이라(누가 처리하든 전사 동일 목록) 분모·분자 모두 전사
  //   기준으로 집계한다. 분모 = 현재 미승인(DONE) 상태로 남아있는 전체 건수(myApprovals와 동일 기준).
  //   분자 = 오늘 실제로 승인 또는 반려 처리된 건수. actions.approved_at(fn_review_action이 승인/반려
  //   공통으로 기록)을 사용한다.
  const myApproveTotalCnt = myApprovals.length;
  const myApproveDoneTodayCnt = isAdmin
    ? ALL_ACTIONS.filter(a => ["APPROVED","REJECTED"].includes(a.status) && (a.approved_at||"").slice(0,10) === today).length
    : 0;

  return {
    insp, isAdmin, myDueIds, myOpenActions, myApprovals,
    myInspectDoneCnt, myInspectTotalCnt, myActionDoneTodayCnt, myActionTotalCnt, myApproveDoneTodayCnt, myApproveTotalCnt
  };
}

function renderMyTaskKpis(){
  const insp = DCL.getCurrentInspector();
  const titleEl = document.getElementById("myTodayTitle");
  if (titleEl) titleEl.textContent = DCL.t("page.dashboard.myListTitle", { name: insp.name });
  const hintEl = document.querySelector('[data-i18n="page.dashboard.myListHint"]');
  if (hintEl) hintEl.textContent = DCL.t("page.dashboard.myListHint");

  const { isAdmin, myInspectDoneCnt, myInspectTotalCnt, myActionDoneTodayCnt, myActionTotalCnt, myApproveDoneTodayCnt, myApproveTotalCnt } = myTaskCounts();
  // 점검할 항목: "완료 / 오늘 배정된 전체" (예: 오늘 배정 4건 중 아직 아무것도 안 했으면 "0 / 4")
  document.getElementById("kpiMyInspect").textContent = `${DCL.fmtCount(myInspectDoneCnt)} / ${DCL.fmtCount(myInspectTotalCnt)}`;
  // 조치할 항목: "오늘 처리한 건수 / 현재 미해결 전체(나에게 배정된 것)"
  document.getElementById("kpiMyAction").textContent = `${DCL.fmtCount(myActionDoneTodayCnt)} / ${DCL.fmtCount(myActionTotalCnt)}`;

  // 승인 박스는 관리자만 노출 (비관리자는 박스 자체를 숨기고 3열 → 2열 그리드로 전환)
  const approveTile = document.getElementById("kpiMyApproveTile");
  const grid = document.getElementById("myTaskGrid");
  if (approveTile){
    approveTile.style.display = isAdmin ? "" : "none";
    // 승인할 항목: "오늘 처리(승인+반려)한 건수 / 현재 미승인 전체(전사)"
    document.getElementById("kpiMyApprove").textContent = `${DCL.fmtCount(myApproveDoneTodayCnt)} / ${DCL.fmtCount(myApproveTotalCnt)}`;
  }
  if (grid) grid.className = "grid " + (isAdmin ? "grid-3" : "grid-2");
}

// 점검/조치/승인 대상 공용 모달 행 렌더 - 부품명/코드, (이상내용/상태/기한), 처리 버튼(기존 페이지로 이동)
function myTaskModalRow(kind, a, partMap){
  if (kind === "myInspect") {
    const p = a; // a는 part 레코드
    const doneIdsToday = new Set(ALL_INSPECTIONS.filter(i=>i.inspect_date===DCL.today()).map(i=>i.part_id));
    const done = doneIdsToday.has(p.id);
    return `<tr><td class="mono"><b>${esc(p.part_code)}</b></td><td>${esc(p.part_name)}</td>
      <td>${done ? `<span class="badge badge-green">${DCL.t("page.inspect.doneComplete")}</span>` : `<span class="badge badge-yellow">${DCL.t("page.inspect.notDoneYet")}</span>`}</td>
      <td><a class="btn btn-sm" href="inspect.html?code=${encodeURIComponent(p.part_code)}">${DCL.t("page.inspect.inspectBtn")}</a></td></tr>`;
  }
  const p = partMap[a.part_id] || {};
  const statusBadge = { OPEN:"badge-red", IN_PROGRESS:"badge-yellow", DONE:"badge-blue" }[a.status] || "badge-gray";
  const btnLabel = DCL.t(kind === "myApprove" ? "page.dashboard.myTasks.approveBtn" : "page.dashboard.myTasks.actionBtn");
  return `<tr><td><b>${p.part_name?esc(p.part_name):"-"}</b><div class="text-mute mono fs-xs">${p.part_code?esc(p.part_code):""}</div></td>
    <td style="max-width:220px;">${esc(a.issue_desc||"-")}</td>
    <td><span class="badge ${statusBadge}">${DCL.t("status."+a.status)}</span></td>
    <td>${a.due_date ? DCL.fmtDate(a.due_date) : "-"}</td>
    <td><a class="btn btn-sm" href="actions.html?focus=${encodeURIComponent(a.id)}">${btnLabel}</a></td></tr>`;
}

// ---- 추이 차트 (기간 필터 적용) ------------------------------------------------
function renderTrends(){
  if (typeof Chart === "undefined") {
    ["rateChart","abnormalChart","actionChart"].forEach(function(id){
      const c = document.getElementById(id);
      if (c && c.parentElement) c.parentElement.innerHTML = `<div class="empty-state">${DCL.t("common.chartLibFail")}</div>`;
    });
    return;
  }
  const days = Number(document.getElementById("periodFilter").value || 7);
  const labels = [];
  const rateData = [], abnData = [], actionData = [], actionCountData = [];

  for (let i=days-1; i>=0; i--){
    const d = new Date(); d.setDate(d.getDate()-i);
    const dStr = d.toISOString().slice(0,10);
    labels.push(dStr.slice(5));

    const dueIds = duePartIdsOn(dStr);
    const dueCnt = dueIds.length;
    const dayInsp = ALL_INSPECTIONS.filter(x=>x.inspect_date===dStr);
    const doneIds = new Set(dayInsp.map(x=>x.part_id));
    const doneCnt = dueIds.filter(id=>doneIds.has(id)).length;
    rateData.push(dueCnt ? Math.round(doneCnt/dueCnt*1000)/10 : 0);

    abnData.push(dayInsp.filter(x=>x.overall_result==="ABNORMAL").length);

    const dayActions = ALL_ACTIONS.filter(a => (a.created_at||"").slice(0,10) === dStr);
    const dayApproved = dayActions.filter(a=>a.status==="APPROVED").length;
    actionData.push(dayActions.length ? Math.round(dayApproved/dayActions.length*1000)/10 : 0);
    // 조치 이행율 0%가 "조치 대상이 없어서 0%"인지 "조치 대상은 있는데 승인이 안 돼서 0%"인지
    // 구분할 수 있도록, 해당일 조치 건수(분모)를 별도 계열로 함께 표시한다.
    actionCountData.push(dayActions.length);
  }

  const pastel = { blue:"#3E6FB0", blueBg:"rgba(214,228,240,0.55)", red:"#C94F4F", redBg:"rgba(246,220,220,0.6)", green:"#3E9A5D", greenBg:"rgba(220,239,225,0.6)" };
  const commonOpt = { responsive:true, maintainAspectRatio:false, plugins:{ legend:{ display:false } }, scales:{ y:{ beginAtZero:true, grid:{ color:"rgba(150,150,150,0.15)" } }, x:{ grid:{ display:false } } } };

  RATE_CHART && RATE_CHART.destroy();
  RATE_CHART = new Chart(document.getElementById("rateChart"), {
    type:"line",
    data:{ labels, datasets:[{ label:KPI_NAMES.rate, data:rateData, borderColor:pastel.blue, backgroundColor:pastel.blueBg, fill:true, tension:.3, pointRadius:2 }] },
    options: Object.assign({}, commonOpt, { scales:{ y:{ beginAtZero:true, max:100, ticks:{ callback:v=>v+"%" } }, x:{ grid:{display:false} } } })
  });

  ABN_CHART && ABN_CHART.destroy();
  ABN_CHART = new Chart(document.getElementById("abnormalChart"), {
    type:"bar",
    data:{ labels, datasets:[{ label:KPI_NAMES.abnormal, data:abnData, backgroundColor:pastel.redBg, borderColor:pastel.red, borderWidth:1, borderRadius:4 }] },
    // 이상 발견 "건수"는 인원(명)과 동일하게 항상 정수이므로 y축도 정수 눈금만 표시 (0.2건 같은 소수 눈금 금지).
    // stepSize는 강제하지 않고 precision:0만 지정해, 값 범위가 커지면 Chart.js가 1/2/5/10 단위로 자동
    // 조정하되 항상 정수로만 반올림하게 한다.
    options: Object.assign({}, commonOpt, { scales:{ y:{ beginAtZero:true, ticks:{ precision:0 }, grid:{ color:"rgba(150,150,150,0.15)" } }, x:{ grid:{ display:false } } } })
  });

  // 조치 이행율(선, 좌측축 %) + 조치 건수(막대, 우측축 건) 이중축 차트.
  // 이행율만 보면 0%가 "조치 대상이 없어서 0%"인지 "대상은 있는데 승인이 안 돼서 0%"인지
  // 구분되지 않는 문제가 있어, 해당일 조치 건수(분모)를 함께 표시해 근본원인을 즉시 구분할 수 있게 한다.
  ACTION_CHART && ACTION_CHART.destroy();
  ACTION_CHART = new Chart(document.getElementById("actionChart"), {
    data:{ labels, datasets:[
      { type:"bar", label:DCL.t("page.dashboard.actionCountLabel"), data:actionCountData, backgroundColor:"rgba(150,150,150,0.22)", borderColor:"rgba(120,120,120,0.55)", borderWidth:1, borderRadius:3, yAxisID:"y1", order:2 },
      { type:"line", label:KPI_NAMES.action, data:actionData, borderColor:pastel.green, backgroundColor:pastel.greenBg, fill:true, tension:.3, pointRadius:2, yAxisID:"y", order:1 }
    ]},
    options: Object.assign({}, commonOpt, {
      plugins:{ legend:{ display:true, position:"bottom", labels:{ boxWidth:10, font:{ size:10 } } } },
      scales:{
        y:{ beginAtZero:true, max:100, position:"left", ticks:{ callback:v=>v+"%" }, grid:{ color:"rgba(150,150,150,0.15)" } },
        // 조치 건수는 인원(명)과 동일하게 항상 정수이므로 우측축도 정수 눈금만 표시
        y1:{ beginAtZero:true, position:"right", ticks:{ precision:0 }, grid:{ drawOnChartArea:false } },
        x:{ grid:{ display:false } }
      }
    })
  });
}

// ---- KPI 타일 클릭 → 해당 리스트 팝업 (대시보드 구축 원칙: 각 KPI는 클릭 가능해야 하며,
// 클릭 시 해당되는 리스트가 팝업으로 표시되어야 함) --------------------------------------
function wireKpiTileClicks(){
  document.querySelectorAll(".kpi-tile[data-kpi]").forEach(function(tile){
    tile.addEventListener("click", function(){ openKpiListModal(tile.dataset.kpi); });
  });
}

async function openKpiListModal(kind){
  const today = DCL.today();
  const partMap = Object.fromEntries(ALL_PARTS.map(p=>[p.id,p]));
  const inspMap = Object.fromEntries(ALL_INSPECTORS.map(i=>[i.id,i]));
  let title = "", head = "", rows = "", emptyKey = "";

  if (kind === "rate") {
    title = DCL.t("page.dashboard.kpiModal.rateTitle");
    head = `<tr><th>${DCL.t("common.col.partCode")}</th><th>${DCL.t("common.col.partName")}</th><th>${DCL.t("common.col.status")}</th></tr>`;
    const dueIds = duePartIdsOn(today);
    const doneIdsToday = new Set(ALL_INSPECTIONS.filter(i=>i.inspect_date===today).map(i=>i.part_id));
    rows = dueIds.map(id=>{
      const p = partMap[id]; if (!p) return "";
      const done = doneIdsToday.has(id);
      return `<tr><td class="mono"><b>${esc(p.part_code)}</b></td><td>${esc(p.part_name)}</td><td>${done ? `<span class="badge badge-green">${DCL.t("page.inspect.doneComplete")}</span>` : `<span class="badge badge-yellow">${DCL.t("page.inspect.notDoneYet")}</span>`}</td></tr>`;
    }).join("");
    emptyKey = "page.dashboard.kpiModal.rateEmpty";
  } else if (kind === "miss") {
    title = DCL.t("page.dashboard.missTableTitle");
    head = `<tr><th>${DCL.t("common.col.partCode")}</th><th>${DCL.t("common.col.partName")}</th><th>${DCL.t("common.col.assignee")}</th></tr>`;
    const dueIds = duePartIdsOn(today);
    const doneIdsToday = new Set(ALL_INSPECTIONS.filter(i=>i.inspect_date===today).map(i=>i.part_id));
    const assignByPart = {};
    ALL_ASSIGNMENTS.forEach(a=>{ (assignByPart[a.part_id]=assignByPart[a.part_id]||[]).push(a.inspector_id); });
    rows = dueIds.filter(id=>!doneIdsToday.has(id)).map(id=>{
      const p = partMap[id]; if (!p) return "";
      const names = (assignByPart[id]||[]).map(iid=>inspMap[iid]?.name).filter(Boolean).join(", ") || DCL.t("common.unassigned");
      return `<tr><td class="mono"><b>${esc(p.part_code)}</b></td><td>${esc(p.part_name)}</td><td class="text-mute">${esc(names)}</td></tr>`;
    }).join("");
    emptyKey = "page.dashboard.missEmpty";
  } else if (kind === "abn") {
    title = DCL.t("page.dashboard.kpiModal.abnTitle");
    head = `<tr><th>${DCL.t("common.col.partCode")}</th><th>${DCL.t("common.col.partName")}</th><th>${DCL.t("common.col.assignee")}</th><th>${DCL.t("common.col.note")}</th></tr>`;
    const abnInspections = ALL_INSPECTIONS.filter(i=>i.inspect_date===today && i.overall_result==="ABNORMAL");
    const abnIds = abnInspections.map(i=>i.id);
    // 비고란: 점검 메모(note, 대부분 미입력)가 아니라 실제로 "이상"으로 판정된 점검항목명과 측정값을 표시
    const abnResults = abnIds.length
      ? await DCL.select("inspection_results", q => q.in("inspection_id", abnIds).eq("judge_result", "ABNORMAL"))
      : [];
    const resultsByInspection = {};
    abnResults.forEach(r=>{ (resultsByInspection[r.inspection_id]=resultsByInspection[r.inspection_id]||[]).push(r); });
    rows = abnInspections.map(i=>{
      const p = partMap[i.part_id];
      const items = (resultsByInspection[i.id]||[])
        .map(r=>`${esc(r.item_name)}: ${esc(r.input_value ?? "-")}`)
        .join(", ");
      return `<tr><td class="mono"><b>${p?esc(p.part_code):"-"}</b></td><td>${p?esc(p.part_name):"-"}</td><td class="text-mute">${esc(inspMap[i.inspector_id]?.name||"-")}</td><td class="text-mute" style="max-width:260px;">${items || "-"}</td></tr>`;
    }).join("");
    emptyKey = "page.dashboard.kpiModal.abnEmpty";
  } else if (kind === "action") {
    title = DCL.t("page.dashboard.kpiModal.actionTitle");
    head = `<tr><th>${DCL.t("common.col.part")}</th><th>${DCL.t("common.col.content")}</th><th>${DCL.t("common.col.status")}</th><th>${DCL.t("common.col.dueDate")}</th></tr>`;
    const d7 = new Date(); d7.setDate(d7.getDate()-7);
    const d7Str = d7.toISOString().slice(0,10);
    const statusBadge = { OPEN:"badge-red", IN_PROGRESS:"badge-yellow", DONE:"badge-blue", APPROVED:"badge-green", REJECTED:"badge-red" };
    rows = ALL_ACTIONS.filter(a => a.created_at >= d7Str).map(a=>{
      const p = partMap[a.part_id];
      return `<tr><td><b>${p?esc(p.part_name):"-"}</b><div class="text-mute mono fs-xs">${p?esc(p.part_code):""}</div></td><td style="max-width:220px;">${esc(a.issue_desc)}</td><td><span class="badge ${statusBadge[a.status]||'badge-gray'}">${DCL.t("status."+a.status)}</span></td><td>${DCL.fmtDate(a.due_date)}</td></tr>`;
    }).join("");
    emptyKey = "page.dashboard.kpiModal.actionEmpty";
  } else if (kind === "myInspect") {
    // 개인별 오늘 할 일 - 점검할 항목: 오늘 점검주기 대상으로 본인에게 배정된 부품 (대시보드 구축 원칙:
    // KPI박스 클릭 → 목록 팝업 → 목록에서 항목 클릭 → 처리 페이지(inspect.html)로 이동)
    title = DCL.t("page.dashboard.myTasks.inspectHeader");
    head = `<tr><th>${DCL.t("common.col.partCode")}</th><th>${DCL.t("common.col.partName")}</th><th>${DCL.t("common.col.status")}</th><th></th></tr>`;
    const { myDueIds } = myTaskCounts();
    rows = myDueIds.map(id => partMap[id] ? myTaskModalRow("myInspect", partMap[id], partMap) : "").join("");
    emptyKey = "page.dashboard.myListEmpty";
  } else if (kind === "myAction") {
    title = DCL.t("page.dashboard.myTasks.actionHeader");
    head = `<tr><th>${DCL.t("common.col.part")}</th><th>${DCL.t("common.col.content")}</th><th>${DCL.t("common.col.status")}</th><th>${DCL.t("common.col.dueDate")}</th><th></th></tr>`;
    const { myOpenActions } = myTaskCounts();
    rows = myOpenActions.map(a => myTaskModalRow("myAction", a, partMap)).join("");
    emptyKey = "page.dashboard.myTasks.actionEmpty";
  } else if (kind === "myApprove") {
    title = DCL.t("page.dashboard.myTasks.approveHeader");
    head = `<tr><th>${DCL.t("common.col.part")}</th><th>${DCL.t("common.col.content")}</th><th>${DCL.t("common.col.status")}</th><th>${DCL.t("common.col.dueDate")}</th><th></th></tr>`;
    const { myApprovals } = myTaskCounts();
    rows = myApprovals.map(a => myTaskModalRow("myApprove", a, partMap)).join("");
    emptyKey = "page.dashboard.myTasks.approveEmpty";
  }

  const cols = (head.match(/<th/g) || []).length || 4;
  document.getElementById("kpiListModalTitle").textContent = title;
  document.getElementById("kpiListModalHead").innerHTML = head;
  document.getElementById("kpiListModalBody").innerHTML = rows || `<tr><td colspan="${cols}" class="empty-state">${DCL.t(emptyKey)}</td></tr>`;
  DCL.openModal("kpiListModalOverlay");
}

function esc(s){ return String(s??"").replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
