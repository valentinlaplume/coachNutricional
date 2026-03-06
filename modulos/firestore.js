
import { getFirestore, 
    doc, 
    setDoc, 
    onSnapshot, 
    collection, 
    query, 
    getDoc, 
    getDocs, 
    orderBy, 
    where, 
    Timestamp, 
    updateDoc,
    serverTimestamp ,  
    limit // Añadimos limit para la optimización
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

import {
    db,
    currentPerfil,
    currentUser, setCurrentUser,setCurrentPerfil, 
    selectedDay,
    weekData,       setWeekDataForDay,
    currentLogData, setCurrentLogData,
    unsubscribeFromLog, setUnsubscribeFromLog, addUnsubscribeFromLog,
    currentWeekStart,
    getWeekDaysISO,
    todayISO,
    setWeekData,
    renderSelectedDay  
} from './state.js';

import{
    updateWeekSummaryUI
} from './ui.js'

import { getElements } from './elements.js';
let elements = getElements();

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


// ==============================================================================
// ╔══════════════════════════════════════════════════════════════════════════════╗
// ║  BLOQUE 8 — FIRESTORE: DATOS CALÓRICOS Y ANÁLISIS                           ║
// ║  → Mover a firestore.js                                                     ║
// ╚══════════════════════════════════════════════════════════════════════════════╝
// ==============================================================================
// ====================
// Incorporar en firestore.js — loadOrCreatePerfil, savePerfil, incrementarConsultaCoach
// ====================

export async function loadOrCreatePerfil(user) {
    const perfilRef = doc(db, `users/${user.uid}/perfil`, "datos");
    try {
        const snap = await getDoc(perfilRef);
        if (snap.exists()) {
            setCurrentPerfil(snap.data());
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
            setCurrentPerfil(perfilNuevo);
        }
    } catch (error) {
        console.error("Error cargando perfil:", error);
        throw error;
    }
}

export async function savePerfil(updates) {
    if (!currentUser) return;
    const perfilRef = doc(db, `users/${currentUser.uid}/perfil`, "datos");
    await updateDoc(perfilRef, { ...updates, fecha_actualizacion_metricas: serverTimestamp() });
    setCurrentPerfil({ ...currentPerfil, ...updates });
}

async function incrementarConsultaCoach() {
    const acceso = checkFeatureAccess(currentPerfil, "coach_consultas_mes");
    if (!acceso.permitido) { showUpgradeModal(acceso.razon); return false; }
    const perfilRef = doc(db, `users/${currentUser.uid}/perfil`, "datos");
    await updateDoc(perfilRef, { "uso.coach_consultas_mes": increment(1) });
    currentPerfil.uso.coach_consultas_mes = (currentPerfil.uso?.coach_consultas_mes || 0) + 1;
    return true;
}

// ====================
// Incorporar en firestore.js — getDailyDocRef, guardarAnalisisCoach, obtenerUltimoAnalisis
// ====================

export function getDailyDocRef(dateISO = selectedDay) {
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
// ║  BLOQUE 10 — FIRESTORE REALTIME LISTENER                                    ║
// ║  → Mover a firestore.js (setupRealtimeListener)                             ║
// ╚══════════════════════════════════════════════════════════════════════════════╝
// ==============================================================================

// ====================
// Incorporar en firestore.js — setupRealtimeListener
// ====================
export function setupRealtimeListener() {
    if (Array.isArray(unsubscribeFromLog)) unsubscribeFromLog.forEach(u => u());
    setUnsubscribeFromLog([])
    setWeekData({});

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
        addUnsubscribeFromLog(unsub);
    });
}