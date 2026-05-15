# Dynamic Sprite Emotion v4

LLM 응답 감정에 따라 캐릭터 스프라이트가 자동 전환되는 SillyTavern 확장.

## v4 주요 변경

- 🐛 **Gemini 2.5 토큰 버그 수정** (thinking 토큰 처리)
- ⭐ **ST Connection Profile 직접 사용** — 본문은 Claude, 분석은 등록된 Gemini 프로필 사용 같은 게 가능
- 📁 **폴더 통째 업로드** — 폴더 안 PNG 한번에 자동 등록
- 🗂️ **캐릭터별 아코디언** — 캐릭터 클릭해서 펼침/접힘

## 설치

깃헙 레포 URL로 ST에서 설치:
1. ST → Extensions 패널 → "Install extension"
2. URL: `https://github.com/yigasda/Dynamic-Sprite`
3. 새로고침

## ⚡ 분석용 API 옵션

### 1. 본문 생성 API 재사용 (기본)
설정 없음. ST 현재 연결된 API 그대로 사용.

### 2. ST의 다른 Connection Profile 사용 ⭐ 추천

ST에 분석용 프로필 미리 만들어두기:
1. ST 상단 ☰ → Connection Profiles → 새 프로필 만들기
2. 빠른 모델 등록 (예: Gemini 2.5 Flash, DeepSeek)
3. 이름 지정 (예: "Quick-Classify")
4. 확장 설정 → "ST의 다른 Connection Profile 사용" 선택 → 드롭다운에서 그 프로필 선택

**작동:** 본문 생성 완료 → 분석 프로필로 일시 전환 → 분류 호출 → 원래 프로필 복원. 본문 영향 없음.

### 3. Gemini API 키 직접
- [Google AI Studio](https://aistudio.google.com/apikey)에서 키 발급
- 모델명 예시: `gemini-2.5-flash`, `gemini-2.0-flash`

### 4. OpenAI 호환
- OpenRouter, OpenAI, Groq, DeepSeek 등
- "빠른 설정" 버튼으로 엔드포인트 원클릭

## 감정 등록

### 파일 선택
- 🖼️ **파일들 선택**: 이미지 여러 개 골라서 등록
- 📁 **폴더 통째로**: 폴더 안 모든 PNG 자동 인식 및 등록

### 파일명 규칙
- `SPR_Damian_aloof.png` → 라벨 `aloof`
- `happy.png` → 라벨 `happy`
- `슬픔.png` → 라벨 `슬픔`

## UI 사용법

캐릭터별 폴더(아코디언)로 정리됨:

```
▼ 🎯 Damian               12개  ← 현재 활성 캐릭터 (자동 펼침)
  [aloof]    설명...    👁 🗑
  [smile]    설명...    👁 🗑
  ...
▶ Valentin                8개   ← 다른 캐릭터 (접힘)
▶ Kang Ijun              15개
```

- ▶/▼ 클릭해서 펼침/접힘
- 라벨/설명 직접 수정 가능
- 👁 미리보기 (현재 활성 캐릭터만)
- 🗑 삭제

## 트러블슈팅

| 증상 | 해결 |
|---|---|
| Gemini "MAX_TOKENS" 에러 | v4에서 수정됨. 안 되면 모델을 `gemini-2.0-flash`로 |
| 프로필 목록 비어있음 | ST 1.12.0+ 필요. "프로필 목록 새로고침" 버튼 클릭 |
| 스프라이트 안 보임 | F12 콘솔 `[DynamicSprite]` 로그 확인 |
| 매번 같은 감정만 | "캐릭터 성격 / 분석 지침" 보강 |

## 백업

📤 백업: 모든 캐릭터 + 이미지 → JSON 한 파일 (API 키 제외)
📥 복원: 다른 PC나 재설치 후 같은 데이터 복원
