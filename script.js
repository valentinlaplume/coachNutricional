// --- Importaciones de Firebase ---
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInAnonymously, signInWithCustomToken } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, 
    doc, 
    setDoc, 
    onSnapshot, 
    collection, 
    query, 
    getDocs, 
    orderBy, 
    where, 
    Timestamp, 
    limit // Añadimos limit para la optimización
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

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
        nivel_actividad: 'moderado', // sedentario, ligero, moderado, activo, muy_activo // quitar
        objetivo: 'definición', // perder_peso, mantener, ganar_musculo
        ritmo_semanal: 0.5, // kg por semana

        // Calculados automáticamente:
        tmb: 1750,
        tdee: 2712,
        calorias_objetivo: 2212, // TDEE - 500 (para perder 0.5kg/semana)
        fecha_actualizacion: '2025-11-26',

        // NUEVA ADICIÓN: Rangos objetivo de macros para guiar la distribución (en %)
        proteina_min: 105, // 75 * 1.4 = 
        proteina_max: 165, // 75 * 2.2 
        carbos_rango_porcentaje: '40-50%', // NUEVA ADICIÓN
        grasas_rango_porcentaje: '25-35%', // NUEVA ADICIÓN

        // --- 2. PREFERENCIAS Y RESTRICCIONES NUTRICIONALES ---
        preferencias: {
            evita_ultraprocesados: true,

            alergias_medicas: ['ninguna'],
            cantidad_comidas_al_dia: 4, 
            habilidades_cocina: 'básico', 

            suplementos_actuales: ['creatina'],
        },
        
        // --- 3. CONTEXTO FITNESS Y RENDIMIENTO ---
        fitness: { 
            nivel_actividad: 'moderado', // sedentario, ligero, moderado, activo, muy_activo
            tipo_entrenamiento: 'Fuerza (4 días) + Cardio (1 día)', 
            frecuencia_semanal: 5, 
            horario_entrenamiento: 'Tarde (17:30h)', 
            experiencia_entrenamiento: 'Intermedio-Avanzado', 

            // CORRECCIÓN: Necesitamos un objetivo cuantificable, no solo estético
            objetivo_estetico: 'Hombros, espalda y abdominales marcados', 
            objetivo_rendimiento_cuantificable: 'Ser mas atlético', // NUEVA ADICIÓN
        },
        
        // --- 4. SOSTENIBILIDAD Y HÁBITOS DE VIDA ---
        salud_y_sostenibilidad: { 
            nivel_estres_dia: 4, // Escala 1-10
            hora_habitual_dormir: '12:30', // Para evaluar si hay tiempo de recovery
            hora_habitual_despertar: '08:30', // Para establecer el inicio del ayuno/alimentación

            tiempo_libre_cocina_semanal: '40 mins por dia',
            dias_flexibilidad_preferidos: ['Sábado noche', 'Domingo tarde/noche'],
        },
        
        preferencias_alimentarias: 
        {
            // 1. Opciones Fáciles/Rápidas (Para correcciones de déficit y snacks)
            opciones_rapidas_faciles: [
                "Huevo (hervido, revuelto, en todas las versiones)",
                "Yogurt casero natural (puede ser con: fruta, soja texturizada)",
                "Atún en lata",
                "Frutas de todo tipo",
                "Ricota (como snack o para untar)"
            ],

            // 2. Fuentes de Carbohidratos para Energía y Fibra (Pre/Post-entrenamiento)
            carbohidratos_favoritos: [
                "Pan integral de masa madre con mix semillas en el borde",
                "Frutas de todo tipo",
                "Zapallo",
                "Papa",
                "Batata",
                "Arvejas",
                "Lentejas"
            ],

            // 3. Fuentes de Proteína Principal (Para alcanzar los objetivos diarios)
            proteinas_favoritas: [
                "Pollo (cualquier corte)",
                "Carne (cualquier corte)",
                "Pescado",
                "Atún en lata",
                "Huevo",
                "Ricota",
                "Soja texturizada",
                "Yogurt casero natural"
            ],

            // 4. Ingredientes Base y Complementos (Para la calidad nutricional)
            ingredientes_base_complementos: [
                "Verduras (Espinaca, Zapallo, Papa, Batata, Cebolla, Morrón)",
                "Salsa de tomate",
                "Miel (para endulzar/energía)",
                "Café",
                "Mate argentino",
                "Agua"
            ],

            // 5. Platos o Preparaciones Favoritas (Para sugerencias de comidas completas)
            platos_favoritos_completos: [
                "Tarta de espinaca mixeada con pollo",
                "Lentejas (guiso/estofado)",
                "Preparaciones con Soja Texturizada"
            ],

            preferencias_de_verduras: [
                'espinaca', 'zapallo', 'papa', 'morrón', 'cebolla', 
                'salsa de tomate', 'zanahoria', 'batata', 'arvejas', 'lentejas'
            ],
        }
    },
   // futuros usuarios
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

    // --- NUEVOS ELEMENTOS PARA MACROS DIARIOS ---
    proteinasDiaDisplay: document.getElementById('proteinasDia'),
    carbohidratosDiaDisplay: document.getElementById('carbohidratosDia'),
    grasasDiaDisplay: document.getElementById('grasasDia'),
    fibraDiaDisplay: document.getElementById('fibraDia'),
    ultraprocesadosDiaDisplay: document.getElementById('ultraprocesadosDia'),
    
    // --- NUEVOS ELEMENTOS PARA METAS DIARIAS (Progreso) ---
    proteinaProgress: document.getElementById('proteinaProgress'),
    carbohidratosProgress: document.getElementById('carbohidratosProgress'),
    grasasProgress: document.getElementById('grasasProgress'),
    kcalTargetProgress: document.getElementById('kcalTargetProgress'), // Muestra Consumido / Objetivo
    kcalRestanteDisplay: document.getElementById('kcalRestanteDisplay'), // Opcional, para el feedback extra
    
    
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

        const userId_valentin = '8GWJpR3XAnWY4uZW87CDsMSDbRD3';
        const userId_sofia = 'jcyKJTaWuKTc2Kb51Zbj7q5yPr62';

        
        userId = (activePersonId === 'valentin' ? userId_valentin : userId_sofia) || auth.currentUser?.uid
        console.log(auth)
        console.log(auth.currentUser)
        console.log(activePersonId)
        console.log(userId)
        console.log(typeof(userId))

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

