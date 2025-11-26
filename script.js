// --- Importaciones de Firebase ---
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInAnonymously, signInWithCustomToken } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, doc, setDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// --- Importar configuraciones personales del archivo config.js ---
import { FIREBASE_CONFIG_PERSONAL, GEMINI_API_KEY_PERSONAL, APP_PROJECT_ID } from './config.js';

// ==============================================================================
// === VARIABLES GLOBALES Y CONFIGURACIÓN DINÁMICA ===
// ==============================================================================

const isCanvasEnvironment = typeof __firebase_config !== 'undefined';
const firebaseConfig = isCanvasEnvironment ? JSON.parse(__firebase_config) : FIREBASE_CONFIG_PERSONAL;
const initialAuthToken = isCanvasEnvironment ? __initial_auth_token : null;
// La clave de la API es una cadena vacía en el entorno Canvas
const API_KEY = isCanvasEnvironment ? "" : GEMINI_API_KEY_PERSONAL; 
const appId = isCanvasEnvironment ? __app_id : APP_PROJECT_ID; 

const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent";

let db, auth, userId = null;
const todayISO = new Date().toISOString().split('T')[0]; 
const WEEK_DAYS_NAMES = ['L', 'M', 'X', 'J', 'V', 'S', 'D']; // Nombres de días de la semana (Lunes a Domingo)

// --- Estados de la aplicación (Fechas y Logs) ---
let selectedDay = todayISO; // El día que se muestra en el panel de detalle
let currentWeekStart = new Date(); // Fecha del lunes de la semana actual
let weekData = {}; // Almacena los datos de los 7 días: { '2025-01-01': { consumed: 100, ... }, ... }

// Logs globales para el detalle del modal y borrado
let currentLogData = {
    log_consumed: [], // Los logs de consumo del día seleccionado
    log_expended: [], // Los logs de gasto del día seleccionado
    consumed: 0,
    expended: 0
};
let unsubscribeFromLog = []; // Almacena los listeners de Firestore para poder cancelarlos

// --- Lista Fija de Personas ---
const PEOPLE = [
    { id: 'valentin', name: 'Valentín' },
    { id: 'sofia', name: 'Sofía' }
];

let activePersonId = PEOPLE[0].id;
let activePersonName = PEOPLE[0].name;

// Mapeo de elementos del DOM
const elements = {
    loadingIndicator: document.getElementById('loadingIndicator'),
    userIdDisplay: document.getElementById('userIdDisplay'),
    activeUserName: document.getElementById('activeUserName'),
    activeUserPlaceholderConsumo: document.getElementById('activeUserPlaceholderConsumo'),
    activeUserPlaceholderGasto: document.getElementById('activeUserPlaceholderGasto'),
    selectedDayDisplay: document.getElementById('selectedDayDisplay'),
    currentDateDisplay: document.getElementById('currentDateDisplay'),

    // Navegación Semanal
    prevWeekBtn: document.getElementById('prevWeekBtn'),
    nextWeekBtn: document.getElementById('nextWeekBtn'),
    weekRangeDisplay: document.getElementById('weekRangeDisplay'),
    daySelectorContainer: document.getElementById('daySelectorContainer'),
    
    // Resumen Semanal
    totalConsumidoSemana: document.getElementById('totalConsumidoSemana'),
    totalGastadoSemana: document.getElementById('totalGastadoSemana'),
    netBalanceSemana: document.getElementById('netBalanceSemana'),
    balanceNetoSemanaBox: document.getElementById('balanceNetoSemanaBox'),

    // Consumo/Gasto Inputs
    apiConsumoLoading: document.getElementById('apiConsumoLoading'),
    submitConsumoButton: document.getElementById('submitConsumoButton'),
    registroConsumoForm: document.getElementById('registroConsumoForm'),
    descripcionConsumo: document.getElementById('descripcionConsumo'),
    apiGastoLoading: document.getElementById('apiGastoLoading'),
    submitGastoButton: document.getElementById('submitGastoButton'),
    registroGastoForm: document.getElementById('registroGastoForm'),
    descripcionGasto: document.getElementById('descripcionGasto'),
    
    // Resumen Diario
    consumidoBox: document.getElementById('consumidoBox'),
    gastadoBox: document.getElementById('gastadoBox'),
    totalConsumido: document.getElementById('totalConsumido'),
    totalGastado: document.getElementById('totalGastado'),
    netBalance: document.getElementById('netBalance'),
    balanceNetoBox: document.getElementById('balanceNetoBox'),
    coachMessage: document.getElementById('coachMessage'),
    foodLog: document.getElementById('foodLog'),
    emptyLogMessage: document.getElementById('emptyLogMessage'),
    emptyLogUser: document.getElementById('emptyLogUser'),
    summaryContent: document.getElementById('summaryContent'),
    selectValentinBtn: document.getElementById('selectValentinBtn'), 
    selectSofiaBtn: document.getElementById('selectSofiaBtn'), 
    
    // Modal
    logDetailsModal: new bootstrap.Modal(document.getElementById('logDetailsModal')),
    logDetailsModalTitle: document.getElementById('logDetailsModalLabel'),
    modalLogContent: document.getElementById('modalLogContent'),
    modalTotalLabel: document.getElementById('modalTotalLabel'),
    modalTotalValue: document.getElementById('modalTotalValue'),
};

