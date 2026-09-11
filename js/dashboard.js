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
  renderMyTodayList();
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
    return `<tr><td><b>${p?esc(p.part_name):"-"}</b><div class="text-mute mono fs-xs">${p?esc(p.part_code):""}</div></td><td style="max-width:220px;">${esc(a.issue_desc)}</td><td class="text-red">${DCL.fmtDate(a.due_date)}</td></tr>`;
  }).join("") : `<tr><td colspan="3" class="empty-state">${DCL.t("page.dashboard.overdueEmpty")}</td></tr>`;

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

// ---- 개인별 오늘 할 일 (로그인한 본인의 점검/조치/승인 대상을 모두 모아서 표시, 필터 미적용) ----
// 대시보드 구축 원칙: 로그인한 인원이 오늘 처리해야 할 업무(점검/조치/승인)를 모두 한 곳에서
// 확인할 수 있어야 한다. 승인 섹션은 관리자(admin) 역할에게만 노출한다 (조치 승인/반려는
// 관리자 권한 전용 - 10장 점검자 관리 참고).
function renderMyTodayList(){
  const mount = document.getElementById("myTodayList");
  if (!mount) return;
  const insp = DCL.getCurrentInspector();
  const titleEl = document.getElementById("myTodayTitle");
  if (titleEl) titleEl.textContent = DCL.t("page.dashboard.myListTitle", { name: insp.name });
  const hintEl = document.querySelector('[data-i18n="page.dashboard.myListHint"]');
  if (hintEl) hintEl.textContent = DCL.t("page.dashboard.myListHint");

  const partMap = Object.fromEntries(ALL_PARTS.map(p=>[p.id,p]));
  const today = DCL.today();

  // 1) 점검할 대상 - 오늘 점검주기 대상으로 본인에게 배정된 부품
  const myPartIds = ALL_ASSIGNMENTS.filter(a=>a.inspector_id===insp.id).map(a=>a.part_id);
  const myDueIds = myPartIds.filter(id => partMap[id] && DCL.isDueOn(partMap[id], today));
  const doneIdsToday = new Set(ALL_INSPECTIONS.filter(i=>i.inspect_date===today).map(i=>i.part_id));

  const inspectRows = myDueIds.map(id=>{
    const p = partMap[id];
    const done = doneIdsToday.has(id);
    return `<div class="flex-between" style="padding:9px 0; border-bottom:1px solid var(--border);">
      <div>
        <div style="font-weight:700;">${esc(p.part_name)}</div>
        <div class="text-mute mono fs-xs">${esc(p.part_code)}</div>
      </div>
      <div style="text-align:right;">
        ${done ? `<span class="badge badge-green">${DCL.t("page.inspect.doneComplete")}</span>` : `<span class="badge badge-yellow">${DCL.t("page.inspect.notDoneYet")}</span>`}
        <a class="btn btn-sm" style="display:block; margin-top:6px; text-align:center;" href="inspect.html?code=${encodeURIComponent(p.part_code)}">${DCL.t("page.inspect.inspectBtn")}</a>
      </div>
    </div>`;
  }).join("");

  // 2) 조치해야 할 대상 - 본인이 담당자로 지정된 대기/조치중 상태 조치
  const myOpenActions = ALL_ACTIONS.filter(a => a.assignee_id === insp.id && ["OPEN","IN_PROGRESS"].includes(a.status));
  const actionRows = myOpenActions.map(a => actionTaskRowHtml(a, partMap, DCL.t("page.dashboard.myTasks.actionBtn"))).join("");

  // 3) 승인해야 할 대상 - 완료등록(DONE) 후 승인 대기 중인 조치 (관리자만)
  const isAdmin = insp.role === "admin";
  const myApprovals = isAdmin ? ALL_ACTIONS.filter(a => a.status === "DONE") : [];
  const approveRows = myApprovals.map(a => actionTaskRowHtml(a, partMap, DCL.t("page.dashboard.myTasks.approveBtn"))).join("");

  if (!myDueIds.length && !myOpenActions.length && !myApprovals.length) {
    mount.innerHTML = `<div class="empty-state">${DCL.t("page.dashboard.myListEmpty")}</div>`;
    return;
  }

  const section = (headerKey, countN, rowsHtml, emptyKey) => `
    <div class="my-task-section">
      <div class="my-task-section-head">${DCL.t(headerKey)} <span class="badge badge-gray">${DCL.fmtCount(countN)}</span></div>
      ${rowsHtml || `<div class="empty-state" style="padding:10px 0;">${DCL.t(emptyKey)}</div>`}
    </div>`;

  mount.innerHTML = [
    section("page.dashboard.myTasks.inspectHeader", myDueIds.length, inspectRows, "page.dashboard.myListEmpty"),
    section("page.dashboard.myTasks.actionHeader", myOpenActions.length, actionRows, "page.dashboard.myTasks.actionEmpty"),
    isAdmin ? section("page.dashboard.myTasks.approveHeader", myApprovals.length, approveRows, "page.dashboard.myTasks.approveEmpty") : "",
  ].join("");
}

// 조치/승인 항목 공용 행 렌더 - 부품명/코드, 이상내용, 상태 배지, 기한, 이동 버튼(actions.html?focus=<id>)
function actionTaskRowHtml(a, partMap, btnLabel){
  const p = partMap[a.part_id] || {};
  const statusBadge = { OPEN:"badge-red", IN_PROGRESS:"badge-yellow", DONE:"badge-blue" }[a.status] || "badge-gray";
  return `<div class="flex-between" style="padding:9px 0; border-bottom:1px solid var(--border);">
    <div>
      <div style="font-weight:700;">${esc(p.part_name||"-")}</div>
      <div class="text-mute mono fs-xs">${esc(p.part_code||"-")}</div>
      <div class="text-mute fs-xs" style="margin-top:2px; max-width:280px;">${esc(a.issue_desc||"-")}</div>
    </div>
    <div style="text-align:right;">
      <span class="badge ${statusBadge}">${DCL.t("status."+a.status)}</span>
      ${a.due_date ? `<div class="text-mute fs-xs" style="margin-top:4px;">${DCL.t("common.col.dueDate")}: ${DCL.fmtDate(a.due_date)}</div>` : ""}
      <a class="btn btn-sm" style="display:block; margin-top:6px; text-align:center;" href="actions.html?focus=${encodeURIComponent(a.id)}">${btnLabel}</a>
    </div>
  </div>`;
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
  const rateData = [], abnData = [], actionData = [];

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
    options: commonOpt
  });

  ACTION_CHART && ACTION_CHART.destroy();
  ACTION_CHART = new Chart(document.getElementById("actionChart"), {
    type:"line",
    data:{ labels, datasets:[{ label:KPI_NAMES.action, data:actionData, borderColor:pastel.green, backgroundColor:pastel.greenBg, fill:true, tension:.3, pointRadius:2 }] },
    options: Object.assign({}, commonOpt, { scales:{ y:{ beginAtZero:true, max:100, ticks:{ callback:v=>v+"%" } }, x:{ grid:{display:false} } } })
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
  }

  document.getElementById("kpiListModalTitle").textContent = title;
  document.getElementById("kpiListModalHead").innerHTML = head;
  document.getElementById("kpiListModalBody").innerHTML = rows || `<tr><td colspan="4" class="empty-state">${DCL.t(emptyKey)}</td></tr>`;
  DCL.openModal("kpiListModalOverlay");
}

function esc(s){ return String(s??"").replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
