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

    // API 모드: 'st' | 'st_profile' | 'gemini' | 'openai_compat'
    apiMode: "st",
    apiProfile: "", // ST Connection Profile 이름
    apiKey: "",
    apiEndpoint: "",
    apiModel: "",

    // === 데스크탑 표시 설정 ===
    desktopPosition: "bottom-left", // bottom-left, bottom-right, bottom-center
    desktopOffsetX: 20,    // px (가장자리로부터 떨어진 거리)
    desktopOffsetY: 0,     // px (바닥에서 위로 띄우는 거리)
    desktopHeight: 80,     // vh (화면 높이 대비 %)
    desktopMaxWidth: 400,  // px
    desktopOpacity: 100,   // %
    desktopZIndex: 100,

    // === 모바일 표시 설정 ===
    mobilePosition: "bottom-left",
    mobileOffsetX: 10,
    mobileOffsetY: 0,
    mobileHeight: 50,
    mobileMaxWidth: 200,
    mobileOpacity: 100,
    mobileZIndex: 100,
    mobileBreakpoint: 768, // 이 너비 이하면 모바일 설정 적용

    // === 표시 설정 프리셋 (이름 → 설정 스냅샷) ===
    displayPresets: {},

    // === 캐릭터 변경 시 알림 ===
    notifyCharChange: true,

    // === 테마 ===
    theme: "system", // system, mono, cream, peach, lilac

    // === 사용자 정의 감정 별칭 ===
    // { "synonymWord": "canonicalLabel" } 형식
    // 예: { "ecstatic": "happy" } → AI가 "ecstatic" 뱉으면 "happy" 라벨로 매칭
    userAliases: {},

    // === origin 백업 (이미지 base64) - 자동복구용 ===
    // 키: imageKey → 값: base64 dataURL
    // 새 origin에서 IndexedDB 비어있으면 여기서 자동 복원
    imageBackup: {},
    autoBackup: true, // 이미지 업로드 시 자동으로 imageBackup에 백업

    // === 이미지 자동 압축 ===
    autoCompress: true,
    compressMaxDim: 800,    // px - 가장 긴 변 기준
    compressQuality: 85,    // 1-100 (WebP quality)

    // === NovelAI 이미지 생성 설정 ===
    naiConfig: {
        apiKey: "",
        model: "nai-diffusion-4-5-full",
        width: 832,
        height: 1216,
        steps: 28,
        scale: 5,
        sampler: "k_euler_ancestral"
    },

    // 캐릭터별 감정 데이터 + 아코디언 펼침 상태
    characters: {},
    expandedChars: {}, // { charName: true/false }

    // 설정 패널 섹션별 접힘 상태 (기본 다 접힘)
    collapsedSections: {
        desktopDisplay: true,
        mobileDisplay: true,
        presets: true,
        compress: true,
        groups: true
    }
};

// ====================================================================
// IndexedDB
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

// ====================================================================
// 테마 적용
// ====================================================================
function applyTheme() {
    const settings = extension_settings[extensionName];
    const theme = settings.theme || "system";
    document.body.setAttribute("data-ds-theme", theme);
    document.querySelectorAll(".ds-theme-btn").forEach(btn => {
        btn.classList.toggle("ds-theme-active", btn.dataset.theme === theme);
    });
}

// ====================================================================
// 표시 스타일 동적 적용 (CSS 변수 주입)
// ====================================================================
function applyDisplayStyles() {
    const settings = extension_settings[extensionName];
    let styleEl = document.getElementById("ds-dynamic-styles");
    if (!styleEl) {
        styleEl = document.createElement("style");
        styleEl.id = "ds-dynamic-styles";
        document.head.appendChild(styleEl);
    }

    // 모바일 ST에서 bottom 좌표가 깨지는 환경이 있어서, top 기반으로 계산
    // (높이 % → 픽셀로 변환하고, 위에서부터 위치 잡음)
    const buildPositionCSS = (pos, offsetX, offsetY, heightVh) => {
        // bottom 대신 top 사용: viewport 높이 - 컨테이너 높이 - offsetY = top 좌표
        const topCalc = `calc(100vh - ${heightVh}vh - ${offsetY}px)`;
        let css = `top: ${topCalc}; bottom: auto;`;
        if (pos === "bottom-left") {
            css += ` left: ${offsetX}px; right: auto; transform: none;`;
        } else if (pos === "bottom-right") {
            css += ` left: auto; right: ${offsetX}px; transform: none;`;
        } else if (pos === "bottom-center") {
            css += ` left: 50%; right: auto; transform: translateX(-50%);`;
        }
        return css;
    };

    const desktopPos = buildPositionCSS(
        settings.desktopPosition,
        settings.desktopOffsetX,
        settings.desktopOffsetY,
        settings.desktopHeight
    );
    const mobilePos = buildPositionCSS(
        settings.mobilePosition,
        settings.mobileOffsetX,
        settings.mobileOffsetY,
        settings.mobileHeight
    );

    styleEl.textContent = `
        #dynamic-sprite-container {
            ${desktopPos}
            height: ${settings.desktopHeight}vh;
            z-index: ${settings.desktopZIndex};
        }
        #dynamic-sprite-img {
            max-width: ${settings.desktopMaxWidth}px;
            opacity: ${settings.desktopOpacity / 100};
        }
        @media (max-width: ${settings.mobileBreakpoint}px) {
            #dynamic-sprite-container {
                ${mobilePos}
                height: ${settings.mobileHeight}vh;
                z-index: ${settings.mobileZIndex};
            }
            #dynamic-sprite-img {
                max-width: ${settings.mobileMaxWidth}px;
                opacity: ${settings.mobileOpacity / 100};
            }
        }
    `;
}

let currentBlobUrl = null;
async function updateSprite(emotionLabel) {
    const settings = extension_settings[extensionName];
    if (!settings.enabled || !settings.showSprite) return;

    const charName = getCurrentCharName();
    if (!charName) return;

    const charData = getCharData(charName);
    // 정확 매칭만 — 없으면 neutral fallback, 그것도 없으면 변경 안 함
    const emotion = charData.emotions.find(e => e.label === emotionLabel)
        || charData.emotions.find(e => e.label.toLowerCase() === "neutral");
    if (!emotion) {
        console.warn(`[DynamicSprite] "${emotionLabel}" 매칭 실패, 스프라이트 유지`);
        return;
    }

    const img = document.getElementById("dynamic-sprite-img");
    if (!img) return;

    try {
        const blob = await loadImage(emotion.imageKey);
        if (!blob) {
            console.warn(`[DynamicSprite] 이미지 blob 없음: ${emotion.imageKey}`);
            return;
        }

        // 모바일 여부에 따라 목표 opacity 결정
        const isMobile = window.innerWidth <= settings.mobileBreakpoint;
        const targetOpacity = (isMobile ? settings.mobileOpacity : settings.desktopOpacity) / 100;

        // 새 blob URL 만들기 (이미지 로드 완료 후 이전 거 해제)
        const newBlobUrl = URL.createObjectURL(blob);

        // 첫 표시인지 체크 (display none → block 전환)
        const isFirstShow = img.style.display === "none" || !img.src;

        if (isFirstShow) {
            // 첫 표시: opacity 0으로 시작 → src 설정 → fade-in
            img.style.transition = "none";
            img.style.opacity = "0";
            img.style.display = "block";

            img.onload = () => {
                requestAnimationFrame(() => {
                    img.style.transition = `opacity ${settings.transitionDuration}ms ease`;
                    img.style.opacity = String(targetOpacity);
                });
                if (currentBlobUrl && currentBlobUrl !== newBlobUrl) {
                    URL.revokeObjectURL(currentBlobUrl);
                }
                currentBlobUrl = newBlobUrl;
                img.onload = null;
            };
            img.onerror = () => {
                console.error(`[DynamicSprite] 이미지 표시 실패: ${emotion.label}`);
                URL.revokeObjectURL(newBlobUrl);
                img.onerror = null;
            };
            img.src = newBlobUrl;
        } else {
            // 전환: fade out → src 교체 → fade in
            img.style.transition = `opacity ${settings.transitionDuration}ms ease`;
            img.style.opacity = "0";

            setTimeout(() => {
                img.onload = () => {
                    img.style.opacity = String(targetOpacity);
                    if (currentBlobUrl && currentBlobUrl !== newBlobUrl) {
                        URL.revokeObjectURL(currentBlobUrl);
                    }
                    currentBlobUrl = newBlobUrl;
                    img.onload = null;
                };
                img.src = newBlobUrl;
            }, settings.transitionDuration);
        }

        charData.current = emotion.label;
        // 사용 횟수 카운트 (자동/수동 모두)
        emotion.usageCount = (emotion.usageCount || 0) + 1;
        emotion.lastUsedAt = Date.now();
        saveSettingsDebounced();
    } catch (err) {
        console.error("[DynamicSprite] 이미지 로드 실패:", err);
    }
}

// ====================================================================
// 프롬프트 빌더 - 캐릭터명 미포함 (배포용)
// ====================================================================
function buildEmotionPrompt(messageText, charData, customInstruction) {
    const emotionDescriptions = charData.emotions.map(e => {
        return e.description?.trim()
            ? `- ${e.label}: ${e.description}`
            : `- ${e.label}`;
    }).join("\n");

    return `[System Task: Emotion Classification]

You are classifying the dominant emotion shown by a character in a roleplay response. Read the text carefully and identify what the CHARACTER is feeling (not the narrator, not the user).

[Character's response]
${messageText}

[Available emotion labels - choose ONE]
${emotionDescriptions}

${customInstruction ? `[Character traits / additional instructions]\n${customInstruction}\n\n` : ""}[Classification guidelines]
- Default to "neutral" for ordinary conversation, small talk, factual statements, or mild responses without clear emotional signals. Most everyday dialogue is neutral.
- Only pick a strong emotion (positive OR negative) when the text contains clear, explicit signals: emotional words, tone markers, body language descriptions, or unmistakable context.
- Treat positive and negative emotions with equal weight. Do NOT default toward negative labels (guarded, contempt, aloof, tired, etc.) just because the tone is calm or reserved. Calm ≠ negative.
- "guarded", "contempt", "aloof", "disdain" require explicit hostility, suspicion, or dismissiveness in the text — not just absence of warmth.
- "smile", "amused", "happy" require explicit positive signals — warmth, laughter, fondness, playfulness, soft tone toward the other person.
- If the character is making casual conversation, asking questions, or giving information without emotional charge → "neutral".
- If genuinely ambiguous between two emotions, prefer the milder/more neutral one.
- Output ONLY the label name. No quotes, no markdown, no explanation, no punctuation.

Label:`;
}


// ====================================================================
// Gemini 직접 호출 - 토큰 버그 수정!
// ====================================================================
async function callGemini(prompt, apiKey, model) {
    if (!apiKey) throw new Error("Gemini API 키가 비어있음");
    if (!model) throw new Error("Gemini 모델명이 비어있음");

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

        const body = {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
            temperature: 0.3,
            maxOutputTokens: 2000,
            topP: 0.95
        },
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

    // finishReason 체크
    const candidate = data.candidates?.[0];
    if (candidate?.finishReason === "MAX_TOKENS" && !candidate?.content?.parts) {
        throw new Error("응답이 토큰 제한에 걸림 (분류 실패). 다른 모델 시도 권장.");
    }
    if (candidate?.finishReason === "SAFETY") {
        throw new Error("Gemini 안전 필터에 차단됨");
    }

    const text = candidate?.content?.parts?.[0]?.text;
    if (!text) throw new Error("Gemini 응답 비어있음: " + JSON.stringify(data).slice(0, 200));
    return text;
}