// Mostrar indicador de carga al inicio
elements.loadingIndicator.style.display = 'block';
elements.summaryContent.style.display = 'none'; 

// ==============================================================================
// === FUNCIONES DE UTILIDAD DE FECHA ===
// ==============================================================================

/**
 * Obtiene la fecha de inicio de la semana (Lunes) para una fecha dada.
 * @param {Date} date 
 * @returns {Date} El lunes de esa semana.
 */
function getWeekStart(date) {
    const d = new Date(date);
    const day = d.getDay(); // 0 (Domingo) - 6 (Sábado)
    // Ajustar para que el Lunes (1) sea el inicio (diff = 0)
    const diff = d.getDate() - day + (day === 0 ? -6 : 1); 
    d.setDate(diff);
    d.setHours(0, 0, 0, 0); // Limpiar la hora
    return d;
}

/**
 * Retorna un array con las 7 fechas ISO de la semana.
 * @param {Date} startOfWeek 
 * @returns {string[]} Array de fechas ISO (YYYY-MM-DD).
 */
function getWeekDaysISO(startOfWeek) {
    const days = [];
    let currentDay = new Date(startOfWeek);
    for (let i = 0; i < 7; i++) {
        days.push(currentDay.toISOString().split('T')[0]);
        currentDay.setDate(currentDay.getDate() + 1);
    }
    return days;
}

/**
 * Formatea una fecha ISO a un formato legible.
 * @param {string} isoDate 
 * @returns {string} Fecha legible (Ej: 25 Nov).
 */
function formatDate(isoDate) {
    const date = new Date(isoDate);
    return date.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
}

/**
 * Retorna el nombre corto del día de la semana.
 * @param {string} isoDate 
 * @returns {string} L, M, X, J, V, S, D.
 */
function getDayNameShort(isoDate) {
    const date = new Date(isoDate);
    let dayIndex = date.getDay(); // 0 (Dom) a 6 (Sab)
    // Ajustar a 0 (Lun) a 6 (Dom)
    if (dayIndex === 0) dayIndex = 6; else dayIndex--;
    return WEEK_DAYS_NAMES[dayIndex];
}


// ==============================================================================
// === FUNCIONES DE ARQUITECTURA (FIREBASE/AUTH/NAVIGATION) ===
// ==============================================================================

/**
 * Obtiene la referencia al documento diario para la persona y fecha seleccionada.
 * @param {string} dateISO 
 */
function getDailyDocRef(dateISO = selectedDay) {
    const docPath = `/artifacts/${appId}/users/${userId}/calory_data/${activePersonId}_${dateISO}`;
    return doc(db, docPath);
}

/**
 * Inicializa Firebase, autentica al usuario y configura la navegación inicial.
 */
async function initializeFirebase() {
    try {
        const app = initializeApp(firebaseConfig);
        db = getFirestore(app);
        auth = getAuth(app);
        
        // Autenticación usando el token personalizado o anónimamente
        if (initialAuthToken) {
            await signInWithCustomToken(auth, initialAuthToken);
        } else {
            await signInAnonymously(auth);
        }
        
        // Asignar el ID de usuario
        userId = auth.currentUser?.uid || crypto.randomUUID();
        elements.userIdDisplay.textContent = userId;
        
        // Inicializar la navegación de fechas
        currentWeekStart = getWeekStart(new Date());
        setupWeekNavigation(); 
        
        setupPersonButtons(); 
        setupSummaryClickHandlers(); 
        
        // Exponer la función para que los botones generados dinámicamente puedan llamarla
        window.deleteLogItem = deleteLogItem; 
        
    } catch (error) {
        console.error("Error al inicializar o autenticar Firebase:", error);
        elements.coachMessage.textContent = `Error crítico de conexión: ${error.message}`;
        elements.loadingIndicator.style.display = 'none';
    }
}

