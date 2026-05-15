import { eventSource, event_types, saveSettingsDebounced } from "../../../../script.js";
import { extension_settings, getContext } from "../../../extensions.js";

const extensionName = "dynamic-sprites";

// ====================================================================
// 기본 설정
// ====================================================================
const defaultSettings = {
    enabled: true,
    showSprite: true,
    transitionDuration: 300,
    customPrompt: "",

    // === API 설정 ===
    // 'st': 본문 생성과 동일한 ST API 재사용 (기본)
    // 'gemini': Google Gemini 직접 호출
    // 'openai_compat': OpenAI 호환 (OpenRouter, 자체 호스팅 등)
    apiMode: "st",
    apiKey: "",
    apiEndpoint: "", // OpenAI 호환용 base URL
    apiModel: "",

    // 캐릭터별 감정 데이터
    characters: {}
};

// ====================================================================
// IndexedDB - 이미지 저장
// ====================================================================
const DB_NAME = "DynamicSpritesDB";
const STORE_NAME = "sprites";
let db = null;

function openDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = (e) => {
            const database = e.target.result;
            if (!database.objectStoreNames.contains(STORE_NAME)) {
                database.createObjectStore(STORE_NAME);
            }
        };
        req.onsuccess = (e) => { db = e.target.result; resolve(db); };
        req.onerror = (e) => reject(e.target.error);
    });
}

async function saveImage(key, blob) {
    if (!db) await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readwrite");
        const req = tx.objectStore(STORE_NAME).put(blob, key);
        req.onsuccess = () => resolve();
        req.onerror = (e) => reject(e.target.error);
    });
}

async function loadImage(key) {
    if (!db) await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readonly");
        const req = tx.objectStore(STORE_NAME).get(key);
        req.onsuccess = () => resolve(req.result);
        req.onerror = (e) => reject(e.target.error);
    });
}

async function deleteImage(key) {
    if (!db) await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readwrite");
        const req = tx.objectStore(STORE_NAME).delete(key);
        req.onsuccess = () => resolve();
        req.onerror = (e) => reject(e.target.error);
    });
}

// ====================================================================
// 설정 로드
// ====================================================================
function loadSettings() {
    extension_settings[extensionName] = extension_settings[extensionName] || {};
    if (Object.keys(extension_settings[extensionName]).length === 0) {
        Object.assign(extension_settings[extensionName], defaultSettings);
    }
    for (const key in defaultSettings) {
        if (extension_settings[extensionName][key] === undefined) {
            extension_settings[extensionName][key] = defaultSettings[key];
        }
    }
    return extension_settings[extensionName];
}

function getCurrentCharName() {
    const context = getContext();
    return context.name2 || context.characters?.[context.characterId]?.name || null;
}

function getCharData(charName) {
    const settings = extension_settings[extensionName];
    if (!settings.characters[charName]) {
        settings.characters[charName] = { emotions: [], current: null };
    }
    return settings.characters[charName];
}

// ====================================================================
// 스프라이트 컨테이너
// ====================================================================
function createSpriteContainer() {
    if (document.getElementById("dynamic-sprite-container")) return;
    const container = document.createElement("div");
    container.id = "dynamic-sprite-container";
    container.innerHTML = `<img id="dynamic-sprite-img" alt="sprite">`;
    document.body.appendChild(container);
}

let currentBlobUrl = null;
async function updateSprite(emotionLabel) {
    const settings = extension_settings[extensionName];
    if (!settings.enabled || !settings.showSprite) return;

    const charName = getCurrentCharName();
    if (!charName) return;

    const charData = getCharData(charName);
    const emotion = charData.emotions.find(e => e.label === emotionLabel)
        || charData.emotions.find(e => e.label.toLowerCase() === "neutral")
        || charData.emotions[0];
    if (!emotion) return;

    const img = document.getElementById("dynamic-sprite-img");
    if (!img) return;

    try {
        const blob = await loadImage(emotion.imageKey);
        if (!blob) return;

        if (currentBlobUrl) URL.revokeObjectURL(currentBlobUrl);
        currentBlobUrl = URL.createObjectURL(blob);

        img.style.transition = `opacity ${settings.transitionDuration}ms ease`;
        img.style.opacity = "0";

        setTimeout(() => {
            img.src = currentBlobUrl;
            img.style.display = "block";
            img.style.opacity = "1";
            charData.current = emotionLabel;
            saveSettingsDebounced();
        }, settings.transitionDuration);
    } catch (err) {
        console.error("[DynamicSprite] 이미지 로드 실패:", err);
    }
}

