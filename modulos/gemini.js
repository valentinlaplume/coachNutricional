
// ==============================================================================
// ╔══════════════════════════════════════════════════════════════════════════════╗
// ║  BLOQUE 2 — GESTOR DE API KEYS                                              ║
// ║  → Mover a gemini.js                                                        ║
// ╚══════════════════════════════════════════════════════════════════════════════╝
// ==============================================================================
import { 
    FIREBASE_CONFIG_PERSONAL,
    GEMINI_API_KEYS,  // Cambia esto
    RATE_LIMIT_CONFIG, // Añade esto
    APP_PROJECT_ID 
} from './config.js';
// ====================
// Incorporar en gemini.js
// class ApiKeyManager { ... }
// ====================
class ApiKeyManager {
    constructor(apiKeys, config = {}) {
        this.apiKeys = apiKeys;
        this.currentIndex = 0;
        this.failedKeys = new Set();
        this.requestCount = 0;
        this.config = {
            requestsPerKey: config.requestsPerKey || 20,
            cooldownTime: config.cooldownTime || 60000,
            ...config
        };
    }
    getCurrentKey() { return this.apiKeys[this.currentIndex]; }
    rotateKey() {
        this.requestCount = 0;
        this.currentIndex = (this.currentIndex + 1) % this.apiKeys.length;
        if (this.failedKeys.size === this.apiKeys.length) {
            console.warn('Todas las API keys han fallado. Esperando cooldown...');
            setTimeout(() => {
                this.failedKeys.clear();
                console.log('Reiniciando sistema de API keys');
            }, this.config.cooldownTime);
        }
    }
    markKeyFailed(key) { this.failedKeys.add(key); this.rotateKey(); }
    incrementRequest() {
        this.requestCount++;
        if (this.requestCount >= this.config.requestsPerKey) {
            console.log(`Rotando API key después de ${this.requestCount} solicitudes`);
            this.rotateKey();
        }
    }
    getAvailableKeys() { return this.apiKeys.filter(k => !this.failedKeys.has(k)); }
}

// ====================
// Incorporar constantes de modelos en gemini.js
// ====================
// ==============================================================================
// ╔══════════════════════════════════════════════════════════════════════════════╗
// ║  BLOQUE 3 — INICIALIZACIÓN Y ESTADO GLOBAL                                  ║
// ║  → Las constantes de modelos van a gemini.js                                ║
const isCanvasEnvironment = typeof __firebase_config !== 'undefined';
export const firebaseConfig = isCanvasEnvironment ? JSON.parse(__firebase_config) : FIREBASE_CONFIG_PERSONAL;
export const initialAuthToken = isCanvasEnvironment ? __initial_auth_token : null;
const appId = isCanvasEnvironment ? __app_id : APP_PROJECT_ID;
let API_KEY = (!isCanvasEnvironment && GEMINI_API_KEYS.length > 0)
    ? new ApiKeyManager(GEMINI_API_KEYS, RATE_LIMIT_CONFIG)
    : null;

const GEMINI_MODELS = [
    "gemini-2.5-flash-lite",
    "gemini-2.5-flash",
    "gemini-2.0-flash",
    "gemini-1.5-flash"
];
let currentModelIndex = 0;
const getCurrentModel = () => GEMINI_MODELS[currentModelIndex];
const getApiUrl = () => `https://generativelanguage.googleapis.com/v1beta/models/${getCurrentModel()}:generateContent`;
function rotateModel() {
    currentModelIndex = (currentModelIndex + 1) % GEMINI_MODELS.length;
    console.log(`🔄 Rotando a modelo: ${getCurrentModel()}`);
}





// ==============================================================================
// ╔══════════════════════════════════════════════════════════════════════════════╗
// ║  BLOQUE 12 — GEMINI API                                                     ║
// ║  → Mover a gemini.js                                                        ║
// ╚══════════════════════════════════════════════════════════════════════════════╝
// ==============================================================================

// ====================
// Incorporar en gemini.js — FOOD_SCHEMA, EXPENDITURE_SCHEMA,
// sendGeminiRequest, fetchGeminiFoodData, fetchGeminiExpenditure, fetchGeminiCoachMessage
// ====================

const FOOD_SCHEMA = {
    type: "OBJECT",
    properties: {
        "kcal":          { "type": "NUMBER" },
        "proteinas":     { "type": "NUMBER" },
        "carbohidratos": { "type": "NUMBER" },
        "grasas":        { "type": "NUMBER" },
        "fibra":         { "type": "NUMBER" },
        "procesado":     { "type": "STRING", "enum": ["natural", "procesado", "ultraprocesado"] }
    },
    required: ["kcal","proteinas","carbohidratos","grasas","fibra","procesado"]
};

const EXPENDITURE_SCHEMA = {
    type: "OBJECT",
    properties: { "kcal": { "type": "NUMBER" } },
    required: ["kcal"]
};

