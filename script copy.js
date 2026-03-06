// ==============================================================================
// === script.js — ARCHIVO PRINCIPAL ===
// ==============================================================================
// ESTRUCTURA DE MÓDULOS SUGERIDA:
//
//  script.js               ← Este archivo (punto de entrada + UI handlers)
//  ├── auth.js             ← Firebase Auth: login, registro, sesión
//  ├── firestore.js        ← Operaciones de DB: perfil, datos calóricos, análisis
//  ├── gemini.js           ← Todas las llamadas a la API de Gemini
//  ├── coach.js            ← Lógica del coach: prompts, análisis, fallback
//  ├── nutrition.js        ← Cálculos: macros, metas, métricas, TMB/TDEE
//  ├── ui.js               ← Render del log, modales, progreso, toasts
//  └── config.js           ← (ya existe) Keys, IDs, configuración
//
// ==============================================================================


// ==============================================================================
// ╔══════════════════════════════════════════════════════════════════════════════╗
// ║  BLOQUE 1 — IMPORTACIONES                                                   ║
// ║  → Mover a cada módulo correspondiente al refactorizar                      ║
// ╚══════════════════════════════════════════════════════════════════════════════╝
// ==============================================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import {
    getAuth,
    signInAnonymously,
    signInWithCustomToken,
    signInWithPopup,
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    GoogleAuthProvider,
    onAuthStateChanged,
    signOut,
    sendPasswordResetEmail,
    updateProfile,
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import {
    getFirestore,
    doc,
    setDoc,
    getDoc,
    updateDoc,
    onSnapshot,
    collection,
    query,
    getDocs,
    orderBy,
    where,
    Timestamp,
    limit,
    serverTimestamp,
    increment,
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// ====================
// Incorporar en config.js
// ====================
import {
    FIREBASE_CONFIG_PERSONAL,
    GEMINI_API_KEYS,
    RATE_LIMIT_CONFIG,
    APP_PROJECT_ID
} from './modulos/config.js';


// ==============================================================================
// ╔══════════════════════════════════════════════════════════════════════════════╗
// ║  BLOQUE 2 — GESTOR DE API KEYS                                              ║
// ║  → Mover a gemini.js                                                        ║
// ╚══════════════════════════════════════════════════════════════════════════════╝
// ==============================================================================

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


// ==============================================================================
// ╔══════════════════════════════════════════════════════════════════════════════╗
// ║  BLOQUE 3 — INICIALIZACIÓN Y ESTADO GLOBAL                                  ║
// ║  → Las constantes de modelos van a gemini.js                                ║
// ║  → currentUser / currentPerfil van a auth.js                                ║
// ╚══════════════════════════════════════════════════════════════════════════════╝
// ==============================================================================

const isCanvasEnvironment = typeof __firebase_config !== 'undefined';
const firebaseConfig = isCanvasEnvironment ? JSON.parse(__firebase_config) : FIREBASE_CONFIG_PERSONAL;
const initialAuthToken = isCanvasEnvironment ? __initial_auth_token : null;
const appId = isCanvasEnvironment ? __app_id : APP_PROJECT_ID;

// ====================
// Incorporar constantes de modelos en gemini.js
// ====================
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

// --- Firebase globals ---
let db, auth;

// ====================
// Incorporar en auth.js
// ====================
let currentUser = null;     // Firebase Auth User
let currentPerfil = null;   // Documento Firestore del perfil

// --- Estado de la app ---
function getLocalDateISO() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
}
const todayISO = getLocalDateISO();
const WEEK_DAYS_NAMES = ['Lun', 'Mar', 'Mie', 'Jue', 'Vie', 'Sab', 'Dom'];

let selectedDay = todayISO;
let currentWeekStart = new Date();
let weekData = {};
let currentLogData = { log_consumido: [], log_gastado: [], consumido: 0, gastado: 0 };
let unsubscribeFromLog = [];

// activePersonId/Name se mantienen para compatibilidad, pero post-auth
// se populan desde currentUser/currentPerfil
let activePersonId = null;
let activePersonName = null;


// ==============================================================================
// ╔══════════════════════════════════════════════════════════════════════════════╗
// ║  BLOQUE 4 — SCHEMA Y PLANES                                                 ║
// ║  → Mover a firestore.js (PERFIL_USUARIO_SCHEMA)                             ║
// ║  → Mover a auth.js o plans.js (PLAN_LIMITS + checkFeatureAccess)            ║
// ╚══════════════════════════════════════════════════════════════════════════════╝
// ==============================================================================

// ====================
// Incorporar en firestore.js
// ====================
const PERFIL_USUARIO_SCHEMA = {
    uid: "",
    email: "",
    display_name: "",
    foto_perfil_url: "",
    fecha_registro: null,
    ultimo_login: null,
    zona_horaria: "America/Argentina/Buenos_Aires",
    idioma: "es",
    onboarding_completado: false,
    rol: "user",                    // "user" | "admin"

    suscripcion: {
        estado: "trial",            // "trial" | "active" | "expired" | "cancelled"
        plan: "free",               // "free" | "pro" | "premium"
        trial_fecha_inicio: null,
        trial_fecha_fin: null,
        fecha_inicio: null,
        fecha_vencimiento: null,
        stripe_customer_id: "",
        stripe_subscription_id: "",
        forma_pago: "",
    },

    uso: {
        coach_consultas_mes: 0,
        coach_consultas_reset_fecha: null,
        alimentos_registrados_hoy: 0,
        ultimo_registro_fecha: null,
    },

    // Datos físicos
    edad: null,
    sexo: null,
    peso_actual: null,
    altura: null,
    peso_objetivo: null,
    objetivo: null,
    ritmo_semanal: null,
    historial_peso: [],             // [{ fecha: "2025-12-01", peso: 76.2 }]

    // Métricas calculadas
    tmb: null,
    tdee: null,
    calorias_objetivo: null,
    proteina_min: null,
    proteina_max: null,
    carbos_rango_porcentaje: "40-55%",
    grasas_rango_porcentaje: "20-30%",
    fecha_actualizacion_metricas: null,

    preferencias: {
        evita_ultraprocesados: true,
        alergias_medicas: [],
        cantidad_comidas_al_dia: 4,
        habilidades_cocina: "básico",
        suplementos_actuales: [],
    },
    fitness: {
        nivel_actividad: null,
        tipo_entrenamiento: "",
        frecuencia_semanal: null,
        horario_entrenamiento: "",
        experiencia_entrenamiento: "",
        objetivo_estetico: "",
        objetivo_rendimiento_cuantificable: "",
    },
    salud_y_sostenibilidad: {
        nivel_estres_dia: 5,
        hora_habitual_dormir: "23:00",
        hora_habitual_despertar: "07:00",
        tiempo_libre_cocina_semanal: "30 mins por día",
        dias_flexibilidad_preferidos: [],
    },
    preferencias_alimentarias: {
        opciones_rapidas_faciles: [],
        carbohidratos_favoritos: [],
        proteinas_favoritas: [],
        ingredientes_base_complementos: [],
        platos_favoritos_completos: [],
        preferencias_de_verduras: [],
    },
    notificaciones: {
        habilitadas: false,
        recordatorio_registrar: false,
        hora_recordatorio: "20:00",
        resumen_semanal: true,
    },
};

// ====================
// Incorporar en plans.js (o auth.js si es pequeño)
// ====================
const PLAN_LIMITS = {
    free:    { coach_consultas_mes: 10,       dias_historial: 7,        exportar_datos: false, graficos_avanzados: false, multiples_objetivos: false },
    pro:     { coach_consultas_mes: 60,       dias_historial: 90,       exportar_datos: true,  graficos_avanzados: true,  multiples_objetivos: false },
    premium: { coach_consultas_mes: Infinity, dias_historial: Infinity, exportar_datos: true,  graficos_avanzados: true,  multiples_objetivos: true  },
};

// ====================
// Incorporar en plans.js
// ====================
function checkFeatureAccess(perfil, feature) {
    const plan = perfil.suscripcion?.plan || "free";
    const estado = perfil.suscripcion?.estado;
    const planEfectivo = estado === "trial" ? "pro" : plan;
    const limites = PLAN_LIMITS[planEfectivo];

    if (feature === "coach_consultas_mes") {
        const usadas = perfil.uso?.coach_consultas_mes || 0;
        const max = limites.coach_consultas_mes;
        if (usadas >= max) {
            return { permitido: false, razon: `Alcanzaste el límite de ${max} consultas este mes. Actualizá tu plan para continuar.` };
        }
        return { permitido: true };
    }
    if (typeof limites[feature] === "boolean") {
        return { permitido: limites[feature], razon: limites[feature] ? undefined : `Esta función requiere plan Pro o Premium.` };
    }
    return { permitido: true };
}


