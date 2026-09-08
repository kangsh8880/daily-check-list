// ============================================================================
// AI 어시스턴트 설정 (필수 — 아래 provider/API Key가 없으면 AI 기능이 동작하지 않습니다)
// 무료 제공자 중 하나를 선택해 API Key를 입력하세요.
// 규칙기반(Rule-based) 대체 응답은 쓰지 않습니다 — API Key가 없거나 LLM 호출이 실패하면
// 정직하게 "설정되지 않음/실패" 안내와 다시 시도 버튼을 보여줄 뿐입니다.
// 지원: Gemini(google) / Groq
// ============================================================================
window.AI_CONFIG = {
  provider: "gemini",      // "gemini" | "groq" | "none"
  geminiApiKey: "AQ.Ab8RN6LJciFNBALqHRIRrMT2NqS5wU_hfrGHSVw1VjhD6oFzhg",   // https://aistudio.google.com/apikey 에서 무료 발급
  groqApiKey: ""           // https://console.groq.com/keys 에서 무료 발급
};
