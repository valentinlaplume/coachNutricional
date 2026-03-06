// ==============================================================================
// === modulos/elements.js — REFERENCIAS AL DOM ===
// ==============================================================================
// Módulo dedicado exclusivamente a los elementos del DOM.
// Separado de state.js porque:
//   - state.js = JS puro (sin DOM, testeable en cualquier entorno)
//   - elements.js = depende del HTML cargado
//
// PATRÓN: inicialización lazy con getElements().
// Los getElementById se ejecutan UNA sola vez cuando se llama
// getElements() por primera vez (no al importar el módulo).
// Esto evita errores si el script carga antes que el HTML.
//
// USO EN OTROS ARCHIVOS:
//   import { getElements } from './elements.js';
//   const el = getElements();
//   el.coachMessage.textContent = '...';
// ==============================================================================

let _elements = null;

export function getElements() {
    if (_elements) return _elements;   // ya inicializado → devolver caché

    _elements = {

        // ── GENERAL ──────────────────────────────────────────────────────────
        loadingIndicator:          document.getElementById('loadingIndicator'),
        summaryContent:            document.getElementById('summaryContent'),
        activeUserName:            document.getElementById('activeUserName'),

        // ── FECHAS Y NAVEGACIÓN ───────────────────────────────────────────────
        selectedDayDisplay:        document.getElementById('selectedDayDisplay'),
        currentDateDisplay:        document.getElementById('currentDateDisplay'),
        prevWeekBtn:               document.getElementById('prevWeekBtn'),
        nextWeekBtn:               document.getElementById('nextWeekBtn'),
        weekRangeDisplay:          document.getElementById('weekRangeDisplay'),
        daySelectorContainer:      document.getElementById('daySelectorContainer'),

        // ── RESUMEN SEMANAL ───────────────────────────────────────────────────
        totalConsumidoSemana:      document.getElementById('totalConsumidoSemana'),
        totalGastadoSemana:        document.getElementById('totalGastadoSemana'),
        netBalanceSemana:          document.getElementById('netBalanceSemana'),
        balanceNetoSemanaBox:      document.getElementById('balanceNetoSemanaBox'),

        // ── FORMULARIO CONSUMO ────────────────────────────────────────────────
        registroConsumoForm:       document.getElementById('registroConsumoForm'),
        descripcionConsumo:        document.getElementById('descripcionConsumo'),
        submitConsumoButton:       document.getElementById('submitConsumoButton'),
        apiConsumoLoading:         document.getElementById('apiConsumoLoading'),

        // ── FORMULARIO GASTO ──────────────────────────────────────────────────
        registroGastoForm:         document.getElementById('registroGastoForm'),
        descripcionGasto:          document.getElementById('descripcionGasto'),
        submitGastoButton:         document.getElementById('submitGastoButton'),
        apiGastoLoading:           document.getElementById('apiGastoLoading'),

        // ── RESUMEN DIARIO ────────────────────────────────────────────────────
        consumidoBox:              document.getElementById('consumidoBox'),
        gastadoBox:                document.getElementById('gastadoBox'),
        totalConsumido:            document.getElementById('totalConsumido'),
        totalGastado:              document.getElementById('totalGastado'),
        netBalance:                document.getElementById('netBalance'),
        balanceNetoBox:            document.getElementById('balanceNetoBox'),

        // ── COACH ─────────────────────────────────────────────────────────────
        coachMessage:              document.getElementById('coachMessage'),
        coachButton:               document.getElementById('coachButton'),

        // ── LOG DE ALIMENTOS ──────────────────────────────────────────────────
        foodLog:                   document.getElementById('foodLog'),
        emptyLogMessage:           document.getElementById('emptyLogMessage'),
        emptyLogUser:              document.getElementById('emptyLogUser'),

        // ── MACROS DEL DÍA ────────────────────────────────────────────────────
        proteinasDiaDisplay:       document.getElementById('proteinasDia'),
        carbohidratosDiaDisplay:   document.getElementById('carbohidratosDia'),
        grasasDiaDisplay:          document.getElementById('grasasDia'),
        fibraDiaDisplay:           document.getElementById('fibraDia'),
        ultraprocesadosDiaDisplay: document.getElementById('ultraprocesadosDia'),

        // ── PROGRESO DE METAS ─────────────────────────────────────────────────
        proteinaProgress:          document.getElementById('proteinaProgress'),
        carbohidratosProgress:     document.getElementById('carbohidratosProgress'),
        grasasProgress:            document.getElementById('grasasProgress'),
        fibraProgress:             document.getElementById('fibraProgress'),
        kcalTargetProgress:        document.getElementById('kcalTargetProgress'),
        kcalRestanteDisplay:       document.getElementById('kcalRestanteDisplay'),

        // ── AUTH SCREEN ───────────────────────────────────────────────────────
        authScreen:                document.getElementById('auth-screen'),
        appMain:                   document.getElementById('app-main'),
        authError:                 document.getElementById('auth-error'),

        // ── MODAL DE DETALLES DEL LOG ─────────────────────────────────────────
        // Bootstrap Modal se inicializa lazy también
        get logDetailsModal() {
            if (!this._logDetailsModal) {
                const el = document.getElementById('logDetailsModal');
                this._logDetailsModal = el ? new bootstrap.Modal(el) : null;
            }
            return this._logDetailsModal;
        },
        logDetailsModalTitle:      document.getElementById('logDetailsModalLabel'),
        modalLogContent:           document.getElementById('modalLogContent'),
        modalTotalLabel:           document.getElementById('modalTotalLabel'),
        modalTotalValue:           document.getElementById('modalTotalValue'),

        // ── MODAL UPGRADE (freemium) ──────────────────────────────────────────
        upgradeModal:              document.getElementById('upgrade-modal'),
        upgradeReason:             document.getElementById('upgrade-reason'),

    };

    return _elements;
}


// ==============================================================================
// === HELPER: inicializar estados visuales al arrancar ===
// ==============================================================================

export function initElementStates() {
    const el = getElements();
    if (el.loadingIndicator) el.loadingIndicator.style.display = 'block';
    if (el.summaryContent)   el.summaryContent.style.display   = 'none';
}