// ==============================================================================
// ╔══════════════════════════════════════════════════════════════════════════════╗
// ║  BLOQUE 5 — DOM ELEMENTS                                                    ║
// ║  → Se queda en script.js (es el punto de entrada de UI)                     ║
// ╚══════════════════════════════════════════════════════════════════════════════╝
// ==============================================================================

const elements = {
    loadingIndicator:       document.getElementById('loadingIndicator'),
    activeUserName:         document.getElementById('activeUserName'),
    selectedDayDisplay:     document.getElementById('selectedDayDisplay'),
    currentDateDisplay:     document.getElementById('currentDateDisplay'),
    prevWeekBtn:            document.getElementById('prevWeekBtn'),
    nextWeekBtn:            document.getElementById('nextWeekBtn'),
    weekRangeDisplay:       document.getElementById('weekRangeDisplay'),
    daySelectorContainer:   document.getElementById('daySelectorContainer'),
    totalConsumidoSemana:   document.getElementById('totalConsumidoSemana'),
    totalGastadoSemana:     document.getElementById('totalGastadoSemana'),
    netBalanceSemana:       document.getElementById('netBalanceSemana'),
    balanceNetoSemanaBox:   document.getElementById('balanceNetoSemanaBox'),
    apiConsumoLoading:      document.getElementById('apiConsumoLoading'),
    submitConsumoButton:    document.getElementById('submitConsumoButton'),
    registroConsumoForm:    document.getElementById('registroConsumoForm'),
    descripcionConsumo:     document.getElementById('descripcionConsumo'),
    apiGastoLoading:        document.getElementById('apiGastoLoading'),
    submitGastoButton:      document.getElementById('submitGastoButton'),
    registroGastoForm:      document.getElementById('registroGastoForm'),
    descripcionGasto:       document.getElementById('descripcionGasto'),
    consumidoBox:           document.getElementById('consumidoBox'),
    gastadoBox:             document.getElementById('gastadoBox'),
    totalConsumido:         document.getElementById('totalConsumido'),
    totalGastado:           document.getElementById('totalGastado'),
    netBalance:             document.getElementById('netBalance'),
    balanceNetoBox:         document.getElementById('balanceNetoBox'),
    coachMessage:           document.getElementById('coachMessage'),
    coachButton:            document.getElementById('coachButton'),
    foodLog:                document.getElementById('foodLog'),
    emptyLogMessage:        document.getElementById('emptyLogMessage'),
    emptyLogUser:           document.getElementById('emptyLogUser'),
    summaryContent:         document.getElementById('summaryContent'),
    // Macros
    proteinasDiaDisplay:    document.getElementById('proteinasDia'),
    carbohidratosDiaDisplay:document.getElementById('carbohidratosDia'),
    grasasDiaDisplay:       document.getElementById('grasasDia'),
    fibraDiaDisplay:        document.getElementById('fibraDia'),
    ultraprocesadosDiaDisplay: document.getElementById('ultraprocesadosDia'),
    // Progreso metas
    proteinaProgress:       document.getElementById('proteinaProgress'),
    carbohidratosProgress:  document.getElementById('carbohidratosProgress'),
    grasasProgress:         document.getElementById('grasasProgress'),
    fibraProgress:          document.getElementById('fibraProgress'),
    kcalTargetProgress:     document.getElementById('kcalTargetProgress'),
    kcalRestanteDisplay:    document.getElementById('kcalRestanteDisplay'),
    // Modal
    logDetailsModal:        new bootstrap.Modal(document.getElementById('logDetailsModal')),
    logDetailsModalTitle:   document.getElementById('logDetailsModalLabel'),
    modalLogContent:        document.getElementById('modalLogContent'),
    modalTotalLabel:        document.getElementById('modalTotalLabel'),
    modalTotalValue:        document.getElementById('modalTotalValue'),
};

elements.loadingIndicator.style.display = 'fixed';
elements.summaryContent.style.display = 'none';


// ==============================================================================
// ╔══════════════════════════════════════════════════════════════════════════════╗
// ║  BLOQUE 6 — AUTENTICACIÓN FIREBASE                                          ║
// ║  → Mover a auth.js                                                          ║
// ╚══════════════════════════════════════════════════════════════════════════════╝
// ==============================================================================

// ====================
// Incorporar en auth.js — loginWithGoogle, loginWithEmail,
// registerWithEmail, logout, resetPassword, getAuthErrorMessage
// ====================

async function loginWithGoogle() {
    const provider = new GoogleAuthProvider();
    try {
        showLoadingButton("btn-google", true);
        await signInWithPopup(auth, provider);
    } catch (error) {
        showAuthError(getAuthErrorMessage(error.code));
    } finally {
        showLoadingButton("btn-google", false);
    }
}

async function loginWithEmail(email, password) {
    try {
        showLoadingButton("btn-email-login", true);
        await signInWithEmailAndPassword(auth, email, password);
    } catch (error) {
        showAuthError(getAuthErrorMessage(error.code));
    } finally {
        showLoadingButton("btn-email-login", false);
    }
}

async function registerWithEmail(email, password, displayName) {
    try {
        showLoadingButton("btn-email-register", true);
        const result = await createUserWithEmailAndPassword(auth, email, password);
        await updateProfile(result.user, { displayName });
    } catch (error) {
        showAuthError(getAuthErrorMessage(error.code));
    } finally {
        showLoadingButton("btn-email-register", false);
    }
}

async function logout() {
    await signOut(auth);
    // onAuthStateChanged → showAuthScreen() se llama automáticamente
}

async function resetPassword(email) {
    try {
        await sendPasswordResetEmail(auth, email);
        showToast("Te enviamos un email para restablecer tu contraseña.", "success");
    } catch (error) {
        showAuthError(getAuthErrorMessage(error.code));
    }
}

function getAuthErrorMessage(code) {
    const errors = {
        "auth/user-not-found":         "No existe una cuenta con ese email.",
        "auth/wrong-password":         "Contraseña incorrecta.",
        "auth/email-already-in-use":   "Ese email ya está registrado.",
        "auth/invalid-email":          "El email no es válido.",
        "auth/weak-password":          "La contraseña debe tener al menos 6 caracteres.",
        "auth/too-many-requests":      "Demasiados intentos. Intentá más tarde.",
        "auth/popup-closed-by-user":   "Cerraste el popup antes de completar el login.",
        "auth/network-request-failed": "Error de red. Verificá tu conexión.",
    };
    return errors[code] || `Error inesperado (${code}). Intentá de nuevo.`;
}


// ==============================================================================
// ╔══════════════════════════════════════════════════════════════════════════════╗
// ║  BLOQUE 7 — GESTIÓN DE PERFILES EN FIRESTORE                                ║
// ║  → Mover a firestore.js                                                     ║
// ╚══════════════════════════════════════════════════════════════════════════════╝
// ==============================================================================

// ====================
// Incorporar en firestore.js — loadOrCreatePerfil, savePerfil, incrementarConsultaCoach
// ====================

async function loadOrCreatePerfil(user) {
    const perfilRef = doc(db, `users/${user.uid}/perfil`, "datos");
    try {
        const snap = await getDoc(perfilRef);
        if (snap.exists()) {
            currentPerfil = snap.data();
            await updateDoc(perfilRef, { ultimo_login: serverTimestamp() });
        } else {
            const perfilNuevo = {
                ...PERFIL_USUARIO_SCHEMA,
                uid: user.uid,
                email: user.email || "",
                display_name: user.displayName || "",
                foto_perfil_url: user.photoURL || "",
                fecha_registro: serverTimestamp(),
                ultimo_login: serverTimestamp(),
                suscripcion: {
                    ...PERFIL_USUARIO_SCHEMA.suscripcion,
                    estado: "trial",
                    plan: "free",
                    trial_fecha_inicio: serverTimestamp(),
                    // trial_fecha_fin: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
                },
            };
            await setDoc(perfilRef, perfilNuevo);
            currentPerfil = perfilNuevo;
        }
    } catch (error) {
        console.error("Error cargando perfil:", error);
        throw error;
    }
}

