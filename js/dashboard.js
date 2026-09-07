// ============================================================================
// 대시보드 - KPI 타일(필터 미적용) + 추이차트(기간필터 적용) + AI
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
  renderTrends();
  wireAiChips();
  DCL.AI.mountWidget(buildAiContext);
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
function buildAiContext(){ return LAST_CTX; }

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

// ---- AI 진단 칩 ---------------------------------------------------------------
function wireAiChips(){
  document.getElementById("chipRate").addEventListener("click", function(e){
    DCL.AI.showDiagnosePopup({ item_name:KPI_NAMES.rate, input_value: Math.round(LAST_CTX.rate*10)/10, lower_limit:95, upper_limit:null, judge_type:"NUMERIC" }, e.currentTarget);
  });
  document.getElementById("chipMiss").addEventListener("click", function(e){
    DCL.AI.showDiagnosePopup({ item_name:DCL.t("page.dashboard.kpi.missLabel"), input_value: LAST_CTX.missCnt, lower_limit:null, upper_limit:0, judge_type:"NUMERIC" }, e.currentTarget);
  });
  document.getElementById("chipAbn").addEventListener("click", function(e){
    DCL.AI.showDiagnosePopup({ item_name:KPI_NAMES.abnormal, input_value: LAST_CTX.abnormalCnt, lower_limit:null, upper_limit:0, judge_type:"NUMERIC" }, e.currentTarget);
  });
  document.getElementById("chipAction").addEventListener("click", function(e){
    DCL.AI.showDiagnosePopup({ item_name:KPI_NAMES.action, input_value: Math.round(LAST_CTX.actionDoneRate*10)/10, lower_limit:90, upper_limit:null, judge_type:"NUMERIC" }, e.currentTarget);
  });
}

function esc(s){ return String(s??"").replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
