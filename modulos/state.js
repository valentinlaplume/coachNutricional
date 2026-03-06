


import { getElements } from './elements.js';
import { calcularMacrosDia, calcularMetasDiarias   } from './nutrition.js';
import { renderMacronutrients , renderTargetProgress, renderCombinedLog   } from './ui.js';
import { setupRealtimeListener    } from './firestore.js';
let elements = getElements();

export let db = null;
export let auth = null;
export let currentUser = null;
export let currentPerfil = null;
export let activePersonId = null;
export let activePersonName = null;
 
export function setActivePersonId(param) { activePersonId = param; }
export function setActivePersonName(param) { activePersonName = param; }

// ==============================================================================
// === modulos/state.js — ESTADO GLOBAL COMPARTIDO ===
// ==============================================================================
// Única fuente de verdad para todas las variables que necesitan
// más de un módulo. Nunca importar estado desde script.js.
//
// PATRÓN: exportar la variable + un setter explícito.
// Así cualquier módulo puede LEER directo, pero ESCRIBIR solo
// a través del setter → trazabilidad y sin efectos raros.
//
// USO EN OTROS ARCHIVOS:
//   import { selectedDay, setSelectedDay } from './state.js';
// ==============================================================================


// ==============================================================================
// === FECHA Y CALENDARIO ===
// ==============================================================================

function _getLocalDateISO() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
}

export const todayISO        = _getLocalDateISO();
export const WEEK_DAYS_NAMES = ['Lun', 'Mar', 'Mie', 'Jue', 'Vie', 'Sab', 'Dom'];

export let selectedDay      = todayISO;
export let currentWeekStart = new Date();

export function setSelectedDay(day)        { selectedDay = day; }
export function setCurrentWeekStart(date)  { currentWeekStart = date; }


// ==============================================================================
// === DATOS DEL DÍA ===
// ==============================================================================

export let weekData      = {};
export let currentLogData = {
    log_consumido: [],
    log_gastado:   [],
    consumido:     0,
    gastado:       0,
};
export let unsubscribeFromLog = [];

export function setWeekData(data)                    { weekData = data; }
export function setWeekDataForDay(dateISO, data)     { weekData[dateISO] = data; }
export function setCurrentLogData(data)              { currentLogData = data; }
export function setUnsubscribeFromLog(fns)           { unsubscribeFromLog = fns; }


export function addUnsubscribeFromLog(fns)           { unsubscribeFromLog.push(fns); }


// ==============================================================================
// === USUARIO Y PERFIL (Firebase Auth + Firestore) ===
// ==============================================================================
export function setDB(instance)      { db = instance; }
export function setAuth(instance)    { auth = instance; }
export function setCurrentUser(user) { currentUser = user; }
export function setCurrentPerfil(p)  { currentPerfil = p; }

// Helper: nombre para mostrar en UI
export function getActivePersonName() {
    return currentPerfil?.display_name || currentPerfil?.email || 'Usuario';
}


// ==============================================================================
// === ENTORNO (Canvas vs local) ===
// ==============================================================================

export const isCanvasEnvironment = typeof __firebase_config !== 'undefined';
export const initialAuthToken    = isCanvasEnvironment ? __initial_auth_token : null;


// ==============================================================================
// === UTILIDADES DE FECHA (usadas en script.js, firestore.js, coach.js, ui.js) ===
// ==============================================================================

/**
 * Devuelve el lunes de la semana que contiene `date`.
 */
export function getWeekStart(date) {
    const d = new Date(date);
    const day = d.getDay();
    d.setDate(d.getDate() - day + (day === 0 ? -6 : 1));
    d.setHours(0, 0, 0, 0);
    return d;
}

/**
 * Devuelve los 7 días ISO de la semana a partir de startOfWeek.
 */
export function getWeekDaysISO(startOfWeek) {
    const days = [];
    const cur  = new Date(startOfWeek);
    for (let i = 0; i < 7; i++) {
        days.push(
            `${cur.getFullYear()}-` +
            `${String(cur.getMonth()+1).padStart(2,'0')}-` +
            `${String(cur.getDate()).padStart(2,'0')}`
        );
        cur.setDate(cur.getDate() + 1);
    }
    return days;
}

/**
 * Formatea una fecha ISO como "3 ene", "15 mar", etc.
 */
export function formatDate(isoDate) {
    const [y, m, d] = isoDate.split('-');
    return new Date(y, m - 1, d)
        .toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
}

/**
 * Devuelve el nombre corto del día ('Lun', 'Mar', …).
 */
export function getDayNameShort(isoDate) {
    const [y, m, d] = isoDate.split('-');
    let idx = new Date(y, m - 1, d).getDay();
    if (idx === 0) idx = 6; else idx--;
    return WEEK_DAYS_NAMES[idx];
}

// ==============================================================================
// ║  BLOQUE 9 — NAVEGACIÓN Y SEMANAS                                           ║
// ║  → Se queda en script.js (es navegación de UI principal)                   ║
// ==============================================================================


export function changeWeek(days) {
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

export function updateWeekUI() {
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

export function selectDay(dateISO) {
    if (selectedDay === dateISO) return;
    selectedDay = dateISO;
    document.querySelectorAll('.day-selector-btn').forEach(btn => {
        btn.classList.toggle('active-day', btn.dataset.date === dateISO);
    });
    renderSelectedDay();
}


// ==============================================================================
// ╔══════════════════════════════════════════════════════════════════════════════╗
// ║  BLOQUE 15 — RENDER DEL DÍA SELECCIONADO                                   ║
// ║  → Se queda en script.js (orquesta UI principal)                           ║
// ╚══════════════════════════════════════════════════════════════════════════════╝
// ==============================================================================

export async function renderSelectedDay() {
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