async function savePerfil(updates) {
    if (!currentUser) return;
    const perfilRef = doc(db, `users/${currentUser.uid}/perfil`, "datos");
    await updateDoc(perfilRef, { ...updates, fecha_actualizacion_metricas: serverTimestamp() });
    currentPerfil = { ...currentPerfil, ...updates };
}

async function incrementarConsultaCoach() {
    const acceso = checkFeatureAccess(currentPerfil, "coach_consultas_mes");
    if (!acceso.permitido) { showUpgradeModal(acceso.razon); return false; }
    const perfilRef = doc(db, `users/${currentUser.uid}/perfil`, "datos");
    await updateDoc(perfilRef, { "uso.coach_consultas_mes": increment(1) });
    currentPerfil.uso.coach_consultas_mes = (currentPerfil.uso?.coach_consultas_mes || 0) + 1;
    return true;
}


// ==============================================================================
// ╔══════════════════════════════════════════════════════════════════════════════╗
// ║  BLOQUE 8 — FIRESTORE: DATOS CALÓRICOS Y ANÁLISIS                           ║
// ║  → Mover a firestore.js                                                     ║
// ╚══════════════════════════════════════════════════════════════════════════════╝
// ==============================================================================

// ====================
// Incorporar en firestore.js — getDailyDocRef, guardarAnalisisCoach, obtenerUltimoAnalisis
// ====================

function getDailyDocRef(dateISO = selectedDay) {
    if (!currentUser) throw new Error("Usuario no autenticado.");
    return doc(db, `users/${currentUser.uid}/datos_caloricos/${dateISO}`);
}

async function guardarAnalisisCoach(dayISO, momentOfDay, message) {
    if (!currentUser) return;
    const analisisRef = doc(db, `users/${currentUser.uid}/coach_analysis/${dayISO}-${momentOfDay}`);
    await setDoc(analisisRef, {
        analisis_coach: message,
        momento: momentOfDay,
        timestamp: new Date(),
    });
    console.log(`Análisis del coach para ${dayISO} (${momentOfDay}) guardado.`);
}

async function obtenerUltimoAnalisis(dayISO) {
    if (!currentUser) return "";
    const dayStart = new Date(dayISO + "T00:00:00");
    const dayEnd   = new Date(dayISO + "T23:59:59");
    const analisisColRef = collection(db, `users/${currentUser.uid}/coach_analysis`);
    const q = query(
        analisisColRef,
        where("timestamp", ">=", Timestamp.fromDate(dayStart)),
        where("timestamp", "<=", Timestamp.fromDate(dayEnd)),
        orderBy("timestamp", "desc"),
        limit(1)
    );
    try {
        const snap = await getDocs(q);
        if (!snap.empty) return snap.docs[0].data()?.analisis_coach || "";
    } catch (error) {
        console.error("Error obteniendo análisis:", error);
    }
    return "";
}


// ==============================================================================
// ╔══════════════════════════════════════════════════════════════════════════════╗
// ║  BLOQUE 9 — NAVEGACIÓN Y SEMANAS                                            ║
// ║  → Se queda en script.js (es navegación de UI principal)                   ║
// ╚══════════════════════════════════════════════════════════════════════════════╝
// ==============================================================================

function getWeekStart(date) {
    const d = new Date(date);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    d.setDate(diff);
    d.setHours(0, 0, 0, 0);
    return d;
}

function getWeekDaysISO(startOfWeek) {
    const days = [];
    let currentDay = new Date(startOfWeek);
    for (let i = 0; i < 7; i++) {
        days.push(`${currentDay.getFullYear()}-${String(currentDay.getMonth()+1).padStart(2,'0')}-${String(currentDay.getDate()).padStart(2,'0')}`);
        currentDay.setDate(currentDay.getDate() + 1);
    }
    return days;
}

function formatDate(isoDate) {
    const [year, month, day] = isoDate.split('-');
    return new Date(year, month - 1, day).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
}

function getDayNameShort(isoDate) {
    const [year, month, day] = isoDate.split('-');
    let dayIndex = new Date(year, month - 1, day).getDay();
    if (dayIndex === 0) dayIndex = 6; else dayIndex--;
    return WEEK_DAYS_NAMES[dayIndex];
}

function setupWeekNavigation() {
    elements.prevWeekBtn.addEventListener('click', () => changeWeek(-7));
    elements.nextWeekBtn.addEventListener('click', () => changeWeek(7));
    updateWeekUI();
    setupRealtimeListener();
}

function changeWeek(days) {
    currentWeekStart.setDate(currentWeekStart.getDate() + days);
    const currentWeekStartDate = getWeekStart(currentWeekStart);
    const todayWeekStartDate = getWeekStart(new Date());
    elements.nextWeekBtn.disabled = (currentWeekStartDate.toDateString() === todayWeekStartDate.toDateString());

    if (currentWeekStart > getWeekStart(new Date())) {
        currentWeekStart = getWeekStart(new Date());
        elements.nextWeekBtn.disabled = true;
    }
    const weekDays = getWeekDaysISO(currentWeekStart);
    if (!weekDays.includes(selectedDay)) selectedDay = weekDays[0];
    updateWeekUI();
    setupRealtimeListener();
}

function updateWeekUI() {
    const weekDays = getWeekDaysISO(currentWeekStart);
    elements.weekRangeDisplay.textContent = `${formatDate(weekDays[0])} - ${formatDate(weekDays[6])}`;
    elements.daySelectorContainer.innerHTML = '';
    weekDays.forEach(dateISO => {
        const button = document.createElement('button');
        button.className = `day-selector-btn ${dateISO === selectedDay ? 'active-day' : ''} ${dateISO === todayISO ? 'today-marker' : ''}`;
        button.innerHTML = `<span class="day-name">${getDayNameShort(dateISO)}</span><span class="day-date">${formatDate(dateISO).split(' ')[0]}</span>`;
        button.dataset.date = dateISO;
        button.setAttribute('aria-label', `${getDayNameShort(dateISO)} ${formatDate(dateISO)}`);
        button.addEventListener('click', () => selectDay(dateISO));
        elements.daySelectorContainer.appendChild(button);
    });
    renderSelectedDay();
}

function selectDay(dateISO) {
    if (selectedDay === dateISO) return;
    selectedDay = dateISO;
    document.querySelectorAll('.day-selector-btn').forEach(btn => {
        btn.classList.toggle('active-day', btn.dataset.date === dateISO);
    });
    renderSelectedDay();
}


// ==============================================================================
// ╔══════════════════════════════════════════════════════════════════════════════╗
// ║  BLOQUE 10 — FIRESTORE REALTIME LISTENER                                    ║
// ║  → Mover a firestore.js (setupRealtimeListener)                             ║
// ╚══════════════════════════════════════════════════════════════════════════════╝
// ==============================================================================

// ====================
// Incorporar en firestore.js — setupRealtimeListener
// ====================
function setupRealtimeListener() {
    if (Array.isArray(unsubscribeFromLog)) unsubscribeFromLog.forEach(u => u());
    unsubscribeFromLog = [];
    weekData = {};

    elements.loadingIndicator.style.display = 'fixed';
    elements.summaryContent.style.display = 'none';

    const weekDaysISO = getWeekDaysISO(currentWeekStart);
    const initialData = { consumido: 0, gastado: 0, log_consumido: [], log_gastado: [] };

    weekDaysISO.forEach(dateISO => {
        const docRef = getDailyDocRef(dateISO);
        const unsub = onSnapshot(docRef, (docSnap) => {
            weekData[dateISO] = docSnap.exists() ? docSnap.data() : initialData;
            if (!docSnap.exists()) setDoc(docRef, initialData);
            updateWeekSummaryUI();
            if (dateISO === selectedDay) renderSelectedDay();
        }, (error) => console.error(`Error en listener para ${dateISO}:`, error));
        unsubscribeFromLog.push(unsub);
    });
}


// ==============================================================================
// ╔══════════════════════════════════════════════════════════════════════════════╗
// ║  BLOQUE 11 — CÁLCULOS NUTRICIONALES                                         ║
// ║  → Mover a nutrition.js                                                     ║
// ╚══════════════════════════════════════════════════════════════════════════════╝
// ==============================================================================