function calcularMacrosDia_OLD(log_consumido) {
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
/**
 * Calcula la suma total de macronutrientes y las Kcal de ultraprocesados para el día.
 * @param {Array<Object>} log_consumido - El log de comidas consumidas.
 * @returns {Object} Un objeto con las sumas totales de macros y Kcal de ultraprocesados.
 */
function calcularMacrosDia(log_consumido) {
    if (!log_consumido || log_consumido.length === 0) {
        return {
            proteinas_dia: 0,
            carbohidratos_dia: 0,
            grasas_dia: 0,
            fibra_dia: 0,
            ultraprocesados_dia: 0, // Esto son Kcal
        };
    }

    const totales = log_consumido.reduce((acc, item) => {
        acc.proteinas_dia += item.proteinas || 0;
        acc.carbohidratos_dia += item.carbohidratos || 0;
        acc.grasas_dia += item.grasas || 0;
        acc.fibra_dia += item.fibra || 0;
        
        // LÓGICA CORREGIDA: Sumar Kcal SOLO si es 'ultraprocesado'
        if (item.procesado === 'ultraprocesado') { 
            acc.ultraprocesados_dia += item.kcal || 0; 
        }
        
        return acc;
    }, {
        proteinas_dia: 0,
        carbohidratos_dia: 0,
        grasas_dia: 0,
        fibra_dia: 0,
        ultraprocesados_dia: 0,
    });

    // Redondeo para todas las propiedades
    Object.keys(totales).forEach(key => {
        totales[key] = parseFloat(totales[key].toFixed(1));
    });

    return totales;
}


// // Función actualizada para generar mensaje del coach
// async function generarMensajeCoach(consumido, gastado, perfilUsuario) {
//     const balance = consumido - gastado;
//     const deficit_esperado = perfilUsuario.tdee - perfilUsuario.calorias_objetivo;
//     const deficit_real = perfilUsuario.tdee - balance;

//     const data = weekData[selectedDay] || {
//         consumido: 0,
//         gastado: 0,
//         log_consumido: [],
//         log_gastado: []
//     };
    
//     currentLogData = data;

//      console.log("generarMensajeCoach")
//     console.log(data)

//     const { 
//         proteinas_dia, 
//         carbohidratos_dia, 
//         grasas_dia, 
//         fibra_dia, 
//         ultraprocesados_dia 
//     }    = calcularMacrosDia(currentLogData.log_consumido);

    
//     const systemPrompt = `Actúa como un nutricionista y coach personal profesional, especializado en nutrición basada en evidencia, guías internacionales (EFSA, FDA, ISSN) y el enfoque práctico del nutricionista Francis Holway.
// Tu prioridad es generar recomendaciones científicamente válidas y personalizadas, evitando mitos, exageraciones y cualquier afirmación sin respaldo empírico.

// PERFIL DEL USUARIO:
// - Nombre: ${activePersonName}
// - Edad: ${perfilUsuario.edad} años
// - Sexo: ${perfilUsuario.sexo}
// - Peso actual: ${perfilUsuario.peso_actual} kg
// - Peso objetivo: ${perfilUsuario.peso_objetivo} kg
// - Altura: ${perfilUsuario.altura} cm
// - Nivel de actividad: ${perfilUsuario.nivel_actividad}
// - TMB (metabolismo basal): ${perfilUsuario.tmb} kcal/día
// - TDEE (gasto diario total): ${perfilUsuario.tdee} kcal/día
// - Objetivo calórico: ${perfilUsuario.calorias_objetivo} kcal/día
// - Meta: ${perfilUsuario.objetivo} a ${perfilUsuario.ritmo_semanal} kg/semana

// DATOS DEL DÍA:
// - Calorías consumidas: ${consumido} kcal
// - Calorías gastadas (ejercicio): ${gastado} kcal
// - Balance neto: ${balance} kcal
// - Déficit real vs TDEE: ${deficit_real} kcal
// - Déficit esperado: ${deficit_esperado} kcal

// MACRONUTRIENTES DEL DÍA:
// - Proteínas ingeridas: ${proteinas_dia} g
// - Carbohidratos ingeridos: ${carbohidratos_dia} g
// - Grasas ingeridas: ${grasas_dia} g
// - Fibra ingerida: ${fibra_dia} g
// - Alimentos ultraprocesados: ${ultraprocesados_dia}


// REGLAS DE RESPUESTA (muy importantes):
// - Utiliza únicamente afirmaciones consistentes con evidencia científica.
// - No inventes datos fisiológicos ni valores nutricionales.
// - Sé preciso, directo y orientado a decisiones accionables.
// - Evita lenguaje alarmista; prioriza la claridad y la adherencia.
// - Mantén un tono profesional, motivador y equilibrado.`;

//     const userQuery = `INSTRUCCIONES:
// 1. Evalúa si el usuario está cumpliendo su objetivo calórico.
// 2. Proporciona retroalimentación específica y personalizada basada en los datos.
// 3. Si está muy por encima o por debajo del objetivo, sugiere ajustes concretos, seguros y razonables.
// 4. Sé motivador pero honesto.
// 5. Responde en formato de items enumerados de forma obligatoria (**6 items máximo**). Cada item debe tener máximo 3 oraciones.
// 6. Usa emojis relevantes, sin saturar.
// 7. Si hay información de macronutrientes o calidad nutricional, intégrala en la evaluación de manera breve.
// 8. Puedes usar <strong> para resaltar palabras importantes
// `;
// return await fetchGeminiCoachMessage(systemPrompt, userQuery);

// // 7. **Evaluación Profunda:** Analiza la distribución de macros, la calidad nutricional, la **hidratación total** y la eficacia del **timing nutricional (Pre/Post)** en relación al entrenamiento.
// // 8. **PUNTO DE CONTROL (Solo en Análisis 2):** Si el campo 'CONTEXTO Y RETROALIMENTACIÓN PREVIA' indica que el Análisis 1 está disponible, el **primer ítem enumerado** debe ser un chequeo directo sobre si las correcciones urgentes (ej. aumentar calorías) se implementaron.
// // 9. **Tono (Análisis 1 vs Análisis 2):**
// //    - **Si es un Análisis Parcial (~18:00h):** Tono urgente y proactivo. Enfócate en el riesgo de déficit inminente y las necesidades inmediatas de combustible para la cena.
// //    - **Si es un Análisis Final:** Tono retrospectivo, enfocado en la sostenibilidad, la recuperación y la planificación del día siguiente.
// // `;
// }



/**
 * Guarda el mensaje del coach en Firestore para el día y momento específicos.
 * @param {string} userId - ID del usuario.
 * @param {string} dayISO - Fecha en formato 'YYYY-MM-DD'.
 * @param {string} momentOfDay - 'Desayuno', 'Almuerzo', 'Merienda', 'Cena'.
 * @param {string} message - El mensaje generado por la IA.
 */
async function guardarAnalisisCoach(userId, dayISO, momentOfDay, message) {
    // Referencia a la colección específica del análisis del coach para ese usuario
    const analisisRef = doc(db, `users/${userId}/coach_analysis/${dayISO}-${momentOfDay}`);
    
    // Guardamos el mensaje y la hora de la actualización
    await setDoc(analisisRef, {
        analisis_coach: message,
        momento: momentOfDay,
        timestamp: new Date(),
    });
    console.log(`Análisis del coach para ${dayISO} (${momentOfDay}) guardado.`);
}

/**
 * Obtiene el último mensaje de análisis guardado para un día y momento (o anterior).
 * @param {string} userId - ID del usuario.
 * @param {string} dayISO - Fecha en formato 'YYYY-MM-DD'.
 * @returns {Promise<string>} El contenido del último análisis o cadena vacía.
 */
// --- Asume que las importaciones de arriba se corrigieron ---

async function obtenerUltimoAnalisis(userId, dayISO) {
    // 1. Definir los límites del día usando Firestore Timestamps
    const dayStart = new Date(dayISO + 'T00:00:00'); 
    const dayEnd = new Date(dayISO + 'T23:59:59');
    
    // Aseguramos que la conversión sea a Timestamp de Firestore para el query.
    const startTimestamp = Timestamp.fromDate(dayStart);
    const endTimestamp = Timestamp.fromDate(dayEnd);
    
    // 2. Referencia a la colección
    const analisisColRef = collection(db, `users/${userId}/coach_analysis`);
    
    // 3. Crear la consulta (Query)
    const q = query(
        analisisColRef,
        where("timestamp", ">=", startTimestamp),
        where("timestamp", "<=", endTimestamp),
        orderBy("timestamp", "desc"),
        limit(1) // Usamos 'limit' que ahora está importado
    );
    
    try {
        const querySnapshot = await getDocs(q);
        
        if (!querySnapshot.empty) {
            const docSnap = querySnapshot.docs[0];
            const data = docSnap.data();
            
            if (data && data.analisis_coach) {
                return data.analisis_coach;
            }
        }
    } catch (error) {
        console.error("Error al obtener el último análisis:", error);
    }
    
    return "";
}
/**
 * Genera el mensaje personalizado del coach nutricional basándose en el estado del día.
 * @param {number} consumido - Kcal totales consumidas.
 * @param {number} gastado - Kcal gastadas por ejercicio.
 * @param {Object} perfilUsuario - Objeto con el perfil y metas del usuario.
 * @param {string} momentOfDay - Indica el momento del análisis ('desayuno', 'almuerzo', 'merienda/entreno', 'final').
 * @param {string} [contextoPrevio=''] - Mensaje del análisis anterior para seguimiento (para el ítem 10).
 * @returns {Promise<string>} Mensaje del coach.
 */
async function generarMensajeCoach(consumido, gastado, perfilUsuario, momentOfDay, contextoPrevio = "") {
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

    const { 
        proteinas_dia, 
        carbohidratos_dia, 
        grasas_dia, 
        fibra_dia, 
        ultraprocesados_dia 
    } = calcularMacrosDia(currentLogData.log_consumido);

    // --- Lógica del Prompt Dinámico ---
    let analysisInstructions = "";
    let analysisTone = "";
    const metasKcal = perfilUsuario.calorias_objetivo;

    // 11. Tono y enfoque basado en el momento del día
    switch (momentOfDay) {
        case 'Desayuno':
            analysisTone = "Tono: Proactivo y optimista. Enfócate en el combustible para la mañana. El análisis es 'Parcial'.";
            analysisInstructions = `
                1. Evalúa el aporte de <strong>Proteínas</strong> y <strong>Fibra</strong> del desayuno en relación a la meta de saciedad del día.
                2. Sugiere la estrategia de ingesta para las próximas horas (media mañana o almuerzo), enfocándose en mantener el <strong>déficit bajo control</strong>.
                3. Proporciona una recomendación de hidratación y manejo de ansiedad para la mañana.
                4. **Corrección Urgente:** Si el desayuno es muy bajo en proteínas (menos de 20g), sugiere una adición inmediata.
            `;
            break;
            
        case 'Almuerzo':
            analysisTone = "Tono: Control de mitad de jornada. Evalúa el cumplimiento calórico y de macros de la mañana. El análisis es 'Parcial'.";
            analysisInstructions = `
                1. Evalúa el porcentaje de <strong>macros</strong> y calorías consumidas hasta el mediodía (debe ser aproximadamente el 40-50% de la meta total de ${metasKcal} Kcal).
                2. Si hay un gran desvío, sugiere una <strong>corrección estratégica</strong> en la merienda/cena.
                3. **Análisis Profunda:** Evalúa la calidad nutricional del almuerzo, usando las preferencias alimentarias del usuario para sugerir opciones de snacks o correcciones de la tarde.
                4. Si el usuario entrena por la tarde (${perfilUsuario.fitness.horario_entrenamiento}), establece la estrategia nutricional Pre-entrenamiento (Carbohidratos 40-60 mins antes).
            `;
            break;
            
        case 'Merienda':
            analysisTone = "Tono: Estratégico y de recuperación. Enfócate en la ventana pre/post-entrenamiento. El análisis es 'Parcial'.";
            analysisInstructions = `
                1. Evalúa la adecuación del <strong>timing nutricional</strong> pre-entrenamiento. ¿Hubo suficientes carbohidratos de fácil digestión para el entrenamiento de ${perfilUsuario.fitness.tipo_entrenamiento}?
                2. Proporciona una estrategia de recuperación <strong>Post-entrenamiento</strong> (Proteína + Carbohidratos) para la cena.
                3. **Déficit Inminente:** Si el déficit calórico es muy alto antes de la cena, advierte el riesgo de comer en exceso y sugiere un ajuste en la cena.
                4. Evalúa la ingesta de <strong>Proteínas totales</strong> y la necesidad de un aporte proteico significativo en la cena para alcanzar la meta.
            `;
            break;
            
        case 'Cena':
        default:
            analysisTone = "Tono: Retrospectivo, enfocado en la sostenibilidad, la recuperación y la planificación del día siguiente. El análisis es 'Final'.";
            analysisInstructions = `
                1. Evalúa el cumplimiento final del <strong>objetivo calórico</strong> y de <strong>Proteínas totales</strong> del día.
                2. **Evaluación Profunda:** Analiza la distribución final de macros, la ingesta de <strong>Fibra</strong> (${fibra_dia} g) y la calidad nutricional (cantidad de <strong>Ultraprocesados</strong>).
                3. Proporciona una recomendación clave para la <strong>planificación y descanso</strong> del día siguiente, en relación a su nivel de estrés (${perfilUsuario.salud_y_sostenibilidad.nivel_estres_dia}/10) y hora de sueño.
                4. Sugiere un plato o ingrediente de la lista de favoritos que hubiera ayudado a mejorar la composición del día.
            `;
            break;
    }
    
    // 10. Punto de control si hay feedback previo
    const contextItem = contextoPrevio ? `
        1. PUNTO DE CONTROL: ¿Se implementaron las sugerencias o correcciones dadas en el análisis anterior?
        CONTEXTO PREVIO: ${contextoPrevio}
    ` : '';

    // --- Definición del System Prompt (Sigue siendo la base) ---
    const systemPrompt = `Actúa como un nutricionista y coach personal profesional, especializado en nutrición basada en evidencia, guías internacionales (EFSA, FDA, ISSN) y el enfoque práctico del nutricionista Francis Holway.
Tu prioridad es generar recomendaciones científicamente válidas y personalizadas, evitando mitos, exageraciones y cualquier afirmación sin respaldo empírico.

PERFIL DEL USUARIO:
- Nombre: ${activePersonName}
- Objetivo calórico: ${perfilUsuario.calorias_objetivo} kcal/día | Meta: ${perfilUsuario.objetivo} a ${perfilUsuario.ritmo_semanal} kg/semana
- Rango Proteína Objetivo: ${perfilUsuario.proteina_min}g - ${perfilUsuario.proteina_max}g
- Rango Carbos Objetivo: ${perfilUsuario.carbos_rango_porcentaje} | Rango Grasas Objetivo: ${perfilUsuario.grasas_rango_porcentaje}
- Tiempo libre cocina: ${perfilUsuario.salud_y_sostenibilidad.tiempo_libre_cocina_semanal}
- Entrenamiento: ${perfilUsuario.fitness.tipo_entrenamiento} - ${perfilUsuario.fitness.horario_entrenamiento}

DATOS DEL DÍA (hasta ahora):
- Calorías consumidas: ${consumido} kcal
- Calorías gastadas (ejercicio): ${gastado} kcal
- Calorías Netas (Consumo - Gasto Ejercicio): ${balance} kcal
- **Déficit Real (vs TDEE): ${deficit_real} kcal** - Déficit esperado: ${deficit_esperado} kcal

MACRONUTRIENTES Y CALIDAD:
- Proteínas ingeridas: ${proteinas_dia} g
- Carbohidratos ingeridos: ${carbohidratos_dia} g
- Grasas ingeridas: ${grasas_dia} g
- Fibra ingerida: ${fibra_dia} g
- Alimentos ultraprocesados: ${ultraprocesados_dia}
- Preferencias Alimentarias Favoritas: ${Object.values(perfilUsuario.preferencias_alimentarias).flat().join(', ')}

REGLAS DE RESPUESTA (muy importantes):
- Utiliza únicamente afirmaciones consistentes con evidencia científica.
- No inventes datos fisiológicos ni valores nutricionales.
- Sé preciso, directo y orientado a decisiones accionables.
- Evita lenguaje alarmista; prioriza la claridad y la adherencia.
- Mantén un tono profesional, motivador y equilibrado.`;

    // --- Definición del User Query (Instrucciones) ---
    const userQuery = `DIRECTRICES DE FORMATO (¡PRIORIDAD MÁXIMA!):
    1. La respuesta DEBE estar obligatoriamente en formato de ÍTEMS ENUMERADOS (1., 2., 3., 4., 5., 6.).
    2. Debes generar **EXACTAMENTE 6 ítems**. Cada ítem debe tener un máximo de 4 oraciones.
    3. Usa emojis relevantes, sin saturar, al inicio de cada ítem.
    4. Usa la etiqueta <strong> para resaltar palabras clave, métricas o palabras importantes.
    5. Finaliza la respuesta con un salto de línea HTML.
    
    // ESTA ES LA LISTA OBLIGATORIA DE TEMAS PARA LOS 6 ÍTEMS:
        
        1. 🟢 **Evaluación Calórica y Adherencia:** Evalúa el Déficit Real (${deficit_real} kcal) comparado con el Déficit Esperado (${deficit_esperado} kcal).
        2. 💪 **Revisión de Proteínas:** Evalúa si ${proteinas_dia} g están dentro del rango objetivo (${perfilUsuario.proteina_min}g - ${perfilUsuario.proteina_max}g) y su impacto en la <strong>Definición</strong>.
        3. ⏱️ **Timing Nutricional (Pre/Post-Entreno):** Analiza la distribución de carbohidratos alrededor del horario de entrenamiento (${perfilUsuario.fitness.horario_entrenamiento}) y cómo afecta el rendimiento.
        4. 🥕 **Fibra y Calidad Nutricional:** Evalúa la ingesta de <strong>Fibra</strong> (${fibra_dia} g) y la cantidad de <strong>Ultraprocesados</strong>, ofreciendo consejos de saciedad.
        5. 🧭 **Ajuste Prioritario y Recomendación:** Sugiere la corrección más urgente para el día siguiente o la recomendación más importante. Menciona un plato o ingrediente de las preferencias alimentarias (${Object.values(perfilUsuario.preferencias_alimentarias).flat().join(', ').substring(0, 100)}...) que lo facilite.
        6. 💤 **Recuperación y Planificación:** Conecta la nutrición con el nivel de estrés (${perfilUsuario.salud_y_sostenibilidad.nivel_estres_dia}/10) y la <strong>planificación de la cena</strong> o el desayuno de mañana.

    INSTRUCCIONES DE ANÁLISIS:

    ${analysisTone}

    ${contextItem}

    ${analysisInstructions} // Mantienes las instrucciones específicas del momento para guiar el foco de los ítems.

    `;
    console.log(systemPrompt)
    console.log(userQuery)
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
    
    currentLogData = data;

    const perfilUsuarioOnline = perfilUsuario[activePersonId];

    console.log("renderSelectedDay")
    console.log(data)

    // === INICIO DE INTEGRACIÓN DE MACROS ===
    const macrosDiarias = calcularMacrosDia(currentLogData.log_consumido);
    renderMacronutrients(macrosDiarias);
    // === FIN DE INTEGRACIÓN DE MACROS ===
    
    // === INICIO DE INTEGRACIÓN DE METAS (NUEVO) ===
    console.log(perfilUsuarioOnline)
    if (perfilUsuarioOnline) {
        const metas = calcularMetasDiarias(
            perfilUsuarioOnline, 
            macrosDiarias, 
            currentLogData.consumido || 0
        );
        renderTargetProgress(metas); // Nueva función para renderizar el progreso
    }
    // === FIN DE INTEGRACIÓN DE METAS ===

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

    // // ✅ AHORA SÍ: Generar mensaje del coach de forma asíncrona (NO bloqueante)

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
        
        // codigo anterior funcionando:    
        // const mensajeCoachAnteriorEnElDia = ""
        
        // // Generar mensaje en background (sin await en esta función)
        // generarMensajeCoach(consumed, expended, perfilUsuarioOnline, getMealCategory(new Date().getHours()), mensajeCoachAnteriorEnElDia)
        //     .then(message => {
        //         elements.coachMessage.innerHTML  = sanitizeHTML(message);
        //     })
        //     .catch(error => {
        //         console.error("Error generando mensaje del coach:", error);
        //         elements.coachMessage.textContent = `Balance del día: ${netBalance > 0 ? '+' : ''}${netBalance} Kcal.`;
        //     });
    
    // --- Lógica de Contexto y Generación ---
        const currentMoment = getMealCategory(new Date()); // Obtiene 'Desayuno', 'Almuerzo', etc.
        let mensajeCoachAnterior = "";

        // Solo buscar análisis previos si es el día actual
        if (isToday) {
            // 1. OBTENER EL ÚLTIMO ANÁLISIS DEL DÍA COMO CONTEXTO PREVIO
            mensajeCoachAnterior = await obtenerUltimoAnalisis(userId, selectedDay);
            console.log("mensajeCoachAnterior ->")
            console.log(mensajeCoachAnterior)
        }
        // 2. GENERAR EL MENSAJE
        generarMensajeCoach(consumed, expended, perfilUsuarioOnline, currentMoment, mensajeCoachAnterior)
            .then(async (message) => { // Usamos async aquí para el await en guardarAnalisis
                elements.coachMessage.innerHTML = sanitizeHTML(message);

                // 3. GUARDAR EL NUEVO MENSAJE GENERADO PARA FUTURA RETROALIMENTACIÓN
                if (isToday) {
                    await guardarAnalisisCoach(userId, selectedDay, currentMoment, message);
                }
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
    DESAYUNO: { start: 6, end: 12 },
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
    // } else if (hour >= MEAL_TIMES.COLACION_MANANA.start && hour < MEAL_TIMES.COLACION_MANANA.end) {
    //     return 'Colación';
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


/**
 * Renderiza los totales de macronutrientes en el card de macros.
 * @param {Object} macros - El objeto devuelto por calcularMacrosDia.
 */
function renderMacronutrients(macros) {
    // Redondeo final para la visualización (cero decimales para ultraprocesados, uno para macros)
    elements.proteinasDiaDisplay.textContent = Math.round(macros.proteinas_dia * 10) / 10;
    elements.carbohidratosDiaDisplay.textContent = Math.round(macros.carbohidratos_dia * 10) / 10;
    elements.grasasDiaDisplay.textContent = Math.round(macros.grasas_dia * 10) / 10;
    elements.fibraDiaDisplay.textContent = Math.round(macros.fibra_dia * 10) / 10;
    // Asumo que ultraprocesados_dia contiene las Kcal
    elements.ultraprocesadosDiaDisplay.textContent = Math.round(macros.ultraprocesados_dia); 
}

// Asegúrate de que los elementos sean accesibles, por ejemplo:
// elements.proteinaMetaDisplay = document.getElementById('proteinaMetaDisplay');

/**
 * Renderiza el progreso de las metas calóricas y de macronutrientes.
 * @param {Object} metas - El objeto devuelto por calcularMetasDiarias.
 */
function renderTargetProgress(metas) {
    // Función para formatear las metas de gramos (ej: "50g / 150g")
    const formatGoal = (actual, meta) => `${Math.round(actual)}g / ${Math.round(meta)}g`;
    
    // Función para formatear las metas de Kcal (ej: "1200 Kcal / 2212 Kcal")
    const formatKcalGoal = (actual, meta) => `${Math.round(actual)} Kcal / ${Math.round(meta)} Kcal`;
    
    // 1. Actualizar Proteínas (Gramos)
    if (elements.proteinaProgress) {
        elements.proteinaProgress.textContent = formatGoal(metas.proteina.actual, metas.proteina.meta);
    }
    
    // 2. Actualizar Carbohidratos (Gramos)
    if (elements.carbohidratosProgress) {
        elements.carbohidratosProgress.textContent = formatGoal(metas.carbohidratos.actual, metas.carbohidratos.meta);
    }

    // 3. Actualizar Grasas (Gramos)
    if (elements.grasasProgress) {
        elements.grasasProgress.textContent = formatGoal(metas.grasas.actual, metas.grasas.meta);
    }

    // 4. Actualizar Kcal (Total Consumido vs. Total Objetivo)
    if (elements.kcalTargetProgress) {
        elements.kcalTargetProgress.textContent = formatKcalGoal(metas.kcal.actual, metas.kcal.meta);
    }
    
    // 5. Feedback Visual (Kcal Restante/Excedente)
    if (elements.kcalRestanteDisplay) {
        let texto;
        if (metas.kcal.restante > 0) {
            texto = `(Quedan ${Math.round(metas.kcal.restante)} Kcal)`;
            elements.kcalRestanteDisplay.className = 'text-success fw-bold';
        } else if (metas.kcal.restante === 0) {
            texto = `(¡Meta de Kcal alcanzada!)`;
            elements.kcalRestanteDisplay.className = 'text-info fw-bold';
        } else {
            // El campo .restante en metas.kcal tiene Math.max(0, ...),
            // por lo que si se excede la meta, usamos el valor absoluto de la diferencia real.
            const excedente = metas.kcal.actual - metas.kcal.meta;
            texto = `(Excedido por ${Math.round(excedente)} Kcal)`;
            elements.kcalRestanteDisplay.className = 'text-danger fw-bold';
        }
        
        elements.kcalRestanteDisplay.textContent = texto;
    }
}

/**
 * Compara los macros consumidos con los objetivos del perfil.
 * @param {Object} perfil - El objeto perfilUsuario[activePersonId].
 * @param {Object} macrosConsumidas - El resultado de calcularMacrosDia().
 * @param {number} caloriasConsumidas - El total 'consumido' del día.
 * @returns {Object} Un objeto con el progreso y las metas.
 */
function calcularMetasDiarias(perfil, macrosConsumidas, caloriasConsumidas) {
    
    // --- 1. Definir Objetivos del Perfil ---
    const objetivoKcal = perfil.calorias_objetivo;
    const objetivoProteina = perfil.peso_actual * 2//(perfil.proteina_min + perfil.proteina_max) / 2; // Usamos el promedio

    // Calcular objetivos de Carbos y Grasas a partir de porcentajes de Kcal Objetivo
    // 1g Carbos = 4 Kcal | 1g Proteína = 4 Kcal | 1g Grasa = 9 Kcal
    
    // Asumo que los rangos de Carbos y Grasas son strings '40-50%' y '25-35%'
    const carbosPorcentaje = parseFloat(perfil.carbos_rango_porcentaje.split('-')[0]) / 100; // Usamos el mínimo del rango
    const grasasPorcentaje = parseFloat(perfil.grasas_rango_porcentaje.split('-')[0]) / 100; // Usamos el mínimo del rango
    
    const objetivoCarbos = Math.round((objetivoKcal * carbosPorcentaje) / 4); // (Kcal * %) / 4 Kcal/g
    const objetivoGrasas = Math.round((objetivoKcal * grasasPorcentaje) / 9); // (Kcal * %) / 9 Kcal/g

    // --- 2. Calcular el Progreso ---
    const progreso = {
        kcal: { meta: objetivoKcal, actual: caloriasConsumidas, restante: objetivoKcal - caloriasConsumidas },
        proteina: { meta: objetivoProteina, actual: macrosConsumidas.proteinas_dia, restante: objetivoProteina - macrosConsumidas.proteinas_dia },
        carbohidratos: { meta: objetivoCarbos, actual: macrosConsumidas.carbohidratos_dia, restante: objetivoCarbos - macrosConsumidas.carbohidratos_dia },
        grasas: { meta: objetivoGrasas, actual: macrosConsumidas.grasas_dia, restante: objetivoGrasas - macrosConsumidas.grasas_dia },
        
        // Indicador de Ultraprocesados (la meta es 0 Kcal)
        ultraprocesados: { meta: 0, actual: macrosConsumidas.ultraprocesados_dia },
    };
    
    // Asegurar que las calorías restantes no sean negativas
    progreso.kcal.restante = Math.max(0, progreso.kcal.restante);

    return progreso;
}

// --- Ejecución Inicial ---
initializeFirebase();