// ====================================================================
// 프롬프트 빌더 (공용)
// ====================================================================
function buildEmotionPrompt(messageText, charName, charData, customInstruction) {
    const emotionDescriptions = charData.emotions.map(e => {
        return e.description?.trim()
            ? `- ${e.label}: ${e.description}`
            : `- ${e.label}`;
    }).join("\n");

    return `[System Task: Emotion Classification]

다음 캐릭터(${charName})의 대사/행동을 읽고, 캐릭터가 지금 느끼는 가장 두드러진 감정 하나를 골라.

[캐릭터 응답]
${messageText}

[가능한 감정 라벨 - 반드시 이 중에서만 선택]
${emotionDescriptions}

${customInstruction ? `[캐릭터 성격 / 추가 지침]\n${customInstruction}\n` : ""}
[규칙]
- 위 라벨 중 하나의 이름만 정확히 출력 (설명은 출력하지 않음)
- 마크다운, 따옴표, 다른 텍스트 일절 금지
- 라벨 이름 하나만 단독으로 출력

답:`;
}

// ====================================================================
// API 호출 - Gemini 직접
// ====================================================================
async function callGemini(prompt, apiKey, model) {
    if (!apiKey) throw new Error("Gemini API 키가 비어있음");
    if (!model) throw new Error("Gemini 모델명이 비어있음");

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

    const body = {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 20,
            topP: 0.95
        },
        // 안전 필터 모두 해제 (분류 태스크라 차단되면 곤란)
        safetySettings: [
            { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
        ]
    };

    const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
    });

    if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Gemini ${res.status}: ${errText.slice(0, 200)}`);
    }

    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error("Gemini 응답 비어있음: " + JSON.stringify(data).slice(0, 200));
    return text;
}

// ====================================================================
// API 호출 - OpenAI 호환 (OpenRouter, 로컬 등)
// ====================================================================
async function callOpenAICompat(prompt, apiKey, endpoint, model) {
    if (!endpoint) throw new Error("API 엔드포인트가 비어있음");
    if (!model) throw new Error("모델명이 비어있음");

    // 끝의 / 정리
    const baseUrl = endpoint.replace(/\/+$/, "");
    const url = baseUrl.endsWith("/chat/completions")
        ? baseUrl
        : `${baseUrl}/chat/completions`;

    const headers = {
        "Content-Type": "application/json"
    };
    if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

    // OpenRouter 권장 헤더
    if (url.includes("openrouter.ai")) {
        headers["HTTP-Referer"] = window.location.origin;
        headers["X-Title"] = "SillyTavern Dynamic Sprites";
    }

    const body = {
        model: model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.1,
        max_tokens: 20
    };

    const res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body)
    });

    if (!res.ok) {
        const errText = await res.text();
        throw new Error(`${res.status}: ${errText.slice(0, 200)}`);
    }

    const data = await res.json();
    const text = data.choices?.[0]?.message?.content;
    if (!text) throw new Error("응답 비어있음: " + JSON.stringify(data).slice(0, 200));
    return text;
}

// ====================================================================
// API 호출 - ST 본문 API 재사용
// ====================================================================
async function callSTApi(prompt) {
    const context = getContext();
    return await context.generateQuietPrompt(prompt, false, false);
}

// ====================================================================
// 감정 분석 - 통합 라우터
// ====================================================================
async function analyzeEmotion(messageText) {
    const settings = extension_settings[extensionName];
    const charName = getCurrentCharName();
    if (!charName) return null;

    const charData = getCharData(charName);
    if (charData.emotions.length === 0) return null;

    const prompt = buildEmotionPrompt(
        messageText, charName, charData, settings.customPrompt?.trim() || ""
    );

    try {
        let result;
        const startTime = performance.now();

        switch (settings.apiMode) {
            case "gemini":
                result = await callGemini(prompt, settings.apiKey, settings.apiModel);
                break;
            case "openai_compat":
                result = await callOpenAICompat(
                    prompt, settings.apiKey, settings.apiEndpoint, settings.apiModel
                );
                break;
            case "st":
            default:
                result = await callSTApi(prompt);
                break;
        }

        const elapsed = Math.round(performance.now() - startTime);
        const cleaned = result.trim().toLowerCase().replace(/[*_`"'.\s]+/g, "");

        let matched = charData.emotions.find(e => e.label.toLowerCase() === cleaned);
        if (!matched) {
            matched = charData.emotions.find(e =>
                cleaned.includes(e.label.toLowerCase()) ||
                e.label.toLowerCase().includes(cleaned)
            );
        }

        const finalLabel = matched?.label || charData.emotions[0].label;
        console.log(`[DynamicSprite] (${settings.apiMode}, ${elapsed}ms) "${result.trim()}" → ${finalLabel}`);
        return finalLabel;
    } catch (err) {
        console.error("[DynamicSprite] 감정 분석 실패:", err);
        toastr.error(`감정 분석 실패: ${err.message}`, "Dynamic Sprite", { timeOut: 5000 });
        return null;
    }
}