// --- Lógica de Navegación de Semanas ---

/**
 * Configura los event listeners para los botones de navegación semanal.
 */
function setupWeekNavigation() {
    elements.prevWeekBtn.addEventListener('click', () => changeWeek(-7));
    elements.nextWeekBtn.addEventListener('click', () => changeWeek(7));
    
    // Inicializar la UI de la semana
    updateWeekUI();
    setupRealtimeListener();
}

/**
 * Cambia la semana visible sumando o restando días.
 * @param {number} days Delta de días (+7 para siguiente, -7 para anterior).
 */
function changeWeek(days) {
    // Calcular nueva fecha de inicio de semana
    currentWeekStart.setDate(currentWeekStart.getDate() + days);
    
    const now = new Date();
    const currentWeekStartISO = getWeekStart(currentWeekStart).toISOString().split('T')[0];
    const todayWeekStartISO = getWeekStart(now).toISOString().split('T')[0];

    // Deshabilitar botón "Siguiente Semana" si ya estamos en la semana actual
    elements.nextWeekBtn.disabled = (currentWeekStartISO === todayWeekStartISO);

    // Asegurar que no se navegue a semanas futuras
    if (currentWeekStart > getWeekStart(new Date())) {
        currentWeekStart = getWeekStart(new Date());
        elements.nextWeekBtn.disabled = true;
    }
    
    // Si la semana actual incluye el selectedDay, mantenerlo seleccionado. Si no, seleccionar el lunes.
    const weekDays = getWeekDaysISO(currentWeekStart);
    if (!weekDays.includes(selectedDay)) {
        // Si el selectedDay cae fuera de la nueva semana, seleccionar el Lunes de esa nueva semana
        selectedDay = weekDays[0]; 
    }

    // Actualizar la interfaz y el listener
    updateWeekUI();
    setupRealtimeListener();
}

/**
 * Actualiza los rangos de fecha y los botones de selección de día.
 */
function updateWeekUI() {
    const weekDays = getWeekDaysISO(currentWeekStart);
    const endOfWeek = new Date(currentWeekStart);
    endOfWeek.setDate(currentWeekStart.getDate() + 6);

    // 1. Actualizar rango de fechas en el display
    const startRange = formatDate(weekDays[0]);
    const endRange = formatDate(weekDays[6]);
    elements.weekRangeDisplay.textContent = `${startRange} - ${endRange}`;

    // 2. Renderizar selectores de día
    elements.daySelectorContainer.innerHTML = '';
    weekDays.forEach(dateISO => {
        const dayName = getDayNameShort(dateISO);
        const datePart = formatDate(dateISO);
        
        const isSelected = dateISO === selectedDay;
        const isActiveDay = dateISO === todayISO;
        
        const button = document.createElement('button');
        button.className = `day-selector-btn ${isSelected ? 'active-day' : ''}`;
        
        // Determinar si es la semana actual para resaltar 'Hoy'
        const isCurrentWeek = getWeekStart(new Date(dateISO)).toISOString().split('T')[0] === getWeekStart(new Date()).toISOString().split('T')[0];
        
        // Uso de clases de Bootstrap para la estructura interna
        button.innerHTML = `
            ${dayName} <br> 
            <span class="fw-light small ${isActiveDay && isCurrentWeek ? 'fw-bold text-success' : ''}">${datePart}</span>
        `;
        button.dataset.date = dateISO;
        
        button.addEventListener('click', () => selectDay(dateISO));
        elements.daySelectorContainer.appendChild(button);
    });
    
    // 3. Renderizar el día seleccionado
    renderSelectedDay();
}

/**
 * Selecciona un día específico para mostrar el detalle.
 * @param {string} dateISO 
 */
function selectDay(dateISO) {
    if (selectedDay === dateISO) return;
    selectedDay = dateISO;
    
    // 1. Actualizar visualmente los botones
    document.querySelectorAll('.day-selector-btn').forEach(btn => {
        btn.classList.remove('active-day');
        if (btn.dataset.date === dateISO) {
            btn.classList.add('active-day');
        }
    });

    // 2. Renderizar el nuevo día
    renderSelectedDay();
}

// --- Lógica de Realtime Listener y UI ---

/**
 * Configura el listener de Firestore para todos los 7 días de la semana seleccionada.
 */
