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
const API_KEY = isCanvasEnvironment ? "" : GEMINI_API_KEY_PERSONAL;
const appId = isCanvasEnvironment ? __app_id : APP_PROJECT_ID;

const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent";

let db, auth, userId = null;

// CORRECCIÓN: Obtener fecha local correctamente sin problemas de zona horaria
function getLocalDateISO() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

const todayISO = getLocalDateISO();
const WEEK_DAYS_NAMES = ['Lun', 'Mar', 'Mie', 'Jue', 'Vie', 'Sab', 'Dom'];

// --- Estados de la aplicación ---
let selectedDay = todayISO;
let currentWeekStart = new Date();
let weekData = {};

// Logs globales con nombres en español
let currentLogData = {
    log_consumido: [],
    log_gastado: [],
    consumido: 0,
    gastado: 0
};
let unsubscribeFromLog = [];

// --- Lista de Personas ---
const PEOPLE = [
    { id: 'valentin', name: 'Valentín' },
    { id: 'sofia', name: 'Sofía' }
];

// Nueva estructura de datos en Firestore
const perfilUsuario = {
    valentin: {
        edad: 25,
        sexo: 'masculino',
        peso_actual: 75, // kg
        altura: 175, // cm
        peso_objetivo: 72,
        nivel_actividad: 'moderado', // sedentario, ligero, moderado, activo, muy_activo
        objetivo: 'perder_peso', // perder_peso, mantener, ganar_musculo
        ritmo_semanal: 0.5, // kg por semana
        // Calculados automáticamente:
        tmb: 1750,
        tdee: 2712,
        calorias_objetivo: 2212, // TDEE - 500 (para perder 0.5kg/semana)
        fecha_actualizacion: '2025-11-26',
        proteina_min: 105, // 75 * 1.4 = 
        proteina_max: 165, // 75 * 2.2 
        preferencias: {
            evita_ultraprocesados: true,
            prefiere_plant_based: false,
            intolerancia_lactosa: false
        }
    },
    sofia: {
        edad: 25,
        sexo: 'femenino',
        peso_actual: 60,
        altura: 165,
        peso_objetivo: 3,
        nivel_actividad: 'moderado',
        objetivo: 'perder_peso',
        ritmo_semanal: 0.25,
        tmb: 1380,
        tdee: 1897,
        calorias_objetivo: 1647, // TDEE - 250
        fecha_actualizacion: '2025-11-26',
        proteina_min: 84, // 60 * 1.4 
        proteina_max: 132, // 60 * 2.2
        preferencias: {
            evita_ultraprocesados: true,
            prefiere_plant_based: false,
            intolerancia_lactosa: false
        }
    }
};

let activePersonId = PEOPLE[0].id;
let activePersonName = PEOPLE[0].name;

// Mapeo de elementos del DOM
const elements = {
    loadingIndicator: document.getElementById('loadingIndicator'),
    activeUserName: document.getElementById('activeUserName'),
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

    // Inputs
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

elements.loadingIndicator.style.display = 'block';
elements.summaryContent.style.display = 'none';

// ==============================================================================
// === FUNCIONES DE UTILIDAD DE FECHA ===
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
        const year = currentDay.getFullYear();
        const month = String(currentDay.getMonth() + 1).padStart(2, '0');
        const day = String(currentDay.getDate()).padStart(2, '0');
        days.push(`${year}-${month}-${day}`);
        currentDay.setDate(currentDay.getDate() + 1);
    }
    return days;
}

function formatDate(isoDate) {
    const [year, month, day] = isoDate.split('-');
    const date = new Date(year, month - 1, day);
    return date.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
}

function getDayNameShort(isoDate) {
    const [year, month, day] = isoDate.split('-');
    const date = new Date(year, month - 1, day);
    let dayIndex = date.getDay();
    if (dayIndex === 0) dayIndex = 6; else dayIndex--;
    return WEEK_DAYS_NAMES[dayIndex];
}

// ==============================================================================
// === FUNCIONES DE FIREBASE Y NAVEGACIÓN ===
// ==============================================================================

function getDailyDocRef(dateISO = selectedDay) {
    const docPath = `/artifacts/${appId}/users/${userId}/datos_caloricos/${activePersonId}_${dateISO}`;
    return doc(db, docPath);
}

async function initializeFirebase() {
    try {
        const app = initializeApp(firebaseConfig);
        db = getFirestore(app);
        auth = getAuth(app);
        
        if (initialAuthToken) {
            await signInWithCustomToken(auth, initialAuthToken);
        } else {
            await signInAnonymously(auth);
        }
        
        userId = auth.currentUser?.uid || crypto.randomUUID();
        
        currentWeekStart = getWeekStart(new Date());
        setupWeekNavigation();
        setupPersonButtons();
        setupSummaryClickHandlers();
        
        window.deleteLogItem = deleteLogItem;
        
    } catch (error) {
        console.error("Error al inicializar Firebase:", error);
        elements.coachMessage.textContent = `Error de conexión: ${error.message}`;
        elements.loadingIndicator.style.display = 'none';
    }
}

// --- Navegación de Semanas ---