// ====================================================================
// OpenAI 호환 호출
// ====================================================================
async function callOpenAICompat(prompt, apiKey, endpoint, model) {
    if (!endpoint) throw new Error("API 엔드포인트가 비어있음");
    if (!model) throw new Error("모델명이 비어있음");

    const baseUrl = endpoint.replace(/\/+$/, "");
    const url = baseUrl.endsWith("/chat/completions") ? baseUrl : `${baseUrl}/chat/completions`;

    const headers = { "Content-Type": "application/json" };
    if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

    if (url.includes("openrouter.ai")) {
        headers["HTTP-Referer"] = window.location.origin;
        headers["X-Title"] = "SillyTavern Dynamic Sprites";
    }

    const body = {
        model: model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.3,
        max_tokens: 2000
    };

    const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
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
// NovelAI 이미지 생성 호출
// ====================================================================
// NAI ZIP 응답에서 첫 번째 이미지 추출
// Central Directory 기준으로 파싱 → data descriptor 방식도 정상 처리
async function extractImageFromNaiZip(arrayBuffer) {
    const view = new DataView(arrayBuffer);
    const bytes = new Uint8Array(arrayBuffer);

    // 1) End of Central Directory (EOCD) 탐색 (뒤에서부터)
    let eocdOffset = -1;
    for (let i = bytes.length - 22; i >= 0; i--) {
        if (view.getUint32(i, true) === 0x06054b50) { eocdOffset = i; break; }
    }
    if (eocdOffset < 0) throw new Error("NAI ZIP: EOCD 없음 (응답이 ZIP이 아닐 수 있음)");

    // 2) Central Directory에서 파일 정보 읽기 (여기가 항상 정확한 크기)
    const cdOffset = view.getUint32(eocdOffset + 16, true);
    if (view.getUint32(cdOffset, true) !== 0x02014b50) throw new Error("NAI ZIP: Central Directory 파싱 실패");
    const compressionMethod = view.getUint16(cdOffset + 10, true);
    const compressedSize    = view.getUint32(cdOffset + 20, true);
    const localHeaderOffset = view.getUint32(cdOffset + 42, true);

    // 3) Local File Header에서 실제 데이터 오프셋 계산
    if (view.getUint32(localHeaderOffset, true) !== 0x04034b50) throw new Error("NAI ZIP: Local Header 파싱 실패");
    const fnLen    = view.getUint16(localHeaderOffset + 26, true);
    const extraLen = view.getUint16(localHeaderOffset + 28, true);
    const dataStart = localHeaderOffset + 30 + fnLen + extraLen;

    const compressed = new Uint8Array(arrayBuffer, dataStart, compressedSize);

    if (compressionMethod === 0) {
        return new Blob([compressed], { type: "image/png" });
    }
    if (compressionMethod === 8) {
        const ds = new DecompressionStream("deflate-raw");
        const writer = ds.writable.getWriter();
        writer.write(compressed);
        writer.close();
        return new Response(ds.readable).blob();
    }
    throw new Error(`NAI ZIP: 지원하지 않는 압축 방식 (method=${compressionMethod})`);
}

async function callNovelAI(prompt, negativePrompt, config) {
    if (!config.apiKey) throw new Error("NAI API 키가 비어있음");

    const url = "https://image.novelai.net/ai/generate-image";
    const seed = Math.floor(Math.random() * 4294967295);

    const body = {
        input: prompt,
        model: config.model || "nai-diffusion-4-5-full",
        action: "generate",
        parameters: {
            params_version: 3,
            width: config.width || 832,
            height: config.height || 1216,
            scale: config.scale || 5,
            sampler: config.sampler || "k_euler_ancestral",
            steps: config.steps || 28,
            seed: seed,
            n_samples: 1,
            ucPreset: 0,
            qualityToggle: true,
            negative_prompt: negativePrompt || "",
            characterPrompts: [],
            v4_prompt: {
                caption: { base_caption: prompt, char_captions: [] },
                use_coords: false,
                use_order: true
            },
            v4_negative_prompt: {
                caption: { base_caption: negativePrompt || "", char_captions: [] }
            }
        }
    };

    const res = await fetch(url, {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${config.apiKey}`,
            "Content-Type": "application/json",
            "Accept": "application/x-zip-compressed"
        },
        body: JSON.stringify(body)
    });

    if (!res.ok) {
        const errText = await res.text();
        throw new Error(`NAI ${res.status}: ${errText.slice(0, 300)}`);
    }

    const arrayBuffer = await res.arrayBuffer();
    return await extractImageFromNaiZip(arrayBuffer);
}

// ====================================================================
// NAI 표정 생성 유틸
// ====================================================================
const DEFAULT_LABEL_PROMPTS = {
    neutral:      "neutral expression, calm, looking at viewer",
    smile:        "soft smile, gentle expression, looking at viewer",
    happy:        "happy expression, bright smile, looking at viewer",
    amused:       "amused, slight smile, eyes narrowed slightly",
    sad:          "sad expression, downcast eyes, slight frown",
    angry:        "angry, furrowed brows, intense glare",
    surprised:    "surprised, wide eyes, slightly open mouth",
    afraid:       "fearful expression, wide eyes, tense",
    disgust:      "disgusted expression, slight frown, narrowed eyes",
    contempt:     "contemptuous, sneering, looking to the side",
    smirk:        "smirk, half smile, raised eyebrow",
    tired:        "tired, half-lidded eyes, exhausted",
    aloof:        "aloof, cold expression, looking away",
    embarrassed:  "embarrassed, blushing, looking away",
    confused:     "confused, slight frown, head tilted",
    pain:         "pained expression, gritted teeth, eyes closed",
    love:         "loving gaze, soft smile, blushing slightly",
    determined:   "determined, focused, serious expression",
    crying:       "crying, tears streaming, sad expression",
    laughing:     "laughing, wide smile, eyes closed"
};

function buildNaiPrompt(charName, label) {
    const charData = getCharData(charName);
    const naiGen = charData.naiGen || {};
    const base = (naiGen.basePrompt || "").trim();
    const labelExtra = (naiGen.labelPrompts?.[label] || DEFAULT_LABEL_PROMPTS[label] || label).trim();
    const neg = (naiGen.negativePrompt || "").trim()
        || "lowres, bad anatomy, bad hands, text, error, extra digit, fewer digits, worst quality, low quality";
    const parts = [base, labelExtra, "masterpiece, best quality"].filter(Boolean);
    return { prompt: parts.join(", "), negativePrompt: neg };
}

let naiGenerating = false;

async function generateSpriteForLabel(charName, label) {
    if (naiGenerating) {
        toastr.warning("이미 생성 중입니다. 완료 후 시도하세요.");
        return false;
    }
    naiGenerating = true;
    try {
        const { prompt, negativePrompt } = buildNaiPrompt(charName, label);
        if (!prompt) throw new Error("베이스 프롬프트를 먼저 입력하세요.");
        const blob = await callNovelAI(prompt, negativePrompt, settings.naiConfig);
        const file = new File([blob], `${label}.png`, { type: "image/png" });
        await addEmotion(file, label, charName);
        return true;
    } catch (err) {
        console.error(`[NAI Gen] ${label} 실패:`, err);
        throw err;
    } finally {
        naiGenerating = false;
    }
}

async function generateAllSprites(charName, onProgress) {
    const charData = getCharData(charName);
    if (charData.emotions.length === 0) {
        toastr.warning("생성할 라벨이 없습니다. 먼저 감정 라벨을 등록하세요.");
        return null;
    }
    const labels = charData.emotions.map(e => e.label);
    const results = { success: [], failed: [] };
    for (let i = 0; i < labels.length; i++) {
        const label = labels[i];
        onProgress?.(i, labels.length, label);
        try {
            await generateSpriteForLabel(charName, label);
            results.success.push(label);
        } catch (err) {
            results.failed.push({ label, error: err.message });
        }
        if (i < labels.length - 1) await new Promise(r => setTimeout(r, 1000));
    }
    onProgress?.(labels.length, labels.length, null);
    return results;
}

function renderNaiLabelPrompts(charName) {
    const container = document.getElementById("ds-nai-label-prompts");
    if (!container) return;
    const charData = getCharData(charName);
    const labelPrompts = charData.naiGen?.labelPrompts || {};

    if (charData.emotions.length === 0) {
        container.innerHTML = `<div class="ds-hint">등록된 감정 라벨 없음</div>`;
        return;
    }
    container.innerHTML = charData.emotions.map(e => `
        <div style="display:flex; gap:6px; align-items:center; margin-bottom:4px;">
            <span style="min-width:80px; font-size:0.85em; flex-shrink:0;">${e.label}</span>
            <input type="text" class="text_pole ds-nai-lp-input" data-label="${e.label}"
                value="${(labelPrompts[e.label] || "").replace(/"/g, "&quot;")}"
                placeholder="${DEFAULT_LABEL_PROMPTS[e.label] || e.label + " expression, ..."}">
        </div>
    `).join("");

    container.querySelectorAll(".ds-nai-lp-input").forEach(input => {
        input.addEventListener("change", () => {
            const cd = getCharData(charName);
            if (!cd.naiGen) cd.naiGen = { basePrompt: "", negativePrompt: "", labelPrompts: {} };
            if (!cd.naiGen.labelPrompts) cd.naiGen.labelPrompts = {};
            if (input.value.trim()) {
                cd.naiGen.labelPrompts[input.dataset.label] = input.value.trim();
            } else {
                delete cd.naiGen.labelPrompts[input.dataset.label];
            }
            saveSettingsDebounced();
        });
    });
}

// ====================================================================
// ST API 호출
// ====================================================================
async function callSTApi(prompt) {
    const context = getContext();
    // generateRaw: 캐릭터 카드/페르소나/WIAN 전부 무시, 순수 프롬프트만 전송
    return await context.generateRaw({
        prompt: prompt,
        systemPrompt: "You are an emotion classification system. Output only the requested label, nothing else.",
        responseLength: 2000,
    });
}

// ====================================================================
// ST Connection Profile 활용
// 다른 프로필로 일시 전환 → 호출 → 원복
// ====================================================================
async function callSTProfile(prompt, profileName) {
    if (!profileName) throw new Error("프로필이 선택되지 않음");

    const context = getContext();

    // ST 슬래시 커맨드로 현재 프로필 백업 → 전환 → 호출 → 복원
    // SlashCommandParser 사용 (ST 1.12.x+)
    try {
        // 현재 프로필 가져오기
        const profileGetCmd = await context.executeSlashCommandsWithOptions("/profile");
        const originalProfile = profileGetCmd?.pipe?.trim() || "";

        try {
            // 분석용 프로필로 전환
            await context.executeSlashCommandsWithOptions(`/profile ${profileName}`);

            // 약간의 대기 (전환 안정화)
            await new Promise(r => setTimeout(r, 200));

            // generateRaw: 캐릭터 카드/페르소나/WIAN 전부 무시
            const result = await context.generateRaw({
                prompt: prompt,
                systemPrompt: "You are an emotion classification system. Output only the requested label, nothing else.",
                responseLength: 2000,
            });

            return result;
        } finally {
            // 무조건 원래 프로필로 복원
            if (originalProfile && originalProfile !== profileName) {
                await context.executeSlashCommandsWithOptions(`/profile ${originalProfile}`);
            }
        }
    } catch (err) {
        throw new Error("프로필 전환 실패: " + err.message);
    }
}

// ====================================================================
// ST에 등록된 Connection Profile 목록 가져오기
// ====================================================================
function getSTProfiles() {
    try {
        // ST의 connection-manager 확장 데이터 접근
        const profiles = extension_settings.connectionManager?.profiles;
        if (Array.isArray(profiles)) {
            return profiles.map(p => p.name).filter(Boolean);
        }
    } catch (err) {
        console.warn("[DynamicSprite] 프로필 목록 조회 실패:", err);
    }
    return [];
}

// ====================================================================
// 분석 캐시 (메모리) — 같은 메시지 재분석 시 API 호출 안 함
// ====================================================================
const analysisCache = new Map(); // key: charName::messageHash → label
const ANALYSIS_CACHE_MAX = 200;

function simpleHash(str) {
    // 빠른 해시 (FNV-1a 변형)
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(36);
}

function cacheGet(charName, messageText) {
    const key = `${charName}::${simpleHash(messageText)}`;
    return analysisCache.get(key) || null;
}

function cacheSet(charName, messageText, label) {
    if (analysisCache.size >= ANALYSIS_CACHE_MAX) {
        // FIFO 정리 - 가장 오래된 절반 제거
        const keys = [...analysisCache.keys()];
        for (let i = 0; i < keys.length / 2; i++) analysisCache.delete(keys[i]);
    }
    const key = `${charName}::${simpleHash(messageText)}`;
    analysisCache.set(key, label);
}

// ====================================================================
// 감정 분석 통합 라우터
// ====================================================================
async function analyzeEmotion(messageText) {
    const settings = extension_settings[extensionName];
    const charName = getCurrentCharName();
    if (!charName) return null;

    const charData = getCharData(charName);
    if (charData.emotions.length === 0) return null;

    // 캐시 확인
    const cached = cacheGet(charName, messageText);
    if (cached) {
        // 캐시에 있는 라벨이 아직 등록된 라벨인지도 확인
        const stillExists = charData.emotions.some(e => e.label === cached);
        if (stillExists) {
            console.log(`[DynamicSprite] (cache) → ${cached}`);
            return cached;
        }
    }

    const prompt = buildEmotionPrompt(
        messageText, charData, settings.customPrompt?.trim() || ""
    );

    try {
        let result;
        const startTime = performance.now();

        switch (settings.apiMode) {
            case "gemini":
                result = await callGemini(prompt, settings.apiKey, settings.apiModel);
                break;
            case "openai_compat":
                result = await callOpenAICompat(prompt, settings.apiKey, settings.apiEndpoint, settings.apiModel);
                break;
            case "st_profile":
                result = await callSTProfile(prompt, settings.apiProfile);
                break;
            case "st":
            default:
                result = await callSTApi(prompt);
                break;
        }

        const elapsed = Math.round(performance.now() - startTime);
        const rawText = result.trim();
        const cleaned = rawText.toLowerCase().replace(/[*_`"'.\s,!?]+/g, "");

        // 1차: 정확 매칭
        let matched = charData.emotions.find(e => e.label.toLowerCase() === cleaned);

        // 2차: 첫 단어만 추출 후 매칭 (LLM이 가끔 문장 뱉는 경우)
        if (!matched) {
            const firstWord = rawText.split(/[\s,.\n]+/)[0].toLowerCase().replace(/[*_`"'.,!?]/g, "");
            matched = charData.emotions.find(e => e.label.toLowerCase() === firstWord);
        }

        // 3차: 부분 매칭 (라벨이 텍스트에 정확히 포함)
        if (!matched) {
            matched = charData.emotions.find(e => {
                const labelLower = e.label.toLowerCase();
                const regex = new RegExp(`\\b${labelLower.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
                return regex.test(rawText.toLowerCase());
            });
        }

        // 4차: alias 매칭 — AI가 다른 단어를 뱉었어도 의미가 같으면 매핑
        // 예: AI가 "furious"라고 했는데 등록된 라벨은 "angry"라면 angry로 매칭
        if (!matched) {
            const aliases = getEmotionAliases(); // { word: canonicalLabel }
            // raw text에서 alias 단어 찾기
            const lowerText = rawText.toLowerCase();
            for (const aliasWord in aliases) {
                const regex = new RegExp(`\\b${aliasWord}\\b`);
                if (regex.test(lowerText)) {
                    const canonical = aliases[aliasWord];
                    // canonical 라벨로 등록된 감정 있나 확인
                    matched = charData.emotions.find(e => e.label.toLowerCase() === canonical);
                    if (matched) {
                        console.log(`[DynamicSprite] alias 매핑: "${aliasWord}" → "${canonical}"`);
                        break;
                    }
                    // canonical 없으면 그 단어가 가리키는 같은 그룹의 다른 alias도 시도
                    for (const w in aliases) {
                        if (aliases[w] === canonical && w !== aliasWord) {
                            matched = charData.emotions.find(e => e.label.toLowerCase() === w);
                            if (matched) {
                                console.log(`[DynamicSprite] alias 그룹 매핑: "${aliasWord}" → "${w}"`);
                                break;
                            }
                        }
                    }
                    if (matched) break;
                }
            }
        }

        if (!matched) {
            // 매칭 실패 → null 반환 = 스프라이트 유지
            console.warn(`[DynamicSprite] (${settings.apiMode}, ${elapsed}ms) 매칭 실패: "${rawText}" → 스프라이트 유지`);
            return null;
        }

        console.log(`[DynamicSprite] (${settings.apiMode}, ${elapsed}ms) "${rawText}" → ${matched.label}`);
        cacheSet(charName, messageText, matched.label);
        return matched.label;
    } catch (err) {
        console.error("[DynamicSprite] 감정 분석 실패:", err);
        toastr.error(`감정 분석 실패: ${err.message}`, "Dynamic Sprite", { timeOut: 5000 });
        return null; // 실패 시에도 스프라이트 유지
    }
}

// ====================================================================
// 감정 별칭 (alias) — 같은 의미의 다른 단어를 canonical 라벨로 매핑
// AI가 등록된 라벨과 다른 단어를 뱉어도 매칭되게 함
// ====================================================================
const BUILTIN_ALIASES = {
    // happy/joy 계열
    happy: "happy", joy: "happy", joyful: "happy", glad: "happy", cheerful: "happy", delighted: "happy", elated: "happy",
    // smile 계열
    smile: "smile", smiling: "smile", grin: "smile", grinning: "smile",
    // amused 계열
    amused: "amused", entertained: "amused", chuckling: "amused", laughing: "amused",
    // sad 계열
    sad: "sad", sorrow: "sad", sorrowful: "sad", unhappy: "sad", melancholy: "sad", gloomy: "sad", depressed: "sad",
    // angry 계열
    angry: "angry", furious: "angry", mad: "angry", enraged: "angry", irritated: "angry", annoyed: "angry", irate: "angry",
    // surprised 계열
    surprised: "surprised", shocked: "surprised", astonished: "surprised", startled: "surprised", caught_off_guard: "surprised", caught: "surprised",
    // fear 계열
    afraid: "afraid", scared: "afraid", fearful: "afraid", terrified: "afraid", anxious: "afraid", nervous: "afraid",
    // disgust 계열
    disgusted: "disgust", disgust: "disgust", revolted: "disgust", repulsed: "disgust",
    // contempt 계열
    contempt: "contempt", contemptuous: "contempt", scornful: "contempt", disdainful: "contempt", disdain: "contempt",
    // smirk 계열
    smirk: "smirk", smirking: "smirk", slight_smirk: "smirk", smug: "smirk",
    // tired 계열
    tired: "tired", exhausted: "tired", weary: "tired", fatigued: "tired", worn_out: "tired", worn: "tired",
    // neutral 계열
    neutral: "neutral", blank: "neutral", emotionless: "neutral", expressionless: "neutral",
    // aloof/cold 계열
    aloof: "aloof", distant: "aloof", cold: "aloof", detached: "aloof", reserved: "aloof",
    // guarded 계열
    guarded: "guarded", wary: "guarded", cautious: "guarded", suspicious: "guarded",
    // calculating 계열
    calculating: "calculating", thoughtful: "calculating", scheming: "calculating", pondering: "calculating",
    // embarrassed 계열
    embarrassed: "embarrassed", flustered: "embarrassed", abashed: "embarrassed", bashful: "embarrassed",
    // confused 계열
    confused: "confused", puzzled: "confused", perplexed: "confused", bewildered: "confused",
    // pain 계열
    pain: "pain", hurt: "pain", suffering: "pain", agony: "pain",
    // love/affection 계열
    love: "love", loving: "love", affectionate: "love", fond: "love", tender: "love",
    // determined 계열
    determined: "determined", resolute: "determined", focused: "determined", serious: "determined",
};

// 사용자 정의 alias와 빌트인 alias 병합 (사용자 정의 우선)
function getEmotionAliases() {
    const settings = extension_settings[extensionName];
    const userAliases = settings.userAliases || {};
    return { ...BUILTIN_ALIASES, ...userAliases };
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
// 파일명 → 라벨
// ====================================================================
function extractEmotionFromFilename(filename) {
    let name = filename.replace(/\.(png|jpg|jpeg|webp|gif)$/i, "");
    name = name.replace(/^SPR_/i, "");
    const parts = name.split("_");
    if (parts.length > 1) return parts.slice(1).join("_").toLowerCase();
    return name.toLowerCase();
}

// ====================================================================
// 이미지 자동 압축 (settings.imageBackup 용량 절약)
// 가로/세로 중 큰 쪽을 maxDim에 맞춰 리사이즈, JPEG/WebP로 저장
// ====================================================================
async function compressImage(file, maxDim = 800, quality = 0.85) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        const url = URL.createObjectURL(file);
        img.onload = () => {
            URL.revokeObjectURL(url);
            let { width, height } = img;
            const ratio = Math.min(maxDim / width, maxDim / height, 1);
            if (ratio >= 1) {
                // 이미 작은 이미지면 원본 그대로 (PNG 투명도 유지를 위해)
                resolve(file);
                return;
            }
            const newW = Math.round(width * ratio);
            const newH = Math.round(height * ratio);
            const canvas = document.createElement("canvas");
            canvas.width = newW;
            canvas.height = newH;
            const ctx = canvas.getContext("2d");
            ctx.imageSmoothingQuality = "high";
            ctx.drawImage(img, 0, 0, newW, newH);

            // 원본이 PNG이고 투명도가 필요할 수 있으면 PNG 유지, 아니면 WebP로
            const isPNG = file.type === "image/png";
            const outputType = isPNG ? "image/webp" : "image/webp"; // WebP가 항상 더 작음 (투명도 지원)
            canvas.toBlob(blob => {
                if (!blob) {
                    resolve(file); // 압축 실패하면 원본
                    return;
                }
                // 원본보다 작아진 경우만 사용
                if (blob.size < file.size) {
                    resolve(blob);
                } else {
                    resolve(file);
                }
            }, outputType, quality);
        };
        img.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error("이미지 로드 실패"));
        };
        img.src = url;
    });
}