// ====================
// Incorporar en nutrition.js — calcularMacrosDia, calcularMetasDiarias, calcularMetricasNutricionales
// ====================

function calcularMacrosDia(log_consumido) {
    if (!log_consumido || log_consumido.length === 0) {
        return { proteinas_dia: 0, carbohidratos_dia: 0, grasas_dia: 0, fibra_dia: 0, ultraprocesados_dia: 0 };
    }
    const totales = log_consumido.reduce((acc, item) => {
        acc.proteinas_dia      += item.proteinas      || 0;
        acc.carbohidratos_dia  += item.carbohidratos  || 0;
        acc.grasas_dia         += item.grasas         || 0;
        acc.fibra_dia          += item.fibra          || 0;
        if (item.procesado === 'ultraprocesado') acc.ultraprocesados_dia += item.kcal || 0;
        return acc;
    }, { proteinas_dia: 0, carbohidratos_dia: 0, grasas_dia: 0, fibra_dia: 0, ultraprocesados_dia: 0 });
    Object.keys(totales).forEach(k => totales[k] = parseFloat(totales[k].toFixed(1)));
    return totales;
}

function calcularMetasDiarias(perfil, macrosConsumidas, caloriasConsumidas) {
    const objetivoKcal    = perfil.calorias_objetivo;
    const objetivoProteina = perfil.peso_actual * 2;
    const carbosPorcentaje = parseFloat(perfil.carbos_rango_porcentaje.split('-')[0]) / 100;
    const grasasPorcentaje = parseFloat(perfil.grasas_rango_porcentaje.split('-')[0]) / 100;
    const objetivoCarbos   = Math.round((objetivoKcal * carbosPorcentaje) / 4);
    const objetivoGrasas   = Math.round((objetivoKcal * grasasPorcentaje) / 9);
    const objetivoFibra    = 25;

    const progreso = {
        kcal:           { meta: objetivoKcal,      actual: caloriasConsumidas,                restante: objetivoKcal - caloriasConsumidas },
        proteina:       { meta: objetivoProteina,  actual: macrosConsumidas.proteinas_dia,    restante: objetivoProteina - macrosConsumidas.proteinas_dia },
        carbohidratos:  { meta: objetivoCarbos,    actual: macrosConsumidas.carbohidratos_dia,restante: objetivoCarbos - macrosConsumidas.carbohidratos_dia },
        grasas:         { meta: objetivoGrasas,    actual: macrosConsumidas.grasas_dia,       restante: objetivoGrasas - macrosConsumidas.grasas_dia },
        fibra:          { meta: objetivoFibra,     actual: macrosConsumidas.fibra_dia,        restante: objetivoFibra - macrosConsumidas.fibra_dia },
        ultraprocesados:{ meta: 0,                 actual: macrosConsumidas.ultraprocesados_dia },
    };
    progreso.kcal.restante = Math.max(0, progreso.kcal.restante);
    return progreso;
}