function setupRealtimeListener() {
    // Si hay listeners anteriores, desuscribirse para evitar fugas de memoria
    if (Array.isArray(unsubscribeFromLog)) {
        unsubscribeFromLog.forEach(unsub => unsub());
    }
    unsubscribeFromLog = [];
    weekData = {};

    elements.loadingIndicator.style.display = 'block';
    elements.summaryContent.style.display = 'none';

    const weekDaysISO = getWeekDaysISO(currentWeekStart);
    
    // Datos iniciales para un día sin registro
    const initialData = { 
        consumed: 0, 
        expended: 0, 
        log_consumed: [], 
        log_expended: [] 
    };

    weekDaysISO.forEach(dateISO => {
        const docRef = getDailyDocRef(dateISO);
        
        // Crea un listener para cada documento diario de la semana
        const unsub = onSnapshot(docRef, (docSnap) => {
            let data = initialData;

            if (docSnap.exists()) {
                data = docSnap.data();
            } else {
                // Si el documento no existe, crearlo con datos iniciales
                setDoc(docRef, initialData); 
            }
            
            // Almacenar los datos del día en la estructura de la semana
            weekData[dateISO] = data;
            
            // Cuando llegan datos, actualizar ambos resúmenes
            updateWeekSummaryUI();
            
            // Si el día que actualiza los datos es el día que está seleccionado, renderizarlo
            if (dateISO === selectedDay) {
                renderSelectedDay();
            }
        }, (error) => {
            console.error(`Error en listener de Firestore para ${dateISO}:`, error);
        });
        
        unsubscribeFromLog.push(unsub);
    });
}

/**
 * Actualiza los elementos de la interfaz relacionados con la persona activa.
 */
function updateActiveUserUI() {
    elements.activeUserName.textContent = activePersonName;
    elements.activeUserPlaceholderConsumo.textContent = activePersonName;
    elements.activeUserPlaceholderGasto.textContent = activePersonName;
    elements.emptyLogUser.textContent = activePersonName;
}

/**
 * Agrega los datos de todos los 7 días de la semana y actualiza el resumen semanal.
 */
function updateWeekSummaryUI() {
    let totalConsumed = 0;
    let totalExpended = 0;
    
    for (const dateISO in weekData) {
        // Asegurar que las propiedades existan antes de sumar
        totalConsumed += weekData[dateISO].consumed || 0;
        totalExpended += weekData[dateISO].expended || 0;
    }
    
    const netBalance = totalConsumed - totalExpended;
    
    // Actualizar Resumen Semanal
    elements.totalConsumidoSemana.textContent = totalConsumed;
    elements.totalGastadoSemana.textContent = totalExpended;
    elements.netBalanceSemana.textContent = netBalance;
    
    // Aplicar estilos condicionales al balance neto semanal
    let backgroundStyle = 'linear-gradient(45deg, #3b82f6, #60a5fa)'; // Azul estándar
    if (netBalance > 1000) { // Balance positivo alto (Naranja/Rojo)
        backgroundStyle = 'linear-gradient(45deg, #f97316, #fb923c)'; 
    } else if (netBalance < -1000) { // Déficit alto (Verde/Cian)
        backgroundStyle = 'linear-gradient(45deg, #10b981, #34d399)'; 
    }
    elements.balanceNetoSemanaBox.style.background = backgroundStyle;
}

/**
 * Renderiza el resumen y el log solo para el día seleccionado.
 */
