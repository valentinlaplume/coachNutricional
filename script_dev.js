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
    signInWithCustomToken,
    onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import {    getFirestore, setDoc, } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

import { getElements } from './modulos/elements.js';

import {
    loginWithGoogle,
    loginWithEmail, 
    registerWithEmail,
    logout,
    resetPassword,
    switchAuthTab,
    onLoginSuccess,
    showAuthScreen 
} from "./modulos/auth.js";
import {
    showToast,

} from "./modulos/ui.js";
import {
    firebaseConfig,initialAuthToken,
    sendGeminiRequest,
    fetchGeminiFoodData,

} from "./modulos/gemini.js";
import {
    loadOrCreatePerfil,
    getDailyDocRef,
    setupRealtimeListener 
} from "./modulos/firestore.js";

import {
    todayISO, WEEK_DAYS_NAMES,
    selectedDay,      setSelectedDay,
    currentWeekStart, setCurrentWeekStart,
    weekData,         setWeekDataForDay,
    currentLogData,   setCurrentLogData,
    unsubscribeFromLog, setUnsubscribeFromLog,
    currentUser, setCurrentUser,
    currentPerfil, setCurrentPerfil,
    db,
    auth,             setAuth,
    setDB,
    getWeekStart, getWeekDaysISO, formatDate, getDayNameShort,
    updateWeekUI, changeWeek 
} from './modulos/state.js';

import { getStagingComidas, clearStaging } from "./modulos/ui_recetas.js";

// ==============================================================================
// ║  BLOQUE 5 — DOM ELEMENTS                                                    ║
// ║  → Se queda en script.js (es el punto de entrada de UI)                     ║
// ==============================================================================

let elements = getElements();

elements.loadingIndicator.style.display = 'fixed';
elements.summaryContent.style.display = 'none';


// ==============================================================================
// ╔══════════════════════════════════════════════════════════════════════════════╗
// ║  BLOQUE 16 — FORMULARIOS DE REGISTRO                                        ║
// ║  → Se quedan en script.js (event listeners de UI)                          ║
// ╚══════════════════════════════════════════════════════════════════════════════╝
// ==============================================================================

// elements.registroConsumoForm.addEventListener('submit', async (e) => {
//     e.preventDefault();
//     if (new Date(selectedDay + 'T00:00:00') > new Date(todayISO + 'T00:00:00')) return;

//     const descripcion = elements.descripcionConsumo.value.trim();
//     if (descripcion.length < 3 || !currentUser) return;

//     elements.submitConsumoButton.disabled = true;
//     elements.apiConsumoLoading.style.display = 'flex';

//     try {
//         const datos = await fetchGeminiFoodData(descripcion);
//         if (!datos) { elements.coachMessage.textContent = "❌ No se pudo interpretar la respuesta nutricional."; return; }

//         const docRef    = getDailyDocRef(selectedDay);
//         const current   = weekData[selectedDay];
//         const nuevoItem = {
//             id: crypto.randomUUID(),
//             hora: new Date().toISOString(),
//             descripcion,
//             kcal:          datos.kcal,
//             proteinas:     datos.proteinas,
//             carbohidratos: datos.carbohidratos,
//             grasas:        datos.grasas,
//             fibra:         datos.fibra,
//             procesado:     datos.procesado,
//         };
//         await setDoc(docRef, {
//             consumido:    (current.consumido || 0) + datos.kcal,
//             log_consumido: (current.log_consumido || []).concat([nuevoItem])
//         }, { merge: true });

//         e.target.reset();
//         elements.coachMessage.textContent = `✅ Consumo registrado: +${datos.kcal} Kcal`;