function calcularMetricasNutricionales(datos) {
    const { edad, sexo, peso_actual, altura, ritmo_semanal } = datos;
    const fitness_nivel = datos.fitness?.nivel_actividad || datos.nivel_actividad;

    let tmb = sexo === "masculino"
        ? Math.round(10 * peso_actual + 6.25 * altura - 5 * edad + 5)
        : Math.round(10 * peso_actual + 6.25 * altura - 5 * edad - 161);

    const factores = { sedentario: 1.2, ligero: 1.375, moderado: 1.55, activo: 1.725, muy_activo: 1.9 };
    const tdee = Math.round(tmb * (factores[fitness_nivel] || 1.55));
    const deficit = Math.round((ritmo_semanal || 0.5) * 7700 / 7);
    const calorias_objetivo = tdee - deficit;
    const proteina_min = Math.round(peso_actual * 1.6);
    const proteina_max = Math.round(peso_actual * 2.2);

    return { tmb, tdee, calorias_objetivo, proteina_min, proteina_max, fecha_actualizacion_metricas: new Date().toISOString() };
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

async function sendGeminiRequest(systemPrompt, userQuery, responseSchema) {
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

async function fetchGeminiFoodData(foodDescription) {
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


// ==============================================================================
// ╔══════════════════════════════════════════════════════════════════════════════╗
// ║  BLOQUE 13 — COACH: ANÁLISIS, FALLBACK, CONFIRMACIÓN                        ║
// ║  → Mover a coach.js                                                         ║
// ╚══════════════════════════════════════════════════════════════════════════════╝
// ==============================================================================

// ====================
// Incorporar en coach.js — MEAL_TIMES, getMealCategory,
// generarMensajeCoach, generarMensajeFallback,
// generateCoachAnalysis, checkAnalysisToday, showAnalysisConfirmationDialog, showBasicAnalysis
// ====================

const MEAL_TIMES = {
    DESAYUNO: { start: 6,     end: 12    },
    ALMUERZO: { start: 12,    end: 14.50 },
    MERIENDA: { start: 14.50, end: 20.50 },
    CENA:     { start: 20.50, end: 23    },
};

function getMealCategory(dateObj) {
    const hour = dateObj.getHours();
    if (hour >= 6  && hour < 12)    return 'Desayuno';
    if (hour >= 12 && hour < 14.5)  return 'Almuerzo';
    if (hour >= 14.5 && hour < 20.5)return 'Merienda';
    if (hour >= 20.5 && hour < 23)  return 'Cena';
    return 'Colación';
}

async function generarMensajeCoach(consumido, gastado, perfil, momentOfDay, contextoPrevio = "") {
    const balance         = consumido - gastado;
    const deficit_esperado = perfil.tdee - perfil.calorias_objetivo;
    const deficit_real    = perfil.tdee - balance;

    const data = weekData[selectedDay] || { consumido: 0, gastado: 0, log_consumido: [], log_gastado: [] };
    currentLogData = data;

    const { proteinas_dia, carbohidratos_dia, grasas_dia, fibra_dia, ultraprocesados_dia } = calcularMacrosDia(currentLogData.log_consumido);
    const alimentosStr = currentLogData.log_consumido.map(i => i.nombre).filter(Boolean).slice(0,8).join(', ') || 'No hay registro de alimentos';

    const systemPrompt = `Eres nutricionista deportivo especializado, usando el enfoque científico-práctico.
ANÁLISIS: Basado EN LOS DATOS PROPORCIONADOS, NO asumas ni inventes datos.
FORMATO DE RESPUESTA OBLIGATORIO:
• Exactamente 6 puntos numerados (1. 2. 3. 4. 5. 6.)
• Cada punto: 4-5 oraciones completas
• Emoji al inicio de cada punto
• Números importantes en **negritas**
• Separación entre puntos con un salto de linea o un <hr>
• No incluir encabezados adicionales
DATOS DEL SISTEMA:
• Atleta: ${activePersonName} | Peso: ${perfil.peso_actual} kg
• TDEE: ${perfil.tdee} kcal | Objetivo: ${perfil.calorias_objetivo} kcal
• Déficit esperado: ${deficit_esperado} kcal (${(deficit_esperado/perfil.tdee*100).toFixed(1)}%)
• Entrenamiento: ${perfil.fitness.tipo_entrenamiento} a las ${perfil.fitness.horario_entrenamiento}`;

    const userQuery = `DATOS ACTUALES (${momentOfDay.toUpperCase()}):
• Calorías: ${consumido} consumidas / ${gastado} ejercicio / ${balance} netas
• Déficit real: ${deficit_real} kcal (objetivo: ${deficit_esperado} kcal)
• Proteína: ${proteinas_dia}g (${(proteinas_dia/perfil.peso_actual).toFixed(1)}g/kg) — objetivo: ${(perfil.proteina_min/perfil.peso_actual).toFixed(1)}-${(perfil.proteina_max/perfil.peso_actual).toFixed(1)}g/kg
• Carbohidratos: ${carbohidratos_dia}g | Fibra: ${fibra_dia}g | Ultraprocesados: ${ultraprocesados_dia} kcal
• Estrés: ${perfil.salud_y_sostenibilidad.nivel_estres_dia}/10 | Sueño: ${perfil.salud_y_sostenibilidad.hora_habitual_dormir}

GENERA ANÁLISIS CON 6 PUNTOS:
1. 🟢 BALANCE ENERGÉTICO — déficit ${deficit_real} kcal vs objetivo ${deficit_esperado} kcal
2. 💪 PROTEÍNA — ${(proteinas_dia/perfil.peso_actual).toFixed(1)}g/kg vs objetivo
3. ⏱️ TIMING — entreno ${perfil.fitness.horario_entrenamiento}, ${carbohidratos_dia}g carbos
4. 🥕 CALIDAD — fibra ${fibra_dia}g, ultraprocesados ${ultraprocesados_dia} kcal
5. 🧭 CORRECCIÓN — alimentos hoy: ${alimentosStr}. Ajuste con ${perfil.preferencias_alimentarias.proteinas_favoritas.join(', ')}
6. 💤 RECUPERACIÓN — estrés ${perfil.salud_y_sostenibilidad.nivel_estres_dia}/10, plan próxima comida

REFERENCIAS: Morton 2018 (proteína), Garthe 2011 (déficit), Aragon & Schoenfeld 2013 (timing), Slavin 2013 (fibra)`;

    let intentos = 0, mensaje = "";
    while (intentos < 3) {
        mensaje = await fetchGeminiCoachMessage(systemPrompt, userQuery);
        const itemCount = (mensaje.match(/\d\.\s/g) || []).length;
        const lineas = mensaje.split('\n').filter(l => l.trim().length > 0);
        if (itemCount >= 6 && lineas.length >= 8) return mensaje;
        intentos++;
        if (intentos < 3) userQuery += "\n\n⚠️ IMPORTANTE: Genera EXACTAMENTE 6 ítems numerados, cada uno con 2-4 oraciones completas.";
    }
    return generarMensajeFallback(consumido, gastado, perfil, momentOfDay, calcularMacrosDia(data.log_consumido));
}

function generarMensajeFallback(consumido, gastado, perfil, momentOfDay, macros) {
    const { proteinas_dia, carbohidratos_dia, grasas_dia, fibra_dia, ultraprocesados_dia } = macros || calcularMacrosDia([]);
    const balance = consumido - gastado;
    const deficit_esperado = perfil.tdee - perfil.calorias_objetivo;
    const deficit_real = perfil.tdee - balance;
    const totalMacrosKcal = (proteinas_dia*4) + (carbohidratos_dia*4) + (grasas_dia*9);
    const pProt  = totalMacrosKcal > 0 ? (proteinas_dia*4/totalMacrosKcal*100).toFixed(1) : "0";
    const pCarbs = totalMacrosKcal > 0 ? (carbohidratos_dia*4/totalMacrosKcal*100).toFixed(1) : "0";
    const pGrasa = totalMacrosKcal > 0 ? (grasas_dia*9/totalMacrosKcal*100).toFixed(1) : "0";
    const pProc  = consumido > 0 ? (ultraprocesados_dia/consumido*100).toFixed(1) : 0;

    let evalCal = deficit_real > deficit_esperado*1.2 ? `🔴 Déficit alto (${deficit_real} vs ${deficit_esperado} kcal). Considera ajustar la ingesta.`
        : deficit_real >= deficit_esperado*0.8 ? `🟢 Déficit en rango objetivo (${deficit_real} kcal). Buen progreso.`
        : deficit_real > 0 ? `🟡 Déficit menor al objetivo. Revisa la distribución.`
        : `🔴 Superávit calórico. Ajusta las próximas comidas.`;

    let evalProt = proteinas_dia < perfil.proteina_min*0.8 ? `🔴 Proteínas bajas (${proteinas_dia}g). Necesitás al menos ${perfil.proteina_min}g.`
        : proteinas_dia < perfil.proteina_min ? `🟡 Proteínas cercanas al mínimo (${proteinas_dia}g). Añadí más en la próxima comida.`
        : proteinas_dia <= perfil.proteina_max ? `🟢 Proteínas en rango óptimo (${proteinas_dia}g). Ideal para definición.`
        : `🟡 Proteínas altas (${proteinas_dia}g). Dentro de límites seguros.`;

    const recomendaciones = {
        'Desayuno': "Enfocate en un desayuno alto en proteínas (>20g) y fibra para controlar el hambre.",
        'Almuerzo': "Priorizá proteína magra, vegetales y carbohidratos complejos. 30-40% de tus calorías.",
        'Merienda': "Snack pre-entreno: carbohidratos de fácil digestión (fruta) y algo de proteína.",
        'Cena':     "Cena ligera con proteína suficiente (30-40g) para recuperación nocturna.",
    };
    const recMomento = recomendaciones[momentOfDay] || recomendaciones['Cena'];

    return `
1. ⚡ **Balance Calórico**
${evalCal} Neto: ${consumido} consumidas − ${gastado} ejercicio = **${balance} kcal**.

2. 💪 **Proteínas y Macros**
${evalProt} Distribución: **${pProt}% Proteína** | ${pCarbs}% Carbos | ${pGrasa}% Grasas.

3. ⏱️ **Timing Nutricional**
${recMomento} Entrenás ${perfil.fitness.horario_entrenamiento.toLowerCase()} — ${perfil.fitness.tipo_entrenamiento}.

4. 🥕 **Calidad Nutricional**
Fibra: **${fibra_dia}g** (meta 25g). Ultraprocesados: **${ultraprocesados_dia} kcal** (${pProc}% del total).

5. 🧭 **Ajuste Prioritario**
${proteinas_dia < perfil.proteina_min*0.7 ? 'AUMENTÁ proteínas' : pProc > 25 ? 'REDUCÍ ultraprocesados' : 'MANTENÉ el curso'}. Objetivo: ${perfil.objetivo} a ${perfil.ritmo_semanal} kg/semana.

6. 💤 **Recuperación**
Estrés **${perfil.salud_y_sostenibilidad.nivel_estres_dia}/10**. ${perfil.salud_y_sostenibilidad.nivel_estres_dia > 7 ? 'Priorizá descanso y comidas sencillas.' : 'Buen momento para planificar mañana.'} Hidratación clave.`;
}

async function checkAnalysisToday(dayISO) {
    if (dayISO !== todayISO) return false;
    const ultimoAnalisis = await obtenerUltimoAnalisis(dayISO);
    return ultimoAnalisis && ultimoAnalisis.trim().length > 0;
}

function showAnalysisConfirmationDialog(type, consumed, expended) {
    return new Promise((resolve) => {
        const balance = consumed - expended;
        const msg = type === "existing"
            ? `⚠️ Ya tenés un análisis generado hoy.\n\nDatos actuales:\n• Consumo: ${consumed} kcal\n• Ejercicio: ${expended} kcal\n• Balance: ${balance>0?'+':''}${balance} kcal\n\n¿Generár un nuevo análisis?`
            : `📊 Generar análisis del coach\n\nBasado en:\n• Consumo: ${consumed} kcal\n• Ejercicio: ${expended} kcal\n• Balance: ${balance>0?'+':''}${balance} kcal\n\n¿Continuar?`;
        resolve(confirm(msg));
    });
}

async function generateCoachAnalysis(dayISO, consumed, expended, perfil, isToday) {
    if (isToday) {
        const hasAnalysis = await checkAnalysisToday(dayISO);
        const confirmed = await showAnalysisConfirmationDialog(hasAnalysis ? "existing" : "new", consumed, expended);
        if (!confirmed) return;
    }

    // Verificar límite freemium ANTES de llamar a Gemini
    const puedeConsultar = await incrementarConsultaCoach();
    if (!puedeConsultar) return;

    elements.coachMessage.innerHTML = `
        <div class="d-flex align-items-center justify-content-center gap-2">
            <div class="spinner-border spinner-border-sm text-primary" role="status"></div>
            <span>Generando análisis personalizado...</span>
        </div>`;

    const currentMoment = getMealCategory(new Date());
    const mensajeAnterior = isToday ? await obtenerUltimoAnalisis(dayISO) : "";

    try {
        const message = await generarMensajeCoach(consumed, expended, perfil, currentMoment, mensajeAnterior);
        elements.coachMessage.innerHTML = sanitizeHTML(message);

        if (isToday) {
            await guardarAnalisisCoach(dayISO, currentMoment, message);
            console.log("✅ Análisis guardado en Firebase");
        }

        elements.coachMessage.innerHTML += `
            <div class="text-center mt-3">
                <button id="regenerateCoachBtn" class="btn btn-outline-primary btn-sm">
                    <i class="fas fa-sync-alt me-1"></i>Generar Nuevo Análisis
                </button>
            </div>`;
        setTimeout(() => {
            document.getElementById('regenerateCoachBtn')?.addEventListener('click', () =>
                generateCoachAnalysis(dayISO, consumed, expended, perfil, isToday));
        }, 100);

    } catch (error) {
        console.error("❌ Error generando análisis:", error);
        elements.coachMessage.innerHTML = `
            <div class="alert alert-warning">
                <strong>Error al conectar con el servicio.</strong>
                <p>Balance: ${consumed-expended > 0 ? '+' : ''}${consumed-expended} Kcal.</p>
                <div class="d-flex gap-2 justify-content-center">
                    <button id="retryCoachBtn" class="btn btn-sm btn-primary">Reintentar</button>
                    <button id="basicAnalysisBtn" class="btn btn-sm btn-outline-secondary">Ver resumen básico</button>
                </div>
            </div>`;
        setTimeout(() => {
            document.getElementById('retryCoachBtn')?.addEventListener('click', () =>
                generateCoachAnalysis(dayISO, consumed, expended, perfil, isToday));
            document.getElementById('basicAnalysisBtn')?.addEventListener('click', () =>
                showBasicAnalysis(consumed, expended));
        }, 100);
    }
}

function showBasicAnalysis(consumed, expended) {
    const netBalance = consumed - expended;
    elements.coachMessage.innerHTML = `
        <h6><i class="fas fa-chart-simple me-2"></i>Resumen del Día</h6>
        <div class="alert ${netBalance > 500 ? 'alert-warning' : netBalance <= -500 ? 'alert-info' : 'alert-success'} py-2 mb-2">
            Balance: <strong>${netBalance > 0 ? '+' : ''}${netBalance} Kcal</strong>
        </div>
        <div class="text-center mt-2">
            <button id="tryAgainBtn" class="btn btn-primary btn-sm">
                <i class="fas fa-robot me-1"></i>Intentar con IA
            </button>
        </div>`;
}


// ==============================================================================
// ╔══════════════════════════════════════════════════════════════════════════════╗
// ║  BLOQUE 14 — UI: RENDER DEL LOG Y MACROS                                    ║
// ║  → Mover a ui.js                                                            ║
// ╚══════════════════════════════════════════════════════════════════════════════╝
// ==============================================================================

// ====================
// Incorporar en ui.js — sanitizeHTML, renderCombinedLog,
// renderMacronutrients, renderTargetProgress, updateWeekSummaryUI,
// showLogDetails, updateActiveUserUI
// ====================

function sanitizeHTML(html) {
    const allowedTags = ['br', 'strong', 'b', 'i', 'em', 'span', 'hr'];
    const temp = document.createElement('div');
    temp.innerHTML = html;
    const allElements = temp.getElementsByTagName('*');
    for (let i = allElements.length - 1; i >= 0; i--) {
        const el = allElements[i];
        if (!allowedTags.includes(el.tagName.toLowerCase())) el.replaceWith(el.textContent);
    }
    for (let el of temp.getElementsByTagName('*')) {
        while (el.attributes.length > 0) el.removeAttribute(el.attributes[0].name);
    }
    return temp.innerHTML;
}

function updateWeekSummaryUI() {
    let totalConsumed = 0, totalExpended = 0;
    for (const dateISO in weekData) {
        totalConsumed  += weekData[dateISO].consumido || 0;
        totalExpended  += weekData[dateISO].gastado   || 0;
    }
    const netBalance = Number((totalConsumed - totalExpended).toFixed(2));
    elements.totalConsumidoSemana.textContent = totalConsumed;
    elements.totalGastadoSemana.textContent   = totalExpended;
    elements.netBalanceSemana.textContent     = netBalance;
    elements.balanceNetoSemanaBox.style.background =
        netBalance > 1000  ? 'linear-gradient(135deg, #ff9500 0%, #ff3b30 100%)' :
        netBalance < -1000 ? 'linear-gradient(135deg, #34c759 0%, #30d158 100%)' :
                             'linear-gradient(135deg, #007aff 0%, #5ac8fa 100%)';
}

function updateActiveUserUI() {
    elements.activeUserName.textContent = activePersonName;
    elements.emptyLogUser.textContent   = activePersonName;
}

function renderMacronutrients(macros) {
    elements.proteinasDiaDisplay.textContent      = Math.round(macros.proteinas_dia * 10) / 10;
    elements.carbohidratosDiaDisplay.textContent  = Math.round(macros.carbohidratos_dia * 10) / 10;
    elements.grasasDiaDisplay.textContent         = Math.round(macros.grasas_dia * 10) / 10;
    elements.fibraDiaDisplay.textContent          = Math.round(macros.fibra_dia * 10) / 10;
    elements.ultraprocesadosDiaDisplay.textContent= Math.round(macros.ultraprocesados_dia);
}

function renderTargetProgress(metas) {
    const fmtG    = (a, m) => `${Math.round(a)}g / ${Math.round(m)}g`;
    const fmtKcal = (a, m) => `${Math.round(a)} Kcal / ${Math.round(m)} Kcal`;
    if (elements.proteinaProgress)      elements.proteinaProgress.textContent      = fmtG(metas.proteina.actual, metas.proteina.meta);
    if (elements.carbohidratosProgress) elements.carbohidratosProgress.textContent = fmtG(metas.carbohidratos.actual, metas.carbohidratos.meta);
    if (elements.grasasProgress)        elements.grasasProgress.textContent        = fmtG(metas.grasas.actual, metas.grasas.meta);
    if (elements.fibraProgress)         elements.fibraProgress.textContent         = fmtG(metas.fibra.actual, metas.fibra.meta);
    if (elements.kcalTargetProgress)    elements.kcalTargetProgress.textContent    = fmtKcal(metas.kcal.actual, metas.kcal.meta);
    if (elements.kcalRestanteDisplay) {
        const excedente = metas.kcal.actual - metas.kcal.meta;
        if (metas.kcal.restante > 0) {
            elements.kcalRestanteDisplay.textContent = `(Quedan ${Math.round(metas.kcal.restante)} Kcal)`;
            elements.kcalRestanteDisplay.className = 'text-success fw-bold';
        } else if (excedente <= 0) {
            elements.kcalRestanteDisplay.textContent = '(¡Meta alcanzada!)';
            elements.kcalRestanteDisplay.className = 'text-info fw-bold';
        } else {
            elements.kcalRestanteDisplay.textContent = `(Excedido por ${Math.round(excedente)} Kcal)`;
            elements.kcalRestanteDisplay.className = 'text-danger fw-bold';
        }
    }
}

function renderCombinedLog(logConsumed, logExpended) {
    elements.foodLog.innerHTML = '';
    const combined = [
        ...(logConsumed  || []).map(i => ({ ...i, type: 'consumo', sortKey: new Date(i.hora).getTime() })),
        ...(logExpended  || []).map(i => ({ ...i, type: 'gasto',   sortKey: new Date(i.hora).getTime() })),
    ].sort((a, b) => a.sortKey - b.sortKey);

    if (combined.length === 0) { elements.emptyLogMessage.style.display = 'block'; return; }
    elements.emptyLogMessage.style.display = 'none';

    combined.forEach(item => {
        const dateObj     = new Date(item.hora);
        const time        = dateObj.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false });
        const isConsumption = item.type === 'consumo';
        const badgeClass  = isConsumption ? 'bg-success' : 'bg-danger';
        const sign        = isConsumption ? '+' : '-';
        const mealCategory= isConsumption ? getMealCategory(dateObj) : 'Ejercicio';

        let macrosHTML = '';
        if (isConsumption) {
            const p = Math.round(item.proteinas*10)/10, c = Math.round(item.carbohidratos*10)/10,
                  g = Math.round(item.grasas*10)/10,    f = Math.round(item.fibra*10)/10;
            macrosHTML = `
            <div class="macro-details mt-2 pt-2 border-top border-light-subtle">
                <div class="row small text-secondary">
                    <div class="col-12">🥩 Proteínas: <strong>${p}g</strong></div>
                    <div class="col-12">🍚 Carbohidratos: <strong>${c}g</strong></div>
                    <div class="col-12">🥑 Grasas: <strong>${g}g</strong></div>
                    <div class="col-12">🥕 Fibra: <strong>${f}g</strong></div>
                </div>
            </div>`;
        }

        const listItem = document.createElement('div');
        listItem.className = 'log-item-card animate-in';
        listItem.innerHTML = `
            <div class="d-flex justify-content-between align-items-start gap-3">
                <div class="flex-grow-1 min-w-0">
                    <div class="meal-category mb-1">${mealCategory}<span class="meal-time ms-2">${time}</span></div>
                    <div class="meal-description">${item.descripcion}</div>
                    ${macrosHTML}
                </div>
                <div class="d-flex flex-column align-items-end gap-2">
                    <span class="badge calorie-badge ${badgeClass}">${sign}${Math.round(item.kcal)} Kcal</span>
                    <button type="button" class="delete-btn"
                        onclick="window.deleteLogItem('${item.type}', '${item.id}', ${item.kcal})"
                        aria-label="Eliminar registro">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>`;
        elements.foodLog.appendChild(listItem);
    });
}

function showLogDetails(type) {
    const isConsumption = type === 'consumo';
    const log    = isConsumption ? currentLogData.log_consumido : currentLogData.log_gastado;
    const total  = isConsumption ? currentLogData.consumido : currentLogData.gastado;
    const title  = `${isConsumption ? 'Consumo' : 'Gasto'} de ${activePersonName} (${getDayNameShort(selectedDay)}, ${formatDate(selectedDay)})`;

    elements.logDetailsModalTitle.textContent = title;
    elements.modalTotalLabel.textContent      = isConsumption ? 'Total Consumido' : 'Total Gastado';
    elements.modalTotalValue.textContent      = `${total} Kcal`;
    elements.modalTotalValue.className        = `px-4 py-2 text-white fw-bold rounded-pill ${isConsumption ? 'bg-success' : 'bg-danger'}`;
    elements.modalLogContent.innerHTML        = '';

    if (!log || log.length === 0) {
        elements.modalLogContent.innerHTML = `<p class="text-center text-muted p-4">No hay registros.</p>`;
    } else {
        [...log].sort((a, b) => new Date(b.hora) - new Date(a.hora)).forEach(item => {
            const time = new Date(item.hora).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false });
            const el = document.createElement('div');
            el.className = 'log-item-card';
            el.innerHTML = `
                <div class="d-flex justify-content-between align-items-center gap-3">
                    <div class="flex-grow-1 min-w-0">
                        <div class="meal-category">${item.descripcion}</div>
                        <div class="meal-time">${time}</div>
                    </div>
                    <div class="d-flex align-items-center gap-2">
                        <span class="badge calorie-badge ${isConsumption ? 'bg-success' : 'bg-danger'}">
                            ${isConsumption ? '+' : '-'}${item.kcal} Kcal
                        </span>
                        <button type="button" class="delete-btn"
                            onclick="window.deleteLogItem('${type}', '${item.id}', ${item.kcal}); elements.logDetailsModal.hide();">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </div>`;
            elements.modalLogContent.appendChild(el);
        });
    }
    elements.logDetailsModal.show();
}