// ====================================================================
// 감정 추가 (개별 파일)
// ====================================================================
async function addEmotion(file, customLabel = null, targetCharName = null) {
    const charName = targetCharName || getCurrentCharName();
    if (!charName) {
        toastr.warning("먼저 캐릭터를 선택하세요");
        return null;
    }

    const settings = extension_settings[extensionName];
    const charData = getCharData(charName);
    const label = customLabel || extractEmotionFromFilename(file.name);

    // 자동 압축 적용
    let processedFile = file;
    if (settings.autoCompress !== false) {
        try {
            const maxDim = settings.compressMaxDim || 800;
            const quality = (settings.compressQuality || 85) / 100;
            processedFile = await compressImage(file, maxDim, quality);
        } catch (err) {
            console.warn("[DynamicSprite] 압축 실패, 원본 사용:", err);
            processedFile = file;
        }
    }

    const existing = charData.emotions.find(e => e.label === label);
    if (existing) {
        // 폴더 일괄 등록 시엔 confirm 생략, 자동 덮어쓰기
        await deleteImage(existing.imageKey);
        if (settings.imageBackup) delete settings.imageBackup[existing.imageKey];
        charData.emotions = charData.emotions.filter(e => e.label !== label);
    }

    const imageKey = `${charName}__${label}__${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    await saveImage(imageKey, processedFile);

    // 자동 백업 - settings에 base64로 저장해서 origin 바뀌어도 복원 가능
    if (settings.autoBackup) {
        try {
            const base64 = await blobToBase64(processedFile);
            settings.imageBackup = settings.imageBackup || {};
            settings.imageBackup[imageKey] = base64;
        } catch (err) {
            console.warn("[DynamicSprite] 자동 백업 실패:", err);
        }
    }

    charData.emotions.push({
        label, imageKey, description: "", addedAt: Date.now(),
        usageCount: 0
    });

    saveSettingsDebounced();
    return label;
}

// ====================================================================
// 캐릭터의 모든 감정 일괄 삭제
// ====================================================================
async function deleteAllEmotionsForChar(charName) {
    const settings = extension_settings[extensionName];
    const charData = settings.characters[charName];
    if (!charData || charData.emotions.length === 0) return 0;

    const count = charData.emotions.length;
    for (const emotion of charData.emotions) {
        try {
            await deleteImage(emotion.imageKey);
            if (settings.imageBackup) delete settings.imageBackup[emotion.imageKey];
        } catch (err) {
            console.warn(`[DynamicSprite] 삭제 실패: ${emotion.imageKey}`, err);
        }
    }
    charData.emotions = [];
    charData.current = null;
    saveSettingsDebounced();
    return count;
}

// ====================================================================
// 전체 감정 데이터 일괄 삭제 (모든 캐릭터)
// ====================================================================
async function deleteAllEmotionsEverywhere() {
    const settings = extension_settings[extensionName];
    let total = 0;
    for (const charName in settings.characters) {
        total += await deleteAllEmotionsForChar(charName);
    }
    // 메모리 정리
    settings.characters = {};
    settings.imageBackup = {};
    saveSettingsDebounced();
    return total;
}

// ====================================================================
// 자동 복구 - IndexedDB가 비어있는데 백업은 있는 경우
// (origin이 바뀌어서 IndexedDB가 격리된 상황 자동 감지)
// ====================================================================
async function autoRestoreFromBackup() {
    const settings = extension_settings[extensionName];
    if (!settings.imageBackup || Object.keys(settings.imageBackup).length === 0) return 0;

    // 등록된 imageKey들 모음
    const expectedKeys = new Set();
    for (const charName in settings.characters) {
        for (const emotion of settings.characters[charName].emotions) {
            expectedKeys.add(emotion.imageKey);
        }
    }
    if (expectedKeys.size === 0) return 0;

    // IndexedDB에 실제 존재하는 키 확인
    let existingCount = 0;
    for (const key of expectedKeys) {
        try {
            const blob = await loadImage(key);
            if (blob) existingCount++;
        } catch {}
    }

    // 전부 다 있으면 복구 불필요
    if (existingCount === expectedKeys.size) return 0;

    // 누락된 거 복구
    let restored = 0;
    for (const key of expectedKeys) {
        try {
            const blob = await loadImage(key);
            if (!blob && settings.imageBackup[key]) {
                const restoredBlob = await base64ToBlob(settings.imageBackup[key]);
                await saveImage(key, restoredBlob);
                restored++;
            }
        } catch (err) {
            console.warn(`[DynamicSprite] 복원 실패: ${key}`, err);
        }
    }
    return restored;
}

// ====================================================================
// 폴더 통째 업로드 - webkitdirectory 사용
// ====================================================================
async function handleFolderUpload(files) {
    const charName = getCurrentCharName();
    if (!charName) {
        toastr.warning("먼저 캐릭터를 선택하세요");
        return;
    }

    // 이미지 파일만 필터링
    const imageFiles = files.filter(f =>
        /\.(png|jpg|jpeg|webp|gif)$/i.test(f.name)
    );

    if (imageFiles.length === 0) {
        toastr.warning("이미지 파일이 없습니다");
        return;
    }

    const status = $("#ds-upload-status");
    const results = [];

    for (let i = 0; i < imageFiles.length; i++) {
        const file = imageFiles[i];
        status.html(`📁 폴더 처리 중... (${i + 1}/${imageFiles.length}) - ${file.name}`);

        try {
            const label = await addEmotion(file);
            if (label) results.push(`✅ <b>${label}</b>`);
        } catch (err) {
            results.push(`❌ ${file.name}`);
        }
    }

    status.html(`완료: ${imageFiles.length}개 처리됨<br>${results.join(" ")}`);
    renderEmotionList();
}

// ====================================================================
// 감정 리스트 - 아코디언 형태로 렌더링
// ====================================================================
function renderEmotionList() {
    const listEl = document.getElementById("ds-emotion-list");
    if (!listEl) return;

    const settings = extension_settings[extensionName];
    const allChars = Object.keys(settings.characters).filter(name =>
        settings.characters[name].emotions.length > 0
    );

    const currentChar = getCurrentCharName();

    // 현재 캐릭터 헤더
    const currentCharEl = document.getElementById("ds-current-char");
    if (currentCharEl) {
        currentCharEl.textContent = currentChar || "(선택 안 됨)";
    }

    if (allChars.length === 0) {
        listEl.innerHTML = "<div class='ds-empty'>아직 등록된 감정이 없습니다.<br>아래에서 이미지를 추가하세요 ↓</div>";
        return;
    }

    // 현재 캐릭터를 맨 위로
    const sortedChars = [
        ...(currentChar && allChars.includes(currentChar) ? [currentChar] : []),
        ...allChars.filter(c => c !== currentChar).sort()
    ];

    listEl.innerHTML = "";

    sortedChars.forEach(charName => {
        const charData = settings.characters[charName];
        const isExpanded = settings.expandedChars[charName] || charName === currentChar;
        const isCurrent = charName === currentChar;

        const accordion = document.createElement("div");
        accordion.className = `ds-char-accordion ${isCurrent ? "ds-current" : ""}`;

        accordion.innerHTML = `
            <div class="ds-char-header" data-char="${charName}">
                <span class="ds-char-toggle">${isExpanded ? "▼" : "▶"}</span>
                <span class="ds-char-name">${isCurrent ? "🎯 " : ""}${charName}</span>
                <span class="ds-char-count">${charData.emotions.length}개</span>
            </div>
            <div class="ds-char-body" style="display:${isExpanded ? "block" : "none"};"></div>
        `;

        const body = accordion.querySelector(".ds-char-body");

        charData.emotions.forEach((emotion, idx) => {
            const item = document.createElement("div");
            item.className = "ds-emotion-item";
            const usage = emotion.usageCount || 0;
            const usageBadge = usage > 0
                ? `<span class="ds-usage-badge" title="사용 횟수">×${usage}</span>`
                : `<span class="ds-usage-badge ds-usage-zero" title="한 번도 안 쓰임">×0</span>`;
            const groupsValue = Array.isArray(emotion.groups) ? emotion.groups.join(", ") : "";
            item.innerHTML = `
                <img class="ds-thumb" alt="${emotion.label}">
                <div class="ds-emotion-info">
                    <div class="ds-emotion-label-row">
                        <input type="text" class="ds-emotion-label text_pole"
                            value="${emotion.label}" data-char="${charName}" data-idx="${idx}">
                        ${usageBadge}
                    </div>
                    <textarea class="ds-emotion-desc text_pole" rows="2"
                        placeholder="설명 (선택) - 예: 차갑게 비웃는 표정"
                        data-char="${charName}" data-idx="${idx}">${emotion.description || ""}</textarea>
                    <input type="text" class="ds-emotion-groups text_pole"
                        placeholder="그룹/태그 (쉼표 구분, 선택) - 예: 긍정, 차분"
                        value="${groupsValue}" data-char="${charName}" data-idx="${idx}"
                        style="font-size:0.82em; margin-top:2px;">
                </div>
                <div class="ds-emotion-actions">
                    <button class="menu_button ds-nai-gen-one" data-char="${charName}" data-label="${emotion.label}" title="NAI로 이미지 생성">🎨</button>
                    <button class="menu_button ds-delete-btn" data-char="${charName}" data-idx="${idx}" title="삭제">🗑</button>
                </div>
            `;
            body.appendChild(item);

            loadImage(emotion.imageKey).then(blob => {
                if (blob) {
                    const url = URL.createObjectURL(blob);
                    item.querySelector(".ds-thumb").src = url;
                }
            });
        });

        listEl.appendChild(accordion);
    });

    // 헤더 클릭 → 펼치기/접기
    listEl.querySelectorAll(".ds-char-header").forEach(header => {
        header.addEventListener("click", (e) => {
            const charName = e.currentTarget.dataset.char;
            const body = e.currentTarget.nextElementSibling;
            const toggle = e.currentTarget.querySelector(".ds-char-toggle");
            const isExpanded = body.style.display !== "none";

            body.style.display = isExpanded ? "none" : "block";
            toggle.textContent = isExpanded ? "▶" : "▼";
            settings.expandedChars[charName] = !isExpanded;
            saveSettingsDebounced();
        });
    });

    // 라벨 수정
    listEl.querySelectorAll(".ds-emotion-label").forEach(input => {
        input.addEventListener("change", (e) => {
            const cn = e.target.dataset.char;
            const idx = parseInt(e.target.dataset.idx);
            settings.characters[cn].emotions[idx].label = e.target.value.trim();
            saveSettingsDebounced();
        });
    });

    // 설명 수정
    listEl.querySelectorAll(".ds-emotion-desc").forEach(input => {
        input.addEventListener("change", (e) => {
            const cn = e.target.dataset.char;
            const idx = parseInt(e.target.dataset.idx);
            settings.characters[cn].emotions[idx].description = e.target.value.trim();
            saveSettingsDebounced();
        });
    });

    // 그룹/태그 수정
    listEl.querySelectorAll(".ds-emotion-groups").forEach(input => {
        input.addEventListener("change", (e) => {
            const cn = e.target.dataset.char;
            const idx = parseInt(e.target.dataset.idx);
            const groups = e.target.value
                .split(",")
                .map(s => s.trim())
                .filter(s => s.length > 0);
            settings.characters[cn].emotions[idx].groups = groups;
            saveSettingsDebounced();
        });
    });

    // 삭제
    listEl.querySelectorAll(".ds-delete-btn").forEach(btn => {
        btn.addEventListener("click", async (e) => {
            const cn = e.currentTarget.dataset.char;
            const idx = parseInt(e.currentTarget.dataset.idx);
            const emotion = settings.characters[cn].emotions[idx];
            if (!confirm(`"${emotion.label}" 감정을 삭제할까요?`)) return;
            await deleteImage(emotion.imageKey);
            if (settings.imageBackup) delete settings.imageBackup[emotion.imageKey];
            settings.characters[cn].emotions.splice(idx, 1);
            saveSettingsDebounced();
            renderEmotionList();
        });
    });

    // NAI 단일 생성
    listEl.querySelectorAll(".ds-nai-gen-one").forEach(btn => {
        btn.addEventListener("click", async (e) => {
            const cn = e.currentTarget.dataset.char;
            const label = e.currentTarget.dataset.label;
            if (!settings.naiConfig?.apiKey) {
                toastr.warning("NAI API 키를 먼저 설정해주세요.");
                return;
            }
            const orig = btn.textContent;
            btn.disabled = true;
            btn.textContent = "⏳";
            try {
                await generateSpriteForLabel(cn, label);
                renderEmotionList();
                toastr.success(`"${label}" 생성 완료`);
            } catch (err) {
                toastr.error(`생성 실패: ${err.message}`);
                btn.disabled = false;
                btn.textContent = orig;
            }
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
    const profileField = document.getElementById("ds-api-profile-field");
    const keyField = document.getElementById("ds-api-key-field");
    const endpointField = document.getElementById("ds-api-endpoint-field");
    const modelField = document.getElementById("ds-api-model-field");
    const presetsField = document.getElementById("ds-api-presets-field");

    if (!stHint) return;

    // 모두 숨김
    stHint.style.display = "none";
    profileField.style.display = "none";
    keyField.style.display = "none";
    endpointField.style.display = "none";
    modelField.style.display = "none";
    presetsField.style.display = "none";

    if (mode === "st") {
        stHint.style.display = "block";
    } else if (mode === "st_profile") {
        profileField.style.display = "block";
        renderProfileDropdown();
    } else if (mode === "gemini") {
        keyField.style.display = "block";
        modelField.style.display = "block";
        document.getElementById("ds-api-key-label").textContent = "Gemini API 키";
        document.getElementById("ds-api-model-label").textContent = "모델명 (예: gemini-2.5-flash, gemini-2.0-flash)";
    } else if (mode === "openai_compat") {
        keyField.style.display = "block";
        endpointField.style.display = "block";
        modelField.style.display = "block";
        presetsField.style.display = "block";
        document.getElementById("ds-api-key-label").textContent = "API 키 (필요시)";
        document.getElementById("ds-api-model-label").textContent = "모델명 (예: deepseek-chat, google/gemini-2.5-flash 등)";
        renderPresets();
    }
}

function renderProfileDropdown() {
    const settings = extension_settings[extensionName];
    const select = document.getElementById("ds-api-profile");
    if (!select) return;

    const profiles = getSTProfiles();

    if (profiles.length === 0) {
        select.innerHTML = `<option value="">⚠️ ST에 등록된 Connection Profile 없음</option>`;
        return;
    }

    select.innerHTML = `<option value="">-- 프로필 선택 --</option>` +
        profiles.map(name =>
            `<option value="${name}" ${name === settings.apiProfile ? "selected" : ""}>${name}</option>`
        ).join("");
}

function renderPresets() {
    const container = document.getElementById("ds-api-presets");
    if (!container) return;

    const presets = [
        { name: "OpenRouter", endpoint: "https://openrouter.ai/api/v1" },
        { name: "OpenAI", endpoint: "https://api.openai.com/v1" },
        { name: "Groq", endpoint: "https://api.groq.com/openai/v1" },
        { name: "DeepSeek", endpoint: "https://api.deepseek.com/v1" }
    ];

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
                <b>Dynamic Sprite</b>
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
                    <label class="checkbox_label">
                        <input id="ds-notify-char-change" type="checkbox" ${settings.notifyCharChange !== false ? "checked" : ""}>
                        <span>캐릭터 변경 시 알림 표시</span>
                    </label>
                    <label>전환 효과 시간 (ms)</label>
                    <input id="ds-transition" type="number" class="text_pole"
                        value="${settings.transitionDuration}" min="0" max="2000">
                    <label>🎨 테마</label>
                    <div class="ds-theme-picker">
                        <button class="ds-theme-btn ${settings.theme === "system" ? "ds-theme-active" : ""}" data-theme="system" title="System (기본)">
                            <span class="ds-theme-swatch" style="background:linear-gradient(135deg,var(--SmartThemeBlurTintColor,#e8dcc8) 50%,var(--SmartThemeQuoteColor,#c8955a) 50%);"></span>
                        </button>
                        <button class="ds-theme-btn ${settings.theme === "mono" ? "ds-theme-active" : ""}" data-theme="mono" title="Mono (흑백)">
                            <span class="ds-theme-swatch" style="background:linear-gradient(135deg,#fff 50%,#111 50%);"></span>
                        </button>
                        <button class="ds-theme-btn ${settings.theme === "cream" ? "ds-theme-active" : ""}" data-theme="cream" title="Cream (베이지)">
                            <span class="ds-theme-swatch" style="background:linear-gradient(135deg,#f5efe0 50%,#b08754 50%);"></span>
                        </button>
                        <button class="ds-theme-btn ${settings.theme === "peach" ? "ds-theme-active" : ""}" data-theme="peach" title="Peach (피치)">
                            <span class="ds-theme-swatch" style="background:linear-gradient(135deg,#fff4ec 50%,#ff8a65 50%);"></span>
                        </button>
                        <button class="ds-theme-btn ${settings.theme === "lilac" ? "ds-theme-active" : ""}" data-theme="lilac" title="Lilac (연보라)">
                            <span class="ds-theme-swatch" style="background:linear-gradient(135deg,#fef8ff 50%,#b06dcc 50%);"></span>
                        </button>
                    </div>
                </div>

                <hr>

                <div class="ds-section ds-collapsible" data-collapse-key="desktopDisplay">
                    <h4 class="ds-collapse-header"><span class="ds-collapse-arrow">▶</span> 🖥️ 데스크탑 표시 설정</h4>
                    <div class="ds-collapse-body">
                        <label>위치</label>
                        <select id="ds-desktop-position" class="text_pole">
                            <option value="bottom-left" ${settings.desktopPosition === "bottom-left" ? "selected" : ""}>왼쪽 아래</option>
                            <option value="bottom-center" ${settings.desktopPosition === "bottom-center" ? "selected" : ""}>중앙 아래</option>
                            <option value="bottom-right" ${settings.desktopPosition === "bottom-right" ? "selected" : ""}>오른쪽 아래</option>
                        </select>

                        <label>가장자리 여백 X (px) — <span id="ds-desktop-offset-x-val">${settings.desktopOffsetX}</span></label>
                        <input id="ds-desktop-offset-x" type="range" min="0" max="500" value="${settings.desktopOffsetX}" class="ds-slider">

                        <label>바닥 여백 Y (px) — <span id="ds-desktop-offset-y-val">${settings.desktopOffsetY}</span></label>
                        <input id="ds-desktop-offset-y" type="range" min="0" max="500" value="${settings.desktopOffsetY}" class="ds-slider">

                        <label>높이 (화면 대비 %) — <span id="ds-desktop-height-val">${settings.desktopHeight}</span></label>
                        <input id="ds-desktop-height" type="range" min="10" max="100" value="${settings.desktopHeight}" class="ds-slider">

                        <label>최대 너비 (px) — <span id="ds-desktop-maxwidth-val">${settings.desktopMaxWidth}</span></label>
                        <input id="ds-desktop-maxwidth" type="range" min="50" max="1000" step="10" value="${settings.desktopMaxWidth}" class="ds-slider">

                        <label>투명도 (%) — <span id="ds-desktop-opacity-val">${settings.desktopOpacity}</span></label>
                        <input id="ds-desktop-opacity" type="range" min="10" max="100" value="${settings.desktopOpacity}" class="ds-slider">

                        <label>z-index (다른 UI보다 위로 띄우려면 높임) — <span id="ds-desktop-zindex-val">${settings.desktopZIndex}</span></label>
                        <input id="ds-desktop-zindex" type="range" min="0" max="9999" step="10" value="${settings.desktopZIndex}" class="ds-slider">
                    </div>
                </div>

                <hr>

                <div class="ds-section ds-collapsible" data-collapse-key="mobileDisplay">
                    <h4 class="ds-collapse-header"><span class="ds-collapse-arrow">▶</span> 📱 모바일 표시 설정</h4>
                    <div class="ds-collapse-body">
                        <p class="ds-hint">화면 너비가 아래 기준 이하일 때 적용됨.</p>

                        <label>모바일 기준 너비 (px) — <span id="ds-mobile-breakpoint-val">${settings.mobileBreakpoint}</span></label>
                        <input id="ds-mobile-breakpoint" type="range" min="320" max="1200" step="10" value="${settings.mobileBreakpoint}" class="ds-slider">

                        <label>위치</label>
                        <select id="ds-mobile-position" class="text_pole">
                            <option value="bottom-left" ${settings.mobilePosition === "bottom-left" ? "selected" : ""}>왼쪽 아래</option>
                            <option value="bottom-center" ${settings.mobilePosition === "bottom-center" ? "selected" : ""}>중앙 아래</option>
                            <option value="bottom-right" ${settings.mobilePosition === "bottom-right" ? "selected" : ""}>오른쪽 아래</option>
                        </select>

                        <label>가장자리 여백 X (px) — <span id="ds-mobile-offset-x-val">${settings.mobileOffsetX}</span></label>
                        <input id="ds-mobile-offset-x" type="range" min="0" max="300" value="${settings.mobileOffsetX}" class="ds-slider">

                        <label>바닥 여백 Y (px) — <span id="ds-mobile-offset-y-val">${settings.mobileOffsetY}</span></label>
                        <input id="ds-mobile-offset-y" type="range" min="0" max="500" value="${settings.mobileOffsetY}" class="ds-slider">

                        <label>높이 (화면 대비 %) — <span id="ds-mobile-height-val">${settings.mobileHeight}</span></label>
                        <input id="ds-mobile-height" type="range" min="10" max="100" value="${settings.mobileHeight}" class="ds-slider">

                        <label>최대 너비 (px) — <span id="ds-mobile-maxwidth-val">${settings.mobileMaxWidth}</span></label>
                        <input id="ds-mobile-maxwidth" type="range" min="50" max="800" step="10" value="${settings.mobileMaxWidth}" class="ds-slider">

                        <label>투명도 (%) — <span id="ds-mobile-opacity-val">${settings.mobileOpacity}</span></label>
                        <input id="ds-mobile-opacity" type="range" min="10" max="100" value="${settings.mobileOpacity}" class="ds-slider">

                        <label>z-index (모바일 채팅창에 가려지면 높임) — <span id="ds-mobile-zindex-val">${settings.mobileZIndex}</span></label>
                        <input id="ds-mobile-zindex" type="range" min="0" max="9999" step="10" value="${settings.mobileZIndex}" class="ds-slider">

                        <button id="ds-display-reset" class="menu_button" style="margin-top:10px;">↺ 표시 설정 기본값으로</button>
                    </div>
                </div>

                <hr>

                <div class="ds-section ds-collapsible" data-collapse-key="presets">
                    <h4 class="ds-collapse-header"><span class="ds-collapse-arrow">▶</span> 💾 표시 설정 프리셋</h4>
                    <div class="ds-collapse-body">
                        <p class="ds-hint">현재 표시 설정(데스크탑+모바일)을 이름 붙여 저장. 캐릭터별로 다른 위치 쓸 때 편함.</p>
                        <div style="display:flex; gap:6px; flex-wrap:wrap;">
                            <input type="text" id="ds-preset-name" class="text_pole" placeholder="프리셋 이름" style="flex:1; min-width:140px;">
                            <button id="ds-preset-save" class="menu_button">💾 저장</button>
                        </div>
                        <div id="ds-preset-list" style="margin-top:8px; display:flex; flex-direction:column; gap:4px;"></div>
                    </div>
                </div>

                <hr>

                <div class="ds-section ds-collapsible" data-collapse-key="compress">
                    <h4 class="ds-collapse-header"><span class="ds-collapse-arrow">▶</span> 🗜️ 이미지 압축 / 백업</h4>
                    <div class="ds-collapse-body">
                        <p class="ds-hint">압축 켜면 업로드 시 자동으로 리사이즈/WebP 변환. 백업은 ST 설정에 base64로 저장해서 origin이 바뀌어도 자동 복원됨.</p>
                        <label class="checkbox_label">
                            <input id="ds-auto-compress" type="checkbox" ${settings.autoCompress !== false ? "checked" : ""}>
                            <span>자동 압축 사용</span>
                        </label>
                        <label class="checkbox_label">
                            <input id="ds-auto-backup" type="checkbox" ${settings.autoBackup !== false ? "checked" : ""}>
                            <span>자동 백업 사용 (origin 변경 대비)</span>
                        </label>
                        <label>최대 크기 (가장 긴 변, px) — <span id="ds-compress-maxdim-val">${settings.compressMaxDim || 800}</span></label>
                        <input id="ds-compress-maxdim" type="range" min="200" max="2000" step="50" value="${settings.compressMaxDim || 800}" class="ds-slider">
                        <label>품질 (%) — <span id="ds-compress-quality-val">${settings.compressQuality || 85}</span></label>
                        <input id="ds-compress-quality" type="range" min="30" max="100" step="5" value="${settings.compressQuality || 85}" class="ds-slider">
                    </div>
                </div>

                <hr>

                <div class="ds-section ds-collapsible" data-collapse-key="groups">
                    <h4 class="ds-collapse-header"><span class="ds-collapse-arrow">▶</span> 📊 통계 / 그룹별 사용</h4>
                    <div class="ds-collapse-body">
                        <p class="ds-hint">현재 캐릭터의 감정 사용 통계. 그룹은 감정 카드의 "그룹/태그" 입력으로 지정.</p>
                        <div style="display:flex; gap:6px; margin-bottom:8px;">
                            <button id="ds-stats-refresh" class="menu_button" style="flex:1;">🔄 통계 새로고침</button>
                            <button id="ds-stats-reset" class="menu_button" style="flex:1;">↺ 카운트 초기화</button>
                        </div>
                        <div id="ds-stats-content"></div>
                    </div>
                </div>

                <hr>

                <div class="ds-section ds-collapsible" data-collapse-key="naiGen">
                    <h4 class="ds-collapse-header"><span class="ds-collapse-arrow">▶</span> AI 표정 생성 (NovelAI)</h4>
                    <div class="ds-collapse-body">
                        <p class="ds-hint">NovelAI API로 표정 이미지를 자동 생성합니다. API 키는 NAI 계정 설정에서 발급받으세요.</p>

                        <label>NovelAI API 키</label>
                        <div class="ds-key-input-wrap">
                            <input type="password" id="ds-nai-key" class="text_pole"
                                value="${settings.naiConfig?.apiKey || ""}" autocomplete="off"
                                placeholder="pst-...">
                            <button type="button" id="ds-nai-key-toggle" class="menu_button" title="키 표시/숨김">👁</button>
                        </div>

                        <label>모델</label>
                        <select id="ds-nai-model" class="text_pole">
                            <option value="nai-diffusion-4-5-full" ${settings.naiConfig?.model === "nai-diffusion-4-5-full" ? "selected" : ""}>NAI Diffusion V4.5 Full (최신)</option>
                            <option value="nai-diffusion-4-5-curated" ${settings.naiConfig?.model === "nai-diffusion-4-5-curated" ? "selected" : ""}>NAI Diffusion V4.5 Curated</option>
                            <option value="nai-diffusion-4-full" ${settings.naiConfig?.model === "nai-diffusion-4-full" ? "selected" : ""}>NAI Diffusion V4 Full</option>
                            <option value="nai-diffusion-4-curated-preview" ${settings.naiConfig?.model === "nai-diffusion-4-curated-preview" ? "selected" : ""}>NAI Diffusion V4 Curated</option>
                            <option value="nai-diffusion-3" ${settings.naiConfig?.model === "nai-diffusion-3" ? "selected" : ""}>NAI Diffusion V3</option>
                        </select>

                        <label>해상도</label>
                        <select id="ds-nai-size" class="text_pole">
                            <option value="832x1216">832×1216 (세로 - 캐릭터 추천)</option>
                            <option value="1024x1024">1024×1024 (정사각)</option>
                            <option value="1216x832">1216×832 (가로)</option>
                            <option value="512x768">512×768 (작게)</option>
                        </select>

                        <button id="ds-nai-test" class="menu_button" style="margin-top:10px;">NAI 연결 테스트 (1장 생성)</button>
                        <div id="ds-nai-test-result" style="margin-top:8px; font-size:0.88em;"></div>

                        <hr>

                        <label>현재 캐릭터 베이스 프롬프트</label>
                        <p class="ds-hint">캐릭터 고정 외모/의상. 예: <code>1girl, white hair, blue eyes, school uniform</code></p>
                        <textarea id="ds-nai-base-prompt" class="text_pole" rows="3"
                            placeholder="1girl, ..."></textarea>

                        <label>네거티브 프롬프트</label>
                        <textarea id="ds-nai-neg-prompt" class="text_pole" rows="2"
                            placeholder="lowres, bad anatomy, ... (비워두면 기본값 사용)"></textarea>

                        <hr>

                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
                            <label style="margin:0;">라벨별 표정 프롬프트</label>
                            <button id="ds-nai-fill-defaults" class="menu_button" style="font-size:0.8em; padding:3px 8px;">기본값 채우기</button>
                        </div>
                        <p class="ds-hint">비워두면 내장 기본 프롬프트 자동 적용</p>
                        <div id="ds-nai-label-prompts" style="margin-top:4px;"></div>

                        <hr>

                        <button id="ds-nai-gen-all" class="menu_button" style="width:100%;">⚡ 전체 라벨 일괄 생성</button>
                        <div id="ds-nai-progress" style="display:none; margin-top:8px;">
                            <div id="ds-nai-progress-text" style="font-size:0.85em; margin-bottom:4px;"></div>
                            <div style="height:6px; background:rgba(255,255,255,0.1); border-radius:3px; overflow:hidden;">
                                <div id="ds-nai-progress-bar" style="height:100%; width:0%; background:rgba(150,100,220,0.7); transition:width 300ms ease;"></div>
                            </div>
                        </div>
                        <div id="ds-nai-gen-status" style="font-size:0.83em; margin-top:6px; min-height:14px; line-height:1.5;"></div>
                    </div>
                </div>

                <hr>

                <div class="ds-section">
                    <h4>⚡ 감정 분석용 API</h4>
                    <p class="ds-hint">본문 생성과 별도로 빠른 모델 사용 가능.</p>

                    <label>API 모드</label>
                    <select id="ds-api-mode" class="text_pole">
                        <option value="st" ${settings.apiMode === "st" ? "selected" : ""}>본문 생성 API 재사용 (기본)</option>
                        <option value="st_profile" ${settings.apiMode === "st_profile" ? "selected" : ""}>ST의 다른 Connection Profile 사용 ⭐</option>
                        <option value="gemini" ${settings.apiMode === "gemini" ? "selected" : ""}>Gemini API 키 직접</option>
                        <option value="openai_compat" ${settings.apiMode === "openai_compat" ? "selected" : ""}>OpenAI 호환 (OpenRouter 등)</option>
                    </select>

                    <div id="ds-api-st-hint" class="ds-hint" style="margin-top:8px;">
                        💡 ST 현재 연결된 API를 그대로 사용. 추가 설정 불필요.
                    </div>

                    <div id="ds-api-profile-field" style="display:none;">
                        <label>분석용 Connection Profile</label>
                        <select id="ds-api-profile" class="text_pole"></select>
                        <p class="ds-hint">⭐ 추천: ST에서 "Quick-Classify" 같은 프로필 미리 만들어두기 (Gemini 2.5 Flash나 DeepSeek 추천).<br>
                        본문 생성 끝난 뒤 일시적으로 이 프로필로 전환해서 분석함.</p>
                        <button id="ds-refresh-profiles" class="menu_button">🔄 프로필 목록 새로고침</button>
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
                        <label>API 엔드포인트</label>
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
                            placeholder="모델명을 직접 입력"
                            value="${settings.apiModel || ""}">
                    </div>

                    <button id="ds-api-test" class="menu_button" style="margin-top:10px;">🔌 API 연결 테스트</button>
                    <div id="ds-api-test-result"></div>
                </div>

                <hr>

                <div class="ds-section">
                    <h4>현재 활성 캐릭터: <span id="ds-current-char" style="color:var(--SmartThemeQuoteColor);"></span></h4>
                    <div style="display:flex; gap:6px; flex-wrap:wrap; margin-bottom:8px;">
                        <button id="ds-delete-current-char" class="menu_button" style="flex:1; min-width:120px;">현재 캐릭터 감정 전체 삭제</button>
                        <button id="ds-delete-all" class="menu_button" style="flex:1; min-width:120px; color:#ff8080;">모든 캐릭터 전체 삭제</button>
                    </div>
                    <div id="ds-emotion-list" class="ds-emotion-list"></div>
                    <div class="ds-list-nav">
                        <button class="menu_button ds-list-nav-btn" id="ds-list-up" title="위로">&lt;</button>
                        <button class="menu_button ds-list-nav-btn" id="ds-list-down" title="아래로">&gt;</button>
                    </div>
                </div>

                <hr>

                <div class="ds-section">
                    <h4>📥 감정 이미지 추가</h4>
                    <p class="ds-hint">
                        파일명에서 라벨 자동 추출 (예: <code>SPR_Damian_aloof.png</code> → <code>aloof</code>).
                    </p>
                    <input type="file" id="ds-file-input" accept="image/*" multiple style="display:none;">
                    <input type="file" id="ds-folder-input" webkitdirectory directory multiple style="display:none;">
                    <div class="ds-upload-buttons">
                        <button id="ds-upload-files-btn" class="menu_button">파일들 선택</button>
                        <button id="ds-upload-folder-btn" class="menu_button">폴더 통째로</button>
                    </div>
                    <div id="ds-upload-status"></div>
                </div>

                <hr>

                <div class="ds-section">
                    <h4>🧠 캐릭터 성격 / 분석 지침</h4>
                    <textarea id="ds-custom-prompt" class="text_pole" rows="3"
                        placeholder="예: 이 character는 무뚝뚝하고 감정 표현을 절제하는 성격. 명확한 신호 없을 때는 neutral 우선.">${settings.customPrompt || ""}</textarea>
                </div>

                <hr>

                <div class="ds-section">
                    <h4>🧪 분석 테스트</h4>
                    <textarea id="ds-test-input" class="text_pole" rows="2"
                        placeholder="테스트할 캐릭터 대사 입력"></textarea>
                    <button id="ds-test-btn" class="menu_button" style="margin-top:6px;">▶ 분석 실행</button>
                    <div id="ds-test-result"></div>
                </div>

                <hr>

                <div class="ds-section ds-actions-row">
                    <button id="ds-refresh" class="menu_button">리스트 새로고침</button>
                    <button id="ds-export" class="menu_button">백업</button>
                    <button id="ds-import-btn" class="menu_button">복원</button>
                    <input type="file" id="ds-import-input" accept=".json" style="display:none;">
                </div>
            </div>
        </div>
    </div>`;

    $("#extensions_settings").append(html);

    // 리스트 네비게이션 버튼 — append 직후 직접 바인딩
    document.getElementById("ds-list-up").addEventListener("click", () => {
        const el = document.getElementById("ds-emotion-list");
        if (el) el.scrollTop = Math.max(0, el.scrollTop - 280);
    });
    document.getElementById("ds-list-down").addEventListener("click", () => {
        const el = document.getElementById("ds-emotion-list");
        if (el) el.scrollTop = Math.min(el.scrollHeight, el.scrollTop + 280);
    });

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

    $(document).on("click", "#dynamic-sprites-settings .ds-theme-btn", function () {
        settings.theme = this.dataset.theme;
        applyTheme();
        saveSettingsDebounced();
    });

    // === 표시 설정 슬라이더 ===
    // 슬라이더 값 변경 시 즉시 반영하는 헬퍼
    const bindDisplaySlider = (sliderId, valueLabelId, settingKey, parser = parseInt) => {
        const slider = document.getElementById(sliderId);
        const label = document.getElementById(valueLabelId);
        if (!slider) return;
        slider.addEventListener("input", () => {
            const v = parser(slider.value);
            settings[settingKey] = v;
            if (label) label.textContent = v;
            applyDisplayStyles();
        });
        slider.addEventListener("change", () => {
            saveSettingsDebounced();
        });
    };

    // 데스크탑
    bindDisplaySlider("ds-desktop-offset-x", "ds-desktop-offset-x-val", "desktopOffsetX");
    bindDisplaySlider("ds-desktop-offset-y", "ds-desktop-offset-y-val", "desktopOffsetY");
    bindDisplaySlider("ds-desktop-height", "ds-desktop-height-val", "desktopHeight");
    bindDisplaySlider("ds-desktop-maxwidth", "ds-desktop-maxwidth-val", "desktopMaxWidth");
    bindDisplaySlider("ds-desktop-opacity", "ds-desktop-opacity-val", "desktopOpacity");
    bindDisplaySlider("ds-desktop-zindex", "ds-desktop-zindex-val", "desktopZIndex");

    $("#ds-desktop-position").on("change", function () {
        settings.desktopPosition = this.value;
        applyDisplayStyles();
        saveSettingsDebounced();
    });

    // 모바일
    bindDisplaySlider("ds-mobile-breakpoint", "ds-mobile-breakpoint-val", "mobileBreakpoint");
    bindDisplaySlider("ds-mobile-offset-x", "ds-mobile-offset-x-val", "mobileOffsetX");
    bindDisplaySlider("ds-mobile-offset-y", "ds-mobile-offset-y-val", "mobileOffsetY");
    bindDisplaySlider("ds-mobile-height", "ds-mobile-height-val", "mobileHeight");
    bindDisplaySlider("ds-mobile-maxwidth", "ds-mobile-maxwidth-val", "mobileMaxWidth");
    bindDisplaySlider("ds-mobile-opacity", "ds-mobile-opacity-val", "mobileOpacity");
    bindDisplaySlider("ds-mobile-zindex", "ds-mobile-zindex-val", "mobileZIndex");

    $("#ds-mobile-position").on("change", function () {
        settings.mobilePosition = this.value;
        applyDisplayStyles();
        saveSettingsDebounced();
    });

    $("#ds-display-reset").on("click", function () {
        const displayKeys = [
            "desktopPosition", "desktopOffsetX", "desktopOffsetY", "desktopHeight",
            "desktopMaxWidth", "desktopOpacity", "desktopZIndex",
            "mobilePosition", "mobileOffsetX", "mobileOffsetY", "mobileHeight",
            "mobileMaxWidth", "mobileOpacity", "mobileZIndex", "mobileBreakpoint"
        ];
        displayKeys.forEach(k => settings[k] = defaultSettings[k]);
        applyDisplayStyles();
        saveSettingsDebounced();
        // UI 슬라이더/셀렉트 값 동기화
        document.getElementById("ds-desktop-position").value = settings.desktopPosition;
        document.getElementById("ds-mobile-position").value = settings.mobilePosition;
        displayKeys.forEach(k => {
            const map = {
                desktopOffsetX: ["ds-desktop-offset-x", "ds-desktop-offset-x-val"],
                desktopOffsetY: ["ds-desktop-offset-y", "ds-desktop-offset-y-val"],
                desktopHeight: ["ds-desktop-height", "ds-desktop-height-val"],
                desktopMaxWidth: ["ds-desktop-maxwidth", "ds-desktop-maxwidth-val"],
                desktopOpacity: ["ds-desktop-opacity", "ds-desktop-opacity-val"],
                desktopZIndex: ["ds-desktop-zindex", "ds-desktop-zindex-val"],
                mobileBreakpoint: ["ds-mobile-breakpoint", "ds-mobile-breakpoint-val"],
                mobileOffsetX: ["ds-mobile-offset-x", "ds-mobile-offset-x-val"],
                mobileOffsetY: ["ds-mobile-offset-y", "ds-mobile-offset-y-val"],
                mobileHeight: ["ds-mobile-height", "ds-mobile-height-val"],
                mobileMaxWidth: ["ds-mobile-maxwidth", "ds-mobile-maxwidth-val"],
                mobileOpacity: ["ds-mobile-opacity", "ds-mobile-opacity-val"],
                mobileZIndex: ["ds-mobile-zindex", "ds-mobile-zindex-val"]
            };
            if (map[k]) {
                const [sId, lId] = map[k];
                const s = document.getElementById(sId);
                const l = document.getElementById(lId);
                if (s) s.value = settings[k];
                if (l) l.textContent = settings[k];
            }
        });
        toastr.success("표시 설정을 기본값으로 되돌렸습니다");
    });

    // === 표시 설정 프리셋 ===
    const DISPLAY_KEYS = [
        "desktopPosition", "desktopOffsetX", "desktopOffsetY", "desktopHeight",
        "desktopMaxWidth", "desktopOpacity", "desktopZIndex",
        "mobilePosition", "mobileOffsetX", "mobileOffsetY", "mobileHeight",
        "mobileMaxWidth", "mobileOpacity", "mobileZIndex", "mobileBreakpoint"
    ];

    const DISPLAY_UI_MAP = {
        desktopOffsetX: ["ds-desktop-offset-x", "ds-desktop-offset-x-val"],
        desktopOffsetY: ["ds-desktop-offset-y", "ds-desktop-offset-y-val"],
        desktopHeight: ["ds-desktop-height", "ds-desktop-height-val"],
        desktopMaxWidth: ["ds-desktop-maxwidth", "ds-desktop-maxwidth-val"],
        desktopOpacity: ["ds-desktop-opacity", "ds-desktop-opacity-val"],
        desktopZIndex: ["ds-desktop-zindex", "ds-desktop-zindex-val"],
        mobileBreakpoint: ["ds-mobile-breakpoint", "ds-mobile-breakpoint-val"],
        mobileOffsetX: ["ds-mobile-offset-x", "ds-mobile-offset-x-val"],
        mobileOffsetY: ["ds-mobile-offset-y", "ds-mobile-offset-y-val"],
        mobileHeight: ["ds-mobile-height", "ds-mobile-height-val"],
        mobileMaxWidth: ["ds-mobile-maxwidth", "ds-mobile-maxwidth-val"],
        mobileOpacity: ["ds-mobile-opacity", "ds-mobile-opacity-val"],
        mobileZIndex: ["ds-mobile-zindex", "ds-mobile-zindex-val"]
    };

    function syncDisplayUI() {
        document.getElementById("ds-desktop-position").value = settings.desktopPosition;
        document.getElementById("ds-mobile-position").value = settings.mobilePosition;
        for (const k of DISPLAY_KEYS) {
            if (DISPLAY_UI_MAP[k]) {
                const [sId, lId] = DISPLAY_UI_MAP[k];
                const s = document.getElementById(sId);
                const l = document.getElementById(lId);
                if (s) s.value = settings[k];
                if (l) l.textContent = settings[k];
            }
        }
    }

    function renderPresetList() {
        const listEl = document.getElementById("ds-preset-list");
        if (!listEl) return;
        settings.displayPresets = settings.displayPresets || {};
        const names = Object.keys(settings.displayPresets);
        if (names.length === 0) {
            listEl.innerHTML = `<div class="ds-hint">저장된 프리셋 없음</div>`;
            return;
        }
        listEl.innerHTML = names.map(name => `
            <div style="display:flex; gap:4px; align-items:center;">
                <span style="flex:1; font-size:0.9em; padding:4px 8px; background:rgba(255,255,255,0.05); border-radius:4px;">${name}</span>
                <button class="menu_button ds-preset-load" data-name="${name}" style="padding:4px 8px;">▶ 불러오기</button>
                <button class="menu_button ds-preset-delete" data-name="${name}" style="padding:4px 8px;">🗑️</button>
            </div>
        `).join("");

        listEl.querySelectorAll(".ds-preset-load").forEach(btn => {
            btn.addEventListener("click", e => {
                const name = e.currentTarget.dataset.name;
                const preset = settings.displayPresets[name];
                if (!preset) return;
                for (const k of DISPLAY_KEYS) {
                    if (preset[k] !== undefined) settings[k] = preset[k];
                }
                applyDisplayStyles();
                syncDisplayUI();
                saveSettingsDebounced();
                toastr.success(`"${name}" 프리셋 불러옴`);
            });
        });

        listEl.querySelectorAll(".ds-preset-delete").forEach(btn => {
            btn.addEventListener("click", e => {
                const name = e.currentTarget.dataset.name;
                if (!confirm(`"${name}" 프리셋을 삭제할까요?`)) return;
                delete settings.displayPresets[name];
                saveSettingsDebounced();
                renderPresetList();
            });
        });
    }

    $("#ds-preset-save").on("click", function () {
        const nameInput = document.getElementById("ds-preset-name");
        const name = nameInput.value.trim();
        if (!name) {
            toastr.warning("프리셋 이름을 입력하세요");
            return;
        }
        settings.displayPresets = settings.displayPresets || {};
        if (settings.displayPresets[name] && !confirm(`"${name}"이 이미 있어요. 덮어쓸까요?`)) return;
        const snapshot = {};
        for (const k of DISPLAY_KEYS) snapshot[k] = settings[k];
        settings.displayPresets[name] = snapshot;
        saveSettingsDebounced();
        nameInput.value = "";
        renderPresetList();
        toastr.success(`"${name}" 프리셋 저장됨`);
    });

    renderPresetList();

    // === 일괄 삭제 버튼 ===
    $("#ds-delete-current-char").on("click", async function () {
        const charName = getCurrentCharName();
        if (!charName) {
            toastr.warning("현재 캐릭터를 찾을 수 없습니다");
            return;
        }
        const charData = settings.characters[charName];
        if (!charData || charData.emotions.length === 0) {
            toastr.info(`"${charName}"에 등록된 감정이 없습니다`);
            return;
        }
        if (!confirm(`"${charName}"의 감정 ${charData.emotions.length}개를 모두 삭제할까요? (이미지 파일과 백업까지 삭제)`)) return;
        const count = await deleteAllEmotionsForChar(charName);
        renderEmotionList();
        toastr.success(`"${charName}"의 감정 ${count}개를 삭제했습니다`);
    });

    $("#ds-delete-all").on("click", async function () {
        const charCount = Object.keys(settings.characters).filter(n => settings.characters[n].emotions.length > 0).length;
        if (charCount === 0) {
            toastr.info("삭제할 감정이 없습니다");
            return;
        }
        if (!confirm(`⚠️ 모든 캐릭터의 감정 데이터를 전부 삭제합니다.\n캐릭터 수: ${charCount}\n진짜로 삭제할까요? (되돌릴 수 없음)`)) return;
        if (!confirm("정말 확실해요? 마지막 확인입니다.")) return;
        const total = await deleteAllEmotionsEverywhere();
        renderEmotionList();
        toastr.success(`전체 ${total}개 감정을 삭제했습니다`);
    });

    // === 압축 / 백업 설정 ===
    $("#ds-auto-compress").on("change", function () {
        settings.autoCompress = $(this).prop("checked");
        saveSettingsDebounced();
    });

    $("#ds-auto-backup").on("change", function () {
        settings.autoBackup = $(this).prop("checked");
        saveSettingsDebounced();
    });

    bindDisplaySlider("ds-compress-maxdim", "ds-compress-maxdim-val", "compressMaxDim");
    bindDisplaySlider("ds-compress-quality", "ds-compress-quality-val", "compressQuality");

    $("#ds-notify-char-change").on("change", function () {
        settings.notifyCharChange = $(this).prop("checked");
        saveSettingsDebounced();
    });

    // === 통계 / 그룹별 사용 ===
    function renderStats() {
        const contentEl = document.getElementById("ds-stats-content");
        if (!contentEl) return;
        const charName = getCurrentCharName();
        if (!charName) {
            contentEl.innerHTML = `<div class="ds-hint">캐릭터를 선택하세요</div>`;
            return;
        }
        const charData = settings.characters[charName];
        if (!charData || charData.emotions.length === 0) {
            contentEl.innerHTML = `<div class="ds-hint">"${charName}"에 등록된 감정 없음</div>`;
            return;
        }

        const totalUsage = charData.emotions.reduce((sum, e) => sum + (e.usageCount || 0), 0);

        // 그룹별 통계
        const groupStats = {};
        const ungrouped = [];
        for (const emotion of charData.emotions) {
            const usage = emotion.usageCount || 0;
            const groups = Array.isArray(emotion.groups) && emotion.groups.length > 0 ? emotion.groups : null;
            if (groups) {
                for (const g of groups) {
                    if (!groupStats[g]) groupStats[g] = { count: 0, emotions: [] };
                    groupStats[g].count += usage;
                    groupStats[g].emotions.push({ label: emotion.label, usage });
                }
            } else {
                ungrouped.push({ label: emotion.label, usage });
            }
        }

        // 라벨별 정렬
        const sortedEmotions = [...charData.emotions].sort((a, b) => (b.usageCount || 0) - (a.usageCount || 0));
        const top = sortedEmotions.slice(0, 5);
        const unused = charData.emotions.filter(e => !e.usageCount).map(e => e.label);

        let html = `
            <div style="margin-bottom:8px; padding:8px; background:rgba(255,255,255,0.04); border-radius:6px;">
                <b>${charName}</b> · 총 분석 ${totalUsage}회 · 등록 감정 ${charData.emotions.length}개
            </div>
        `;

        if (totalUsage > 0) {
            html += `<div style="margin-bottom:8px;"><b style="font-size:0.9em;">🔥 자주 쓰인 감정 (TOP 5)</b><br>`;
            html += top.filter(e => (e.usageCount || 0) > 0).map(e => {
                const pct = totalUsage > 0 ? Math.round((e.usageCount / totalUsage) * 100) : 0;
                return `<div style="display:flex; align-items:center; gap:6px; margin:3px 0;">
                    <span style="flex:1; font-size:0.88em;">${e.label}</span>
                    <span style="font-size:0.8em; opacity:0.7;">${e.usageCount}회 (${pct}%)</span>
                    <div style="width:60px; height:6px; background:rgba(255,255,255,0.08); border-radius:3px; overflow:hidden;">
                        <div style="height:100%; width:${pct}%; background:rgba(100,180,255,0.7);"></div>
                    </div>
                </div>`;
            }).join("");
            html += `</div>`;
        }

        if (Object.keys(groupStats).length > 0) {
            html += `<div style="margin-bottom:8px;"><b style="font-size:0.9em;">📂 그룹별 사용</b><br>`;
            const sortedGroups = Object.entries(groupStats).sort((a, b) => b[1].count - a[1].count);
            html += sortedGroups.map(([g, data]) => {
                const pct = totalUsage > 0 ? Math.round((data.count / totalUsage) * 100) : 0;
                return `<div style="display:flex; align-items:center; gap:6px; margin:3px 0;">
                    <span style="flex:1; font-size:0.88em;">${g} <span style="opacity:0.5; font-size:0.85em;">(${data.emotions.length}개)</span></span>
                    <span style="font-size:0.8em; opacity:0.7;">${data.count}회 (${pct}%)</span>
                    <div style="width:60px; height:6px; background:rgba(255,255,255,0.08); border-radius:3px; overflow:hidden;">
                        <div style="height:100%; width:${pct}%; background:rgba(180,140,255,0.7);"></div>
                    </div>
                </div>`;
            }).join("");
            html += `</div>`;
        }

        if (unused.length > 0) {
            html += `<div style="margin-bottom:8px;"><b style="font-size:0.9em; opacity:0.7;">💤 한 번도 안 쓰인 감정 (${unused.length}개)</b><br>
                <div style="font-size:0.82em; opacity:0.6; margin-top:3px;">${unused.join(", ")}</div>
            </div>`;
        }

        contentEl.innerHTML = html;
    }

    $("#ds-stats-refresh").on("click", renderStats);
    $("#ds-stats-reset").on("click", function () {
        if (!confirm("모든 캐릭터의 사용 횟수를 0으로 초기화할까요?")) return;
        for (const cn in settings.characters) {
            for (const e of settings.characters[cn].emotions) {
                e.usageCount = 0;
            }
        }
        saveSettingsDebounced();
        renderStats();
        renderEmotionList();
        toastr.success("사용 횟수 초기화됨");
    });

    // 통계 섹션 펼칠 때 자동 렌더
    document.querySelector('[data-collapse-key="groups"] .ds-collapse-header')?.addEventListener("click", () => {
        setTimeout(renderStats, 50);
    });
    renderStats();

    $("#ds-custom-prompt").on("change", function () {
        settings.customPrompt = this.value;
        saveSettingsDebounced();
    });

    $("#ds-api-mode").on("change", function () {
        settings.apiMode = this.value;
        saveSettingsDebounced();
        updateApiFieldsVisibility();
    });

    $("#ds-api-profile").on("change", function () {
        settings.apiProfile = this.value;
        saveSettingsDebounced();
    });

    $("#ds-refresh-profiles").on("click", () => {
        renderProfileDropdown();
        toastr.info("프로필 목록 갱신됨");
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
                case "st_profile":
                    result = await callSTProfile(testPrompt, settings.apiProfile);
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

    // 파일들 업로드
    $("#ds-upload-files-btn").on("click", () => $("#ds-file-input").trigger("click"));

    $("#ds-file-input").on("change", async function () {
        const files = Array.from(this.files);
        if (files.length === 0) return;
        const status = $("#ds-upload-status");
        const results = [];
        let i = 0;
        for (const file of files) {
            i++;
            status.html(`처리 중... (${i}/${files.length}) - ${file.name}`);
            try {
                const label = await addEmotion(file);
                if (label) results.push(`✅ <b>${label}</b>`);
            } catch (err) {
                results.push(`❌ ${file.name}`);
            }
        }
        status.html(results.join(" "));
        renderEmotionList();
        this.value = "";
    });

    // 폴더 통째 업로드
    $("#ds-upload-folder-btn").on("click", () => $("#ds-folder-input").trigger("click"));

    $("#ds-folder-input").on("change", async function () {
        const files = Array.from(this.files);
        if (files.length === 0) return;
        await handleFolderUpload(files);
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

    $("#ds-export").on("click", async () => {
        const exportData = {
            version: 4,
            settings: { ...extension_settings[extensionName] },
            images: {}
        };
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
        toastr.success("백업 다운로드 완료 (API 키 제외)");
    });

    $("#ds-import-btn").on("click", () => $("#ds-import-input").trigger("click"));

    $("#ds-import-input").on("change", async function () {
        const file = this.files[0];
        if (!file) return;
        if (!confirm("기존 설정과 병합됩니다. 진행할까요?")) return;
        try {
            const text = await file.text();
            const data = JSON.parse(text);
            const stg = extension_settings[extensionName];
            stg.imageBackup = stg.imageBackup || {};
            for (const key in data.images) {
                const base64 = data.images[key];
                const blob = await base64ToBlob(base64);
                await saveImage(key, blob);
                // 백업에도 저장해서 다음 origin 변경 시에도 안전
                stg.imageBackup[key] = base64;
            }
            Object.assign(stg.characters, data.settings.characters);
            // 프리셋도 있으면 병합
            if (data.settings.displayPresets) {
                stg.displayPresets = stg.displayPresets || {};
                Object.assign(stg.displayPresets, data.settings.displayPresets);
            }
            saveSettingsDebounced();
            renderEmotionList();
            renderPresetList();
            toastr.success("가져오기 완료");
        } catch (err) {
            toastr.error("가져오기 실패: " + err.message);
        }
        this.value = "";
    });

    let lastNotifiedChar = null;
    eventSource.on(event_types.CHAT_CHANGED, async () => {
        setTimeout(async () => {
            renderEmotionList();

            const charName = getCurrentCharName();
            if (!charName) return;

            const charData = settings.characters[charName];
            const img = document.getElementById("dynamic-sprite-img");

            if (charData && charData.emotions.length > 0) {
                const targetLabel = charData.current
                    || charData.emotions.find(e => e.label.toLowerCase() === "neutral")?.label
                    || charData.emotions[0].label;
                await updateSprite(targetLabel);
            } else {
                if (img) {
                    img.style.opacity = "0";
                    setTimeout(() => { img.style.display = "none"; }, settings.transitionDuration || 300);
                }
            }

            if (charName !== lastNotifiedChar) {
                if (settings.notifyCharChange && lastNotifiedChar !== null) {
                    toastr.info(`캐릭터 변경: ${charName}`, "", { timeOut: 1500 });
                }
                lastNotifiedChar = charName;
                syncNaiCharUI?.();
            }
        }, 300);
    });

    // === NAI 설정 ===
    $("#ds-nai-key").on("change", function () {
        settings.naiConfig = settings.naiConfig || {};
        settings.naiConfig.apiKey = this.value;
        saveSettingsDebounced();
    });

    $("#ds-nai-key-toggle").on("click", function () {
        const input = document.getElementById("ds-nai-key");
        if (input.type === "password") {
            input.type = "text";
            this.textContent = "🙈";
        } else {
            input.type = "password";
            this.textContent = "👁";
        }
    });

    $("#ds-nai-model").on("change", function () {
        settings.naiConfig = settings.naiConfig || {};
        settings.naiConfig.model = this.value;
        saveSettingsDebounced();
    });

    $("#ds-nai-size").on("change", function () {
        const [w, h] = this.value.split("x").map(Number);
        settings.naiConfig = settings.naiConfig || {};
        settings.naiConfig.width = w;
        settings.naiConfig.height = h;
        saveSettingsDebounced();
    });

    if (settings.naiConfig?.width && settings.naiConfig?.height) {
        const sizeStr = `${settings.naiConfig.width}x${settings.naiConfig.height}`;
        const sizeSelect = document.getElementById("ds-nai-size");
        if (sizeSelect) sizeSelect.value = sizeStr;
    }

    $("#ds-nai-test").on("click", async function () {
        const resultEl = $("#ds-nai-test-result");
        const btn = $(this);
        btn.prop("disabled", true);
        resultEl.html("🔄 생성 중... (10~30초 소요)");

        try {
            const testPrompt = "1girl, smile, simple background, masterpiece, best quality";
            const negPrompt = "worst quality, bad anatomy, lowres";
            const startTime = performance.now();

            const imageBlob = await callNovelAI(testPrompt, negPrompt, settings.naiConfig);
            const elapsed = Math.round((performance.now() - startTime) / 1000);

            const url = URL.createObjectURL(imageBlob);
            resultEl.html(`
                ✅ 생성 성공 (${elapsed}초, ${Math.round(imageBlob.size / 1024)}KB)<br>
                <img src="${url}" style="max-width:200px; border-radius:6px; margin-top:8px;">
            `);
        } catch (err) {
            resultEl.html(`❌ 실패: ${err.message}`);
        } finally {
            btn.prop("disabled", false);
        }
    });

    // === NAI 캐릭터 프롬프트 핸들러 ===
    function syncNaiCharUI() {
        const charName = getCurrentCharName();
        if (!charName) return;
        const charData = getCharData(charName);
        const naiGen = charData.naiGen || {};
        const baseEl = document.getElementById("ds-nai-base-prompt");
        const negEl = document.getElementById("ds-nai-neg-prompt");
        if (baseEl) baseEl.value = naiGen.basePrompt || "";
        if (negEl) negEl.value = naiGen.negativePrompt || "";
        renderNaiLabelPrompts(charName);
    }

    $("#ds-nai-base-prompt").on("change", function () {
        const charName = getCurrentCharName();
        if (!charName) return;
        const cd = getCharData(charName);
        if (!cd.naiGen) cd.naiGen = { basePrompt: "", negativePrompt: "", labelPrompts: {} };
        cd.naiGen.basePrompt = this.value.trim();
        saveSettingsDebounced();
    });

    $("#ds-nai-neg-prompt").on("change", function () {
        const charName = getCurrentCharName();
        if (!charName) return;
        const cd = getCharData(charName);
        if (!cd.naiGen) cd.naiGen = { basePrompt: "", negativePrompt: "", labelPrompts: {} };
        cd.naiGen.negativePrompt = this.value.trim();
        saveSettingsDebounced();
    });

    $("#ds-nai-fill-defaults").on("click", function () {
        const charName = getCurrentCharName();
        if (!charName) return;
        const cd = getCharData(charName);
        if (!cd.naiGen) cd.naiGen = { basePrompt: "", negativePrompt: "", labelPrompts: {} };
        if (!cd.naiGen.labelPrompts) cd.naiGen.labelPrompts = {};
        cd.emotions.forEach(e => {
            if (DEFAULT_LABEL_PROMPTS[e.label]) {
                cd.naiGen.labelPrompts[e.label] = DEFAULT_LABEL_PROMPTS[e.label];
            }
        });
        saveSettingsDebounced();
        renderNaiLabelPrompts(charName);
        toastr.success("기본값으로 채웠습니다.");
    });

    $("#ds-nai-gen-all").on("click", async function () {
        const charName = getCurrentCharName();
        if (!charName) { toastr.warning("캐릭터를 먼저 선택하세요."); return; }
        if (!settings.naiConfig?.apiKey) { toastr.warning("NAI API 키를 먼저 설정해주세요."); return; }

        const progressEl = document.getElementById("ds-nai-progress");
        const progressBar = document.getElementById("ds-nai-progress-bar");
        const progressText = document.getElementById("ds-nai-progress-text");
        const statusEl = document.getElementById("ds-nai-gen-status");
        const btn = this;

        btn.disabled = true;
        progressEl.style.display = "block";
        statusEl.innerHTML = "";
        const log = [];

        const results = await generateAllSprites(charName, (i, total, label) => {
            const pct = total > 0 ? Math.round((i / total) * 100) : 100;
            progressBar.style.width = pct + "%";
            if (label) {
                progressText.textContent = `생성 중 (${i + 1}/${total}): ${label}`;
            } else {
                progressText.textContent = `완료 (${total}/${total})`;
            }
        });

        if (results) {
            if (results.success.length) log.push(`✅ ${results.success.length}개 완료`);
            if (results.failed.length) {
                log.push(`❌ ${results.failed.length}개 실패: ${results.failed.map(f => f.label).join(", ")}`);
            }
            statusEl.innerHTML = log.join("<br>");
            renderEmotionList();
            toastr.success(`일괄 생성 완료 (${results.success.length}/${results.success.length + results.failed.length})`);
        }

        btn.disabled = false;
    });

    // NAI 섹션 열릴 때 + 초기 로드
    document.querySelector('[data-collapse-key="naiGen"] .ds-collapse-header')
        ?.addEventListener("click", () => setTimeout(syncNaiCharUI, 50));
    syncNaiCharUI();

    updateApiFieldsVisibility();

    // === Collapsible 섹션 초기화 ===
    settings.collapsedSections = settings.collapsedSections || {};
    document.querySelectorAll(".ds-collapsible").forEach(section => {
        const key = section.dataset.collapseKey;
        const header = section.querySelector(".ds-collapse-header");
        const body = section.querySelector(".ds-collapse-body");
        const arrow = section.querySelector(".ds-collapse-arrow");

        // 초기 상태 적용
        const collapsed = settings.collapsedSections[key] !== false; // 기본 접힘
        if (collapsed) {
            body.style.display = "none";
            arrow.textContent = "▶";
        } else {
            body.style.display = "";
            arrow.textContent = "▼";
        }

        header.addEventListener("click", () => {
            const nowCollapsed = body.style.display === "none";
            if (nowCollapsed) {
                body.style.display = "";
                arrow.textContent = "▼";
                settings.collapsedSections[key] = false;
            } else {
                body.style.display = "none";
                arrow.textContent = "▶";
                settings.collapsedSections[key] = true;
            }
            saveSettingsDebounced();
        });
    });
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
        applyDisplayStyles();
        createSettingsPanel();
        applyTheme();

        // 모바일 감정 리스트 독립 스크롤 (scrollTop 직접 제어)
        addWandMenuItems();

        // origin이 바뀌어서 IndexedDB가 비어있는데 백업은 있는 경우 자동 복원
        try {
            const restored = await autoRestoreFromBackup();
            if (restored > 0) {
                console.log(`[DynamicSprite] 백업에서 ${restored}개 이미지 자동 복원됨`);
                toastr.success(`이미지 ${restored}개를 백업에서 자동 복원했습니다`, "Dynamic Sprite", { timeOut: 4000 });
            }
        } catch (err) {
            console.warn("[DynamicSprite] 자동 복원 실패:", err);
        }

        eventSource.on(event_types.MESSAGE_RECEIVED, onMessageReceived);
        eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, onMessageReceived);

        setTimeout(renderEmotionList, 500);
        console.log("[DynamicSprite] v5 로드 완료");
    } catch (err) {
        console.error("[DynamicSprite] 초기화 실패:", err);
    }
});

// ====================================================================
// 마술봉(Wand) 메뉴 - 빠른 토글 버튼들
// ====================================================================
function addWandMenuItems() {
    const settings = extension_settings[extensionName];
    const menuId = "extensionsMenu";
    const menu = document.getElementById(menuId);
    if (!menu) {
        // ST가 아직 메뉴 안 만들었을 수 있음 - 재시도
        setTimeout(addWandMenuItems, 500);
        return;
    }
    // 이미 추가됐으면 패스
    if (document.getElementById("ds-wand-toggle")) return;

    // 1) 스프라이트 표시 ON/OFF 토글
    const toggleItem = document.createElement("div");
    toggleItem.id = "ds-wand-toggle";
    toggleItem.className = "list-group-item flex-container flexGap5 interactable";
    toggleItem.tabIndex = 0;
    toggleItem.innerHTML = `
        <div class="fa-solid fa-masks-theater extensionsMenuExtensionButton"></div>
        <span id="ds-wand-toggle-label">${settings.showSprite ? "스프라이트 숨기기" : "스프라이트 표시"}</span>
    `;
    toggleItem.addEventListener("click", () => {
        settings.showSprite = !settings.showSprite;
        const img = document.getElementById("dynamic-sprite-img");
        if (img) {
            if (settings.showSprite) {
                if (img.src) {
                    img.style.display = "block";
                    requestAnimationFrame(() => { img.style.opacity = "1"; });
                }
            } else {
                img.style.opacity = "0";
                setTimeout(() => { img.style.display = "none"; }, settings.transitionDuration || 300);
            }
        }
        document.getElementById("ds-wand-toggle-label").textContent =
            settings.showSprite ? "스프라이트 숨기기" : "스프라이트 표시";
        // 설정 패널의 체크박스도 동기화
        const cb = document.getElementById("ds-show-sprite");
        if (cb) cb.checked = settings.showSprite;
        saveSettingsDebounced();
        toastr.info(settings.showSprite ? "스프라이트 표시" : "스프라이트 숨김", "", { timeOut: 1500 });
    });
    menu.appendChild(toggleItem);

    // 2) 수동 감정 변경 (라벨 목록에서 선택)
    const pickerItem = document.createElement("div");
    pickerItem.id = "ds-wand-picker";
    pickerItem.className = "list-group-item flex-container flexGap5 interactable";
    pickerItem.tabIndex = 0;
    pickerItem.innerHTML = `
        <div class="fa-solid fa-face-smile extensionsMenuExtensionButton"></div>
        <span>감정 수동 선택</span>
    `;
    pickerItem.addEventListener("click", () => {
        showEmotionPickerPopup();
    });
    menu.appendChild(pickerItem);

    // 3) 분석 일시 정지 토글
    const pauseItem = document.createElement("div");
    pauseItem.id = "ds-wand-pause";
    pauseItem.className = "list-group-item flex-container flexGap5 interactable";
    pauseItem.tabIndex = 0;
    pauseItem.innerHTML = `
        <div class="fa-solid fa-pause extensionsMenuExtensionButton"></div>
        <span id="ds-wand-pause-label">${settings.enabled ? "감정 분석 정지" : "감정 분석 재개"}</span>
    `;
    pauseItem.addEventListener("click", () => {
        settings.enabled = !settings.enabled;
        document.getElementById("ds-wand-pause-label").textContent =
            settings.enabled ? "감정 분석 정지" : "감정 분석 재개";
        const cb = document.getElementById("ds-enabled");
        if (cb) cb.checked = settings.enabled;
        saveSettingsDebounced();
        toastr.info(settings.enabled ? "감정 분석 켜짐" : "감정 분석 꺼짐", "", { timeOut: 1500 });
    });
    menu.appendChild(pauseItem);
}

// ====================================================================
// 감정 수동 선택 팝업 (마술봉 메뉴에서 호출)
// ====================================================================
function showEmotionPickerPopup() {
    const charName = getCurrentCharName();
    if (!charName) {
        toastr.warning("캐릭터를 선택하세요");
        return;
    }
    const charData = getCharData(charName);
    if (!charData.emotions || charData.emotions.length === 0) {
        toastr.warning(`"${charName}"에 등록된 감정이 없습니다`);
        return;
    }

    // 이미 떠있으면 제거
    const existing = document.getElementById("ds-emotion-picker-popup");
    if (existing) {
        existing.remove();
        return;
    }

    const popup = document.createElement("div");
    popup.id = "ds-emotion-picker-popup";
    popup.innerHTML = `
        <div class="ds-picker-popup-header">
            <span>감정 선택 — ${charName}</span>
            <button class="ds-picker-popup-close">✕</button>
        </div>
        <div class="ds-picker-popup-grid">
            ${charData.emotions.map(e => `
                <button class="ds-picker-popup-item ${e.label === charData.current ? "ds-picker-popup-current" : ""}" data-label="${e.label}">
                    ${e.label}
                </button>
            `).join("")}
        </div>
    `;
    document.body.appendChild(popup);

    popup.querySelectorAll(".ds-picker-popup-item").forEach(btn => {
        btn.addEventListener("click", (e) => {
            const label = e.currentTarget.dataset.label;
            updateSprite(label);
            popup.remove();
        });
    });
    popup.querySelector(".ds-picker-popup-close").addEventListener("click", () => {
        popup.remove();
    });

    // 바깥 클릭 닫기
    setTimeout(() => {
        const closeOnOutside = (ev) => {
            if (!popup.contains(ev.target)) {
                popup.remove();
                document.removeEventListener("click", closeOnOutside);
            }
        };
        document.addEventListener("click", closeOnOutside);
    }, 100);
}