function renderSelectedDay() {
    // Obtener datos del día seleccionado (o datos vacíos si no existen)
    const data = weekData[selectedDay] || { consumed: 0, expended: 0, log_consumed: [], log_expended: [] };
    
    // 1. Guardar los logs del día seleccionado para el modal/borrado
    currentLogData = data;

    // 2. Actualizar texto del día seleccionado en el panel de registro
    const isToday = selectedDay === todayISO;
    elements.selectedDayDisplay.textContent = isToday ? "Hoy" : formatDate(selectedDay);
    elements.currentDateDisplay.textContent = selectedDay;

    // Habilitar/Deshabilitar registro: solo se puede registrar en el día actual
    const forms = [elements.registroConsumoForm, elements.registroGastoForm];
    const inputs = [elements.descripcionConsumo, elements.descripcionGasto];
    const buttons = [elements.submitConsumoButton, elements.submitGastoButton];

    if (selectedDay !== todayISO) {
        forms.forEach(form => form.classList.add('opacity-50'));
        inputs.forEach(input => { input.disabled = true; input.placeholder = "Solo se puede registrar en el día actual."; });
        buttons.forEach(btn => btn.disabled = true);
    } else {
        forms.forEach(form => form.classList.remove('opacity-50'));
        inputs.forEach(input => { 
            input.disabled = false; 
            input.placeholder = input.id.includes('Consumo') ? "Ej: Tostadas con palta" : "Ej: 30 minutos de correr intenso"; 
        });
        buttons.forEach(btn => btn.disabled = false);
    }

    // 3. Renderizar Resumen Diario
    const consumed = data.consumed || 0;
    const expended = data.expended || 0;
    const netBalance = consumed - expended;
    
    elements.totalConsumido.textContent = consumed;
    elements.totalGastado.textContent = expended;
    elements.netBalance.textContent = netBalance;

    // 4. Lógica del Coach (para el día seleccionado)
    let message = '';
    if (consumed === 0 && expended === 0) {
        message = `No hay registros para ${selectedDay === todayISO ? 'hoy' : formatDate(selectedDay)} en ${activePersonName}.`;
    } else if (netBalance > 500) {
        message = `¡Cuidado! El balance diario (+${netBalance} Kcal) es alto para ${activePersonName}.`;
    } else if (netBalance <= 0 && netBalance > -500) {
        message = `¡Día excelente! Balance neutro/déficit ligero para ${activePersonName}.`;
    } else {
        message = `Balance del día: ${netBalance > 0 ? '+' : ''}${netBalance} Kcal.`;
    }
    
    elements.coachMessage.textContent = message;
    
    // 5. Renderizar el log combinado
    renderCombinedLog(data.log_consumed, data.log_expended);

    elements.loadingIndicator.style.display = 'none';
    elements.summaryContent.style.display = 'block';
}


/**
 * Renderiza el historial de comidas y actividades combinadas en la UI principal.
 * @param {Array<Object>} logConsumed - Log de consumo.
 * @param {Array<Object>} logExpended - Log de gasto.
 */
function renderCombinedLog(logConsumed, logExpended) {
    elements.foodLog.innerHTML = '';
    
    // Combinar y ordenar los logs por tiempo (más reciente primero)
    const combinedLog = [
        ...(logConsumed || []).map(item => ({...item, type: 'consumo', sortKey: new Date(item.time).getTime() })),
        ...(logExpended || []).map(item => ({...item, type: 'gasto', sortKey: new Date(item.time).getTime() }))
    ];
    
    if (combinedLog.length === 0) {
        elements.emptyLogMessage.style.display = 'block';
        return;
    }
    elements.emptyLogMessage.style.display = 'none';

    const sortedLog = combinedLog.sort((a, b) => b.sortKey - a.sortKey);

    sortedLog.forEach(item => {
        const time = new Date(item.time).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
        const isConsumption = item.type === 'consumo';
        const badgeClass = isConsumption ? 'bg-success' : 'bg-danger';
        const sign = isConsumption ? '+' : '-';
        
        const listItem = document.createElement('div');
        listItem.className = 'd-flex justify-content-between align-items-center log-item';
        
        // Agregar botón de borrado solo si es el día actual
        const deleteButtonHTML = (selectedDay === todayISO) ? `
            <button type="button" class="btn btn-sm text-secondary hover-text-danger p-1" 
                onclick="window.deleteLogItem('${item.type}', '${item.id}', ${item.kcal})">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-trash" viewBox="0 0 16 16">
                  <path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z"/>
                  <path d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2.5a1 1 0 0 1 1-1h11a1 1 0 0 1 1 1V3zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4H4.118zM2.5 3V2.5h11V3h-11z"/>
                </svg>
            </button>
        ` : `<span class="text-muted small">Histórico</span>`;

        listItem.innerHTML = `
            <div class="d-flex flex-column flex-grow-1 min-w-0 me-3">
                <span class="fw-bold text-truncate">${item.desc}</span>
                <span class="text-secondary small">(${time})</span>
            </div>
            <div class="d-flex align-items-center gap-2 flex-shrink-0">
                <span class="badge ${badgeClass} text-white fw-semibold rounded-pill p-2">
                    ${sign}${item.kcal} Kcal
                </span>
                ${deleteButtonHTML}
            </div>
        `;
        elements.foodLog.appendChild(listItem);
    });
}


// --- Lógica de Eliminación y Modal ---

/**
 * Elimina un ítem del log (consumo o gasto) y actualiza el total en Firestore.
 * @param {string} type - 'consumo' o 'gasto'
 * @param {string} itemId - ID único del ítem a eliminar
 * @param {number} kcalValue - Valor calórico del ítem
 */