export async function sendGeminiRequest(systemPrompt, userQuery, responseSchema) {
    const payload = {
        contents: [{ role: "user", parts: [{ text: userQuery }] }],
        systemInstruction: { parts: [{ text: systemPrompt }] },
        generationConfig: { temperature: 0.2, responseMimeType: "application/json", responseSchema }
    };
    const MAX_RETRIES = 3;

    for (let i = 0; i < MAX_RETRIES; i++) {
        let currentKey = null;
        try {
            if (!API_KEY || typeof API_KEY.getCurrentKey !== 'function') throw new Error("ApiKeyManager no inicializado");
            currentKey = API_KEY.getCurrentKey();
            if (!currentKey || typeof currentKey !== 'string') throw new Error("No hay API keys disponibles");

            const response = await fetch(`${getApiUrl()}?key=${currentKey}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                if (response.status === 404) { rotateModel(); if (i < MAX_RETRIES - 1) continue; }
                if (response.status === 429 || response.status === 403) {
                    API_KEY.markKeyFailed(currentKey);
                    if (API_KEY.getAvailableKeys().length === 0) throw new Error("Todas las API keys excedieron sus límites.");
                    if (i < MAX_RETRIES - 1) { await new Promise(r => setTimeout(r, Math.pow(2,i)*1000)); continue; }
                }
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const result = await response.json();
            const jsonText = result?.candidates?.[0]?.content?.parts?.[0]?.text;
            if (!jsonText) throw new Error("Respuesta vacía de la API");

            const parsed = JSON.parse(jsonText);
            API_KEY.incrementRequest();
            return parsed;

        } catch (error) {
            console.warn(`Intento ${i+1} fallido:`, error.message);
            if (i === MAX_RETRIES - 1) throw new Error(`Fallo en AI después de ${MAX_RETRIES} intentos: ${error.message}`);
            await new Promise(r => setTimeout(r, Math.pow(2,i)*1000));
        }
    }
    throw new Error("Fallo en AI: Máximo de reintentos alcanzado");
}

export async function fetchGeminiFoodData(foodDescription) {
    const systemPrompt = `Eres un analizador experto de alimentos y nutrición basado en datos reales (USDA, FAO, BEDCA).
Debes responder SIEMPRE con JSON válido y NADA fuera del JSON.
REGLAS: No omitas campos. Si falta información, aproxima con valores realistas. Clasifica con NOVA si es casero. Usa porción estándar si no hay cantidad.`;
    const rawResponse = await sendGeminiRequest(systemPrompt, `Analiza nutricionalmente: "${foodDescription}"`, FOOD_SCHEMA);
    if (typeof rawResponse === "number") return { kcal: rawResponse, proteinas: 0, carbohidratos: 0, grasas: 0, fibra: 0, procesado: "desconocido" };
    return rawResponse;
}

async function fetchGeminiExpenditure(activityDescription) {
    const systemPrompt = "Eres un experto en fitness. Estima las calorías quemadas según la actividad descrita. Responde SOLO con JSON según el schema.";
    return await sendGeminiRequest(systemPrompt, `Estimar calorías quemadas en: ${activityDescription}`, EXPENDITURE_SCHEMA);
}

async function fetchGeminiCoachMessage(systemPrompt, userQuery) {
    const payload = {
        contents: [{ parts: [{ text: userQuery }] }],
        systemInstruction: { parts: [{ text: systemPrompt }] },
        generationConfig: {
            temperature: 0.7, topP: 0.95, topK: 40, maxOutputTokens: 1500,
            responseMimeType: "application/json",
            responseSchema: {
                type: "OBJECT",
                properties: { "mensaje": { "type": "STRING", "description": "Análisis del coach" } },
                required: ["mensaje"]
            }
        }
    };
    const MAX_RETRIES = 3;
    for (let i = 0; i < MAX_RETRIES; i++) {
        try {
            const currentKey = API_KEY.getCurrentKey();
            if (!currentKey) throw new Error("API key no disponible");
            const response = await fetch(`${getApiUrl()}?key=${currentKey}`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
            });
            if (!response.ok) {
                if (response.status === 404) { rotateModel(); if (i < MAX_RETRIES-1) continue; }
                if (response.status === 429 || response.status === 403) { API_KEY.markKeyFailed(currentKey); if (i < MAX_RETRIES-1) { await new Promise(r=>setTimeout(r,Math.pow(2,i)*1000)); continue; } }
                throw new Error(`HTTP ${response.status}`);
            }
            const result = await response.json();
            const jsonText = result?.candidates?.[0]?.content?.parts?.[0]?.text;
            if (!jsonText) throw new Error("Respuesta vacía");
            const parsed = JSON.parse(jsonText);
            if (typeof parsed.mensaje === 'string' && parsed.mensaje.length > 0) {
                API_KEY.incrementRequest();
                return parsed.mensaje;
            }
            throw new Error("Mensaje inválido");
        } catch (error) {
            console.warn(`Intento ${i+1} coach fallido:`, error.message);
            if (i < MAX_RETRIES-1) await new Promise(r=>setTimeout(r,Math.pow(2,i)*1000));
        }
    }
    return "📊 Sigue registrando tus comidas para recibir retroalimentación personalizada.";
}
