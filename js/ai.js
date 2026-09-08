// ============================================================================
// AI 어시스턴트 (자연어 Q&A) + AI 자동진단 (이상 원인/영향/조치가이드)
// 규칙기반(Rule-based) 대체 답변은 쓰지 않는다 — 정규식으로 흉내낸 뻔한 문장을 "AI 답변"인 것처럼
// 보여주는 건 사용자를 오히려 속이는 것이라는 판단에 따라 의도적으로 제거했다(정규식 매칭은 실제
// 데이터를 이해하고 답하는 게 아니라 미리 정해둔 템플릿 문장을 고르는 것뿐이라 Gemini 수준의 신뢰도를
// 낼 수 없고, "학습"이라 부를 만한 것도 아니다 — 진짜로 학습된 모델을 쓰려면 별도의 데이터셋/학습
// 파이프라인이 필요하며 이 정적 사이트 구조로는 만들 수 없다). 대신 LLM 호출이 실패하면 실패했다고
// 솔직하게 알리고 "다시 시도" 버튼을 보여준다. provider 미설정 시에도 마찬가지로 안내만 하고 끝낸다.
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
  // 속도 개선(전면 수정): Flash 계열은 thinking을 완전히 끌 수 없어(thinkingLevel "low"가 실질적 하한),
  // (1) 항상 thinkingLevel:"low"로 지연을 최소화하고, (2) maxOutputTokens을 꼭 필요한 만큼만 요청하며,
  // (3) generateContent(한번에 응답) 대신 streamGenerateContent(SSE 스트리밍)로 호출해 토큰이 도착하는
  // 즉시 화면에 흘려보낸다 — 총 생성시간이 같아도 몇 초 안에 글자가 보이기 시작해 크롬 내장 Gemini처럼
  // 체감 속도가 빨라진다. onDelta(deltaText, fullTextSoFar)를 넘기면 청크마다 호출된다.
  // 타임아웃 정책(중요): 처음엔 "20초 넘으면 무조건 중단"이었으나, 실사용 중 정상적으로 응답이
  // 진행 중인데도(토큰이 계속 들어오는 중인데도) 총 소요시간이 20초를 넘었다는 이유만으로 강제
  // 중단되어 이미 받은 내용까지 전부 버려지고 규칙기반 답변으로 대체되는 문제가 발견됐다
  // (콘솔에 "AbortError: signal is aborted without reason"로 나타남).
  // 그래서 "총 시간"이 아니라 "무응답 시간"을 기준으로 바꾼다 — 청크가 계속 들어오는 한(느려도)
  // 죽이지 않고, 완전히 멈춰있는 시간이 STALL_MS를 넘을 때만 중단한다. HARD_CAP_MS는 만약을 위한
  // 최후 안전판이다. 또한 중단되더라도 그때까지 받은 내용(full)이 있으면 버리지 않고 그대로
  // 반환한다 — "짧아도 진짜 답"이 "규칙기반 대체 문장"보다 항상 낫다.
  const STALL_MS = 20000;   // 마지막 데이터 수신 후 이만큼 추가 응답이 없으면 중단
  const HARD_CAP_MS = 45000; // 전체 소요시간이 이걸 넘으면 무조건 중단(최후 안전판)
  async function callLLM(prompt, opts, onDelta){
    opts = opts || {};
    const maxOutputTokens = opts.maxOutputTokens || 800;
    const thinkingLevel = opts.thinkingLevel || "low";
    const controller = (typeof AbortController !== "undefined") ? new AbortController() : null;
    const hardCapId = controller ? setTimeout(function(){ controller.abort(); }, HARD_CAP_MS) : null;
    let watchdogId = null;
    try{
      if (cfg.provider === "gemini" && cfg.geminiApiKey) {
        const url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:streamGenerateContent?alt=sse&key=" + cfg.geminiApiKey;
        const res = await fetch(url, {
          method:"POST", headers:{"Content-Type":"application/json"},
          signal: controller ? controller.signal : undefined,
          body: JSON.stringify({
            contents:[{ parts:[{ text: prompt }] }],
            generationConfig: {
              temperature: 0.3,
              maxOutputTokens: maxOutputTokens,
              thinkingConfig: { thinkingLevel: thinkingLevel }
            }
          })
        });
        if (!res.body || !res.body.getReader) {
          // 스트리밍을 지원하지 않는 환경 대비 폴백: 배열 형태의 전체 응답에서 마지막 candidate를 사용
          const data = await res.json();
          const cand = Array.isArray(data) ? data[data.length-1]?.candidates?.[0] : data?.candidates?.[0];
          const text = cand?.content?.parts?.map(p=>p.text||"").join("") || undefined;
          if (!text) { console.warn("[DCL.AI] Gemini 응답에 결과가 없습니다.", data?.error || data); return null; }
          if (onDelta) onDelta(text, text);
          return text;
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder("utf-8");
        let buf = "", full = "", lastFinishReason = null;
        let lastActivity = Date.now();
        if (controller) {
          watchdogId = setInterval(function(){
            if (Date.now() - lastActivity > STALL_MS) controller.abort();
          }, 1000);
        }
        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            lastActivity = Date.now();
            buf += decoder.decode(value, { stream: true });
            let idx;
            while ((idx = buf.indexOf("\n\n")) >= 0) {
              const block = buf.slice(0, idx);
              buf = buf.slice(idx + 2);
              const line = block.split("\n").find(function(l){ return l.indexOf("data:") === 0; });
              if (!line) continue;
              const jsonStr = line.slice(5).trim();
              if (!jsonStr || jsonStr === "[DONE]") continue;
              try {
                const chunk = JSON.parse(jsonStr);
                const cand = chunk?.candidates?.[0];
                if (cand?.finishReason) lastFinishReason = cand.finishReason;
                const delta = cand?.content?.parts?.map(p=>p.text||"").join("") || "";
                if (delta) { full += delta; if (onDelta) onDelta(delta, full); }
              } catch(e2) { /* 아직 완성되지 않은 청크는 다음 루프에서 이어붙여지므로 건너뜀 */ }
            }
          }
        } catch(streamErr) {
          // 무응답/최후안전판 타임아웃으로 중간에 끊긴 경우. full이 비어있지 않다면 그대로 살려서 쓴다.
          console.warn("[DCL.AI] 스트리밍이 중간에 중단되었습니다(응답 지연). 그때까지 받은 내용을 사용합니다.", streamErr);
        }
        if (!full) { console.warn("[DCL.AI] Gemini 스트리밍 응답이 비어 있습니다."); return null; }
        if (lastFinishReason === "MAX_TOKENS") { console.warn("[DCL.AI] Gemini 응답이 토큰 한도로 중간에 잘렸습니다.", full); }
        return full;
      }
      if (cfg.provider === "groq" && cfg.groqApiKey) {
        const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method:"POST",
          headers:{"Content-Type":"application/json", "Authorization":"Bearer " + cfg.groqApiKey},
          signal: controller ? controller.signal : undefined,
          body: JSON.stringify({
            model:"llama-3.1-8b-instant",
            messages:[{role:"user", content: prompt}],
            temperature: 0.3, max_tokens: maxOutputTokens
          })
        });
        const data = await res.json();
        const text = data?.choices?.[0]?.message?.content;
        if (!text) { console.warn("[DCL.AI] Groq 응답에 결과가 없습니다.", data?.error || data); return null; }
        if (onDelta) onDelta(text, text);
        return text;
      }
    }catch(e){
      console.warn("[DCL.AI] LLM 호출 실패", e);
    }finally{
      if (hardCapId) clearTimeout(hardCapId);
      if (watchdogId) clearInterval(watchdogId);
    }
    return null;
  }

  // AI_CONFIG에 키가 하나도 없으면(provider:"none" 등) 네트워크 호출을 시도할 필요조차 없다 —
  // 바로 "설정되지 않음" 안내로 끝낸다.
  function isLLMConfigured(){
    return !!((cfg.provider === "gemini" && cfg.geminiApiKey) || (cfg.provider === "groq" && cfg.groqApiKey));
  }

  // "분석해줘/진단해줘/보고서/상세히/원인/개선방안" 등 심층 분석을 요구하는 질문인지 판별.
  // 단순 수치 조회("오늘 점검율은?")는 지금처럼 짧게, 분석형 질문은 구조화된 리포트로 답한다(스마트 하이브리드).
  function isDeepQuestion(q){
    return /분석|진단|보고서|리포트|상세히|자세히|개선\s*(방안|제언|점)|제안|원인|근본|리뷰|검토|평가/.test(String(q||""));
  }

  AI.ask = async function(question, ctx, onDelta){
    if (!isLLMConfigured()) return { text: DCL.t("ai.notConfiguredMsg"), rich: false, failed: true };
    const rich = isDeepQuestion(question);
    const prompt = rich ? [
      "당신은 제조현장 '부품 일상점검 시스템'의 데이터 분석 어시스턴트입니다. 아래 JSON 데이터만 근거로 답변하세요.",
      "규칙:",
      "1) 한국어 존댓말(합쇼체)을 사용한다.",
      "2) 마크다운으로 구조화된 보고서 형태로 답한다 — 소제목은 '## '로, 핵심 수치는 **굵게**로, 세부 항목은 '- ' 글머리 목록으로, 실행 제안은 '1. ' 번호 목록으로 작성한다.",
      "3) 구성 순서: 한 줄 요약 → ## 주요 지표 현황 → ## 상세 내역(해당 시) → ## 개선 제언(구체적으로 실행 가능한 조치, 담당/기한이 있으면 함께 언급).",
      "4) 숫자 표기: 인원(명)은 정수, 비율(%)은 소수점 첫째자리까지 표기한다.",
      "5) 데이터에 없는 내용은 추측하지 말고 '확인되지 않음'이라고 명시한다.",
      "6) 목록 항목을 인용할 때는 부품명·부품코드·담당자명·기한 등 실무 식별정보를 함께 표기한다.",
      "",
      "데이터(JSON): " + JSON.stringify(ctx),
      "",
      "질문: " + question
    ].join("\n") : [
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
    // 속도 개선: 심층 분석도 thinkingLevel은 "low"로 고정하고(Flash 계열은 이 값이 지연을 최소화하는 하한),
    // 답변 길이만 quick보다 넉넉하게(1536) 주어 구조화된 리포트 형태는 유지하면서 응답 시간을 크게 줄인다.
    const llmOpts = rich ? { maxOutputTokens: 1536, thinkingLevel: "low" } : { maxOutputTokens: 800, thinkingLevel: "low" };
    const llmAns = await callLLM(prompt, llmOpts, onDelta);
    if (llmAns) return { text: llmAns.trim(), rich: rich, failed: false };
    return { text: DCL.t("ai.llmFailedMsg"), rich: false, failed: true };
  };

  // ---- AI 자동진단 (이상 항목 클릭 시 원인/영향/조치가이드) ---------------------
  // anomaly: { part_name, item_name, input_value, lower_limit, upper_limit, judge_type }
  // 규칙기반 대체 없음: LLM 미설정/실패/파싱실패 시 { failed:true, message } 를 반환하고,
  // 호출부(showDiagnosePopup)가 이를 받아 실패 안내 + 다시 시도 버튼을 그린다.
  AI.diagnose = async function(anomaly){
    if (!isLLMConfigured()) return { failed: true, message: DCL.t("ai.notConfiguredMsg") };
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
      } catch(e){ console.warn("[DCL.AI] 진단 응답 파싱 실패", e); }
    }
    return { failed: true, message: DCL.t("ai.llmFailedMsg") };
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

    // 답변 요청 실행 + 렌더링을 하나의 함수로 묶어 최초 전송과 "다시 시도" 버튼 클릭이 동일한
    // 로직을 재사용하게 한다(규칙기반 대체가 없어졌으므로 실패 시 재시도가 유일한 복구 수단이다).
    async function runAsk(q, ansId, ctx){
      const body = document.getElementById("aiPanelBody");
      const el0 = document.getElementById(ansId);
      if (el0) { el0.className = "ai-msg ai-msg-wait"; el0.textContent = DCL.t("ai.analyzing"); }
      if (body) body.scrollTop = body.scrollHeight;
      let started = false;
      function onDelta(delta, full){
        const e = document.getElementById(ansId);
        if (!e) return;
        if (!started) { started = true; e.classList.remove("ai-msg-wait"); }
        e.textContent = full; // 스트리밍 중에는 서식 없는 원문으로 표시하고, 완료 후 마크다운으로 최종 렌더한다
        if (body) body.scrollTop = body.scrollHeight;
      }
      function renderFailed(el, msg){
        el.classList.remove("ai-msg-wait");
        el.classList.add("ai-msg-error");
        el.innerHTML = escapeHtml(msg) + ' <button class="btn btn-sm ai-retry-btn" id="'+ansId+'Retry">'+escapeHtml(DCL.t("ai.retryBtn"))+'</button>';
        const btn = document.getElementById(ansId+"Retry");
        if (btn) btn.addEventListener("click", function(){ btn.disabled = true; runAsk(q, ansId, ctx); });
      }
      try{
        const ans = await AI.ask(q, ctx, onDelta);
        const el = document.getElementById(ansId);
        if (el) {
          if (ans.failed) { renderFailed(el, ans.text); }
          else {
            el.classList.remove("ai-msg-wait");
            if (ans.rich) { el.classList.add("ai-msg-rich"); el.innerHTML = renderMarkdownLite(ans.text); }
            else { el.textContent = ans.text; }
          }
        }
      }catch(e){
        const el = document.getElementById(ansId);
        if (el) renderFailed(el, DCL.t("ai.llmFailedMsg"));
      }finally{
        if (body) body.scrollTop = body.scrollHeight;
      }
    }

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
      // 답변 말풍선을 먼저 만들어두고, 스트리밍으로 도착하는 토큰을 그 안에 실시간으로 흘려보낸다
      // (완료를 기다리지 않고 몇 초 안에 글자가 나타나기 시작 — 체감 속도의 핵심).
      const ansId = "aiAns" + Date.now();
      body.insertAdjacentHTML("beforeend", '<div class="ai-msg ai-msg-wait" id="'+ansId+'">'+escapeHtml(DCL.t("ai.analyzing"))+'</div>');
      body.scrollTop = body.scrollHeight;
      try{
        const ctx = getContext ? (getContext() || {}) : {};
        await runAsk(q, ansId, ctx);
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

  // ---- 경량 마크다운 렌더러 (심층 분석 답변 전용) --------------------------------
  // AI 응답이 ## 소제목 / **굵게** / - 목록 / 1. 번호목록 을 쓸 때만 사용한다.
  // 먼저 escapeHtml로 전체를 이스케이프한 뒤 마크다운 기호만 안전하게 치환하므로
  // 응답 텍스트에 <script> 등이 섞여도 그대로 문자로 표시될 뿐 실행되지 않는다.
  function renderMarkdownLite(md){
    const lines = escapeHtml(md).split(/\r?\n/);
    let html = ""; let ulOpen = false; let olOpen = false;
    function closeLists(){
      if (ulOpen) { html += "</ul>"; ulOpen = false; }
      if (olOpen) { html += "</ol>"; olOpen = false; }
    }
    function inline(t){
      return t.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
    }
    lines.forEach(function(raw){
      const line = raw.trim();
      if (!line) { closeLists(); return; }
      let m;
      if ((m = line.match(/^#{2,3}\s+(.*)$/))) {
        closeLists();
        html += '<div class="ai-md-h">'+inline(m[1])+'</div>';
      } else if ((m = line.match(/^[-*]\s+(.*)$/))) {
        if (olOpen) { html += "</ol>"; olOpen = false; }
        if (!ulOpen) { html += '<ul class="ai-md-ul">'; ulOpen = true; }
        html += "<li>"+inline(m[1])+"</li>";
      } else if ((m = line.match(/^\d+[.)]\s+(.*)$/))) {
        if (ulOpen) { html += "</ul>"; ulOpen = false; }
        if (!olOpen) { html += '<ol class="ai-md-ol">'; olOpen = true; }
        html += "<li>"+inline(m[1])+"</li>";
      } else {
        closeLists();
        html += "<div>"+inline(line)+"</div>";
      }
    });
    closeLists();
    return html;
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
    popup.style.display = "block";
    await renderDiagnosePopup(anomaly, popup);
  };

  // 진단 결과 렌더링을 별도 함수로 분리 — 실패 시 "다시 시도" 버튼이 이 함수를 다시 호출해
  // 처음 열었을 때와 완전히 동일한 절차로 재진단한다(규칙기반 대체 없음).
  async function renderDiagnosePopup(anomaly, popup){
    popup.innerHTML = '<div class="text-mute fs-xs">'+escapeHtml(DCL.t("ai.diagnosing"))+'</div>';
    const result = await AI.diagnose(anomaly);

    if (result.failed) {
      popup.innerHTML =
        '<div class="flex-between mb-0"><b class="fs-sm">'+escapeHtml(DCL.t("ai.diagnoseTitle"))+'</b><span style="cursor:pointer;" id="aiDiagClose">✕</span></div>' +
        '<div class="divider"></div>' +
        '<div class="ai-msg ai-msg-error fs-xs">'+escapeHtml(result.message)+' <button class="btn btn-sm ai-retry-btn" id="aiDiagRetry">'+escapeHtml(DCL.t("ai.retryBtn"))+'</button></div>';
      document.getElementById("aiDiagClose").addEventListener("click", ()=> popup.style.display="none");
      document.getElementById("aiDiagRetry").addEventListener("click", function(){ renderDiagnosePopup(anomaly, popup); });
      return;
    }

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
    async function runDiagAsk(q){
      if (diagAsking) return;
      diagAsking = true;
      const askBtn = document.getElementById("aiDiagAsk");
      if (askBtn) askBtn.disabled = true;
      const ansEl0 = document.getElementById("aiDiagAns");
      if (ansEl0) { ansEl0.className = "mt-8 fs-xs ai-msg-wait"; ansEl0.textContent = DCL.t("ai.analyzing"); }
      let started = false;
      function onDelta(delta, full){
        const el = document.getElementById("aiDiagAns");
        if (!el) return;
        if (!started) { started = true; el.classList.remove("ai-msg-wait"); }
        el.textContent = full;
      }
      try{
        const ans = await AI.ask(q, anomaly, onDelta);
        const el = document.getElementById("aiDiagAns");
        if (el) {
          el.classList.remove("ai-msg-wait");
          if (ans.failed) {
            el.classList.add("ai-msg-error");
            el.innerHTML = escapeHtml(ans.text) + ' <button class="btn btn-sm ai-retry-btn" id="aiDiagAnsRetry">'+escapeHtml(DCL.t("ai.retryBtn"))+'</button>';
            const rb = document.getElementById("aiDiagAnsRetry");
            if (rb) rb.addEventListener("click", function(){ rb.disabled = true; runDiagAsk(q); });
          } else if (ans.rich) {
            el.innerHTML = renderMarkdownLite(ans.text);
          } else {
            el.textContent = ans.text;
          }
        }
      }catch(e){
        const el = document.getElementById("aiDiagAns");
        if (el) {
          el.classList.remove("ai-msg-wait");
          el.classList.add("ai-msg-error");
          el.innerHTML = escapeHtml(DCL.t("ai.llmFailedMsg")) + ' <button class="btn btn-sm ai-retry-btn" id="aiDiagAnsRetry">'+escapeHtml(DCL.t("ai.retryBtn"))+'</button>';
          const rb = document.getElementById("aiDiagAnsRetry");
          if (rb) rb.addEventListener("click", function(){ rb.disabled = true; runDiagAsk(q); });
        }
      }finally{
        diagAsking = false;
        const btn2 = document.getElementById("aiDiagAsk");
        if (btn2) btn2.disabled = false;
      }
    }
    document.getElementById("aiDiagAsk").addEventListener("click", function(){
      const q = document.getElementById("aiDiagQ").value.trim();
      if (!q) return;
      runDiagAsk(q);
    });
  }

})();
