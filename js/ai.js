// ============================================================================
// AI 어시스턴트 (자연어 Q&A) + AI 자동진단 (이상 원인/영향/조치가이드)
// provider 미설정 시 규칙기반(Rule-based)으로 완전히 동작합니다.
// ============================================================================
(function(){
  "use strict";
  window.DCL = window.DCL || {};
  const AI = {};
  DCL.AI = AI;
  const cfg = window.AI_CONFIG || { provider:"none" };

  // ---- 외부 LLM 호출 (설정된 경우만) -----------------------------------------
  async function callLLM(prompt){
    try{
      if (cfg.provider === "gemini" && cfg.geminiApiKey) {
        const url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=" + cfg.geminiApiKey;
        const res = await fetch(url, {
          method:"POST", headers:{"Content-Type":"application/json"},
          body: JSON.stringify({ contents:[{ parts:[{ text: prompt }] }] })
        });
        const data = await res.json();
        return data?.candidates?.[0]?.content?.parts?.[0]?.text || null;
      }
      if (cfg.provider === "groq" && cfg.groqApiKey) {
        const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method:"POST",
          headers:{"Content-Type":"application/json", "Authorization":"Bearer " + cfg.groqApiKey},
          body: JSON.stringify({
            model:"llama-3.1-8b-instant",
            messages:[{role:"user", content: prompt}]
          })
        });
        const data = await res.json();
        return data?.choices?.[0]?.message?.content || null;
      }
    }catch(e){ console.warn("[DCL.AI] LLM 호출 실패, 규칙기반으로 대체합니다", e); }
    return null;
  }

  // ---- 규칙기반 Q&A (대시보드 KPI 컨텍스트 기반) -------------------------------
  // ctx 예: { rate, targetCnt, doneCnt, missCnt, missList:[{part_name,part_code}],
  //           abnormalCnt, actionOpenCnt, actionDoneRate, overdueCnt, overdueList:[...] }
  function ruleBasedAnswer(q, ctx){
    ctx = ctx || {};
    const has = (kw)=> q.includes(kw);

    if (has("점검율") || has("점검률") || (has("점검") && has("몇") )) {
      return `오늘 점검율은 ${DCL.fmtPercent(ctx.rate)} 입니다. (대상 ${DCL.fmtCount(ctx.targetCnt)}건 중 ${DCL.fmtCount(ctx.doneCnt)}건 완료)`;
    }
    if (has("누락") || has("미점검")) {
      if (!ctx.missList || ctx.missList.length === 0) return "현재 미점검 부품은 없습니다. 오늘 점검 대상이 모두 처리되었습니다.";
      const names = ctx.missList.slice(0,5).map(p=>p.part_name+"("+p.part_code+")").join(", ");
      return `미점검 부품이 ${DCL.fmtCount(ctx.missList.length)}건 있습니다: ${names}${ctx.missList.length>5?" 외":""}`;
    }
    if (has("이상") && (has("건") || has("몇") || has("현황"))) {
      return `금일 이상 발견 건수는 ${DCL.fmtCount(ctx.abnormalCnt)}건 입니다. 진행중인 조치는 ${DCL.fmtCount(ctx.actionOpenCnt)}건 입니다.`;
    }
    if (has("조치") && (has("이행") || has("완료") || has("현황") || has("율") || has("률"))) {
      return `조치 이행율은 ${DCL.fmtPercent(ctx.actionDoneRate)} 입니다.` + (ctx.overdueCnt ? ` 기한 초과된 조치가 ${DCL.fmtCount(ctx.overdueCnt)}건 있으니 확인이 필요합니다.` : " 기한 초과 조치는 없습니다.");
    }
    if (has("지연") || has("기한")) {
      if (!ctx.overdueList || ctx.overdueList.length===0) return "기한이 지난 미완료 조치는 없습니다.";
      const names = ctx.overdueList.slice(0,5).map(a=>a.part_name+" - "+a.issue_desc).join(" / ");
      return `기한 초과 조치 ${DCL.fmtCount(ctx.overdueList.length)}건: ${names}`;
    }
    if (has("안녕") || has("hello")) return "안녕하세요! 오늘 점검율, 미점검 부품, 이상 발견 현황, 조치 이행율 등을 물어보세요.";
    return "이해하지 못했습니다. 예) '오늘 점검율은?', '미점검 부품 알려줘', '조치 이행율은?', '지연된 조치 있어?' 와 같이 질문해 보세요.";
  }

  AI.ask = async function(question, ctx){
    const prompt = `당신은 제조현장 부품 일상점검 시스템의 데이터 어시스턴트입니다. 아래 KPI 데이터를 참고하여 한국어로 간결하게 답하세요.\n데이터: ${JSON.stringify(ctx)}\n질문: ${question}`;
    const llmAns = await callLLM(prompt);
    return llmAns || ruleBasedAnswer(question, ctx);
  };

  // ---- AI 자동진단 (이상 항목 클릭 시 원인/영향/조치가이드) ---------------------
  // anomaly: { part_name, item_name, input_value, lower_limit, upper_limit, judge_type }
  function ruleBasedDiagnose(a){
    const isNumeric = a.judge_type === "NUMERIC";
    let cause = `${a.item_name} 항목에서 기준을 벗어난 값(${a.input_value ?? "이상"})이 감지되었습니다.`;
    if (isNumeric && a.upper_limit !== null && a.upper_limit !== undefined && Number(a.input_value) > Number(a.upper_limit)) {
      cause = `측정값(${a.input_value})이 상한 기준(${a.upper_limit})을 초과했습니다. 과부하, 냉각 불량, 센서 드리프트 등이 주요 원인일 수 있습니다.`;
    } else if (isNumeric && a.lower_limit !== null && a.lower_limit !== undefined && Number(a.input_value) < Number(a.lower_limit)) {
      cause = `측정값(${a.input_value})이 하한 기준(${a.lower_limit}) 미만입니다. 센서 오작동 또는 설비 정지 상태일 가능성이 있습니다.`;
    }
    return {
      cause,
      impact: "방치할 경우 설비 고장, 생산 중단(라인 정지), 품질 불량으로 이어질 수 있습니다.",
      immediate: "해당 부품 운전을 일시 정지하고 육안 재확인 후 담당자에게 즉시 통보하세요.",
      shortterm: "원인 부품(센서/배관/구동부 등) 점검 및 교체, 조치결과를 시스템에 등록하세요.",
      prevention: "점검 주기를 단축하거나 점검항목의 판정기준(상/하한)을 현장 여건에 맞게 재검토하세요."
    };
  }
  AI.diagnose = async function(anomaly){
    const prompt = `제조설비 부품 점검 중 이상이 발견되었습니다. 아래 정보를 바탕으로 원인/영향/즉시조치/단기조치/재발방지 5가지를 한국어로 각 1문장씩 간결히 제시하세요. JSON으로만 답하세요: {"cause":"","impact":"","immediate":"","shortterm":"","prevention":""}\n정보: ${JSON.stringify(anomaly)}`;
    const llmAns = await callLLM(prompt);
    if (llmAns) {
      try {
        const m = llmAns.match(/\{[\s\S]*\}/);
        if (m) return JSON.parse(m[0]);
      } catch(e){ /* fallthrough */ }
    }
    return ruleBasedDiagnose(anomaly);
  };

  // ---- 위젯 마운트 (FAB + 패널) -----------------------------------------------
  AI.mountWidget = function(getContext){
    if (document.getElementById("aiFab")) return;
    const fab = document.createElement("div");
    fab.id = "aiFab"; fab.className = "ai-fab no-print"; fab.title = DCL.t("ai.title"); fab.textContent = "✦";
    const panel = document.createElement("div");
    panel.id = "aiPanel"; panel.className = "ai-panel no-print";
    panel.innerHTML =
      '<div class="ai-panel-head"><span>✦ '+escapeHtml(DCL.t("ai.title"))+'</span><span style="cursor:pointer;" id="aiPanelClose">✕</span></div>' +
      '<div class="ai-panel-body" id="aiPanelBody"><div class="ai-msg">'+escapeHtml(DCL.t("ai.greeting"))+'</div></div>' +
      '<div class="ai-panel-input"><input type="text" id="aiPanelInput" placeholder="'+escapeHtml(DCL.t("ai.inputPlaceholder"))+'"/><button class="btn btn-primary btn-sm" id="aiPanelSend">'+escapeHtml(DCL.t("ai.sendBtn"))+'</button></div>';
    document.body.appendChild(fab); document.body.appendChild(panel);

    fab.addEventListener("click", ()=> panel.classList.toggle("open"));
    document.getElementById("aiPanelClose").addEventListener("click", ()=> panel.classList.remove("open"));

    async function send(){
      const input = document.getElementById("aiPanelInput");
      const q = input.value.trim();
      if (!q) return;
      const body = document.getElementById("aiPanelBody");
      body.insertAdjacentHTML("beforeend", '<div class="ai-msg user">'+escapeHtml(q)+'</div>');
      input.value = "";
      body.scrollTop = body.scrollHeight;
      const ctx = getContext ? (getContext() || {}) : {};
      const ans = await AI.ask(q, ctx);
      body.insertAdjacentHTML("beforeend", '<div class="ai-msg">'+escapeHtml(ans)+'</div>');
      body.scrollTop = body.scrollHeight;
    }
    document.getElementById("aiPanelSend").addEventListener("click", send);
    document.getElementById("aiPanelInput").addEventListener("keydown", function(e){ if (e.key==="Enter") send(); });
  };

  function escapeHtml(s){
    return String(s).replace(/[&<>"']/g, function(c){ return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]; });
  }

  // ---- AI 진단 팝업 (KPI 타일 ✦ 칩 클릭 시 사용) --------------------------------
  AI.showDiagnosePopup = async function(anomaly, anchorEl){
    let popup = document.getElementById("aiDiagnosePopup");
    if (!popup) {
      popup = document.createElement("div");
      popup.id = "aiDiagnosePopup";
      popup.className = "card no-print";
      popup.style.cssText = "position:fixed; width:320px; z-index:150; box-shadow:var(--shadow-md); border-color:var(--border-strong);";
      document.body.appendChild(popup);
    }
    const rect = anchorEl.getBoundingClientRect();
    popup.style.top = Math.min(rect.bottom + 8, window.innerHeight - 320) + "px";
    popup.style.left = Math.min(rect.left - 260, window.innerWidth - 340) + "px";
    popup.innerHTML = '<div class="text-mute fs-xs">'+escapeHtml(DCL.t("ai.diagnosing"))+'</div>';
    popup.style.display = "block";

    const result = await AI.diagnose(anomaly);
    popup.innerHTML =
      '<div class="flex-between mb-0"><b class="fs-sm">'+escapeHtml(DCL.t("ai.diagnoseTitle"))+'</b><span style="cursor:pointer;" id="aiDiagClose">✕</span></div>' +
      '<div class="divider"></div>' +
      '<div class="fs-xs" style="line-height:1.7;">' +
      '<div><b class="text-red">'+escapeHtml(DCL.t("ai.cause"))+'</b> '+escapeHtml(result.cause)+'</div>' +
      '<div class="mt-8"><b class="text-red">'+escapeHtml(DCL.t("ai.impact"))+'</b> '+escapeHtml(result.impact)+'</div>' +
      '<div class="mt-8"><b class="text-blue">'+escapeHtml(DCL.t("ai.immediate"))+'</b> '+escapeHtml(result.immediate)+'</div>' +
      '<div class="mt-8"><b class="text-blue">'+escapeHtml(DCL.t("ai.shortterm"))+'</b> '+escapeHtml(result.shortterm)+'</div>' +
      '<div class="mt-8"><b class="text-blue">'+escapeHtml(DCL.t("ai.prevention"))+'</b> '+escapeHtml(result.prevention)+'</div>' +
      '</div>' +
      '<div class="form-row mt-14" style="margin-bottom:0;"><label style="margin-bottom:4px;">'+escapeHtml(DCL.t("ai.additionalQLabel"))+'</label>' +
      '<div class="flex gap-6"><input type="text" id="aiDiagQ" placeholder="'+escapeHtml(DCL.t("ai.additionalQPlaceholder"))+'"/><button class="btn btn-sm btn-primary" id="aiDiagAsk">'+escapeHtml(DCL.t("ai.askBtn"))+'</button></div>' +
      '<div id="aiDiagAns" class="mt-8 fs-xs"></div></div>';

    document.getElementById("aiDiagClose").addEventListener("click", ()=> popup.style.display="none");
    document.getElementById("aiDiagAsk").addEventListener("click", async function(){
      const q = document.getElementById("aiDiagQ").value.trim();
      if (!q) return;
      document.getElementById("aiDiagAns").textContent = DCL.t("ai.analyzing");
      const ans = await AI.ask(q, anomaly);
      document.getElementById("aiDiagAns").textContent = ans;
    });
  };

})();