//     } catch (error) {
//         console.error("Error al obtener datos nutricionales:", error);
//         elements.coachMessage.textContent = `⚠️ Error al obtener datos nutricionales`;
//     } finally {
//         elements.apiConsumoLoading.style.display = 'none';
//         elements.submitConsumoButton.disabled = false;
//     }
// });
elements.registroConsumoForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!currentUser) return;

    const staging = getStagingComidas(); 
    const inputManual = elements.descripcionConsumo.value.trim();

    if (staging.length === 0 && inputManual.length < 3) return;

    elements.submitConsumoButton.disabled = true;
    elements.apiConsumoLoading.style.display = 'flex';

    try {
        let totalMacros = { kcal: 0, proteinas: 0, carbohidratos: 0, grasas: 0, fibra: 0 };

        // --- 1. PROCESAR STAGING (Matemática Pura) ---
        staging.forEach(s => {
            const factor = s.cantidad / 100;
            totalMacros.kcal += Math.round((s.kcal || 0) * factor);
            totalMacros.proteinas += Math.round((s.proteinas || 0) * factor);
            totalMacros.carbohidratos += Math.round((s.carbohidratos || 0) * factor);
            totalMacros.grasas += Math.round((s.grasas || 0) * factor);
            totalMacros.fibra += Math.round((s.fibra || 0) * factor);
        });

        // --- 2. PROCESAR MANUAL (IA - Solo si hay texto) ---
        if (inputManual.length >= 3) {
            const datosIA = await fetchGeminiFoodData(inputManual);
            if (datosIA) {
                totalMacros.kcal += datosIA.kcal;
                totalMacros.proteinas += datosIA.proteinas;
                totalMacros.carbohidratos += datosIA.carbohidratos;
                totalMacros.grasas += datosIA.grasas;
                totalMacros.fibra += (datosIA.fibra || 0);
            }
        }

        // --- 3. GUARDAR EN FIRESTORE ---
        const docRef = getDailyDocRef(selectedDay);
        const current = weekData[selectedDay] || { consumido: 0, log_consumido: [] };

        const nuevoItem = {
            id: crypto.randomUUID(),
            hora: new Date().toISOString(),
            recetasUsadas: staging.map(s => ({ 
                nombre: s.nombre, 
                cantidad: s.cantidad, 
                unidad: s.unidad || 'g' 
            })),
            descripcionManual: inputManual,
            // Guardamos los macros finales ya sumados
            ...totalMacros 
        };
        
        await setDoc(docRef, {
            consumido: (current.consumido || 0) + totalMacros.kcal,
            log_consumido: (current.log_consumido || []).concat([nuevoItem])
        }, { merge: true });

        // 4. Limpieza de UI
        e.target.reset();
        clearStaging();
        elements.coachMessage.textContent = `✅ +${totalMacros.kcal} Kcal`;

    } catch (error) {
        console.error("Error en registro:", error);
        alert("Hubo un error al registrar. Revisa la consola.");
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

export async function deleteLogItem(type, itemId, kcalValue) {
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
// ║  BLOQUE 20 — SETUP DE EVENTOS Y PUNTO DE ENTRADA                           ║
// ║  → Se queda en script.js                                                   ║
// ╚══════════════════════════════════════════════════════════════════════════════╝
// ==============================================================================



// Exponer funciones necesarias en el scope global (para los onclick del HTML)
window.loginWithGoogle      = loginWithGoogle;
window.loginWithEmail       = loginWithEmail;
window.registerWithEmail    = registerWithEmail;
window.logout               = logout;
window.resetPassword        = resetPassword;
window.switchAuthTab        = switchAuthTab;
// window.closeUpgradeModal    = closeUpgradeModal;
window.deleteLogItem        = deleteLogItem;

export function setupWeekNavigation() {
    elements.prevWeekBtn.addEventListener('click', () => changeWeek(-7));
    elements.nextWeekBtn.addEventListener('click', () => changeWeek(7));
    updateWeekUI();
    setupRealtimeListener();
}

// --- Punto de entrada principal ---
async function initializeFirebase() {
    try {
        const app = initializeApp(firebaseConfig);
        setDB(getFirestore(app));
        setAuth(getAuth(app));

        // Compatibilidad con el entorno Canvas (si aplica)
        if (initialAuthToken) await signInWithCustomToken(auth, initialAuthToken);

        onAuthStateChanged(auth, async (user) => {
            console.log("onAuthStateChanged")
            console.log(user)
            if (user) {
                setCurrentUser(user);
                await loadOrCreatePerfil(user);
                onLoginSuccess();         // ← muestra la app
            } else {
                setCurrentUser(null);
                setCurrentPerfil(null);
                showAuthScreen();         // ← muestra el login
            }
        });

    } catch (error) {
        console.error("Error al inicializar Firebase:", error);
        showToast(`Error de conexión: ${error.message}`, "error");
    }
}



// 🚀 Arrancar la app
initializeFirebase();