// ==============================================================================
// ╔══════════════════════════════════════════════════════════════════════════════╗
// ║  BLOQUE 15 — RENDER DEL DÍA SELECCIONADO                                   ║
// ║  → Se queda en script.js (orquesta UI principal)                           ║
// ╚══════════════════════════════════════════════════════════════════════════════╝
// ==============================================================================

async function renderSelectedDay() {
    const data = weekData[selectedDay] || { consumido: 0, gastado: 0, log_consumido: [], log_gastado: [] };
    currentLogData = data;

    const perfil = currentPerfil;   // ← ahora viene de Firestore, no del objeto hardcodeado
    if (!perfil) return;

    const macrosDiarias = calcularMacrosDia(currentLogData.log_consumido);
    renderMacronutrients(macrosDiarias);
    const metas = calcularMetasDiarias(perfil, macrosDiarias, currentLogData.consumido || 0);
    renderTargetProgress(metas);

    const isToday  = selectedDay === todayISO;
    const isFuture = new Date(selectedDay + 'T00:00:00') > new Date(todayISO + 'T00:00:00');

    elements.selectedDayDisplay.textContent = isToday ? "Hoy" : formatDate(selectedDay);
    elements.currentDateDisplay.textContent = selectedDay;

    // Bloquear inputs en días futuros
    const locked = isFuture;
    [elements.registroConsumoForm, elements.registroGastoForm].forEach(f => f.style.opacity = locked ? '0.5' : '1');
    [elements.descripcionConsumo, elements.descripcionGasto].forEach(inp => {
        inp.disabled = locked;
        inp.placeholder = locked ? "No se puede registrar en días futuros" : inp.id.includes('Consumo') ? "Ej: 1 huevo hervido" : "Ej: 30 min de correr";
    });
    [elements.submitConsumoButton, elements.submitGastoButton].forEach(btn => btn.disabled = locked);

    const consumed   = data.consumido || 0;
    const expended   = data.gastado   || 0;
    const netBalance = Number((consumed - expended).toFixed(2));

    elements.totalConsumido.textContent = consumed;
    elements.totalGastado.textContent   = expended;
    elements.netBalance.textContent     = netBalance;

    renderCombinedLog(data.log_consumido, data.log_gastado);

    if (consumed === 0 && expended === 0) {
        elements.coachMessage.textContent = `No hay registros para ${isToday ? 'hoy' : formatDate(selectedDay)}.`;
        elements.coachButton.style.display = 'none';
    } else {
        elements.coachMessage.innerHTML = `
            <div class="text-center">
                <p class="mb-3">📊 Hay registros para ${isToday ? 'hoy' : formatDate(selectedDay)}</p>
                <button id="generateCoachBtn" class="btn btn-primary">
                    <i class="fas fa-robot me-2"></i>Generar Análisis del Coach
                </button>
            </div>`;
        setTimeout(() => {
            document.getElementById('generateCoachBtn')?.addEventListener('click', () =>
                generateCoachAnalysis(selectedDay, consumed, expended, perfil, isToday));
        }, 100);
    }

    elements.loadingIndicator.style.display = 'none';
    elements.summaryContent.style.display   = 'block';
}