async function deleteLogItem(type, itemId, kcalValue) {
    if (!userId || !db || selectedDay !== todayISO) {
        elements.coachMessage.textContent = "Error: Solo puedes eliminar registros del día actual.";
        return;
    }

    const docRef = getDailyDocRef(selectedDay);
    const logKey = type === 'consumo' ? 'log_consumed' : 'log_expended';
    const totalKey = type === 'consumo' ? 'consumed' : 'expended';
    
    elements.coachMessage.textContent = `Eliminando registro de ${type}...`;

    try {
        const currentData = currentLogData; 
        
        // Filtrar el log para eliminar el ítem por su ID
        const updatedLog = (currentData[logKey] || []).filter(item => item.id !== itemId);
        
        // Calcular el nuevo total, asegurando que no sea negativo
        const newTotal = Math.max(0, (currentData[totalKey] || 0) - kcalValue);

        const updateObject = {};
        updateObject[totalKey] = newTotal;
        updateObject[logKey] = updatedLog;

        // Escribir los datos actualizados de vuelta a Firestore
        await setDoc(docRef, updateObject, { merge: true });
        elements.coachMessage.textContent = `Registro de ${type} eliminado correctamente.`;

    } catch (error) {
        console.error(`Error al eliminar ${type} en Firestore:`, error);
        elements.coachMessage.textContent = `ERROR: No se pudo eliminar el registro. ${error.message}`;
    }
}

/**
 * Muestra el modal con el detalle de los registros (Consumo o Gasto) del día seleccionado.
 * @param {string} type - 'consumo' o 'gasto'
 */
function showLogDetails(type) {
    // Usamos los logs del día seleccionado
    const isConsumption = type === 'consumo';
    const log = isConsumption ? currentLogData.log_consumed : currentLogData.log_expended;
    const total = isConsumption ? currentLogData.consumed : currentLogData.expended;
    const dateFormatted = formatDate(selectedDay);
    const title = isConsumption ? `Detalle de Consumo de ${activePersonName} (${dateFormatted})` : `Detalle de Gasto Calórico de ${activePersonName} (${dateFormatted})`;
    const totalLabel = isConsumption ? 'Consumido' : 'Gastado';
    const totalColorClass = isConsumption ? 'bg-success' : 'bg-danger';

    elements.logDetailsModalTitle.textContent = title;
    elements.modalTotalLabel.textContent = totalLabel;
    elements.modalTotalValue.textContent = `${total} Kcal`;
    elements.modalTotalValue.className = `px-4 py-2 text-white fw-bolder rounded-pill fs-5 shadow-sm ${totalColorClass}`;

    elements.modalLogContent.innerHTML = '';
    const canDelete = selectedDay === todayISO;

    if (log.length === 0) {
        elements.modalLogContent.innerHTML = `<p class="text-center text-muted p-4">No hay registros de ${totalLabel.toLowerCase()} para este día.</p>`;
    } else {
        const sortedLog = log.sort((a, b) => new Date(b.time) - new Date(a.time));

        sortedLog.forEach(item => {
            const time = new Date(item.time).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
            const sign = isConsumption ? '+' : '-';
            const badgeClass = isConsumption ? 'bg-success' : 'bg-danger';
            
            // Botón de borrado en el modal (solo si es el día actual)
            const deleteButton = canDelete ? `
                <button type="button" class="btn btn-sm text-secondary hover-text-danger p-1" 
                    onclick="window.deleteLogItem('${type}', '${item.id}', ${item.kcal}); elements.logDetailsModal.hide();">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-trash" viewBox="0 0 16 16">
                      <path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z"/>
                      <path d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2.5a1 1 0 0 1 1-1h11a1 1 0 0 1 1 1V3zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4H4.118zM2.5 3V2.5h11V3h-11z"/>
                    </svg>
                </button>
            ` : '';

            const listItem = document.createElement('div');
            listItem.className = 'd-flex justify-content-between align-items-center log-item';
            listItem.innerHTML = `
                <div class="d-flex flex-column flex-grow-1 min-w-0 me-3">
                    <span class="fw-bold text-truncate">${item.desc}</span>
                    <span class="text-secondary small">(${time})</span>
                </div>
                <div class="d-flex align-items-center gap-2 flex-shrink-0">
                    <span class="badge ${badgeClass} text-white fw-semibold rounded-pill p-2">
                        ${sign}${item.kcal} Kcal
                    </span>
                    ${deleteButton}
                </div>
            `;
            elements.modalLogContent.appendChild(listItem);
        });
    }

    elements.logDetailsModal.show();
}

