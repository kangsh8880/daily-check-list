// ============================================================================
// 점검항목 추천 (부품유형/점검항목 화면 - "점검항목 추천" 탭)
// 1순위: 내장 표준 라이브러리에서 부품유형명/코드접두어 키워드로 카테고리를 매칭해
//        즉시(네트워크 없이) TOP5를 추천한다.
// 2순위: 매칭되는 카테고리가 없는(생소한) 부품유형이고 AI(js/ai-config.js)가 설정되어
//        있으면, LLM에게 해당 부품유형 전용 TOP5를 생성하도록 요청한다.
// 3순위: 둘 다 해당 없으면(AI 미설정) 일반 참고용 5항목을 대신 보여주고, 대신 표시임을
//        명확히 안내한다 (규칙기반 결과를 "AI 추천"으로 위장하지 않는다 - 대시보드 구축
//        원칙의 "규칙기반 대체 답변 금지" 원칙과 동일한 정신을 적용).
// ============================================================================
(function(){
  "use strict";

  // ---- 1) 표준 라이브러리 ---------------------------------------------------
  // 각 항목은 checklist_templates 테이블 컬럼명과 동일한 키를 사용해, 추천 → 등록 시
  // 변환 없이 그대로 fn_upsert_checklist_item RPC 인자로 넘길 수 있게 한다.
  const RECOMMEND_LIBRARY = [
    {
      label: "모터/구동부",
      keywords: ["모터", "motor", "mtr", "구동"],
      items: [
        { item_name:"외관 손상/오염 여부", judge_type:"OX", photo_required:true,
          reason:"외관 손상은 내부 고장으로 번지기 전 가장 먼저 육안으로 확인 가능한 신호입니다" },
        { item_name:"이상소음/진동", judge_type:"OX",
          reason:"베어링 마모나 축 정렬 불량 등 회전체 이상을 가장 빠르게 포착할 수 있는 핵심 지표입니다" },
        { item_name:"작동온도", judge_type:"NUMERIC", unit:"℃", lower_limit:0, upper_limit:80,
          reason:"과열은 절연 열화와 소손의 직접 원인이므로 수치로 관리할 필요가 있습니다" },
        { item_name:"베어링 상태(그리스/마모)", judge_type:"OX",
          reason:"베어링 손상은 모터 정지를 유발하는 가장 흔한 원인 중 하나입니다" },
        { item_name:"결선/단자 체결 상태", judge_type:"OX",
          reason:"단자 풀림은 접촉 불량과 국부 발열·화재로 이어질 수 있습니다" },
      ]
    },
    {
      label: "밸브/배관",
      keywords: ["밸브", "valve", "vlv", "배관", "pipe", "piping", "파이프"],
      items: [
        { item_name:"누유/누수 여부", judge_type:"OX", photo_required:true,
          reason:"유체 누출은 안전사고 및 2차 오염으로 직결되는 최우선 점검 항목입니다" },
        { item_name:"개폐 작동상태", judge_type:"SELECT", select_options:"정상,뻑뻑함,작동불가",
          reason:"개폐 불량은 공정 제어 실패나 압력 이상으로 이어질 수 있습니다" },
        { item_name:"볼트/플랜지 체결 상태", judge_type:"OX",
          reason:"체결 이완은 누설의 선행 신호로, 조기 발견 시 큰 사고를 예방할 수 있습니다" },
        { item_name:"부식/도장 손상 여부", judge_type:"OX",
          reason:"부식은 배관 두께 감소로 인한 파열 위험을 나타내는 장기 열화 지표입니다" },
        { item_name:"압력계 지시값 정상 여부", judge_type:"OX",
          reason:"압력 이상은 상류 설비의 이상을 조기에 알려주는 간접 지표입니다" },
      ]
    },
    {
      label: "센서/계측기",
      keywords: ["센서", "sensor", "snr", "계측", "게이지", "gauge"],
      items: [
        { item_name:"센서 오염/이물질", judge_type:"OX", photo_required:true,
          reason:"측정면 오염은 측정값 왜곡을 일으키는 가장 흔한 원인입니다" },
        { item_name:"측정값 정상범위", judge_type:"OX",
          reason:"측정값 이상은 공정 데이터의 신뢰성에 직접 영향을 미칩니다" },
        { item_name:"케이블/커넥터 손상 여부", judge_type:"OX",
          reason:"배선 손상은 신호 단절이나 오작동을 유발할 수 있습니다" },
        { item_name:"캘리브레이션(교정) 유효기간", judge_type:"OX",
          reason:"교정 기한 경과 시 측정 정확도를 보증할 수 없습니다" },
        { item_name:"표시부(디스플레이) 정상 작동", judge_type:"OX",
          reason:"표시부 이상은 현장 작업자의 오판단으로 이어질 수 있습니다" },
      ]
    },
    {
      label: "펌프",
      keywords: ["펌프", "pump", "pmp"],
      items: [
        { item_name:"이상소음/진동", judge_type:"OX",
          reason:"임펠러 손상이나 캐비테이션을 가장 먼저 알려주는 신호입니다" },
        { item_name:"토출압력 정상범위", judge_type:"NUMERIC", unit:"bar",
          reason:"압력 저하는 배관 막힘이나 임펠러 마모를 짐작하게 하는 간접 지표입니다" },
        { item_name:"누유/누수 여부", judge_type:"OX", photo_required:true,
          reason:"축봉부 누설은 펌프 고장의 대표적인 전조 증상입니다" },
        { item_name:"베어링/축봉 상태", judge_type:"OX",
          reason:"축계 이상은 장기적으로 펌프 전체 수명에 영향을 미칩니다" },
        { item_name:"모터 작동전류 정상범위", judge_type:"NUMERIC", unit:"A",
          reason:"전류의 비정상적 상승은 부하 증가나 기계적 이상을 나타냅니다" },
      ]
    },
    {
      label: "베어링",
      keywords: ["베어링", "bearing", "brg"],
      items: [
        { item_name:"이상소음 여부", judge_type:"OX",
          reason:"베어링 손상 초기에 가장 먼저 나타나는 청각적 신호입니다" },
        { item_name:"진동값 정상범위", judge_type:"NUMERIC", unit:"mm/s",
          reason:"진동 수치는 베어링 열화 정도를 정량적으로 추적할 수 있는 지표입니다" },
        { item_name:"표면 온도 정상범위", judge_type:"NUMERIC", unit:"℃",
          reason:"과도한 마찰은 온도 상승으로 나타나며 소손의 전조입니다" },
        { item_name:"그리스(윤활) 상태", judge_type:"OX",
          reason:"윤활 부족은 베어링 조기 마모의 가장 흔한 원인입니다" },
        { item_name:"마모/파손 여부", judge_type:"OX", photo_required:true,
          reason:"육안 마모 확인은 교체 시기를 판단하는 직접적인 근거가 됩니다" },
      ]
    },
    {
      label: "전기/제어반",
      keywords: ["전기", "electric", "제어반", "panel", "판넬", "분전반", "mcc", "제어함"],
      items: [
        { item_name:"외관 손상/변색 여부", judge_type:"OX", photo_required:true,
          reason:"변색은 과열·아크 발생을 나타내는 대표적인 육안 징후입니다" },
        { item_name:"이상 발열 여부", judge_type:"OX",
          reason:"국부 발열은 접촉 불량이나 과부하를 나타내는 화재 예방 핵심 지표입니다" },
        { item_name:"결선/단자 체결 상태", judge_type:"OX",
          reason:"단자 이완은 접촉저항 증가로 인한 발열의 직접 원인입니다" },
        { item_name:"표시등(램프) 정상 작동", judge_type:"OX",
          reason:"상태 표시등 오작동은 실제 이상 상태를 놓치게 만들 수 있습니다" },
        { item_name:"접지 상태", judge_type:"OX",
          reason:"접지 불량은 감전 등 중대 안전사고로 직결됩니다" },
      ]
    },
    {
      label: "실린더/공압",
      keywords: ["실린더", "cylinder", "공압", "액추에이터", "actuator", "에어실린더"],
      items: [
        { item_name:"누유/누기 여부", judge_type:"OX", photo_required:true,
          reason:"공압·유압 누설은 작동 불량과 에너지 손실의 직접 원인입니다" },
        { item_name:"작동 스트로크 정상 여부", judge_type:"OX",
          reason:"스트로크 이상은 위치 제어 정밀도에 직접 영향을 줍니다" },
        { item_name:"로드(피스톤) 손상 여부", judge_type:"OX",
          reason:"로드 손상은 실링 손상으로 이어져 누설을 가속화합니다" },
        { item_name:"압력 정상범위", judge_type:"NUMERIC", unit:"bar",
          reason:"압력 저하는 실린더 출력 부족의 원인이 됩니다" },
        { item_name:"리밋스위치(센서) 작동 정상", judge_type:"OX",
          reason:"위치 센서 오작동은 설비 오동작이나 충돌 사고로 이어질 수 있습니다" },
      ]
    },
    {
      label: "컨베이어/벨트",
      keywords: ["컨베이어", "conveyor", "벨트", "belt"],
      items: [
        { item_name:"벨트 마모/손상 여부", judge_type:"OX", photo_required:true,
          reason:"벨트 파손은 라인 정지로 직결되는 가장 치명적인 고장입니다" },
        { item_name:"이상소음 여부", judge_type:"OX",
          reason:"롤러 베어링이나 모터 이상을 조기에 감지할 수 있는 지표입니다" },
        { item_name:"사행(정렬) 상태", judge_type:"OX",
          reason:"벨트 사행은 마모 가속 및 이탈 사고의 원인이 됩니다" },
        { item_name:"롤러 회전 상태", judge_type:"OX",
          reason:"롤러 고착은 벨트 국부 마모와 화재 위험을 유발할 수 있습니다" },
        { item_name:"텐션(장력) 정상 여부", judge_type:"OX",
          reason:"장력 이상은 벨트 미끄러짐이나 조기 파손으로 이어집니다" },
      ]
    },
    {
      label: "필터",
      keywords: ["필터", "filter", "flt"],
      items: [
        { item_name:"이물질/막힘 여부", judge_type:"OX", photo_required:true,
          reason:"막힘은 압력 손실과 유량 저하의 직접 원인입니다" },
        { item_name:"차압 정상범위", judge_type:"NUMERIC", unit:"kPa",
          reason:"차압 수치는 필터 교체 시기를 가장 객관적으로 판단하는 근거입니다" },
        { item_name:"교체주기 경과 여부", judge_type:"OX",
          reason:"주기 경과 시 여과 성능이 급격히 저하될 수 있습니다" },
        { item_name:"외관 손상 여부", judge_type:"OX",
          reason:"하우징 손상은 미여과 유체의 우회 유입 경로가 될 수 있습니다" },
        { item_name:"실링(밀폐) 상태", judge_type:"OX",
          reason:"실링 불량은 여과되지 않은 이물질의 직접적인 통과 경로입니다" },
      ]
    },
  ];

  // 카테고리 매칭 실패 시(생소한 부품유형이고 AI도 미설정일 때) 대신 보여줄 일반 참고용 항목.
  // "일반 참고용"임을 항상 명시적으로 표기하므로, 규칙기반 결과를 AI 추천으로 위장하지 않는다.
  const FALLBACK_ITEMS = [
    { item_name:"외관 손상/오염 여부", judge_type:"OX", photo_required:true,
      reason:"대부분의 설비 이상은 외관 변화로 먼저 나타납니다 (일반 참고용)" },
    { item_name:"이상소음/냄새 발생 여부", judge_type:"OX",
      reason:"오감으로 확인 가능한 가장 기본적인 이상 감지 방법입니다 (일반 참고용)" },
    { item_name:"정상 작동 여부", judge_type:"OX",
      reason:"설비 본연의 기능이 정상 수행되는지 확인하는 기본 항목입니다 (일반 참고용)" },
    { item_name:"체결/고정 상태", judge_type:"OX",
      reason:"풀림·이완은 대부분의 기계 설비에서 공통적으로 발생하는 고장 원인입니다 (일반 참고용)" },
    { item_name:"안전라벨/표시 부착 상태", judge_type:"OX",
      reason:"안전 표시 훼손은 작업자 안전과 직결됩니다 (일반 참고용)" },
  ];

  // ---- 2) 카테고리 매칭 ------------------------------------------------------
  // 부품유형명 + 코드접두어에 카테고리 키워드가 몇 개 포함되는지로 점수를 매겨 최고점 카테고리를
  // 고른다. 동점이면 라이브러리에 먼저 정의된 카테고리를 우선한다(단순하지만 이 정도 카테고리
  // 개수에서는 충분히 명확한 결과를 낸다).
  function matchCategory(typeName, codePrefix){
    const norm = ((typeName||"") + " " + (codePrefix||"")).toLowerCase();
    let best = null, bestScore = 0;
    RECOMMEND_LIBRARY.forEach(function(cat){
      const score = cat.keywords.filter(function(k){ return norm.indexOf(k.toLowerCase()) >= 0; }).length;
      if (score > bestScore) { bestScore = score; best = cat; }
    });
    return { category: best, score: bestScore };
  }

  // ---- 3) AI(LLM) 보완 ------------------------------------------------------
  function isLLMConfigured(){
    const cfg = window.AI_CONFIG || {};
    if (cfg.provider === "gemini") return !!cfg.geminiApiKey;
    if (cfg.provider === "groq") return !!cfg.groqApiKey;
    return false;
  }

  function buildPrompt(typeName, description){
    return [
      "당신은 제조설비 일상점검 체크리스트를 설계하는 전문가입니다.",
      "아래 부품유형에 대해, 일상점검(현장 작업자가 매일 육안/간단 측정으로 수행) 관점에서",
      "가장 적정한 점검항목 5개를 선정해 순수 JSON 배열로만 답하세요. 다른 설명, 마크다운, 코드블록 표시 없이 JSON만 출력합니다.",
      "",
      "부품유형명: " + (typeName || ""),
      "설명: " + (description || "(없음)"),
      "",
      "각 배열 원소는 다음 필드를 가진 객체입니다:",
      '{"item_name": string(점검항목명, 한국어), "judge_type": "OX"|"NUMERIC"|"SELECT", ' +
      '"unit": string|null(judge_type이 NUMERIC일 때만 단위, 예: "℃"), ' +
      '"lower_limit": number|null(NUMERIC일 때 하한, 모르면 null), ' +
      '"upper_limit": number|null(NUMERIC일 때 상한, 모르면 null), ' +
      '"select_options": string|null(judge_type이 SELECT일 때만 콤마로 구분된 옵션, 첫번째가 정상), ' +
      '"photo_required": boolean(이상 발견 시 사진 첨부가 특히 중요하면 true), ' +
      '"reason": string(이 항목을 추천하는 이유, 한국어 한 문장)}',
      "판정유형은 실제 현장에서 가장 자연스러운 것으로 고르세요(정상/이상 판정이면 OX, 수치 기준이 명확하면 NUMERIC, 여러 상태 중 하나를 고르는 것이면 SELECT).",
    ].join("\n");
  }

  function extractJson(text){
    if (!text) return null;
    const m = text.match(/\[[\s\S]*\]/);
    if (!m) return null;
    try { return JSON.parse(m[0]); } catch(e){ return null; }
  }

  function validateItems(arr){
    if (!Array.isArray(arr) || !arr.length) return null;
    const valid = arr.filter(function(it){
      return it && typeof it.item_name === "string" && it.item_name.trim() &&
        ["OX","NUMERIC","SELECT"].indexOf(it.judge_type) >= 0;
    }).slice(0, 5).map(function(it){
      return {
        item_name: it.item_name.trim(),
        judge_type: it.judge_type,
        unit: it.unit || null,
        lower_limit: (it.lower_limit === undefined || it.lower_limit === null || it.lower_limit === "") ? null : Number(it.lower_limit),
        upper_limit: (it.upper_limit === undefined || it.upper_limit === null || it.upper_limit === "") ? null : Number(it.upper_limit),
        select_options: it.select_options || null,
        photo_required: !!it.photo_required,
        reason: (it.reason || "").toString().trim() || null,
      };
    });
    return valid.length ? valid : null;
  }

  // Gemini: 짧은 JSON 한 덩어리만 필요하므로 스트리밍 없이 generateContent 단발 호출.
  // (대시보드_구축_원칙.md "AI 자동진단처럼 구조화된 응답이 필요한 경우" 패턴과 동일)
  async function callGemini(prompt){
    const cfg = window.AI_CONFIG || {};
    const url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=" + cfg.geminiApiKey;
    const controller = new AbortController();
    const timeoutId = setTimeout(function(){ controller.abort(); }, 30000);
    try {
      const res = await fetch(url, {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.3, maxOutputTokens: 1200, thinkingConfig: { thinkingLevel: "low" } }
        })
      });
      if (!res.ok) return null;
      const data = await res.json();
      const text = data && data.candidates && data.candidates[0] && data.candidates[0].content &&
        data.candidates[0].content.parts && data.candidates[0].content.parts.map(function(p){ return p.text||""; }).join("");
      return validateItems(extractJson(text));
    } catch(e) {
      return null;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  // Groq: OpenAI 호환 chat completions 엔드포인트.
  async function callGroq(prompt){
    const cfg = window.AI_CONFIG || {};
    const controller = new AbortController();
    const timeoutId = setTimeout(function(){ controller.abort(); }, 30000);
    try {
      const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST", signal: controller.signal,
        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + cfg.groqApiKey },
        body: JSON.stringify({
          model: "llama-3.1-8b-instant",
          temperature: 0.3,
          messages: [{ role: "user", content: prompt }]
        })
      });
      if (!res.ok) return null;
      const data = await res.json();
      const text = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
      return validateItems(extractJson(text));
    } catch(e) {
      return null;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async function callLLMJson(prompt){
    const cfg = window.AI_CONFIG || {};
    if (cfg.provider === "gemini") return await callGemini(prompt);
    if (cfg.provider === "groq") return await callGroq(prompt);
    return null;
  }

  // ---- 4) 공개 API ------------------------------------------------------------
  // source: "library" | "ai" | "ai_failed" | "fallback"
  window.DCL = window.DCL || {};
  DCL.TypeRecommend = {
    match: matchCategory,
    isLLMConfigured: isLLMConfigured,
    get: async function(typeName, codePrefix, description){
      const matched = matchCategory(typeName, codePrefix);
      if (matched.category && matched.score >= 1) {
        return { source:"library", category: matched.category.label, items: matched.category.items };
      }
      if (isLLMConfigured()) {
        const aiItems = await callLLMJson(buildPrompt(typeName, description));
        if (aiItems) return { source:"ai", items: aiItems };
        return { source:"ai_failed", items: FALLBACK_ITEMS };
      }
      return { source:"fallback", items: FALLBACK_ITEMS };
    }
  };
})();