// ==============================================================================
// ╔══════════════════════════════════════════════════════════════════════════════╗
// ║  BLOQUE 16 — FORMULARIOS DE REGISTRO                                        ║
// ║  → Se quedan en script.js (event listeners de UI)                          ║
// ╚══════════════════════════════════════════════════════════════════════════════╝
// ==============================================================================

elements.registroConsumoForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (new Date(selectedDay + 'T00:00:00') > new Date(todayISO + 'T00:00:00')) return;

    const descripcion = elements.descripcionConsumo.value.trim();
    if (descripcion.length < 3 || !currentUser) return;

    elements.submitConsumoButton.disabled = true;
    elements.apiConsumoLoading.style.display = 'flex';

    try {
        const datos = await fetchGeminiFoodData(descripcion);
        if (!datos) { elements.coachMessage.textContent = "❌ No se pudo interpretar la respuesta nutricional."; return; }

        const docRef    = getDailyDocRef(selectedDay);
        const current   = weekData[selectedDay];
        const nuevoItem = {
            id: crypto.randomUUID(),
            hora: new Date().toISOString(),
            descripcion,
            kcal:          datos.kcal,
            proteinas:     datos.proteinas,
            carbohidratos: datos.carbohidratos,
            grasas:        datos.grasas,
            fibra:         datos.fibra,
            procesado:     datos.procesado,
        };
        await setDoc(docRef, {
            consumido:    (current.consumido || 0) + datos.kcal,
            log_consumido: (current.log_consumido || []).concat([nuevoItem])
        }, { merge: true });

        e.target.reset();
        elements.coachMessage.textContent = `✅ Consumo registrado: +${datos.kcal} Kcal`;

    } catch (error) {
        console.error("Error al obtener datos nutricionales:", error);
        elements.coachMessage.textContent = `⚠️ Error al obtener datos nutricionales`;
    } finally {
        elements.apiConsumoLoading.style.display = 'none';
        elements.submitConsumoButton.disabled = false;
    }
});