// ====================================================================
// 메시지 수신 핸들러
// ====================================================================
let processing = false;
async function onMessageReceived(messageId) {
    const settings = extension_settings[extensionName];
    if (!settings.enabled || processing) return;

    const context = getContext();
    const message = context.chat?.[messageId];
    if (!message || message.is_user || message.is_system) return;
    if (!message.mes || message.mes.trim().length < 5) return;

    processing = true;
    try {
        const emotion = await analyzeEmotion(message.mes);
        if (emotion) await updateSprite(emotion);
    } finally {
        processing = false;
    }
}

// ====================================================================
// 파일명 → 감정 라벨
// ====================================================================
function extractEmotionFromFilename(filename) {
    let name = filename.replace(/\.(png|jpg|jpeg|webp|gif)$/i, "");
    name = name.replace(/^SPR_/i, "");
    const parts = name.split("_");
    if (parts.length > 1) return parts.slice(1).join("_").toLowerCase();
    return name.toLowerCase();
}

// ====================================================================
// 감정 추가
// ====================================================================
async function addEmotion(file, customLabel = null) {
    const charName = getCurrentCharName();
    if (!charName) {
        toastr.warning("먼저 캐릭터를 선택하세요");
        return null;
    }

    const charData = getCharData(charName);
    const label = customLabel || extractEmotionFromFilename(file.name);

    const existing = charData.emotions.find(e => e.label === label);
    if (existing) {
        if (!confirm(`"${label}" 이미 존재합니다. 덮어쓸까요?`)) return null;
        await deleteImage(existing.imageKey);
        charData.emotions = charData.emotions.filter(e => e.label !== label);
    }

    const imageKey = `${charName}__${label}__${Date.now()}`;
    await saveImage(imageKey, file);

    charData.emotions.push({
        label, imageKey, description: "", addedAt: Date.now()
    });

    saveSettingsDebounced();
    return label;
}