function setupWeekNavigation() {
    elements.prevWeekBtn.addEventListener('click', () => changeWeek(-7));
    elements.nextWeekBtn.addEventListener('click', () => changeWeek(7));
    
    updateWeekUI();
    setupRealtimeListener();
}

function changeWeek(days) {
    currentWeekStart.setDate(currentWeekStart.getDate() + days);
    
    const now = new Date();
    const currentWeekStartDate = getWeekStart(currentWeekStart);
    const todayWeekStartDate = getWeekStart(now);

    elements.nextWeekBtn.disabled = (currentWeekStartDate.toDateString() === todayWeekStartDate.toDateString());

    if (currentWeekStart > getWeekStart(new Date())) {
        currentWeekStart = getWeekStart(new Date());
        elements.nextWeekBtn.disabled = true;
    }
    
    const weekDays = getWeekDaysISO(currentWeekStart);
    if (!weekDays.includes(selectedDay)) {
        selectedDay = weekDays[0];
    }

    updateWeekUI();
    setupRealtimeListener();
}

function updateWeekUI() {
    const weekDays = getWeekDaysISO(currentWeekStart);
    const endOfWeek = new Date(currentWeekStart);
    endOfWeek.setDate(currentWeekStart.getDate() + 6);

    const startRange = formatDate(weekDays[0]);
    const endRange = formatDate(weekDays[6]);
    elements.weekRangeDisplay.textContent = `${startRange} - ${endRange}`;

    elements.daySelectorContainer.innerHTML = '';
    weekDays.forEach(dateISO => {
        const dayName = getDayNameShort(dateISO);
        const datePart = formatDate(dateISO);
        
        const isSelected = dateISO === selectedDay;
        const isToday = dateISO === todayISO;
        
        const button = document.createElement('button');
        button.className = `day-selector-btn ${isSelected ? 'active-day' : ''} ${isToday ? 'today-marker' : ''}`;
        
        button.innerHTML = `
            <span class="day-name">${dayName}</span>
            <span class="day-date">${datePart.split(' ')[0]}</span>
        `;
        button.dataset.date = dateISO;
        button.setAttribute('aria-label', `${dayName} ${datePart}`);
        
        button.addEventListener('click', () => selectDay(dateISO));
        elements.daySelectorContainer.appendChild(button);
    });
    
    renderSelectedDay();
}

function selectDay(dateISO) {
    if (selectedDay === dateISO) return;
    selectedDay = dateISO;
    
    document.querySelectorAll('.day-selector-btn').forEach(btn => {
        btn.classList.remove('active-day');
        if (btn.dataset.date === dateISO) {
            btn.classList.add('active-day');
        }
    });

    renderSelectedDay();
}

// --- Listener de Firestore ---

function setupRealtimeListener() {
    if (Array.isArray(unsubscribeFromLog)) {
        unsubscribeFromLog.forEach(unsub => unsub());
    }
    unsubscribeFromLog = [];
    weekData = {};

    elements.loadingIndicator.style.display = 'block';
    elements.summaryContent.style.display = 'none';

    const weekDaysISO = getWeekDaysISO(currentWeekStart);
    
    const initialData = {
        consumido: 0,
        gastado: 0,
        log_consumido: [],
        log_gastado: []
    };

    weekDaysISO.forEach(dateISO => {
        const docRef = getDailyDocRef(dateISO);
        
        const unsub = onSnapshot(docRef, (docSnap) => {
            let data = initialData;

            if (docSnap.exists()) {
                data = docSnap.data();
            } else {
                setDoc(docRef, initialData);
            }
            
            weekData[dateISO] = data;
            updateWeekSummaryUI();
            
            if (dateISO === selectedDay) {
                renderSelectedDay();
            }
        }, (error) => {
            console.error(`Error en listener para ${dateISO}:`, error);
        });
        
        unsubscribeFromLog.push(unsub);
    });
}

function updateActiveUserUI() {
    elements.activeUserName.textContent = activePersonName;
    elements.emptyLogUser.textContent = activePersonName;
}