elements.registroGastoForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (new Date(selectedDay + 'T00:00:00') > new Date(todayISO + 'T00:00:00')) return;

    const descripcion = elements.descripcionGasto.value.trim();
    if (descripcion.length < 3 || !currentUser) return;

    elements.submitGastoButton.disabled = true;
    elements.apiGastoLoading.style.display = 'flex';

    try {
        const data = await fetchGeminiExpenditure(descripcion);
        if (!data?.kcal) { elements.coachMessage.textContent = `❌ No se pudo calcular el gasto.`; return; }

        const docRef    = getDailyDocRef(selectedDay);
        const current   = weekData[selectedDay];
        const nuevoItem = { id: crypto.randomUUID(), hora: new Date().toISOString(), descripcion, kcal: data.kcal };

        await setDoc(docRef, {
            gastado:    (current.gastado || 0) + data.kcal,
            log_gastado: (current.log_gastado || []).concat([nuevoItem])
        }, { merge: true });

        e.target.reset();
        elements.coachMessage.textContent = `✅ Gasto registrado: -${data.kcal} Kcal`;

    } catch (error) {
        console.error("Error al guardar gasto:", error);
        elements.coachMessage.textContent = `⚠️ Error en el cálculo de gasto.`;
    } finally {
        elements.apiGastoLoading.style.display = 'none';
        elements.submitGastoButton.disabled = false;
    }
});

async function deleteLogItem(type, itemId, kcalValue) {
    if (!currentUser || !db) return;
    const docRef  = getDailyDocRef(selectedDay);
    const logKey  = type === 'consumo' ? 'log_consumido' : 'log_gastado';
    const totalKey= type === 'consumo' ? 'consumido'     : 'gastado';
    elements.coachMessage.textContent = `Eliminando registro...`;
    try {
        const updatedLog = (currentLogData[logKey] || []).filter(item => item.id !== itemId);
        const newTotal   = Math.max(0, (currentLogData[totalKey] || 0) - kcalValue);
        await setDoc(docRef, { [totalKey]: newTotal, [logKey]: updatedLog }, { merge: true });
        elements.coachMessage.textContent = `✅ Registro eliminado correctamente.`;
    } catch (error) {
        console.error(`Error al eliminar:`, error);
        elements.coachMessage.textContent = `❌ Error al eliminar: ${error.message}`;
    }
}


// ==============================================================================
// ╔══════════════════════════════════════════════════════════════════════════════╗
// ║  BLOQUE 17 — AUTH UI HELPERS                                                ║
// ║  → Mover a auth.js                                                          ║
// ╚══════════════════════════════════════════════════════════════════════════════╝
// ==============================================================================

// ====================
// Incorporar en auth.js — showAuthScreen, onLoginSuccess,
// switchAuthTab, showAuthError, clearAuthError
// ====================

function showAuthScreen() {
    document.getElementById("auth-screen").style.display = "flex";
    document.getElementById("app-main").style.display   = "none";
}

function onLoginSuccess() {
    document.getElementById("auth-screen").style.display = "none";
    document.getElementById("app-main").style.display    = "block";

    if (!currentPerfil.onboarding_completado) {
        showOnboardingModal();
        return;
    }

    activePersonId   = currentUser.uid;
    activePersonName = currentPerfil.display_name || currentPerfil.email;

    currentWeekStart = getWeekStart(new Date());
    setupWeekNavigation();
    setupSummaryClickHandlers();
    setupRealtimeListener();
    updateActiveUserUI();
    window.deleteLogItem = deleteLogItem;
}

function switchAuthTab(tab) {
    document.getElementById("tab-login").style.display    = tab === "login"    ? "block" : "none";
    document.getElementById("tab-register").style.display = tab === "register" ? "block" : "none";
    document.querySelectorAll(".auth-tab").forEach((el, i) => {
        el.classList.toggle("active", (i === 0 && tab === "login") || (i === 1 && tab === "register"));
    });
    clearAuthError();
}

function showAuthError(msg) {
    const el = document.getElementById("auth-error");
    el.textContent = msg;
    el.style.display = "block";
}

function clearAuthError() {
    const el = document.getElementById("auth-error");
    el.textContent = "";
    el.style.display = "none";
}


// ==============================================================================
// ╔══════════════════════════════════════════════════════════════════════════════╗
// ║  BLOQUE 18 — UI HELPERS GENERALES                                           ║
// ║  → Mover a ui.js                                                            ║
// ╚══════════════════════════════════════════════════════════════════════════════╝
// ==============================================================================

// ====================
// Incorporar en ui.js — showLoadingButton, showUpgradeModal,
// closeUpgradeModal, showToast
// ====================

function showLoadingButton(btnId, loading) {
    const btn = document.getElementById(btnId);
    if (!btn) return;
    btn.disabled = loading;
    btn.dataset.originalText = btn.dataset.originalText || btn.textContent;
    btn.textContent = loading ? "Cargando..." : btn.dataset.originalText;
}

function showUpgradeModal(razon) {
    document.getElementById("upgrade-reason").textContent = razon;
    document.getElementById("upgrade-modal").style.display = "flex";
}

function closeUpgradeModal() {
    document.getElementById("upgrade-modal").style.display = "none";
}

function showToast(msg, type = "info") {
    const toast = document.createElement("div");
    toast.className = `toast toast-${type}`;
    toast.textContent = msg;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 4000);
}


// ==============================================================================
// ╔══════════════════════════════════════════════════════════════════════════════╗
// ║  BLOQUE 19 — ONBOARDING                                                     ║
// ║  → Mover a onboarding.js                                                    ║
// ╚══════════════════════════════════════════════════════════════════════════════╝
// ==============================================================================

// ====================
// Incorporar en onboarding.js — onboardingSteps, finalizarOnboarding, showOnboardingModal
// ====================

const onboardingSteps = [
    { id: "datos_basicos", titulo: "Contanos sobre vos",      campos: ["edad", "sexo", "peso_actual", "altura"] },
    { id: "objetivo",      titulo: "¿Cuál es tu objetivo?",   campos: ["objetivo", "peso_objetivo", "ritmo_semanal"] },
    { id: "actividad",     titulo: "Tu actividad física",     campos: ["fitness.nivel_actividad", "fitness.tipo_entrenamiento", "fitness.frecuencia_semanal"] },
    { id: "habitos",       titulo: "Tus hábitos",             campos: ["salud_y_sostenibilidad.hora_habitual_dormir", "salud_y_sostenibilidad.hora_habitual_despertar"] },
];

async function finalizarOnboarding(datosRecolectados) {
    const metricas = calcularMetricasNutricionales(datosRecolectados);
    await savePerfil({ ...datosRecolectados, ...metricas, onboarding_completado: true });
    onLoginSuccess();
}

// TODO: Implementar la UI del modal de onboarding paso a paso
function showOnboardingModal() {
    console.log("🔧 TODO: implementar modal de onboarding en onboarding.js");
    // Por ahora mostrar un alert básico como placeholder
    alert("¡Bienvenido! Completá tu perfil para empezar.");
}


// ==============================================================================
// ╔══════════════════════════════════════════════════════════════════════════════╗
// ║  BLOQUE 20 — SETUP DE EVENTOS Y PUNTO DE ENTRADA                           ║
// ║  → Se queda en script.js                                                   ║
// ╚══════════════════════════════════════════════════════════════════════════════╝
// ==============================================================================

function setupSummaryClickHandlers() {
    elements.consumidoBox.addEventListener('click', () => showLogDetails('consumo'));
    elements.gastadoBox.addEventListener('click',   () => showLogDetails('gasto'));
}

// Exponer funciones necesarias en el scope global (para los onclick del HTML)
window.loginWithGoogle      = loginWithGoogle;
window.loginWithEmail       = loginWithEmail;
window.registerWithEmail    = registerWithEmail;
window.logout               = logout;
window.resetPassword        = resetPassword;
window.switchAuthTab        = switchAuthTab;
window.closeUpgradeModal    = closeUpgradeModal;
window.deleteLogItem        = deleteLogItem;

// --- Punto de entrada principal ---
async function initializeFirebase() {
    try {
        const app = initializeApp(firebaseConfig);
        db   = getFirestore(app);
        auth = getAuth(app);

        // Compatibilidad con el entorno Canvas (si aplica)
        if (initialAuthToken) await signInWithCustomToken(auth, initialAuthToken);

        onAuthStateChanged(auth, async (user) => {
            if (user) {
                currentUser = user;
                await loadOrCreatePerfil(user);
                onLoginSuccess();
            } else {
                currentUser  = null;
                currentPerfil= null;
                showAuthScreen();
            }
        });

    } catch (error) {
        console.error("Error al inicializar Firebase:", error);
        showToast(`Error de conexión: ${error.message}`, "error");
    }
}

// 🚀 Arrancar la app
initializeFirebase();