// ====================================================================
// 감정 리스트 렌더링
// ====================================================================
function renderEmotionList() {
    const charName = getCurrentCharName();
    const listEl = document.getElementById("ds-emotion-list");
    const charNameEl = document.getElementById("ds-current-char");
    if (!listEl) return;

    if (!charName) {
        charNameEl.textContent = "(캐릭터 선택 안 됨)";
        listEl.innerHTML = "<div class='ds-empty'>채팅을 시작하면 캐릭터가 자동 인식됨</div>";
        return;
    }

    charNameEl.textContent = charName;
    const charData = getCharData(charName);

    if (charData.emotions.length === 0) {
        listEl.innerHTML = "<div class='ds-empty'>아직 등록된 감정 없음. 아래에서 추가하세요 ↓</div>";
        return;
    }

    listEl.innerHTML = "";
    charData.emotions.forEach((emotion, idx) => {
        const item = document.createElement("div");
        item.className = "ds-emotion-item";
        item.innerHTML = `
            <img class="ds-thumb" data-key="${emotion.imageKey}" alt="${emotion.label}">
            <div class="ds-emotion-info">
                <input type="text" class="ds-emotion-label text_pole" value="${emotion.label}" data-idx="${idx}">
                <textarea class="ds-emotion-desc text_pole" rows="2"
                    placeholder="설명 (선택) - 예: 차갑게 비웃는 표정"
                    data-idx="${idx}">${emotion.description || ""}</textarea>
            </div>
            <div class="ds-emotion-actions">
                <button class="menu_button ds-preview-btn" data-idx="${idx}" title="미리보기">👁</button>
                <button class="menu_button ds-delete-btn" data-idx="${idx}" title="삭제">🗑</button>
            </div>
        `;
        listEl.appendChild(item);

        loadImage(emotion.imageKey).then(blob => {
            if (blob) {
                const url = URL.createObjectURL(blob);
                item.querySelector(".ds-thumb").src = url;
            }
        });
    });

    listEl.querySelectorAll(".ds-emotion-label").forEach(input => {
        input.addEventListener("change", (e) => {
            const idx = parseInt(e.target.dataset.idx);
            charData.emotions[idx].label = e.target.value.trim();
            saveSettingsDebounced();
        });
    });

    listEl.querySelectorAll(".ds-emotion-desc").forEach(input => {
        input.addEventListener("change", (e) => {
            const idx = parseInt(e.target.dataset.idx);
            charData.emotions[idx].description = e.target.value.trim();
            saveSettingsDebounced();
        });
    });

    listEl.querySelectorAll(".ds-preview-btn").forEach(btn => {
        btn.addEventListener("click", (e) => {
            const idx = parseInt(e.currentTarget.dataset.idx);
            updateSprite(charData.emotions[idx].label);
        });
    });

    listEl.querySelectorAll(".ds-delete-btn").forEach(btn => {
        btn.addEventListener("click", async (e) => {
            const idx = parseInt(e.currentTarget.dataset.idx);
            const emotion = charData.emotions[idx];
            if (!confirm(`"${emotion.label}" 감정을 삭제할까요?`)) return;
            await deleteImage(emotion.imageKey);
            charData.emotions.splice(idx, 1);
            saveSettingsDebounced();
            renderEmotionList();
        });
    });
}

// ====================================================================
// API 모드별 UI 표시/숨김
// ====================================================================
function updateApiFieldsVisibility() {
    const settings = extension_settings[extensionName];
    const mode = settings.apiMode;

    const stHint = document.getElementById("ds-api-st-hint");
    const keyField = document.getElementById("ds-api-key-field");
    const endpointField = document.getElementById("ds-api-endpoint-field");
    const modelField = document.getElementById("ds-api-model-field");
    const presetsField = document.getElementById("ds-api-presets-field");

    if (!stHint) return;

    if (mode === "st") {
        stHint.style.display = "block";
        keyField.style.display = "none";
        endpointField.style.display = "none";
        modelField.style.display = "none";
        presetsField.style.display = "none";
    } else if (mode === "gemini") {
        stHint.style.display = "none";
        keyField.style.display = "block";
        endpointField.style.display = "none";
        modelField.style.display = "block";
        presetsField.style.display = "block";

        document.getElementById("ds-api-key-label").textContent = "Gemini API 키";
        document.getElementById("ds-api-model-label").textContent = "모델명 (예: gemini-2.5-flash, gemini-2.5-pro, gemini-2.0-flash)";
        renderPresets("gemini");
    } else if (mode === "openai_compat") {
        stHint.style.display = "none";
        keyField.style.display = "block";
        endpointField.style.display = "block";
        modelField.style.display = "block";
        presetsField.style.display = "block";

        document.getElementById("ds-api-key-label").textContent = "API 키 (필요시)";
        document.getElementById("ds-api-model-label").textContent = "모델명 (예: openai/gpt-4o-mini, anthropic/claude-3.5-haiku 등)";
        renderPresets("openai_compat");
    }
}

