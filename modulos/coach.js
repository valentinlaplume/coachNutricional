
// ==============================================================================
// ╔══════════════════════════════════════════════════════════════════════════════╗
// ║  BLOQUE 13 — COACH: ANÁLISIS, FALLBACK, CONFIRMACIÓN                        ║
// ║  → Mover a coach.js                                                         ║
// ╚══════════════════════════════════════════════════════════════════════════════╝
// ==============================================================================
import { setupRealtimeListener, obtenerUltimoAnalisis, guardarAnalisisCoach,
    incrementarConsultaCoach 
    } from './firestore.js';

    
    // ====================
    // Incorporar en coach.js — MEAL_TIMES, getMealCategory,
    // generarMensajeCoach, generarMensajeFallback,
    // generateCoachAnalysis, checkAnalysisToday, showAnalysisConfirmationDialog, showBasicAnalysis
    // ====================
    import {
        selectedDay,
        currentLogData,
        weekData,
        todayISO,
        getActivePersonName,
    } from './state.js';

import { getElements } from './elements.js';
let elements = getElements();

const MEAL_TIMES = {
    DESAYUNO: { start: 6,     end: 12    },
    ALMUERZO: { start: 12,    end: 14.50 },
    MERIENDA: { start: 14.50, end: 20.50 },
    CENA:     { start: 20.50, end: 23    },
};

export function getMealCategory(dateObj) {
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

export async function generateCoachAnalysis(dayISO, consumed, expended, perfil, isToday) {
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
        console.log(consumed, expended, perfil, currentMoment, mensajeAnterior)
        const message = await generarMensajeCoach(consumed, expended, perfil, currentMoment, mensajeAnterior);
        console.log(message)
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