function updateWeekSummaryUI() {
    let totalConsumed = 0;
    let totalExpended = 0;
    
    for (const dateISO in weekData) {
        totalConsumed += weekData[dateISO].consumido || 0;
        totalExpended += weekData[dateISO].gastado || 0;
    }
    
    const netBalance = Number((totalConsumed - totalExpended).toFixed(2));

    elements.totalConsumidoSemana.textContent = totalConsumed;
    elements.totalGastadoSemana.textContent = totalExpended;
    elements.netBalanceSemana.textContent = netBalance;
    
    let backgroundStyle = 'linear-gradient(135deg, #007aff 0%, #5ac8fa 100%)';
    if (netBalance > 1000) {
        backgroundStyle = 'linear-gradient(135deg, #ff9500 0%, #ff3b30 100%)';
    } else if (netBalance < -1000) {
        backgroundStyle = 'linear-gradient(135deg, #34c759 0%, #30d158 100%)';
    }
    elements.balanceNetoSemanaBox.style.background = backgroundStyle;
}
// Nueva función específica para mensajes del coach
async function fetchGeminiCoachMessage(systemPrompt, userQuery) {
    const payload = {
        contents: [{ parts: [{ text: userQuery }] }],
        systemInstruction: { parts: [{ text: systemPrompt }] },
        generationConfig: {
            responseMimeType: "application/json",
            responseSchema: {
                type: "OBJECT",
                properties: {
                    "mensaje": { 
                        "type": "STRING",
                        "description": "Mensaje motivacional del coach en 2 oraciones cortas con emojis"
                    }
                },
                required: ["mensaje"]
            }
        }
    };

    const url = `${GEMINI_API_URL}?key=${API_KEY}`;
    const MAX_RETRIES = 3;

    for (let i = 0; i < MAX_RETRIES; i++) {
        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const result = await response.json();
            const jsonText = result?.candidates?.[0]?.content?.parts?.[0]?.text;
            if (!jsonText) throw new Error("Respuesta vacía");
            
            const parsedJson = JSON.parse(jsonText);
            const mensaje = parsedJson.mensaje;

            if (typeof mensaje === 'string' && mensaje.length > 0) {
                return mensaje;
            }
            throw new Error("Mensaje inválido");

        } catch (error) {
            console.warn(`Intento ${i + 1} de mensaje coach fallido:`, error.message);
            if (i === MAX_RETRIES - 1) {
                // Mensaje de fallback si falla la IA
                return "📊 Sigue registrando tus comidas para recibir retroalimentación personalizada.";
            }
            await new Promise(resolve => setTimeout(resolve, Math.pow(2, i) * 1000));
        }
    }
    return "📊 Sigue registrando tus comidas para recibir retroalimentación personalizada.";
}

/**
 * Sanitiza HTML permitiendo solo tags seguros
 * @param {string} html - HTML a sanitizar
 * @returns {string} HTML sanitizado
 */
function sanitizeHTML(html) {
    // Lista blanca de tags permitidos
    const allowedTags = ['br', 'strong', 'b', 'i', 'em', 'span'];
    
    // Crear un elemento temporal
    const temp = document.createElement('div');
    temp.innerHTML = html;
    
    // Eliminar cualquier tag que no esté en la lista blanca
    const allElements = temp.getElementsByTagName('*');
    for (let i = allElements.length - 1; i >= 0; i--) {
        const element = allElements[i];
        if (!allowedTags.includes(element.tagName.toLowerCase())) {
            // Reemplazar el tag no permitido con su contenido de texto
            element.replaceWith(element.textContent);
        }
    }
    
    // Eliminar cualquier atributo (onclick, onerror, etc.)
    for (let element of temp.getElementsByTagName('*')) {
        while (element.attributes.length > 0) {
            element.removeAttribute(element.attributes[0].name);
        }
    }
    
    return temp.innerHTML;
}

function calcularMacrosDia(log_consumido) {
    let prote = 0, carbs = 0, grasas = 0, fibra = 0, ultraprocesados = 0;

    log_consumido.forEach(item => {
        prote += item.proteinas || 0;
        carbs += item.carbohidratos || 0;
        grasas += item.grasas || 0;
        fibra += item.fibra || 0;
        if (item.procesado === 'ultraprocesado') ultraprocesados++;
    });

    return {
        proteinas_dia: prote,
        carbohidratos_dia: carbs,
        grasas_dia: grasas,
        fibra_dia: fibra,
        ultraprocesados_dia: ultraprocesados
    };
}