/**
 * Configura los event listeners para las cajas de resumen clickeables.
 */
function setupSummaryClickHandlers() {
    elements.consumidoBox.addEventListener('click', () => showLogDetails('consumo'));
    elements.gastadoBox.addEventListener('click', () => showLogDetails('gasto'));
}


/**
 * Actualiza la apariencia visual del botón de la persona activa.
 * @param {string} personId 
 */
function setActiveButtonVisuals(personId) {
    elements.selectValentinBtn.classList.remove('active-person');
    elements.selectSofiaBtn.classList.remove('active-person');

    if (personId === 'valentin') {
        elements.selectValentinBtn.classList.add('active-person');
    } else if (personId === 'sofia') {
        elements.selectSofiaBtn.classList.add('active-person');
    }
}

/**
 * Configura los botones de selección de persona.
 */
function setupPersonButtons() {
    
    // Inicialización de la persona activa
    activePersonId = PEOPLE[0].id; 
    activePersonName = PEOPLE[0].name; 
    updateActiveUserUI();
    setActiveButtonVisuals(activePersonId);

    const changePerson = (id, name) => {
        if (activePersonId !== id) {
            activePersonId = id;
            activePersonName = name;
            updateActiveUserUI();
            // Reiniciar la semana para la nueva persona
            currentWeekStart = getWeekStart(new Date()); 
            selectedDay = todayISO;
            updateWeekUI();
            setupRealtimeListener(); 
        }
    };

    elements.selectValentinBtn.addEventListener('click', () => changePerson('valentin', 'Valentín'));
    elements.selectSofiaBtn.addEventListener('click', () => changePerson('sofia', 'Sofía'));
}


// --- Funciones de Integración con Gemini API (Cálculo Calórico) ---

/**
 * Solicita a Gemini la estimación de calorías consumidas.
 * @param {string} foodDescription - Descripción de la comida.
 */
async function fetchGeminiCalories(foodDescription) {
    const systemPrompt = "Act as a highly accurate food and nutrition calculator. Based on the user's description, estimate the calorie count (Kcal) for a typical serving size, or the amount specified by the user. Respond ONLY with a JSON object that strictly adheres to the provided schema.";
    const userQuery = `Estimate calories for: ${foodDescription}`;
    return await sendGeminiRequest(systemPrompt, userQuery);
}

/**
 * Solicita a Gemini la estimación de gasto calórico.
 * @param {string} activityDescription - Descripción de la actividad física.
 */
async function fetchGeminiExpenditure(activityDescription) {
    const systemPrompt = "Act as a fitness and activity tracker. Based on the user's description of a physical activity (including duration if provided), estimate the total calories burned (Kcal). Respond ONLY with a JSON object that strictly adheres to the provided schema.";
    const userQuery = `Estimate calories burned for: ${activityDescription}`;
    return await sendGeminiRequest(systemPrompt, userQuery);
}

/**
 * Envía la solicitud a la API de Gemini con manejo de reintentos y formato JSON.
 */
async function sendGeminiRequest(systemPrompt, userQuery) {
    const payload = {
        contents: [{ parts: [{ text: userQuery }] }],
        systemInstruction: { parts: [{ text: systemPrompt }] },
        generationConfig: {
            responseMimeType: "application/json",
            responseSchema: {
                type: "OBJECT",
                properties: {
                    "item": { "type": "STRING", "description": "The identified item/activity." },
                    "calories": { "type": "NUMBER", "description": "The estimated calorie count (Kcal)." }
                },
                propertyOrdering: ["item", "calories"]
            }
        }
    };

    const url = `${GEMINI_API_URL}?key=${API_KEY}`;
    const MAX_RETRIES = 5;

    for (let i = 0; i < MAX_RETRIES; i++) {
        try {
            if (!isCanvasEnvironment && API_KEY === "TU_CLAVE_GEMINI_API_AQUI") {
                // Esta verificación es para el entorno local
                if(i === 0) console.warn("Usando clave de API ficticia. Si está en un entorno local, por favor configure su clave en config.js.");
            }

            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                // En caso de error HTTP, lanzar un error para reintentar
                throw new Error(`Error HTTP! estado: ${response.status}`);
            }

            const result = await response.json();
            
            const jsonText = result?.candidates?.[0]?.content?.parts?.[0]?.text;
            if (!jsonText) throw new Error("Respuesta de API vacía o inválida.");
            
            const parsedJson = JSON.parse(jsonText);
            const calories = parsedJson.calories;

            if (typeof calories === 'number' && calories > 0) {
                // Retornar las calorías redondeadas
                return Math.round(calories);
            }
            throw new Error("Calorías obtenidas no válidas o cero.");

        } catch (error) {
            console.warn(`Intento ${i + 1} fallido: ${error.message}. Reintentando...`);
            if (i === MAX_RETRIES - 1) throw new Error(`Fallo al obtener calorías después de ${MAX_RETRIES} intentos.`);
            // Espera exponencial antes de reintentar
            await new Promise(resolve => setTimeout(resolve, Math.pow(2, i) * 1000));
        }
    }
    return 0; // Fallback final
}


