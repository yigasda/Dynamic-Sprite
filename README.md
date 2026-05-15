# Dynamic Sprite Emotion Extension v3

LLM이 쓴 본문에 따라 캐릭터 스프라이트가 자동으로 바뀌는 SillyTavern 확장.

## v3 새 기능

🔥 **분석용 API 별도 설정** — 본문은 Claude Opus로 쓰고, 감정 분석은 Gemini 2.5 Flash로 빠르게.

## 설치

1. `dynamic-sprites` 폴더를 `SillyTavern/public/scripts/extensions/third-party/`로 복사
2. SillyTavern 새로고침
3. Extensions → "🎭 Dynamic Sprite Emotion"

## ⚡ 분석용 API 설정

### A. ST 본문 API 재사용 (기본, 추천: 무료/로컬 모델)
별다른 설정 없이 ST 현재 연결된 API 그대로 사용.

### B. Gemini 직접 호출 (추천: 가장 빠름)
1. API 모드 → "Gemini 직접 호출"
2. API 키: [Google AI Studio](https://aistudio.google.com/apikey)에서 발급
3. 모델명 직접 입력:
   - `gemini-2.5-flash` — 빠르고 저렴, 분류엔 충분
   - `gemini-2.5-pro` — 더 정확, 약간 느림
   - `gemini-2.0-flash` — 안정적인 옛 버전

### C. OpenAI 호환 (OpenRouter 등)
1. API 모드 → "OpenAI 호환"
2. "빠른 설정" 버튼으로 엔드포인트 자동 입력:
   - **OpenRouter** — 모든 모델 한 키로 접근 가능
   - **OpenAI** — GPT 시리즈
   - **Groq** — 초고속 추론
   - **DeepSeek** — 저렴함
3. API 키 입력
4. 모델명 입력 (OpenRouter 예: `google/gemini-2.5-flash`, `openai/gpt-4o-mini`, `anthropic/claude-3.5-haiku`)

### 🔌 연결 테스트
설정 입력 후 "API 연결 테스트" 버튼 → 응답 시간이랑 응답 내용 확인 가능.

## 감정 등록

1. 캐릭터와 채팅 시작 (자동 인식)
2. "📁 파일 선택해서 추가" → PNG 여러 개 한번에
3. 파일명에서 라벨 자동 추출 (`SPR_Damian_aloof.png` → `aloof`)
4. 각 카드에 설명 추가하면 분류 정확도 ↑

## 백업

- "📤 백업 내보내기" → JSON 파일 다운로드 (이미지 + 설정 통째로)
- **API 키는 백업에서 자동 제외** (보안)
- "📥 백업 가져오기" → 다른 PC/재설치 후 복원

## 비교: 어떤 API 쓸까?

| 옵션 | 속도 | 비용 | 정확도 | 설정 |
|---|---|---|---|---|
| ST 본문 재사용 | 본문과 동일 (보통 느림) | 본문과 합산 | 본문 모델 따라 | 없음 |
| Gemini 2.5 Flash | ⚡ 매우 빠름 (~500ms) | 매우 저렴 | 충분 | 키만 |
| Gemini 2.5 Pro | 보통 | 저렴 | 매우 높음 | 키만 |
| OpenRouter + Haiku | 빠름 | 저렴 | 높음 | 키+모델 |
| Groq + Llama | 🚀 초고속 | 저렴 | 보통 | 키+모델 |

**추천:** Gemini 2.5 Flash가 가격/속도/정확도 균형 가장 좋음.

## 트러블슈팅

| 증상 | 해결 |
|---|---|
| 스프라이트 안 보임 | F12 콘솔 `[DynamicSprite]` 로그 확인 |
| API 키 잘못 입력 | "API 연결 테스트" 버튼으로 검증 |
| Gemini가 응답 차단함 | 분석용 프롬프트는 안전 필터 BLOCK_NONE 자동 적용됨 |
| OpenRouter CORS 오류 | OpenRouter는 CORS 허용함. 다른 호환 서버는 막힐 수 있음 |
| 매번 같은 감정만 나옴 | "캐릭터 성격 / 분석 지침" 보강 |

## 데이터 저장 위치

- 설정/라벨: ST `extension_settings`
- API 키: ST `extension_settings` (브라우저 localStorage)
- 이미지: 브라우저 IndexedDB

⚠️ 브라우저 데이터 삭제 시 다 날아감. 백업 떠두기.