// Función actualizada para generar mensaje del coach
async function generarMensajeCoach(consumido, gastado, perfilUsuario) {
    const balance = consumido - gastado;
    const deficit_esperado = perfilUsuario.tdee - perfilUsuario.calorias_objetivo;
    const deficit_real = perfilUsuario.tdee - balance;

    const data = weekData[selectedDay] || {
        consumido: 0,
        gastado: 0,
        log_consumido: [],
        log_gastado: []
    };
    
    currentLogData = data;

     console.log("generarMensajeCoach")
    console.log(data)

    const { 
        proteinas_dia, 
        carbohidratos_dia, 
        grasas_dia, 
        fibra_dia, 
        ultraprocesados_dia 
    }    = calcularMacrosDia(currentLogData.log_consumido);

    
    const systemPrompt = `Actúa como un nutricionista y coach personal profesional, especializado en nutrición basada en evidencia, guías internacionales (EFSA, FDA, ISSN) y el enfoque práctico del nutricionista Francis Holway.
Tu prioridad es generar recomendaciones científicamente válidas y personalizadas, evitando mitos, exageraciones y cualquier afirmación sin respaldo empírico.

PERFIL DEL USUARIO:
- Nombre: ${activePersonName}
- Edad: ${perfilUsuario.edad} años
- Sexo: ${perfilUsuario.sexo}
- Peso actual: ${perfilUsuario.peso_actual} kg
- Peso objetivo: ${perfilUsuario.peso_objetivo} kg
- Altura: ${perfilUsuario.altura} cm
- Nivel de actividad: ${perfilUsuario.nivel_actividad}
- TMB (metabolismo basal): ${perfilUsuario.tmb} kcal/día
- TDEE (gasto diario total): ${perfilUsuario.tdee} kcal/día
- Objetivo calórico: ${perfilUsuario.calorias_objetivo} kcal/día
- Meta: ${perfilUsuario.objetivo} a ${perfilUsuario.ritmo_semanal} kg/semana

DATOS DEL DÍA:
- Calorías consumidas: ${consumido} kcal
- Calorías gastadas (ejercicio): ${gastado} kcal
- Balance neto: ${balance} kcal
- Déficit real vs TDEE: ${deficit_real} kcal
- Déficit esperado: ${deficit_esperado} kcal

MACRONUTRIENTES DEL DÍA:
- Proteínas ingeridas: ${proteinas_dia} g
- Carbohidratos ingeridos: ${carbohidratos_dia} g
- Grasas ingeridas: ${grasas_dia} g
- Fibra ingerida: ${fibra_dia} g
- Alimentos ultraprocesados: ${ultraprocesados_dia}


REGLAS DE RESPUESTA (muy importantes):
- Utiliza únicamente afirmaciones consistentes con evidencia científica.
- No inventes datos fisiológicos ni valores nutricionales.
- Sé preciso, directo y orientado a decisiones accionables.
- Evita lenguaje alarmista; prioriza la claridad y la adherencia.
- Mantén un tono profesional, motivador y equilibrado.`;

    const userQuery = `INSTRUCCIONES:
1. Evalúa si el usuario está cumpliendo su objetivo calórico.
2. Proporciona retroalimentación específica y personalizada basada en los datos.
3. Si está muy por encima o por debajo del objetivo, sugiere ajustes concretos, seguros y razonables.
4. Sé motivador pero honesto.
5. Responde en formato de items enumerados de forma obligatoria (máximo 5 items), que estos items tengan maximo 3 oraciones, y en cada item enumerado un salto de linea html.
6. Usa emojis relevantes, sin saturar.
7. Si hay información de macronutrientes o calidad nutricional, intégrala en la evaluación de manera breve.
8. Puedes usar <strong> para resaltar palabras importantes
`;
    return await fetchGeminiCoachMessage(systemPrompt, userQuery);
}



// --- Renderizado de Log ---
async function renderSelectedDay() {
    const data = weekData[selectedDay] || {
        consumido: 0,
        gastado: 0,
        log_consumido: [],
        log_gastado: []
    };
    console.log("renderSelectedDay")
    console.log(data)
    currentLogData = data;

    const isToday = selectedDay === todayISO;
    
    // Verificar si es día futuro
    const selectedDate = new Date(selectedDay + 'T00:00:00');
    const today = new Date(todayISO + 'T00:00:00');
    const isFutureDay = selectedDate > today;
    
    elements.selectedDayDisplay.textContent = isToday ? "Hoy" : formatDate(selectedDay);
    elements.currentDateDisplay.textContent = selectedDay;

    const forms = [elements.registroConsumoForm, elements.registroGastoForm];
    const inputs = [elements.descripcionConsumo, elements.descripcionGasto];
    const buttons = [elements.submitConsumoButton, elements.submitGastoButton];

    // Deshabilitar solo si es día futuro
    if (isFutureDay) {
        forms.forEach(form => form.style.opacity = '0.5');
        inputs.forEach(input => {
            input.disabled = true;
            input.placeholder = "No se puede registrar en días futuros";
        });
        buttons.forEach(btn => btn.disabled = true);
    } else {
        forms.forEach(form => form.style.opacity = '1');
        inputs.forEach(input => {
            input.disabled = false;
            input.placeholder = input.id.includes('Consumo') 
                ? "Ej: Tostadas con palta" 
                : "Ej: 30 min de correr";
        });
        buttons.forEach(btn => btn.disabled = false);
    }

    const consumed = data.consumido || 0;
    const expended = data.gastado || 0;
    const netBalance = Number((consumed - expended).toFixed(2));

    
    // ✅ RENDERIZAR INMEDIATAMENTE los números
    elements.totalConsumido.textContent = consumed;
    elements.totalGastado.textContent = expended;
    elements.netBalance.textContent = netBalance;

    // ✅ RENDERIZAR INMEDIATAMENTE el log
    renderCombinedLog(data.log_consumido, data.log_gastado);

    // ✅ MOSTRAR LA UI INMEDIATAMENTE
    elements.loadingIndicator.style.display = 'none';
    elements.summaryContent.style.display = 'block';

    // ✅ AHORA SÍ: Generar mensaje del coach de forma asíncrona (NO bloqueante)
    const perfilUsuarioOnline = perfilUsuario[activePersonId];

    if (consumed === 0 && expended === 0) {
        elements.coachMessage.textContent = `No hay registros para ${isToday ? 'hoy' : formatDate(selectedDay)}.`;
    } else if (perfilUsuarioOnline) {
        // Mostrar indicador de carga
        elements.coachMessage.innerHTML = `
            <div class="d-flex align-items-center gap-2">
                <div class="spinner-border spinner-border-sm text-primary" role="status">
                    <span class="visually-hidden">Cargando...</span>
                </div>
                <span>Analizando tu día...</span>
            </div>
        `;
        
        // Generar mensaje en background (sin await en esta función)
        generarMensajeCoach(consumed, expended, perfilUsuarioOnline)
            .then(message => {
                elements.coachMessage.innerHTML  = sanitizeHTML(message);
            })
            .catch(error => {
                console.error("Error generando mensaje del coach:", error);
                elements.coachMessage.textContent = `Balance del día: ${netBalance > 0 ? '+' : ''}${netBalance} Kcal.`;
            });
    } else {
        // Mensaje básico si no hay perfil configurado
        let message = '';
        if (netBalance > 500) {
            message = `⚠️ Balance alto: +${netBalance} Kcal. Considera más actividad física.`;
        } else if (netBalance <= 0 && netBalance > -500) {
            message = `✅ Excelente día. Balance equilibrado: ${netBalance} Kcal.`;
        } else if (netBalance <= -500) {
            message = `💪 Déficit importante: ${netBalance} Kcal. ¡Buen trabajo!`;
        } else {
            message = `Balance del día: ${netBalance > 0 ? '+' : ''}${netBalance} Kcal.`;
        }
        elements.coachMessage.textContent = message;
    }
}