// --- Manejadores de Eventos de Registro (Consumo y Gasto) ---

elements.registroConsumoForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if(selectedDay !== todayISO) return; // Permitir registrar solo en el día actual

    const descripcion = elements.descripcionConsumo.value.trim();
    if (descripcion.length < 3 || !userId) return;

    elements.submitConsumoButton.disabled = true;
    elements.apiConsumoLoading.style.display = 'block';

    let caloriasObtenidas = 0;

    try {
        caloriasObtenidas = await fetchGeminiCalories(descripcion);

    } catch (error) {
        console.error("Error en el cálculo de consumo:", error);
        caloriasObtenidas = 150; // Valor de fallback
        elements.coachMessage.textContent = `Advertencia: Falló la IA. Usando 150 Kcal como fallback para consumo.`;
    } finally {
        elements.apiConsumoLoading.style.display = 'none';
        elements.submitConsumoButton.disabled = false;
    }
    
    if (caloriasObtenidas === 0) {
        elements.coachMessage.textContent = `Error: No se pudo obtener el valor calórico para el consumo. Intenta ser más específico.`;
        return;
    }

    const docRef = getDailyDocRef(todayISO);

    try {
        const currentData = weekData[todayISO];
        
        const newConsumed = (currentData.consumed || 0) + caloriasObtenidas;

        const newItem = { 
            id: crypto.randomUUID(), 
            time: new Date().toISOString(), 
            desc: descripcion, 
            kcal: caloriasObtenidas 
        };
        
        // Actualizar el total consumido y añadir el nuevo ítem al log
        await setDoc(docRef, { 
            consumed: newConsumed, 
            log_consumed: (currentData.log_consumed || []).concat([newItem])
        }, { merge: true });

        e.target.reset(); // Limpiar el formulario
    } catch (error) {
        console.error("Error al guardar consumo en Firestore:", error);
        elements.coachMessage.textContent = `Error al guardar consumo: ${error.message}`;
    }
});


elements.registroGastoForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if(selectedDay !== todayISO) return; // Permitir registrar solo en el día actual

    const descripcion = elements.descripcionGasto.value.trim();
    
    if (descripcion.length < 3 || !userId) return;

    elements.submitGastoButton.disabled = true;
    elements.apiGastoLoading.style.display = 'block';

    let caloriasObtenidas = 0;

    try {
        caloriasObtenidas = await fetchGeminiExpenditure(descripcion);

    } catch (error) {
        console.error("Error en el cálculo de gasto:", error);
        caloriasObtenidas = 200; // Valor de fallback
        elements.coachMessage.textContent = `Advertencia: Falló la IA. Usando 200 Kcal como fallback para gasto.`;
    } finally {
        elements.apiGastoLoading.style.display = 'none';
        elements.submitGastoButton.disabled = false;
    }
    
    if (caloriasObtenidas === 0) {
        elements.coachMessage.textContent = `Error: No se pudo obtener el valor calórico para el gasto. Intenta ser más específico (Ej: 30 minutos de correr).`;
        return;
    }

    const docRef = getDailyDocRef(todayISO);

    try {
        const currentData = weekData[todayISO]; 
        
        const newExpended = (currentData.expended || 0) + caloriasObtenidas;

        const newItem = { 
            id: crypto.randomUUID(), 
            time: new Date().toISOString(), 
            desc: descripcion, 
            kcal: caloriasObtenidas 
        };
        
        // Actualizar el total gastado y añadir el nuevo ítem al log
        await setDoc(docRef, { 
            expended: newExpended, 
            log_expended: (currentData.log_expended || []).concat([newItem])
        }, { merge: true });

        e.target.reset(); // Limpiar el formulario
    } catch (error) {
        console.error("Error al guardar gasto en Firestore:", error);
        elements.coachMessage.textContent = `Error al guardar gasto: ${error.message}`;
    }
});


// --- Ejecución Inicial ---
initializeFirebase();