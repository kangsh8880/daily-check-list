// ============================================================================
// AI 어시스턴트 설정 (선택사항)
// 무료 제공자 중 하나를 선택해 API Key를 입력하면 자연어 질의응답 품질이 향상됩니다.
// 비워두면 규칙기반(Rule-based) 응답으로 자동 동작합니다 (설정 없이도 정상 작동).
// 지원: Gemini(google) / Groq / 없음(rule-based)
// ============================================================================
window.AI_CONFIG = {
  provider: "none",        // "gemini" | "groq" | "none"
  geminiApiKey: "",        // https://aistudio.google.com/apikey 에서 무료 발급
  groqApiKey: ""           // https://console.groq.com/keys 에서 무료 발급
};