const MEAL_TIMES = {
    DESAYUNO: { start: 5, end: 11 },
    COLACION_MANANA: { start: 11, end: 12 },
    ALMUERZO: { start: 12, end: 15 },
    MERIENDA: { start: 15, end: 18 },
    CENA: { start: 18, end: 22 },
    COLACION_NOCHE: { start: 22, end: 24 }
};

function getMealCategory(dateObj) {
    const hour = dateObj.getHours();

    if (hour >= MEAL_TIMES.DESAYUNO.start && hour < MEAL_TIMES.DESAYUNO.end) {
        return 'Desayuno';
    } else if (hour >= MEAL_TIMES.COLACION_MANANA.start && hour < MEAL_TIMES.COLACION_MANANA.end) {
        return 'Colación';
    } else if (hour >= MEAL_TIMES.ALMUERZO.start && hour < MEAL_TIMES.ALMUERZO.end) {
        return 'Almuerzo';
    } else if (hour >= MEAL_TIMES.MERIENDA.start && hour < MEAL_TIMES.MERIENDA.end) {
        return 'Merienda';
    } else if (hour >= MEAL_TIMES.CENA.start && hour < MEAL_TIMES.CENA.end) {
        return 'Cena';
    } else {
        return 'Colación';
    }
}

function renderCombinedLog(logConsumed, logExpended) {
    elements.foodLog.innerHTML = '';
    
    const combinedLog = [
        ...(logConsumed || []).map(item => ({
            ...item,
            type: 'consumo',
            sortKey: new Date(item.hora).getTime() // CAMBIO: time -> hora
        })),
        ...(logExpended || []).map(item => ({
            ...item,
            type: 'gasto',
            sortKey: new Date(item.hora).getTime() // CAMBIO: time -> hora
        }))
    ];
    
    if (combinedLog.length === 0) {
        elements.emptyLogMessage.style.display = 'block';
        return;
    }
    elements.emptyLogMessage.style.display = 'none';

    const sortedLog = combinedLog.sort((a, b) => a.sortKey - b.sortKey);

    sortedLog.forEach(item => {
        const dateObj = new Date(item.hora); // CAMBIO: time -> hora
        const time = dateObj.toLocaleTimeString('es-AR', { 
            hour: '2-digit', 
            minute: '2-digit',
            hour12: false
        });
        const isConsumption = item.type === 'consumo';
        const badgeClass = isConsumption ? 'bg-success' : 'bg-danger';
        const sign = isConsumption ? '+' : '-';
        const mealCategory = isConsumption ? getMealCategory(dateObj) : 'Ejercicio';
        
        const listItem = document.createElement('div');
        listItem.className = 'log-item-card animate-in';
        
        const deleteButtonHTML = (selectedDay === todayISO) ? `
            <button type="button" class="delete-btn" 
                onclick="window.deleteLogItem('${item.type}', '${item.id}', ${item.kcal})" 
                aria-label="Eliminar registro">
                <i class="fas fa-trash"></i>
            </button>
        ` : '';

        listItem.innerHTML = `
            <div class="d-flex justify-content-between align-items-start gap-3">
                <div class="flex-grow-1 min-w-0">
                    <div class="meal-category mb-1">
                        ${mealCategory}
                        <span class="meal-time ms-2">${time}</span>
                    </div>
                    <div class="meal-description">${item.descripcion}</div>
                </div>
                <div class="d-flex flex-column align-items-end gap-2">
                    <span class="badge calorie-badge ${badgeClass}">
                        ${sign}${item.kcal} Kcal
                    </span>
                    ${deleteButtonHTML}
                </div>
            </div>
        `;
        elements.foodLog.appendChild(listItem);
    });
}

// --- Eliminación de Items ---

