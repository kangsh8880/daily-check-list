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
  // gemini-flash-latest: 특정 버전을 하드코딩하지 않고 Google이 관리하는 "최신 Flash 모델" 별칭을 사용.
  // 모델이 세대교체되어도(2.x → 3.x 등) 코드를 매번 수정할 필요 없이 자동으로 최신 무료 모델을 탄다.
  async function callLLM(prompt){
    try{
      if (cfg.provider === "gemini" && cfg.geminiApiKey) {
        const url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=" + cfg.geminiApiKey;
        const res = await fetch(url, {
          method:"POST", headers:{"Content-Type":"application/json"},
          body: JSON.stringify({
            contents:[{ parts:[{ text: prompt }] }],
            // thinkingConfig: 최신 Flash 계열은 기본적으로 내부 추론(thinking)을 거치는데,
            // 이 추론 시간이 응답 지연(느림)의 주 원인이고 모델/버전에 따라 추론 토큰이
            // maxOutputTokens 예산을 함께 잠식해 답변이 중간에 끊기는 원인이 되기도 한다.
            // 우리는 KPI 요약처럼 짧고 사실기반인 답변만 필요하므로 추론을 최소화(low)하고,
            // maxOutputTokens도 넉넉히 잡아 절대 중간에 끊기지 않게 한다.
            generationConfig: {
              temperature: 0.3,
              maxOutputTokens: 1024,
              thinkingConfig: { thinkingLevel: "low" }
            }
          })
        });
        const data = await res.json();
        const cand = data?.candidates?.[0];
        const text = cand?.content?.parts?.map(p=>p.text||"").join("") || undefined;
        if (!text) { console.warn("[DCL.AI] Gemini 응답에 결과가 없습니다. 규칙기반으로 대체합니다.", data?.error || data); return null; }
        if (cand?.finishReason === "MAX_TOKENS") { console.warn("[DCL.AI] Gemini 응답이 토큰 한도로 중간에 잘렸습니다.", text); }
        return text;
      }
      if (cfg.provider === "groq" && cfg.groqApiKey) {
        const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method:"POST",
          headers:{"Content-Type":"application/json", "Authorization":"Bearer " + cfg.groqApiKey},
          body: JSON.stringify({
            model:"llama-3.1-8b-instant",
            messages:[{role:"user", content: prompt}],
            temperature: 0.3, max_tokens: 500
          })
        });
        const data = await res.json();
        const text = data?.choices?.[0]?.message?.content;
        if (!text) { console.warn("[DCL.AI] Groq 응답에 결과가 없습니다. 규칙기반으로 대체합니다.", data?.error || data); return null; }
        return text;
      }
    }catch(e){ console.warn("[DCL.AI] LLM 호출 실패, 규칙기반으로 대체합니다", e); }
    return null;
  }

  // ---- 규칙기반 Q&A (대시보드 KPI 컨텍스트 기반) -------------------------------
  // ctx 예: { rate, targetCnt, doneCnt, rawTodayCount, missCnt, missList:[{part_name,part_code,assignees}],
  //           abnormalCnt, abnormalList:[{part_name,part_code,note}],
  //           actionOpenCnt, actionSeverityCnt:{CRITICAL,MAJOR,MINOR}, actionDoneRate, actionApprovedCnt, actionTotalCnt,
  //           overdueCnt, overdueList:[{part_name,part_code,issue_desc,severity,due_date,assignee}],
  //           perInspectorToday:[{name,assignedCnt,doneCnt,rate}], partsInUseCnt, inspectorsActiveCnt,
  //           inquiriesTotal, inquiriesOpen, inquiriesAnswered,
  //           allPartNames:[{name,code}], allInspectorNames:[name,...] }
  // 오프라인/무료로 동작하는 규칙기반 엔진이므로 LLM만큼의 자유도는 없지만, 아래 원칙으로 정확도를 최대화한다:
  //  1) 특정 부품/담당자 이름이 문장에 포함되면 그 개체에 대한 답을 최우선으로 준다 (엔티티 인식)
  //  2) 각 의도(intent)마다 동의어를 여러 개 등록해 표현 변화에 강하게 대응한다
  //  3) 의도끼리 키워드가 겹칠 때는(예: "점검자" 안에 "점검"이 포함) 더 구체적인 의도를 먼저 검사한다
  //  4) 아무 의도에도 안 걸리면 "이해 못함" 한 줄로 끝내지 않고, 오늘 현황 요약 + 질문 예시를 함께 준다
  function ruleBasedAnswer(q, ctx){
    ctx = ctx || {};
    // 띄어쓰기/문장부호 변형에 강하도록 정규화 후 포함여부로 판정 (완전한 형태소분석은 아니지만 실용적으로 충분)
    const norm = (s)=> String(s||"").toLowerCase().replace(/[\s?!.,~^*·"'()]/g, "");
    const nq = norm(q);
    const has = (kw)=> nq.includes(norm(kw));
    const hasAny = (...kws)=> kws.some(has);
    const pct = (n)=> (n===undefined || n===null || Number.isNaN(n)) ? "정보 없음" : DCL.fmtPercent(n);
    const cnt = (n)=> (n===undefined || n===null || Number.isNaN(n)) ? "정보 없음" : DCL.fmtCount(n);

    // ---- 0) 엔티티 인식: 질문 속에 특정 부품명/코드, 특정 담당자명이 있으면 최우선으로 그 항목을 답한다 ----
    // 부품명은 보통 "온도센서 #1"처럼 일련번호가 붙는데, 사용자는 흔히 "온도센서"처럼 번호를 빼고 묻는다.
    // 그래서 정확히 일치하는 이름/코드가 없으면 번호를 뗀 "줄기(stem)" 기준으로도 한 번 더 찾는다.
    const stem = (s)=> String(s||"").replace(/\s*#\d+\s*$/,"").trim();
    const allParts = ctx.allPartNames || [];
    let matchedParts = allParts.filter(p => (p.name && p.name.length>=2 && has(p.name)) || (p.code && p.code.length>=2 && has(p.code)));
    if (!matchedParts.length) {
      const q2 = allParts.find(p => stem(p.name).length>=2 && has(stem(p.name)));
      if (q2) matchedParts = allParts.filter(p => stem(p.name) === stem(q2.name));
    }
    if (matchedParts.length) {
      const describeOne = (part)=>{
        const miss = (ctx.missList||[]).find(m=>m.part_name===part.name);
        const abn = (ctx.abnormalList||[]).find(a=>a.part_name===part.name);
        const overdueHere = (ctx.overdueList||[]).filter(a=>a.part_name===part.name);
        const bits = [miss ? "미점검" : "점검완료"];
        if (abn) bits.push("이상발견");
        if (overdueHere.length) bits.push(`기한초과조치 ${cnt(overdueHere.length)}건`);
        return `${part.name}(${part.code}): ${bits.join(", ")}`;
      };
      if (matchedParts.length === 1) {
        const part = matchedParts[0];
        const miss = (ctx.missList||[]).find(m=>m.part_name===part.name);
        const abn = (ctx.abnormalList||[]).find(a=>a.part_name===part.name);
        const overdueHere = (ctx.overdueList||[]).filter(a=>a.part_name===part.name);
        const lines = [`[${part.name}(${part.code})] 관련 현황입니다.`];
        lines.push(miss ? `오늘 아직 점검하지 않았습니다.${(miss.assignees&&miss.assignees.length)?` (담당자: ${miss.assignees.join(", ")})`:""}` : "오늘 점검은 완료된 것으로 확인됩니다.");
        if (abn) lines.push(`금일 이상 발견 기록이 있습니다.${abn.note?` (비고: ${abn.note})`:""}`);
        if (overdueHere.length) lines.push(`기한초과 조치 ${cnt(overdueHere.length)}건: ` + overdueHere.map(a=>`${a.issue_desc}(담당 ${a.assignee}, 기한 ${a.due_date})`).join(" / "));
        return lines.join(" ");
      }
      // 같은 이름 줄기를 가진 부품이 여러 대인 경우 (예: 온도센서 #1, #2) 각각 요약해서 함께 제시
      return `"${stem(matchedParts[0].name)}"에 해당하는 부품이 ${cnt(matchedParts.length)}대 있습니다: ` + matchedParts.slice(0,6).map(describeOne).join(" / ");
    }
    const matchedInspector = (ctx.allInspectorNames||[]).find(name => name && name.length>=2 && has(name));
    if (matchedInspector) {
      const me = (ctx.perInspectorToday||[]).find(x=>x.name===matchedInspector);
      if (!me) return `${matchedInspector}님에게 오늘 배정된 점검 대상이 없습니다.`;
      return `${matchedInspector}님은 오늘 배정 ${cnt(me.assignedCnt)}건 중 ${cnt(me.doneCnt)}건 점검을 완료했습니다 (완료율 ${pct(me.rate)}).`;
    }

    // ---- 1) 인사 / 도움말 ----
    if (hasAny("안녕","hello","hi","반가","시작")) {
      return "안녕하세요! 오늘 점검율, 미점검 부품, 이상 발견 현황, 조치 이행율, 지연 조치, 특정 부품/담당자 현황 등을 자유롭게 물어보세요.";
    }
    if (hasAny("도움말","사용법","뭘물어","뭐물어","어떻게물어","예시")) {
      return `이렇게 물어보실 수 있어요: "오늘 점검율은?", "미점검 부품 알려줘", "이상 발견된 거 있어?", "조치 이행율은?", "지연된 조치 있어?", "지금 뭐부터 해야해?", "긴급 조치 몇건이야?", "OOO님 실적 어때?", "온도센서 상태 어때?"`;
    }

    // ---- 2) 종합 브리핑/요약 ----
    if (hasAny("브리핑","요약","전체현황","전체상황","서머리","오늘현황","한눈에","종합")) {
      let ans = `[오늘 종합 현황] 점검율 ${pct(ctx.rate)}(${cnt(ctx.doneCnt)}/${cnt(ctx.targetCnt)}건), 미점검 ${cnt(ctx.missCnt)}건, 이상발견 ${cnt(ctx.abnormalCnt)}건, 조치 이행율(최근7일) ${pct(ctx.actionDoneRate)}, 기한초과 조치 ${cnt(ctx.overdueCnt)}건입니다.`;
      if (ctx.overdueCnt) ans += " 기한초과 건부터 우선 확인해 주세요.";
      return ans;
    }

    // ---- 3) 우선순위 / 지금 뭐 해야 하는지 ----
    if (hasAny("지금뭐","당장","우선순위","뭐부터","뭐해야","할일","해야할","먼저해야","급한거","급한일")) {
      const parts = [];
      if (ctx.overdueCnt) parts.push(`기한초과 조치 ${cnt(ctx.overdueCnt)}건 (최우선)`);
      if (ctx.actionSeverityCnt && ctx.actionSeverityCnt.CRITICAL) parts.push(`긴급 등급 미조치 ${cnt(ctx.actionSeverityCnt.CRITICAL)}건`);
      if (ctx.missCnt) parts.push(`미점검 부품 ${cnt(ctx.missCnt)}건`);
      if (!parts.length) return "현재 긴급하게 처리할 항목이 없습니다. 좋은 상태입니다.";
      return "우선순위대로 안내드립니다: " + parts.join(" → ");
    }

    // ---- 4) 문의사항 ----
    if (hasAny("문의","건의사항","질문게시판")) {
      return `등록된 문의사항은 총 ${cnt(ctx.inquiriesTotal||0)}건이며, 답변대기 ${cnt(ctx.inquiriesOpen||0)}건, 답변완료 ${cnt(ctx.inquiriesAnswered||0)}건입니다.`;
    }

    // ---- 5) 마스터 통계 (부품수/점검자수) - "점검" substring 충돌 방지를 위해 구체적 조합만 인정 ----
    if (hasAny("부품수","부품몇","부품이몇","등록된부품","전체부품","부품목록몇","점검자수","점검자몇","점검자가몇","활동인원","전체인원","점검자인원")) {
      return `현재 사용중 부품은 ${cnt(ctx.partsInUseCnt)}개, 활동중인 점검자는 ${cnt(ctx.inspectorsActiveCnt)}명입니다.`;
    }

    // ---- 6) 심각도별 조치 ----
    if (hasAny("긴급","중대","경미") && hasAny("조치","건","몇","현황")) {
      const sevKey = has("긴급") ? "CRITICAL" : has("중대") ? "MAJOR" : "MINOR";
      const sevLabel = has("긴급") ? "긴급" : has("중대") ? "중대" : "경미";
      const n = ctx.actionSeverityCnt ? ctx.actionSeverityCnt[sevKey] : undefined;
      return `현재 진행중(미완료)인 ${sevLabel} 등급 조치는 ${cnt(n)}건입니다.`;
    }

    // ---- 7) 담당자별 실적/랭킹 ----
    if (hasAny("실적","랭킹","순위","누가제일","누가가장","누가잘")) {
      const list = (ctx.perInspectorToday||[]).slice().sort((a,b)=>(b.rate??-1)-(a.rate??-1));
      if (!list.length) return "오늘 배정된 담당자별 점검 실적 데이터가 없습니다.";
      const top = list.slice(0,5).map(x=>`${x.name} ${cnt(x.doneCnt)}/${cnt(x.assignedCnt)}(${pct(x.rate)})`).join(", ");
      return `담당자별 오늘 점검 실적: ${top}`;
    }

    // ---- 8) 미점검 (점검율보다 먼저 검사: "미점검" 안에 "점검"이 포함되어 있어 순서가 중요) ----
    if (hasAny("누락","미점검","안한","안했","아직안","안했음")) {
      if (!ctx.missList || ctx.missList.length === 0) return "현재 미점검 부품은 없습니다. 오늘 점검 대상이 모두 처리되었습니다.";
      const names = ctx.missList.slice(0,5).map(p=>`${p.part_name}(${p.part_code})`+((p.assignees&&p.assignees.length)?` - ${p.assignees.join(",")}`:"")).join(", ");
      return `미점검 부품이 ${cnt(ctx.missList.length)}건 있습니다: ${names}${ctx.missList.length>5?" 외":""}`;
    }

    // ---- 9) 점검율/점검현황 ----
    if (hasAny("점검율","점검률") || (has("점검") && hasAny("몇건했","몇건했어","얼마나","진행률","진척"))) {
      return `오늘 점검율은 ${pct(ctx.rate)}입니다. (대상 ${cnt(ctx.targetCnt)}건 중 ${cnt(ctx.doneCnt)}건 완료, 실제 점검 시행 ${cnt(ctx.rawTodayCount)}건)`;
    }

    // ---- 10) 이상발견 ----
    if (has("이상") && hasAny("건","몇","현황","발견","있어","있나")) {
      let ans = `금일 이상 발견 건수는 ${cnt(ctx.abnormalCnt)}건입니다. 진행중인 조치는 ${cnt(ctx.actionOpenCnt)}건입니다.`;
      if (ctx.abnormalList && ctx.abnormalList.length) ans += " (" + ctx.abnormalList.slice(0,3).map(a=>a.part_name).join(", ") + (ctx.abnormalList.length>3?" 외":"") + ")";
      return ans;
    }

    // ---- 11) 조치 이행율/현황 ----
    if (has("조치") && hasAny("이행","완료","현황","율","률")) {
      return `조치 이행율(최근7일)은 ${pct(ctx.actionDoneRate)}입니다 (승인완료 ${cnt(ctx.actionApprovedCnt)}/${cnt(ctx.actionTotalCnt)}건).` + (ctx.overdueCnt ? ` 기한 초과된 조치가 ${cnt(ctx.overdueCnt)}건 있으니 확인이 필요합니다.` : " 기한 초과 조치는 없습니다.");
    }

    // ---- 12) 지연/기한초과 ----
    if (hasAny("지연","기한초과","늦은","기한임박","기한지난")) {
      if (!ctx.overdueList || ctx.overdueList.length===0) return "기한이 지난 미완료 조치는 없습니다.";
      const names = ctx.overdueList.slice(0,5).map(a=>`${a.part_name} - ${a.issue_desc}(담당:${a.assignee}, 기한:${a.due_date})`).join(" / ");
      return `기한 초과 조치 ${cnt(ctx.overdueList.length)}건: ${names}`;
    }

    // ---- fallback: "이해하지 못했습니다" 한 줄로 끝내지 않고, 알고 있는 정보 요약 + 질문 예시를 함께 제공 ----
    if (ctx.rate !== undefined) {
      return `질문을 정확히 이해하지 못했습니다. 참고로 오늘 현황은 점검율 ${pct(ctx.rate)}, 미점검 ${cnt(ctx.missCnt)}건, 이상발견 ${cnt(ctx.abnormalCnt)}건, 조치 이행율 ${pct(ctx.actionDoneRate)}입니다. 이렇게도 물어보세요: "지연된 조치 있어?", "지금 뭐부터 해야해?", "OOO님 실적 어때?", "온도센서 상태 어때?"`;
    }
    if (ctx.item_name) {
      return `"${ctx.item_name}" 항목에 대해 더 궁금하신 점을 구체적으로 적어주시면 답변드리겠습니다. (예: "원인이 뭐야?", "재발 방지책은?")`;
    }
    return "이해하지 못했습니다. 예) '오늘 점검율은?', '미점검 부품 알려줘', '조치 이행율은?', '지연된 조치 있어?' 와 같이 질문해 보세요.";
  }

  AI.ask = async function(question, ctx){
    const prompt = [
      "당신은 제조현장 '부품 일상점검 시스템'의 데이터 어시스턴트입니다. 아래 JSON 데이터만 근거로 질문에 답하세요.",
      "규칙:",
      "1) 반드시 한국어 존댓말(합쇼체)로, 2~3문장 이내로 간결하게 답한다.",
      "2) 마크다운(별표, 헤더, 코드블록 등)이나 글머리 기호를 쓰지 않고 평문으로만 답한다.",
      "3) 숫자 표기: 인원(명) 단위는 정수로, 비율(%) 단위는 소수점 첫째자리까지 표기한다.",
      "4) 데이터에 없는 내용은 추측하지 말고 '해당 정보는 확인되지 않습니다'라고 답한다.",
      "5) missList/overdueList 등 목록 데이터를 인용할 때는 부품명과 담당자명을 함께 언급해 실무적으로 답한다.",
      "",
      "데이터(JSON): " + JSON.stringify(ctx),
      "",
      "질문: " + question
    ].join("\n");
    const llmAns = await callLLM(prompt);
    return llmAns ? llmAns.trim() : ruleBasedAnswer(question, ctx);
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
    const prompt = [
      "제조설비 부품 일상점검 중 이상이 발견되었습니다. 아래 항목 정보를 근거로 원인/영향/즉시조치/단기조치/재발방지 5가지를 각 1문장씩, 한국어 존댓말(합쇼체)로 간결히 제시하세요.",
      "실무 현장 담당자가 바로 읽고 행동할 수 있는 구체적인 문장으로 작성하고, 마크다운 없이 순수 JSON 하나만 출력하세요(설명 문구를 앞뒤에 붙이지 마세요).",
      'JSON 형식: {"cause":"","impact":"","immediate":"","shortterm":"","prevention":""}',
      "항목 정보(JSON): " + JSON.stringify(anomaly)
    ].join("\n");
    const llmAns = await callLLM(prompt);
    if (llmAns) {
      try {
        const m = llmAns.match(/\{[\s\S]*\}/);
        if (m) {
          const parsed = JSON.parse(m[0]);
          if (parsed && parsed.cause && parsed.impact && parsed.immediate && parsed.shortterm && parsed.prevention) return parsed;
        }
      } catch(e){ console.warn("[DCL.AI] 진단 응답 파싱 실패, 규칙기반으로 대체합니다", e); }
    }
    return ruleBasedDiagnose(anomaly);
  };

  // ---- 위젯 마운트 (FAB + 패널) -----------------------------------------------
  // FAB은 탑바 우측(topbar-right)에 배치해 "AI 기능이 탑재되어 있다"는 것이 한눈에 보이도록 하고,
  // 은은한 펄스(heartbeat) 애니메이션 + 이상/지연 건수 배지로 눈에 띄게 한다.
  AI.mountWidget = function(getContext){
    if (document.getElementById("aiFab")) return;
    const fab = document.createElement("div");
    fab.id = "aiFab"; fab.className = "ai-fab no-print"; fab.title = DCL.t("ai.title");
    fab.innerHTML =
      '<span class="ai-fab-ring"></span>' +
      '<span class="ai-fab-ico">✦</span>' +
      '<span class="ai-fab-label">'+escapeHtml(DCL.t("ai.fabLabel"))+'</span>' +
      '<span class="ai-fab-badge" id="aiFabBadge" hidden>0</span>';
    const panel = document.createElement("div");
    panel.id = "aiPanel"; panel.className = "ai-panel no-print";
    panel.innerHTML =
      '<div class="ai-panel-head"><span>✦ '+escapeHtml(DCL.t("ai.title"))+'</span><span style="cursor:pointer;" id="aiPanelClose">✕</span></div>' +
      '<div class="ai-panel-body" id="aiPanelBody"><div class="ai-msg">'+escapeHtml(DCL.t("ai.greeting"))+'</div></div>' +
      '<div class="ai-panel-input"><input type="text" id="aiPanelInput" placeholder="'+escapeHtml(DCL.t("ai.inputPlaceholder"))+'"/><button class="btn btn-primary btn-sm" id="aiPanelSend">'+escapeHtml(DCL.t("ai.sendBtn"))+'</button></div>';

    const topbarRight = document.querySelector(".topbar-right");
    if (topbarRight) topbarRight.insertBefore(fab, topbarRight.firstChild);
    else document.body.appendChild(fab);
    document.body.appendChild(panel);

    function refreshBadge(){
      const badge = document.getElementById("aiFabBadge");
      if (!badge) return;
      const ctx = getContext ? (getContext() || {}) : {};
      const n = (ctx.abnormalCnt||0) + (ctx.overdueCnt||0);
      if (n > 0) { badge.textContent = n > 99 ? "99+" : String(n); badge.hidden = false; }
      else { badge.hidden = true; }
    }
    refreshBadge();

    fab.addEventListener("click", ()=>{ refreshBadge(); panel.classList.toggle("open"); });
    document.getElementById("aiPanelClose").addEventListener("click", ()=> panel.classList.remove("open"));

    // 응답을 기다리는 동안 입력/전송을 잠가 중복 전송(Enter+클릭 등)을 막고,
    // "답변 작성 중..." 표시로 "느리다/응답이 없다"는 오해를 방지한다.
    let sending = false;
    async function send(){
      if (sending) return;
      const input = document.getElementById("aiPanelInput");
      const sendBtn = document.getElementById("aiPanelSend");
      const q = input.value.trim();
      if (!q) return;
      sending = true;
      input.disabled = true; sendBtn.disabled = true;
      const body = document.getElementById("aiPanelBody");
      body.insertAdjacentHTML("beforeend", '<div class="ai-msg user">'+escapeHtml(q)+'</div>');
      input.value = "";
      const waitId = "aiWait" + Date.now();
      body.insertAdjacentHTML("beforeend", '<div class="ai-msg ai-msg-wait" id="'+waitId+'">'+escapeHtml(DCL.t("ai.analyzing"))+'</div>');
      body.scrollTop = body.scrollHeight;
      try{
        const ctx = getContext ? (getContext() || {}) : {};
        const ans = await AI.ask(q, ctx);
        const waitEl = document.getElementById(waitId);
        if (waitEl) waitEl.remove();
        body.insertAdjacentHTML("beforeend", '<div class="ai-msg">'+escapeHtml(ans)+'</div>');
      }catch(e){
        const waitEl = document.getElementById(waitId);
        if (waitEl) waitEl.remove();
        body.insertAdjacentHTML("beforeend", '<div class="ai-msg">'+escapeHtml(DCL.t("ai.errorFallback"))+'</div>');
      }finally{
        sending = false;
        input.disabled = false; sendBtn.disabled = false;
        body.scrollTop = body.scrollHeight;
        input.focus();
      }
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
    let diagAsking = false;
    document.getElementById("aiDiagAsk").addEventListener("click", async function(){
      if (diagAsking) return;
      const q = document.getElementById("aiDiagQ").value.trim();
      if (!q) return;
      const askBtn = document.getElementById("aiDiagAsk");
      diagAsking = true; askBtn.disabled = true;
      document.getElementById("aiDiagAns").textContent = DCL.t("ai.analyzing");
      try{
        const ans = await AI.ask(q, anomaly);
        document.getElementById("aiDiagAns").textContent = ans;
      }catch(e){
        document.getElementById("aiDiagAns").textContent = DCL.t("ai.errorFallback");
      }finally{
        diagAsking = false; askBtn.disabled = false;
      }
    });
  };

})();