// OpenRouter / 일반 OpenAI 호환 프리셋
function renderPresets(mode) {
    const container = document.getElementById("ds-api-presets");
    if (!container) return;

    let presets = [];
    if (mode === "openai_compat") {
        presets = [
            { name: "OpenRouter", endpoint: "https://openrouter.ai/api/v1" },
            { name: "OpenAI", endpoint: "https://api.openai.com/v1" },
            { name: "Groq", endpoint: "https://api.groq.com/openai/v1" },
            { name: "DeepSeek", endpoint: "https://api.deepseek.com/v1" }
        ];
    }

    container.innerHTML = presets.map(p =>
        `<button class="menu_button ds-preset-btn" data-endpoint="${p.endpoint}">${p.name}</button>`
    ).join("");

    container.querySelectorAll(".ds-preset-btn").forEach(btn => {
        btn.addEventListener("click", (e) => {
            const endpoint = e.currentTarget.dataset.endpoint;
            document.getElementById("ds-api-endpoint").value = endpoint;
            extension_settings[extensionName].apiEndpoint = endpoint;
            saveSettingsDebounced();
        });
    });
}

// ====================================================================
// 설정 패널
// ====================================================================
function createSettingsPanel() {
    const settings = extension_settings[extensionName];

    const html = `
    <div id="dynamic-sprites-settings" class="dynamic-sprites-settings">
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>🎭 Dynamic Sprite Emotion</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content">

                <div class="ds-section">
                    <label class="checkbox_label">
                        <input id="ds-enabled" type="checkbox" ${settings.enabled ? "checked" : ""}>
                        <span>확장 활성화</span>
                    </label>
                    <label class="checkbox_label">
                        <input id="ds-show-sprite" type="checkbox" ${settings.showSprite ? "checked" : ""}>
                        <span>스프라이트 표시</span>
                    </label>
                    <label>전환 효과 시간 (ms)</label>
                    <input id="ds-transition" type="number" class="text_pole"
                        value="${settings.transitionDuration}" min="0" max="2000">
                </div>

                <hr>

                <!-- ========== 분석용 API 설정 ========== -->
                <div class="ds-section">
                    <h4>⚡ 감정 분석용 API</h4>
                    <p class="ds-hint">본문 생성과 별도의 빠른 모델을 쓸 수 있어요.</p>

                    <label>API 모드</label>
                    <select id="ds-api-mode" class="text_pole">
                        <option value="st" ${settings.apiMode === "st" ? "selected" : ""}>본문 생성 API 재사용 (기본)</option>
                        <option value="gemini" ${settings.apiMode === "gemini" ? "selected" : ""}>Gemini 직접 호출</option>
                        <option value="openai_compat" ${settings.apiMode === "openai_compat" ? "selected" : ""}>OpenAI 호환 (OpenRouter 등)</option>
                    </select>

                    <div id="ds-api-st-hint" class="ds-hint" style="margin-top:8px;">
                        💡 ST의 현재 연결된 API를 그대로 사용합니다. 추가 설정 불필요.
                    </div>

                    <div id="ds-api-key-field" style="display:none;">
                        <label id="ds-api-key-label">API 키</label>
                        <div class="ds-key-input-wrap">
                            <input type="password" id="ds-api-key" class="text_pole"
                                value="${settings.apiKey || ""}" autocomplete="off">
                            <button type="button" id="ds-key-toggle" class="menu_button" title="키 표시/숨김">👁</button>
                        </div>
                    </div>

                    <div id="ds-api-endpoint-field" style="display:none;">
                        <label>API 엔드포인트 (Base URL)</label>
                        <input type="text" id="ds-api-endpoint" class="text_pole"
                            placeholder="https://openrouter.ai/api/v1"
                            value="${settings.apiEndpoint || ""}">
                    </div>

                    <div id="ds-api-presets-field" style="display:none;">
                        <label>빠른 설정</label>
                        <div id="ds-api-presets" class="ds-presets"></div>
                    </div>

                    <div id="ds-api-model-field" style="display:none;">
                        <label id="ds-api-model-label">모델명</label>
                        <input type="text" id="ds-api-model" class="text_pole"
                            placeholder="모델명을 직접 입력하세요"
                            value="${settings.apiModel || ""}">
                    </div>

                    <button id="ds-api-test" class="menu_button" style="margin-top:10px;">🔌 API 연결 테스트</button>
                    <div id="ds-api-test-result"></div>
                </div>

                <hr>

                <!-- ========== 캐릭터별 감정 ========== -->
                <div class="ds-section">
                    <h4>현재 캐릭터: <span id="ds-current-char" style="color:var(--SmartThemeQuoteColor);"></span></h4>
                    <div id="ds-emotion-list" class="ds-emotion-list"></div>
                </div>

                <hr>

                <div class="ds-section">
                    <h4>📥 감정 이미지 추가</h4>
                    <p class="ds-hint">
                        파일명에서 라벨 자동 추출 (예: <code>SPR_Damian_aloof.png</code> → <code>aloof</code>).<br>
                        여러 파일 한번에 선택 가능.
                    </p>
                    <input type="file" id="ds-file-input" accept="image/*" multiple style="display:none;">
                    <button id="ds-upload-btn" class="menu_button">📁 파일 선택해서 추가</button>
                    <div id="ds-upload-status"></div>
                </div>

                <hr>

                <div class="ds-section">
                    <h4>🧠 캐릭터 성격 / 분석 지침</h4>
                    <textarea id="ds-custom-prompt" class="text_pole" rows="3"
                        placeholder="예: Damian은 무뚝뚝하고 감정 표현을 절제하는 성격. 명확한 신호 없을 때는 neutral 우선.">${settings.customPrompt || ""}</textarea>
                </div>

                <hr>

                <div class="ds-section">
                    <h4>🧪 분석 테스트</h4>
                    <textarea id="ds-test-input" class="text_pole" rows="2"
                        placeholder="테스트할 캐릭터 대사 입력 후 분석 실행"></textarea>
                    <button id="ds-test-btn" class="menu_button" style="margin-top:6px;">▶ 분석 실행</button>
                    <div id="ds-test-result"></div>
                </div>

                <hr>

                <div class="ds-section ds-actions-row">
                    <button id="ds-refresh" class="menu_button">🔄 리스트 새로고침</button>
                    <button id="ds-export" class="menu_button">📤 백업 내보내기</button>
                    <button id="ds-import-btn" class="menu_button">📥 백업 가져오기</button>
                    <input type="file" id="ds-import-input" accept=".json" style="display:none;">
                </div>
            </div>
        </div>
    </div>`;

    $("#extensions_settings").append(html);

    // === 이벤트 바인딩 ===

    $("#ds-enabled").on("change", function () {
        settings.enabled = $(this).prop("checked");
        saveSettingsDebounced();
    });

    $("#ds-show-sprite").on("change", function () {
        settings.showSprite = $(this).prop("checked");
        const container = document.getElementById("dynamic-sprite-container");
        if (container) container.style.display = settings.showSprite ? "flex" : "none";
        saveSettingsDebounced();
    });

    $("#ds-transition").on("change", function () {
        settings.transitionDuration = parseInt(this.value) || 300;
        saveSettingsDebounced();
    });

    $("#ds-custom-prompt").on("change", function () {
        settings.customPrompt = this.value;
        saveSettingsDebounced();
    });

    // API 모드 변경
    $("#ds-api-mode").on("change", function () {
        settings.apiMode = this.value;
        saveSettingsDebounced();
        updateApiFieldsVisibility();
    });

    $("#ds-api-key").on("change", function () {
        settings.apiKey = this.value;
        saveSettingsDebounced();
    });

    $("#ds-api-endpoint").on("change", function () {
        settings.apiEndpoint = this.value;
        saveSettingsDebounced();
    });

    $("#ds-api-model").on("change", function () {
        settings.apiModel = this.value;
        saveSettingsDebounced();
    });

    // 키 표시/숨김 토글
    $("#ds-key-toggle").on("click", function () {
        const input = document.getElementById("ds-api-key");
        if (input.type === "password") {
            input.type = "text";
            this.textContent = "🙈";
        } else {
            input.type = "password";
            this.textContent = "👁";
        }
    });

    // API 연결 테스트
    $("#ds-api-test").on("click", async function () {
        const resultEl = $("#ds-api-test-result");
        resultEl.html("🔄 테스트 중...");
        try {
            const testPrompt = `Reply with exactly the word: ok`;
            let result;
            const startTime = performance.now();

            switch (settings.apiMode) {
                case "gemini":
                    result = await callGemini(testPrompt, settings.apiKey, settings.apiModel);
                    break;
                case "openai_compat":
                    result = await callOpenAICompat(testPrompt, settings.apiKey, settings.apiEndpoint, settings.apiModel);
                    break;
                case "st":
                default:
                    result = await callSTApi(testPrompt);
                    break;
            }

            const elapsed = Math.round(performance.now() - startTime);
            resultEl.html(`✅ 연결 성공 (${elapsed}ms) - 응답: <code>${result.trim().slice(0, 50)}</code>`);
        } catch (err) {
            resultEl.html(`❌ 실패: ${err.message}`);
        }
    });

    // 파일 업로드
    $("#ds-upload-btn").on("click", () => $("#ds-file-input").trigger("click"));

    $("#ds-file-input").on("change", async function () {
        const files = Array.from(this.files);
        if (files.length === 0) return;
        const status = $("#ds-upload-status");
        status.html(`처리 중... (0/${files.length})`);
        const results = [];
        let i = 0;
        for (const file of files) {
            i++;
            status.html(`처리 중... (${i}/${files.length}) - ${file.name}`);
            try {
                const label = await addEmotion(file);
                if (label) results.push(`✅ <b>${label}</b> (${file.name})`);
            } catch (err) {
                results.push(`❌ ${file.name}: ${err.message}`);
            }
        }
        status.html(results.join("<br>"));
        renderEmotionList();
        this.value = "";
    });

    $("#ds-refresh").on("click", renderEmotionList);

    $("#ds-test-btn").on("click", async function () {
        const text = $("#ds-test-input").val();
        if (!text.trim()) return;
        $("#ds-test-result").text("분석 중...");
        const emotion = await analyzeEmotion(text);
        if (emotion) {
            $("#ds-test-result").html(`→ <b>${emotion}</b>`);
            updateSprite(emotion);
        } else {
            $("#ds-test-result").text("⚠️ 등록된 감정이 없거나 분석 실패");
        }
    });

    // 백업
    $("#ds-export").on("click", async () => {
        const exportData = {
            version: 2,
            settings: { ...extension_settings[extensionName] },
            images: {}
        };
        // 보안상 API 키는 백업에서 제외
        delete exportData.settings.apiKey;

        for (const charName in extension_settings[extensionName].characters) {
            const charData = extension_settings[extensionName].characters[charName];
            for (const emotion of charData.emotions) {
                const blob = await loadImage(emotion.imageKey);
                if (blob) exportData.images[emotion.imageKey] = await blobToBase64(blob);
            }
        }

        const json = JSON.stringify(exportData);
        const blob = new Blob([json], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `dynamic-sprites-backup-${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(url);
        toastr.success("백업 다운로드 완료 (API 키는 제외됨)");
    });

    $("#ds-import-btn").on("click", () => $("#ds-import-input").trigger("click"));

    $("#ds-import-input").on("change", async function () {
        const file = this.files[0];
        if (!file) return;
        if (!confirm("기존 설정과 병합됩니다. 진행할까요?")) return;
        try {
            const text = await file.text();
            const data = JSON.parse(text);
            for (const key in data.images) {
                const blob = await base64ToBlob(data.images[key]);
                await saveImage(key, blob);
            }
            Object.assign(
                extension_settings[extensionName].characters,
                data.settings.characters
            );
            saveSettingsDebounced();
            renderEmotionList();
            toastr.success("가져오기 완료");
        } catch (err) {
            toastr.error("가져오기 실패: " + err.message);
        }
        this.value = "";
    });

    eventSource.on(event_types.CHAT_CHANGED, () => {
        setTimeout(renderEmotionList, 300);
    });

    // 초기 UI 상태 적용
    updateApiFieldsVisibility();
}

// ====================================================================
// 유틸
// ====================================================================
function blobToBase64(blob) {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.readAsDataURL(blob);
    });
}

async function base64ToBlob(base64) {
    const res = await fetch(base64);
    return res.blob();
}

// ====================================================================
// 초기화
// ====================================================================
jQuery(async () => {
    try {
        loadSettings();
        await openDB();
        createSpriteContainer();
        createSettingsPanel();

        eventSource.on(event_types.MESSAGE_RECEIVED, onMessageReceived);
        eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, onMessageReceived);

        setTimeout(renderEmotionList, 500);
        console.log("[DynamicSprite] v3 로드 완료");
    } catch (err) {
        console.error("[DynamicSprite] 초기화 실패:", err);
    }
});