async function deleteLogItem(type, itemId, kcalValue) {
    if (!userId || !db || selectedDay !== todayISO) {
        elements.coachMessage.textContent = "❌ Solo puedes eliminar registros de hoy.";
        return;
    }

    const docRef = getDailyDocRef(selectedDay);
    const logKey = type === 'consumo' ? 'log_consumido' : 'log_gastado';
    const totalKey = type === 'consumo' ? 'consumido' : 'gastado';
    
    elements.coachMessage.textContent = `Eliminando registro...`;

    try {
        const currentData = currentLogData;
        const updatedLog = (currentData[logKey] || []).filter(item => item.id !== itemId);
        const newTotal = Math.max(0, (currentData[totalKey] || 0) - kcalValue);

        const updateObject = {};
        updateObject[totalKey] = newTotal;
        updateObject[logKey] = updatedLog;

        await setDoc(docRef, updateObject, { merge: true });
        elements.coachMessage.textContent = `✅ Registro eliminado correctamente.`;

    } catch (error) {
        console.error(`Error al eliminar:`, error);
        elements.coachMessage.textContent = `❌ Error al eliminar: ${error.message}`;
    }
}

// --- Modal de Detalles ---

function showLogDetails(type) {
    const isConsumption = type === 'consumo';
    const log = isConsumption ? currentLogData.log_consumido : currentLogData.log_gastado;
    const total = isConsumption ? currentLogData.consumido : currentLogData.gastado;
    const dateFormatted = formatDate(selectedDay);
    const diaNombre = getDayNameShort(selectedDay);
    const title = isConsumption 
        ? `Consumo de ${activePersonName} (${diaNombre}, ${dateFormatted}) ` 
        : `Gasto de ${activePersonName}  (${diaNombre}, ${dateFormatted})`;
    const totalLabel = isConsumption ? 'Total Consumido' : 'Total Gastado';
    const totalColorClass = isConsumption ? 'bg-success' : 'bg-danger';

    elements.logDetailsModalTitle.textContent = title;
    elements.modalTotalLabel.textContent = totalLabel;
    elements.modalTotalValue.textContent = `${total} Kcal`;
    elements.modalTotalValue.className = `px-4 py-2 text-white fw-bold rounded-pill ${totalColorClass}`;

    elements.modalLogContent.innerHTML = '';
    const canDelete = selectedDay === todayISO;

    if (log.length === 0) {
        elements.modalLogContent.innerHTML = `
            <p class="text-center text-muted p-4">No hay registros.</p>
        `;
    } else {
        const sortedLog = log.sort((a, b) => new Date(b.hora) - new Date(a.hora));

        sortedLog.forEach(item => {
            const time = new Date(item.hora).toLocaleTimeString('es-AR', { 
                hour: '2-digit', 
                minute: '2-digit',
                hour12: false
            });
            const sign = isConsumption ? '+' : '-';
            const badgeClass = isConsumption ? 'bg-success' : 'bg-danger';
            
            const deleteButton = canDelete ? `
                <button type="button" class="delete-btn" 
                    onclick="window.deleteLogItem('${type}', '${item.id}', ${item.kcal}); elements.logDetailsModal.hide();">
                    <i class="fas fa-trash"></i>
                </button>
            ` : '';

            const listItem = document.createElement('div');
            listItem.className = 'log-item-card';
            listItem.innerHTML = `
                <div class="d-flex justify-content-between align-items-center gap-3">
                    <div class="flex-grow-1 min-w-0">
                        <div class="meal-category">${item.descripcion}</div>
                        <div class="meal-time">${time}</div>
                    </div>
                    <div class="d-flex align-items-center gap-2">
                        <span class="badge calorie-badge ${badgeClass}">
                            ${sign}${item.kcal} Kcal
                        </span>
                        ${deleteButton}
                    </div>
                </div>
            `;
            elements.modalLogContent.appendChild(listItem);
        });
    }

    elements.logDetailsModal.show();
}

function setupSummaryClickHandlers() {
    elements.consumidoBox.addEventListener('click', () => showLogDetails('consumo'));
    elements.gastadoBox.addEventListener('click', () => showLogDetails('gasto'));
}

// --- Botones de Persona ---

function setActiveButtonVisuals(personId) {
    elements.selectValentinBtn.classList.remove('active-person');
    elements.selectSofiaBtn.classList.remove('active-person');

    if (personId === 'valentin') {
        elements.selectValentinBtn.classList.add('active-person');
    } else if (personId === 'sofia') {
        elements.selectSofiaBtn.classList.add('active-person');
    }
}

function setupPersonButtons() {
    activePersonId = PEOPLE[0].id;
    activePersonName = PEOPLE[0].name;
    updateActiveUserUI();
    setActiveButtonVisuals(activePersonId);

    const changePerson = (id, name) => {
        if (activePersonId !== id) {
            activePersonId = id;
            activePersonName = name;
            updateActiveUserUI();
            currentWeekStart = getWeekStart(new Date());
            selectedDay = todayISO;
            updateWeekUI();
            setupRealtimeListener();
        }
    };

    elements.selectValentinBtn.addEventListener('click', () => changePerson('valentin', 'Valentín'));
    elements.selectSofiaBtn.addEventListener('click', () => changePerson('sofia', 'Sofía'));
}

function parseNutriResponse(raw) {
    if (!raw) return null;

    // Si Gemini devolvió solo un número (ej: "1200")
    if (!isNaN(raw)) {
        const kcal = Number(raw);
        return {
            kcal,
            proteinas: 0,
            carbohidratos: 0,
            grasas: 0,
            fibra: 0,
            procesado: "desconocido"
        };
    }

    if (typeof raw !== "string") return null;

    // Intentar extraer JSON del texto
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;

    try {
        const parsed = JSON.parse(match[0]);

        return {
            kcal: Number(parsed.kcal) || 0,
            proteinas: Number(parsed.proteinas) || 0,
            carbohidratos: Number(parsed.carbohidratos) || 0,
            grasas: Number(parsed.grasas) || 0,
            fibra: Number(parsed.fibra) || 0,
            procesado: parsed.procesado ?? "desconocido"
        };

    } catch (e) {
        console.error("JSON parse error:", e);
        return null;
    }
}


const FOOD_SCHEMA = {
    type: "OBJECT",
    properties: {
        "kcal": { "type": "NUMBER" },
        "proteinas": { "type": "NUMBER" },
        "carbohidratos": { "type": "NUMBER" },
        "grasas": { "type": "NUMBER" },
        "fibra": { "type": "NUMBER" },
        "procesado": { 
            "type": "STRING",
            "enum": ["natural", "procesado", "ultraprocesado"]
        }
    },
    required: ["kcal","proteinas","carbohidratos","grasas","fibra","procesado"]
};
const EXPENDITURE_SCHEMA = {
    type: "OBJECT", 
    properties: { 
        "kcal": { "type": "NUMBER" } 
    },
    required: ["kcal"]
};


// --- Integración con Gemini ---
async function fetchGeminiFoodData(foodDescription) {
    const systemPrompt = `
Eres un analizador experto de alimentos y nutrición basado en datos reales (USDA, FAO, BEDCA).
Debes responder SIEMPRE con JSON válido y NADA fuera del JSON.

FORMATO OBLIGATORIO:
{
  "kcal": number,
  "proteinas": number,
  "carbohidratos": number,
  "grasas": number,
  "fibra": number,
  "procesado": "natural" | "procesado" | "ultraprocesado"
}

REGLAS:
- Nunca respondas con un solo número.
- No omitas campos.
- No agregues texto fuera del JSON.
- Si falta información, aproxima con valores realistas.
- Si el alimento es casero, clasifícalo con NOVA.
- Si el usuario no da cantidades, usa una porción estándar.
    `;

    const userQuery = `Analiza nutricionalmente esta descripción: "${foodDescription}"`;

    const rawResponse = await sendGeminiRequest(systemPrompt, userQuery, FOOD_SCHEMA);
    console.log("fetchGeminiFoodData RAW GEMINI RESPONSE:", rawResponse);

    // --- 1. Validación: Gemini NO debe devolver solo un número ---
    if (typeof rawResponse === "number") {
        console.warn("Gemini devolvió un número aislado. Corrigiendo…");
        return {
            kcal: rawResponse,
            proteinas: 0,
            carbohidratos: 0,
            grasas: 0,
            fibra: 0,
            procesado: "desconocido"
        };
    }

    // --- 2. Extraer JSON de manera segura ---
    let extractedJson = rawResponse;

    if (typeof rawResponse === "string") {
        const match = rawResponse.match(/\{[\s\S]*\}/);
        if (match) extractedJson = match[0];
    }

    console.log("EXTRACTED JSON:", extractedJson);

    try {
        return extractedJson;
    } catch (e) {
        console.error("ERROR PARSEANDO JSON NUTRICIONAL:", e);

        return {
            kcal: 0,
            proteinas: 0,
            carbohidratos: 0,
            grasas: 0,
            fibra: 0,
            procesado: "desconocido"
        };
    }
}

// no se usa
async function fetchGeminiCalories(foodDescription) {
    const systemPrompt = "Eres un calculador experto de calorías. Estima las calorías (Kcal) de una porción típica o la cantidad especificada. Responde SOLO con JSON según el schema.";
    const userQuery = `Estimar calorías para: ${foodDescription}`;
    return await sendGeminiRequest(systemPrompt, userQuery, FOOD_SCHEMA);
}

async function fetchGeminiExpenditure(activityDescription) {
    const systemPrompt = "Eres un experto en fitness. Estima las calorías quemadas (Kcal) según la actividad descrita. Responde SOLO con JSON según el schema.";
    const userQuery = `Estimar calorías quemadas en: ${activityDescription}`;
    return await sendGeminiRequest(systemPrompt, userQuery, EXPENDITURE_SCHEMA);
}

async function sendGeminiRequest(systemPrompt, userQuery, responseSchema) {
    const payload = {
        contents: [{ parts: [{ text: userQuery }] }],
        systemInstruction: { parts: [{ text: systemPrompt }] },
        generationConfig: {
            responseMimeType: "application/json",
            responseSchema: responseSchema
        }
    };

    const url = `${GEMINI_API_URL}?key=${API_KEY}`;
    const MAX_RETRIES = 3;

    for (let i = 0; i < MAX_RETRIES; i++) {
        try {
            const response = await fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const result = await response.json();
            const jsonText = result?.candidates?.[0]?.content?.parts?.[0]?.text;

            if (!jsonText) throw new Error("Respuesta vacía");

            const parsed = JSON.parse(jsonText);
            return parsed;

        } catch (error) {
            console.warn(`Intento ${i + 1} fallido:`, error.message);
            if (i === MAX_RETRIES - 1) throw error;
            await new Promise(res => setTimeout(res, Math.pow(2, i) * 1000));
        }
    }

    throw new Error("Fallo en AI");
}

// --- Manejadores de Formularios ---
elements.registroConsumoForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    // CAMBIO: Bloquear solo días futuros
    const selectedDate = new Date(selectedDay + 'T00:00:00');
    const today = new Date(todayISO + 'T00:00:00');
    if (selectedDate > today) return; // Solo bloquear futuros

    const descripcion = elements.descripcionConsumo.value.trim();
    if (descripcion.length < 3 || !userId) return;

    elements.submitConsumoButton.disabled = true;
    elements.apiConsumoLoading.style.display = 'flex';

    let datosNutricionales = '';

    try {
        // caloriasObtenidas = await fetchGeminiCalories(descripcion);
        let datosNutricionales = await fetchGeminiFoodData(descripcion);
        console.log("datosNutricionales:", datosNutricionales);

        if (!datosNutricionales) {
            elements.coachMessage.textContent = "❌ No se pudo interpretar la respuesta nutricional.";
            return;
        }

         // CAMBIO: Usar selectedDay en lugar de todayISO
    const docRef = getDailyDocRef(selectedDay);

    try {
        const currentData = weekData[selectedDay]; // CAMBIO AQUÍ
        const nuevoConsumido = (currentData.consumido || 0) + datosNutricionales.kcal;

        const nuevoItem = { 
            id: crypto.randomUUID(),
            hora: new Date().toISOString(),
            descripcion: descripcion,
            kcal: datosNutricionales.kcal,
            proteinas: datosNutricionales.proteinas,
            carbohidratos: datosNutricionales.carbohidratos,
            grasas: datosNutricionales.grasas,
            fibra: datosNutricionales.fibra,
            procesado: datosNutricionales.procesado
        };
        
        console.log("DEBUG nuevoItem:", nuevoItem);
        
        await setDoc(docRef, { 
            consumido: nuevoConsumido, 
            log_consumido: (currentData.log_consumido || []).concat([nuevoItem])
        }, { merge: true });

        e.target.reset();
        elements.coachMessage.textContent = `✅ Consumo registrado: +${datosNutricionales.kcal} Kcal`;
    } catch (error) {
        console.error("Error al guardar consumo en Firestore:", error);
        elements.coachMessage.textContent = `❌ Error al guardar: ${error.message}`;
    }

    } catch (error) {
        console.error("Error al obtener datos nutricionales:", error);
        elements.coachMessage.textContent = `⚠️ Error al obtener datos nutricionales ⚠️`;
    } finally {
        elements.apiConsumoLoading.style.display = 'none';
        elements.submitConsumoButton.disabled = false;
    }
    
    

   
});


elements.registroGastoForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    // CAMBIO: Bloquear solo días futuros
    const selectedDate = new Date(selectedDay + 'T00:00:00');
    const today = new Date(todayISO + 'T00:00:00');
    if (selectedDate > today) return; // Solo bloquear futuros

    const descripcion = elements.descripcionGasto.value.trim();
    if (descripcion.length < 3 || !userId) return;

    elements.submitGastoButton.disabled = true;
    elements.apiGastoLoading.style.display = 'flex';

    let caloriasObtenidas = 0;
    let dataGastado = {};

    try {
        dataGastado = await fetchGeminiExpenditure(descripcion);
    } catch (error) {
        console.error("Error en el cálculo de gasto:", error);
        elements.coachMessage.textContent = `⚠️ Error en IA. Usando 200 Kcal como respaldo.`;
    } finally {
        elements.apiGastoLoading.style.display = 'none';
        elements.submitGastoButton.disabled = false;
    }
    
    if (dataGastado.kcal === 0) {
        elements.coachMessage.textContent = `❌ No se pudo calcular el gasto. Intenta ser más específico.`;
        return;
    }

    caloriasObtenidas = dataGastado.kcal;

    // CAMBIO: Usar selectedDay en lugar de todayISO
    const docRef = getDailyDocRef(selectedDay);

    try {
        const currentData = weekData[selectedDay]; // CAMBIO AQUÍ
        const nuevoGastado = (currentData.gastado || 0) + caloriasObtenidas;

        const nuevoItem = { 
            id: crypto.randomUUID(), 
            hora: new Date().toISOString(), 
            descripcion: descripcion, 
            kcal: caloriasObtenidas 
        };
        
        await setDoc(docRef, { 
            gastado: nuevoGastado, 
            log_gastado: (currentData.log_gastado || []).concat([nuevoItem])
        }, { merge: true });

        e.target.reset();
        elements.coachMessage.textContent = `✅ Gasto registrado: -${caloriasObtenidas} Kcal`;
    } catch (error) {
        console.error("Error al guardar gasto en Firestore:", error);
        elements.coachMessage.textContent = `❌ Error al guardar: ${error.message}`;
    }
});



// --- Ejecución Inicial ---
initializeFirebase();