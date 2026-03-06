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

import { 
    FIREBASE_CONFIG_PERSONAL,
    GEMINI_API_KEYS,  // Cambia esto
    RATE_LIMIT_CONFIG, // Añade esto
    APP_PROJECT_ID 
} from './modulos/config.js';

// ==============================================================================
// === SISTEMA DE GESTIÓN DE API KEYS ===
// ==============================================================================

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

    getCurrentKey() {
        return this.apiKeys[this.currentIndex];
    }

    rotateKey() {
        this.requestCount = 0;
        this.currentIndex = (this.currentIndex + 1) % this.apiKeys.length;
        
        // Si hemos rotado todas las keys y todas están fallando
        if (this.failedKeys.size === this.apiKeys.length) {
            console.warn('Todas las API keys han fallado. Esperando cooldown...');
            setTimeout(() => {
                this.failedKeys.clear();
                console.log('Reiniciando sistema de API keys');
            }, this.config.cooldownTime);
        }
    }

    markKeyFailed(key) {
        this.failedKeys.add(key);
        this.rotateKey();
    }

    incrementRequest() {
        this.requestCount++;
        if (this.requestCount >= this.config.requestsPerKey) {
            console.log(`Rotando API key después de ${this.requestCount} solicitudes`);
            this.rotateKey();
        }
    }

    getAvailableKeys() {
        return this.apiKeys.filter(key => !this.failedKeys.has(key));
    }
}

// ==============================================================================
// === INICIALIZACIÓN ===
// ==============================================================================

const isCanvasEnvironment = typeof __firebase_config !== 'undefined';
const firebaseConfig = isCanvasEnvironment ? JSON.parse(__firebase_config) : FIREBASE_CONFIG_PERSONAL;
const initialAuthToken = isCanvasEnvironment ? __initial_auth_token : null;
const appId = isCanvasEnvironment ? __app_id : APP_PROJECT_ID;

// Inicializar el gestor de API keys
let API_KEY;
if (!isCanvasEnvironment && GEMINI_API_KEYS.length > 0) {
    API_KEY = new ApiKeyManager(GEMINI_API_KEYS, RATE_LIMIT_CONFIG);
} else {
    API_KEY = null; // En Canvas usaremos otra lógica
}
// Opción más recomendada y rápida

const GEMINI_MODELS = [
    "gemini-2.5-flash-lite",  // 🥇 más rápida, arrancar acá
    "gemini-2.5-flash",       // fallback con más inteligencia
    "gemini-2.0-flash",       // fallback estable
    "gemini-1.5-flash"        // último recurso
];

let currentModelIndex = 0;

function getCurrentModel() {
    return GEMINI_MODELS[currentModelIndex];
}

function getApiUrl() {
    return `https://generativelanguage.googleapis.com/v1beta/models/${getCurrentModel()}:generateContent`;
}

function rotateModel() {
    currentModelIndex = (currentModelIndex + 1) % GEMINI_MODELS.length;
    console.log(`🔄 Rotando a modelo: ${getCurrentModel()}`);
}

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
        altura: 174, // cm
        peso_objetivo: 72,
        nivel_actividad: 'moderado', // sedentario, ligero, moderado, activo, muy_activo // quitar
        objetivo: 'definición', // perder_peso, mantener, ganar_musculo
        ritmo_semanal: 0.5, // kg por semana a bajar

        // Calculados automáticamente:
        tmb: 1718,
        tdee: 2835,
        calorias_objetivo: 2300, // TDEE - 500 (para perder 0.5kg/semana)
        fecha_actualizacion: '2025-12-06',

        // RANGOS OBJETIVO DE MACROS (en gramos y porcentajes ajustados a 2345 kcal):
        // Proteína: 1.4 g/kg a 2.2 g/kg
        proteina_min: 105, // 75 kg * 1.4 g/kg
        proteina_max: 165, // 75 kg * 2.2 g/kg 

        // NUEVA ADICIÓN: Rangos objetivo de macros para guiar la distribución (en %)
        // Distribución basada en 150g de Proteína (600 kcal) y 25% de Grasas (65g, 585 kcal)
            // Carbos restantes: 2345 - 600 - 585 = 1160 kcal
            // % Carbos: 1160 / 2345 * 100 = 49.5%
            // % Grasas: 585 / 2345 * 100 = 25%

        carbos_rango_porcentaje: '40-55%', 
        grasas_rango_porcentaje: '20-30%', 

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
   sofia:  {
        edad: 25,
        sexo: 'femenino',
        peso_actual: 59, // kg
        altura: 160, // cm
        peso_objetivo: 56,
        nivel_actividad: 'moderado', // sedentario, ligero, moderado, activo, muy_activo // quitar
        objetivo: 'definición', // perder_peso, mantener, ganar_musculo
        ritmo_semanal: 0.4, // kg por semana a bajar

        // Calculados automáticamente:
        tmb: 1304, // Fórmula Mifflin-St Jeor (Mujeres)
        tdee: 2021, // 1304 * 1.55
        calorias_objetivo: 1621, // TDEE - 400 (para perder 0.4kg/semana)
        fecha_actualizacion: '2025-12-06',

        // RANGOS OBJETIVO DE MACROS (en gramos y porcentajes ajustados a 2345 kcal):
       // RANGOS OBJETIVO DE MACROS (en gramos y porcentajes):
        proteina_min: 94, // 59 kg * 1.6 g/kg
        proteina_max: 130, // 59 kg * 2.2 g/kg

        // NUEVA ADICIÓN: Rangos objetivo de macros para guiar la distribución (en %)
        carbos_rango_porcentaje: '40-55%', 
        grasas_rango_porcentaje: '20-30%',
   }
};

let activePersonId = PEOPLE[0].id;
let activePersonName = PEOPLE[0].name;


elements.loadingIndicator.style.display = 'fixed';
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

    elements.loadingIndicator.style.display = 'fixed';
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
    console.log(activePersonName)
    if (activePersonName === 'Valentín') {
        elements.activeUserName.classList.add('text-dark');
    } else if (activePersonName === 'Sofía') {
        elements.activeUserName.classList.add('text-danger');
    }
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
            temperature: 0.7,
            topP: 0.95,
            topK: 40,
            maxOutputTokens: 1500,
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

    const MAX_RETRIES = 3;

    for (let i = 0; i < MAX_RETRIES; i++) {
        try {
            // OBTENER LA API KEY CORRECTAMENTE del ApiKeyManager
            const currentKey = API_KEY.getCurrentKey();
            
            // Verificar que la key sea válida
            if (!currentKey || typeof currentKey !== 'string') {
                throw new Error("API key no disponible o inválida");
            }
            
            const url = `${getApiUrl()}?key=${currentKey}`;
            console.log(`Usando API key: ${currentKey.substring(0, 8)}... para intento ${i + 1}`);

            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                if (response.status === 404) {
                    console.warn(`Modelo ${getCurrentModel()} no disponible. Rotando...`);
                    rotateModel();
                    if (i < MAX_RETRIES - 1) continue;
                }

                // Si es error 429 (rate limit) o 403 (quota), rotar la key
                if (response.status === 429 || response.status === 403) {
                    console.warn(`Key ${currentKey.substring(0, 8)}... excedió límite. Rotando...`);
                    API_KEY.markKeyFailed(currentKey);
                    
                    // Continuar con siguiente intento con nueva key
                    if (i < MAX_RETRIES - 1) {
                        await new Promise(resolve => setTimeout(resolve, Math.pow(2, i) * 1000));
                        continue;
                    }
                }
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const result = await response.json();
            const jsonText = result?.candidates?.[0]?.content?.parts?.[0]?.text;
            
            if (!jsonText) {
                throw new Error("Respuesta vacía de Gemini");
            }
            
            const parsedJson = JSON.parse(jsonText);
            const mensaje = parsedJson.mensaje;

            if (typeof mensaje === 'string' && mensaje.length > 0) {
                // Incrementar contador de solicitudes exitosas
                API_KEY.incrementRequest();
                console.log(`✅ Mensaje coach obtenido con éxito`);
                return mensaje;
            }
            throw new Error("Mensaje inválido en respuesta");

        } catch (error) {
            console.warn(`Intento ${i + 1} de mensaje coach fallido:`, error.message);
            
            // Si no es un error HTTP y tenemos más intentos, esperar antes de reintentar
            if (i < MAX_RETRIES - 1) {
                const waitTime = Math.pow(2, i) * 1000;
                console.log(`Esperando ${waitTime}ms antes de reintentar...`);
                await new Promise(resolve => setTimeout(resolve, waitTime));
            } else {
                // Último intento fallido
                console.error("Todos los intentos fallaron para mensaje del coach");
                return "📊 Sigue registrando tus comidas para recibir retroalimentación personalizada.";
            }
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
    let analysisTone = "Profesional y amigable";
    const metasKcal = perfilUsuario.calorias_objetivo;

// --- System Prompt Optimizado y Corregido ---
const systemPrompt = `Eres nutricionista deportivo especializado, usando el enfoque científico-práctico.
ANÁLISIS: Basado EN LOS DATOS PROPORCIONADOS, NO asumas ni inventes datos.
REFERENCIAS: Usa las referencias proporcionadas cuando apliquen.

FORMATO DE RESPUESTA OBLIGATORIO:
• Exactamente 6 puntos numerados (1. 2. 3. 4. 5. 6.)
• Cada punto: 4-5 oraciones completas
• Emoji al inicio de cada punto
• Números importantes en **negritas**
• Separación entre puntos con un salto de linea o un <hr>
• No incluir encabezados adicionales

DATOS DEL SISTEMA (solo para contexto):
• Atleta: ${activePersonName}
• TDEE: ${perfilUsuario.tdee} kcal | Objetivo: ${perfilUsuario.calorias_objetivo} kcal
• Déficit esperado: ${deficit_esperado} kcal (${(deficit_esperado/perfilUsuario.tdee*100).toFixed(1)}%)
• Peso: ${perfilUsuario.peso_actual} kg
• Entrenamiento: ${perfilUsuario.fitness.tipo_entrenamiento} a las ${perfilUsuario.fitness.horario_entrenamiento}

Tu rol: Analizar los datos específicos del día y dar recomendaciones prácticas.`;
const alimentosConsumidos = currentLogData.log_consumido.map(item => item.nombre).filter(Boolean);
const alimentosStr = alimentosConsumidos.length > 0 
    ? alimentosConsumidos.slice(0, 8).join(', ') + (alimentosConsumidos.length > 8 ? '...' : '')
    : 'No hay registro de alimentos';


    
// --- User Query Optimizado ---
let userQuery = `DATOS ACTUALES PARA ANÁLISIS (${momentOfDay.toUpperCase()}):

• Calorías consumidas: ${consumido} kcal
• Calorías ejercicio: ${gastado} kcal
• Balance neto: ${balance} kcal
• Déficit real: ${deficit_real} kcal (vs objetivo: ${deficit_esperado} kcal)
• Proteína: ${proteinas_dia}g (${(proteinas_dia/perfilUsuario.peso_actual).toFixed(1)}g/kg)
• Objetivo proteína: ${(perfilUsuario.proteina_min/perfilUsuario.peso_actual).toFixed(1)}-${(perfilUsuario.proteina_max/perfilUsuario.peso_actual).toFixed(1)}g/kg
• Carbohidratos: ${carbohidratos_dia}g
• Fibra: ${fibra_dia}g (meta: ${(consumido/1000*14).toFixed(1)}g)
• Ultraprocesados: ${ultraprocesados_dia} kcal (${consumido>0 ? (ultraprocesados_dia/consumido*100).toFixed(1) : 0}%)
• Estrés: ${perfilUsuario.salud_y_sostenibilidad.nivel_estres_dia}/10
• Sueño: ${perfilUsuario.salud_y_sostenibilidad.hora_habitual_dormir}
• Preferencia proteica: ${perfilUsuario.preferencias_alimentarias.proteinas_favoritas[0] || "huevo"}
• Tiempo disponible: ${perfilUsuario.salud_y_sostenibilidad.tiempo_libre_cocina_semanal}

GENERA ANÁLISIS CON 6 PUNTOS:

1. 🟢 EVALUACIÓN DEL BALANCE ENERGÉTICO
Analiza específicamente el déficit real de **${deficit_real} kcal** vs el objetivo de **${deficit_esperado} kcal**. ¿Es sostenible para ${perfilUsuario.ritmo_semanal} kg/semana?

2. 💪 ANÁLISIS DE PROTEÍNA
Evalúa **${(proteinas_dia/perfilUsuario.peso_actual).toFixed(1)}g/kg** vs objetivo **${(perfilUsuario.proteina_min/perfilUsuario.peso_actual).toFixed(1)}-${(perfilUsuario.proteina_max/perfilUsuario.peso_actual).toFixed(1)}g/kg**. Impacto en definición muscular.

3. ⏱️ DISTRIBUCIÓN Y TIMING NUTRICIONAL
Entreno: ${perfilUsuario.fitness.horario_entrenamiento}. Analiza **${carbohidratos_dia}g de carbohidratos** en relación al timing. Recomendación basada en evidencia ISSN.

4. 🥕 CALIDAD NUTRICIONAL Y FIBRA
Fibra: **${fibra_dia}g** (meta ${(consumido/1000*14).toFixed(1)}g). Ultraprocesados: **${ultraprocesados_dia} kcal**. Estrategias para densidad nutricional.

5. 🧭 CORRECCIÓN PRIORITARIA PARA MAÑANA
Análisis de alimentos consumidos hoy: ${alimentosStr}.
¿Brecha principal? (proteína/energía/distribución/calidad). 
Sugiere ajuste específico usando ${perfilUsuario.preferencias_alimentarias.proteinas_favoritas.join(', ')}.
Enfoque práctico para ${perfilUsuario.salud_y_sostenibilidad.tiempo_libre_cocina_semanal} considerando las preferencias: ${perfilUsuario.preferencias_alimentarias.opciones_rapidas_faciles.slice(0, 3).join(', ')}.
6. 💤 RECUPERACIÓN Y PLANIFICACIÓN
Estrés: **${perfilUsuario.salud_y_sostenibilidad.nivel_estres_dia}/10**. Recomendaciones para sueño (${perfilUsuario.salud_y_sostenibilidad.hora_habitual_dormir}) e hidratación. Plan para ${momentOfDay === 'Cena' ? 'desayuno' : 'próxima comida'}.

TONO: Profesional y amigable.
USAR REFERENCIAS SI APLICAN:
• Morton et al. 2018 para proteína (1.6-2.2g/kg)
• Garthe et al. 2011 para déficit (0.7%/semana)
• Aragon & Schoenfeld 2013 para timing
• Slavin 2013 para fibra-saciedad`;

// ${contextoPrevio ? `## SEGUIMIENTO DEL ANÁLISIS ANTERIOR:
// Contexto previo: "${contextoPrevio.substring(0, 120)}"` : ''}
    console.log(systemPrompt)
    console.log(userQuery)

    let intentos = 0;
    let mensaje = "";
    
    while (intentos < 3) {
        mensaje = await fetchGeminiCoachMessage(systemPrompt, userQuery);
        
        // Validar que la respuesta tenga al menos 6 ítems
        const itemCount = (mensaje.match(/\d\.\s/g) || []).length;
        const lineas = mensaje.split('\n').filter(l => l.trim().length > 0);
        
        if (itemCount >= 6 && lineas.length >= 8) {
            return mensaje;
        }
        
        // Si es corto, regenerar con instrucciones más claras
        intentos++;
        
        if (intentos < 3) {
            userQuery += "\n\n⚠️ IMPORTANTE: Tu respuesta anterior fue muy corta. Asegúrate de generar EXACTAMENTE 6 ítems numerados, cada uno con 2-4 oraciones completas.";
        }
    }

    const macros = calcularMacrosDia(data.log_consumido);
    return generarMensajeFallback(consumido, gastado, perfilUsuario, momentOfDay, macros);
}

/**
 * Genera un mensaje de fallback estructurado cuando Gemini no responde adecuadamente
 * @param {number} consumido - Kcal totales consumidas.
 * @param {number} gastado - Kcal gastadas por ejercicio.
 * @param {Object} perfilUsuario - Objeto con el perfil y metas del usuario.
 * @param {string} momentOfDay - Indica el momento del análisis.
 * @param {Object} macros - Objeto con los macros calculados del día.
 * @returns {string} Mensaje del coach estructurado.
 */
function generarMensajeFallback(consumido, gastado, perfilUsuario, momentOfDay, macros) {
    const {
        proteinas_dia,
        carbohidratos_dia,
        grasas_dia,
        fibra_dia,
        ultraprocesados_dia
    } = macros || calcularMacrosDia([]); // Usa macros proporcionados o calcula vacío
    
    const balance = consumido - gastado;
    const deficit_esperado = perfilUsuario.tdee - perfilUsuario.calorias_objetivo;
    const deficit_real = perfilUsuario.tdee - balance;
    
    // Calcular porcentajes de macros
    const kcalProteinas = proteinas_dia * 4;
    const kcalCarbos = carbohidratos_dia * 4;
    const kcalGrasas = grasas_dia * 9;
    const totalMacrosKcal = kcalProteinas + kcalCarbos + kcalGrasas;
    
    const porcentajeProteinas = totalMacrosKcal > 0 ? (kcalProteinas / totalMacrosKcal * 100).toFixed(1) : "0";
    const porcentajeCarbos = totalMacrosKcal > 0 ? (kcalCarbos / totalMacrosKcal * 100).toFixed(1) : "0";
    const porcentajeGrasas = totalMacrosKcal > 0 ? (kcalGrasas / totalMacrosKcal * 100).toFixed(1) : "0";
    
    // Determinar estado calórico
    let evaluacionCalorica = "";
    let emojiCalorias = "🟡";
    
    if (deficit_real > deficit_esperado * 1.2) {
        evaluacionCalorica = `Déficit alto (${deficit_real} vs ${deficit_esperado} kcal esperado). Considera ajustar la ingesta.`;
        emojiCalorias = "🔴";
    } else if (deficit_real >= deficit_esperado * 0.8) {
        evaluacionCalorica = `Déficit en rango objetivo (${deficit_real} kcal). Buen progreso hacia ${perfilUsuario.ritmo_semanal} kg/semana.`;
        emojiCalorias = "🟢";
    } else if (deficit_real > 0) {
        evaluacionCalorica = `Déficit menor al objetivo. Revisa la distribución del resto del día.`;
        emojiCalorias = "🟡";
    } else {
        evaluacionCalorica = `Superávit calórico. Ajusta las próximas comidas para volver al déficit.`;
        emojiCalorias = "🔴";
    }
    
    // Determinar estado de proteínas
    let evaluacionProteinas = "";
    let emojiProteinas = "💪";
    
    if (proteinas_dia < perfilUsuario.proteina_min * 0.8) {
        evaluacionProteinas = `Proteínas bajas (${proteinas_dia}g). Necesitas al menos ${perfilUsuario.proteina_min}g para preservar músculo.`;
        emojiProteinas = "🔴";
    } else if (proteinas_dia < perfilUsuario.proteina_min) {
        evaluacionProteinas = `Proteínas cercanas al mínimo (${proteinas_dia}g). Añade más en la próxima comida.`;
        emojiProteinas = "🟡";
    } else if (proteinas_dia <= perfilUsuario.proteina_max) {
        evaluacionProteinas = `Proteínas en rango óptimo (${proteinas_dia}g). Ideal para definición muscular.`;
        emojiProteinas = "🟢";
    } else {
        evaluacionProteinas = `Proteínas altas (${proteinas_dia}g). Dentro de límites seguros pero podría redistribuirse.`;
        emojiProteinas = "🟡";
    }
    
    // Evaluar fibra
    let evaluacionFibra = "";
    const metaFibra = perfilUsuario.sexo === 'femenino' ? 25 : 38; // Metas generales AHA
    
    if (fibra_dia < metaFibra * 0.5) {
        evaluacionFibra = `Fibra muy baja (${fibra_dia}g). Aumenta vegetales y granos integrales para saciedad.`;
    } else if (fibra_dia < metaFibra) {
        evaluacionFibra = `Fibra moderada (${fibra_dia}g). Podrías mejorar con más vegetales.`;
    } else {
        evaluacionFibra = `Fibra adecuada (${fibra_dia}g). Excelente para salud digestiva y saciedad.`;
    }
    
    // Evaluar ultraprocesados
    let evaluacionProcesados = "";
    const porcentajeProcesados = consumido > 0 ? ((ultraprocesados_dia / consumido) * 100).toFixed(1) : 0;
    
    if (porcentajeProcesados > 20) {
        evaluacionProcesados = `Alto en ultraprocesados (${porcentajeProcesados}% del total). Reduce para mejor salud.`;
    } else if (porcentajeProcesados > 10) {
        evaluacionProcesados = `Moderado en ultraprocesados (${porcentajeProcesados}%). Mantén bajo control.`;
    } else {
        evaluacionProcesados = `Bajo en ultraprocesados (${porcentajeProcesados}%). Excelente elección de alimentos.`;
    }
    
    // Mensaje según momento del día
    let recomendacionMomento = "";
    switch(momentOfDay) {
        case 'Desayuno':
            recomendacionMomento = "Enfócate en un desayuno alto en proteínas (>20g) y fibra para controlar el hambre matutina y mantener energía estable.";
            break;
        case 'Almuerzo':
            recomendacionMomento = "Prioriza proteína magra, vegetales abundantes y carbohidratos complejos. Idealmente 30-40% de tus calorías diarias.";
            break;
        case 'Merienda':
            recomendacionMomento = `Prepara un snack pre-entreno con carbohidratos de fácil digestión (fruta, avena) y algo de proteína ligera.`;
            break;
        case 'Cena':
        default:
            recomendacionMomento = "Cena ligera pero con proteína suficiente (30-40g) para recuperación nocturna y control del apetito matutino.";
            break;
    }
    
    // Obtener ingredientes favoritos
    const todosIngredientes = Object.values(perfilUsuario.preferencias_alimentarias).flat();
    const ingredienteAleatorio = todosIngredientes.length > 0 
        ? todosIngredientes[Math.floor(Math.random() * todosIngredientes.length)]
        : "alimentos que disfrutes";
    
    // Determinar recomendación basada en análisis
    let recomendacionUrgente = "";
    if (proteinas_dia < perfilUsuario.proteina_min * 0.7) {
        recomendacionUrgente = `AUMENTA PROTEÍNAS: Incluye ${ingredienteAleatorio} u otra fuente proteica en la próxima comida.`;
    } else if (porcentajeProcesados > 25) {
        recomendacionUrgente = `REDUCE ULTRAPROCESADOS: Sustituye por opciones más naturales como ${ingredienteAleatorio}.`;
    } else if (deficit_real > deficit_esperado * 1.5) {
        recomendacionUrgente = `MODERA DÉFICIT: El déficit es muy agresivo. Considera una comida más sustanciosa.`;
    } else {
        recomendacionUrgente = `MANTÉN EL CURSO: Sigue con tu plan actual. Incluye ${ingredienteAleatorio} para variedad.`;
    }
    
    // Construir el mensaje estructurado con 6 ítems
    return `
1. ${emojiCalorias} **Evaluación Calórica y Adherencia**
${evaluacionCalorica} Balance: ${consumido} kcal consumidas - ${gastado} kcal gastadas = ${balance} kcal netas.

2. ${emojiProteinas} **Revisión de Proteínas y Macronutrientes**
${evaluacionProteinas} Distribución: ${porcentajeProteinas}% Proteína, ${porcentajeCarbos}% Carbos, ${porcentajeGrasas}% Grasas.

3. ⏱️ **Timing Nutricional y Entrenamiento**
${recomendacionMomento} Entrenas ${perfilUsuario.fitness.horario_entrenamiento.toLowerCase()} - tipo ${perfilUsuario.fitness.tipo_entrenamiento}.

4. 🥕 **Calidad Nutricional y Fibra**
${evaluacionFibra} ${evaluacionProcesados} Ultraprocesados: ${ultraprocesados_dia} kcal (${porcentajeProcesados}%).

5. 🧭 **Ajuste Prioritario y Recomendación**
${recomendacionUrgente} Objetivo: ${perfilUsuario.objetivo} a ${perfilUsuario.ritmo_semanal} kg/semana.

6. 💤 **Recuperación y Planificación Sostenible**
Estrés nivel ${perfilUsuario.salud_y_sostenibilidad.nivel_estres_dia}/10. ${perfilUsuario.salud_y_sostenibilidad.nivel_estres_dia > 7 ? 'Prioriza descanso y comidas sencillas.' : 'Aprovecha para planificar.'} Hidratación clave.
`;
}



/**
 * Verifica si ya existe un análisis guardado para el día actual
 * @param {string} userId - ID del usuario
 * @param {string} selectedDay - Fecha seleccionada (formato YYYY-MM-DD)
 * @returns {Promise<boolean>} - True si ya existe un análisis hoy
 */
async function checkAnalysisToday(userId, selectedDay) {
    try {
        // Primero, verificar si selectedDay es hoy
        const today = new Date().toISOString().split('T')[0]; // Formato YYYY-MM-DD
        const isToday = selectedDay === today;
        
        if (!isToday) {
            return false; // No es hoy, permitir análisis sin restricción
        }
        
        // Usar tu función existente para obtener el último análisis
        const ultimoAnalisis = await obtenerUltimoAnalisis(userId, selectedDay);
        
        // Si hay un mensaje de análisis, significa que ya existe
        return ultimoAnalisis && ultimoAnalisis.trim().length > 0;
        
    } catch (error) {
        console.error("Error verificando análisis del día:", error);
        return false; // En caso de error, permitir continuar
    }
}
/**
 * Función que se ejecuta al hacer click para generar el análisis del coach
 */
async function generateCoachAnalysis(selectedDay, consumed, expended, perfilUsuarioOnline, isToday, userId) {
    const elements = {
        coachMessage: document.getElementById('coachMessage')
    };
    
    // 1. Si es hoy, verificar si ya hay análisis y pedir confirmación
    if (isToday) {
        const hasAnalysisToday = await checkAnalysisToday(userId, selectedDay);
        
        if (hasAnalysisToday) {
            // Mostrar diálogo de confirmación para regenerar
            const confirmed = await showAnalysisConfirmationDialog(
                "existing", 
                consumed,
                expended
            );
            
            if (!confirmed) {
                return; // El usuario canceló
            }
        } else {
            // No hay análisis hoy, mostrar confirmación normal
            const confirmed = await showAnalysisConfirmationDialog(
                "new", 
                consumed,
                expended
            );
            
            if (!confirmed) {
                return; // El usuario canceló
            }
        }
    }
    
    // 2. Mostrar indicador de carga
    elements.coachMessage.innerHTML = `
        <div class="d-flex align-items-center justify-content-center gap-2">
            <div class="spinner-border spinner-border-sm text-primary" role="status">
                <span class="visually-hidden">Cargando...</span>
            </div>
            <span>Generando análisis personalizado...</span>
        </div>
    `;

    // 3. Obtener contexto previo (usando tu función existente)
    const currentMoment = getMealCategory(new Date());
    let mensajeCoachAnterior = "";
    
    if (isToday) {
        mensajeCoachAnterior = await obtenerUltimoAnalisis(userId, selectedDay);
        console.log("Contexto previo obtenido para el análisis:", mensajeCoachAnterior);
    }
    
    // 4. Generar el mensaje del coach
    try {
        let message = await generarMensajeCoach(
            consumed, 
            expended, 
            perfilUsuarioOnline, 
            currentMoment, 
            mensajeCoachAnterior
        );
        
        // 5. Mostrar el mensaje generado
        elements.coachMessage.innerHTML = sanitizeHTML(message);

        // 6. Guardar el nuevo mensaje (solo si es hoy)
        if (isToday) {
            await guardarAnalisisCoach(userId, selectedDay, currentMoment, message);
            console.log("✅ Análisis guardado en Firebase");
        }
        
        // 7. Agregar botón para regenerar si se desea
        elements.coachMessage.innerHTML += `
            <div class="text-center mt-3">
                <button id="regenerateCoachBtn" class="btn btn-outline-primary btn-sm">
                    <i class="fas fa-sync-alt me-1"></i>Generar Nuevo Análisis
                </button>
            </div>
        `;
        
        // Configurar event listener para regenerar
        setTimeout(() => {
            const regenerateBtn = document.getElementById('regenerateCoachBtn');
            if (regenerateBtn) {
                regenerateBtn.addEventListener('click', () => {
                    generateCoachAnalysis(selectedDay, consumed, expended, perfilUsuarioOnline, isToday, userId);
                });
            }
        }, 100);
        
    } catch (error) {
        console.error("❌ Error generando mensaje del coach:", error);
        
        elements.coachMessage.innerHTML = `
            <div class="alert alert-warning">
                <i class="fas fa-exclamation-triangle me-2"></i>
                <strong>Error al conectar con el servicio de análisis</strong>
                <p class="mb-2 mt-2">Balance del día: ${(consumed - expended) > 0 ? '+' : ''}${consumed - expended} Kcal.</p>
                <div class="d-flex gap-2 justify-content-center">
                    <button id="retryCoachBtn" class="btn btn-sm btn-primary">
                        <i class="fas fa-redo me-1"></i>Reintentar
                    </button>
                    <button id="basicAnalysisBtn" class="btn btn-sm btn-outline-secondary">
                        <i class="fas fa-chart-simple me-1"></i>Ver resumen básico
                    </button>
                </div>
            </div>
        `;
        
        // Configurar event listeners para reintentar
        setTimeout(() => {
            const retryBtn = document.getElementById('retryCoachBtn');
            const basicBtn = document.getElementById('basicAnalysisBtn');
            
            if (retryBtn) {
                retryBtn.addEventListener('click', () => {
                    generateCoachAnalysis(selectedDay, consumed, expended, perfilUsuarioOnline, isToday, userId);
                });
            }
            
            if (basicBtn) {
                basicBtn.addEventListener('click', () => {
                    showBasicAnalysis(consumed, expended);
                });
            }
        }, 100);
    }
}

/**
 * Muestra un diálogo de confirmación personalizado para análisis
 * @param {string} type - "new" o "existing"
 * @param {number} consumed - Calorías consumidas
 * @param {number} expended - Calorías gastadas
 * @returns {Promise<boolean>} - True si el usuario confirma
 */
function showAnalysisConfirmationDialog(type, consumed, expended) {
    return new Promise((resolve) => {
        // Si no usas Bootstrap o prefieres confirm nativo, usa esto:
        const balance = consumed - expended;
        
        if (type === "existing") {
            const message = `⚠️ Ya tienes un análisis generado hoy.\n\n` +
                          `Datos actuales:\n` +
                          `• Consumo: ${consumed} kcal\n` +
                          `• Gasto ejercicio: ${expended} kcal\n` +
                          `• Balance: ${balance > 0 ? '+' : ''}${balance} kcal\n\n` +
                          `¿Quieres generar un nuevo análisis?`;
            
            resolve(confirm(message));
        } else {
            const message = `📊 Generar análisis del coach\n\n` +
                          `Basado en:\n` +
                          `• Consumo: ${consumed} kcal\n` +
                          `• Gasto ejercicio: ${expended} kcal\n` +
                          `• Balance: ${balance > 0 ? '+' : ''}${balance} kcal\n\n` +
                          `¿Continuar?`;
            
            resolve(confirm(message));
        }
    });
}

/**
 * Muestra un análisis básico cuando falla la generación con IA
 */
function showBasicAnalysis(consumed, expended) {
    const elements = {
        coachMessage: document.getElementById('coachMessage')
    };
    
    const netBalance = consumed - expended;
    const proteinasDia = currentLogData?.proteinas_dia || 0;
    const carbosDia = currentLogData?.carbohidratos_dia || 0;
    const grasasDia = currentLogData?.grasas_dia || 0;
    
    let message = `<h6 class="mb-3"><i class="fas fa-chart-simple me-2"></i>Resumen del Día</h6>`;
    
    // Evaluación calórica simple
    if (netBalance > 500) {
        message += `<div class="alert alert-warning py-2 mb-2">
            <i class="fas fa-exclamation-triangle me-1"></i>
            <strong>Balance alto:</strong> +${netBalance} Kcal
        </div>`;
    } else if (netBalance <= 0 && netBalance > -500) {
        message += `<div class="alert alert-success py-2 mb-2">
            <i class="fas fa-check-circle me-1"></i>
            <strong>Balance equilibrado:</strong> ${netBalance} Kcal
        </div>`;
    } else if (netBalance <= -500) {
        message += `<div class="alert alert-info py-2 mb-2">
            <i class="fas fa-fire me-1"></i>
            <strong>Déficit significativo:</strong> ${netBalance} Kcal
        </div>`;
    } else {
        message += `<div class="alert alert-secondary py-2 mb-2">
            <strong>Balance:</strong> ${netBalance > 0 ? '+' : ''}${netBalance} Kcal
        </div>`;
    }
    
    // Macronutrientes básicos
    message += `
        <div class="card border-0 bg-light mb-3">
            <div class="card-body py-2">
                <h6 class="small mb-2"><strong>Macronutrientes:</strong></h6>
                <div class="d-flex justify-content-between small">
                    <span>Proteínas: <strong>${proteinasDia}g</strong></span>
                    <span>Carbos: <strong>${carbosDia}g</strong></span>
                    <span>Grasas: <strong>${grasasDia}g</strong></span>
                </div>
            </div>
        </div>
    `;
    
    message += `
        <div class="text-center">
            <button id="tryAgainBtn" class="btn btn-primary btn-sm">
                <i class="fas fa-robot me-1"></i>Intentar con Análisis IA
            </button>
        </div>
    `;
    
    elements.coachMessage.innerHTML = message;
    
    // Configurar botón para intentar nuevamente
    setTimeout(() => {
        const tryAgainBtn = document.getElementById('tryAgainBtn');
        if (tryAgainBtn) {
            tryAgainBtn.addEventListener('click', () => {
                // Esta función debería llamar a generateCoachAnalysis con los parámetros necesarios
                console.log("Intento de regenerar análisis...");
            });
        }
    }, 100);
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
                ? "Ej: 1 huevo hervido" 
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


    // // Generar mensaje del coach de forma asíncrona (NO bloqueante)
    if (consumed === 0 && expended === 0) {
        elements.coachMessage.textContent = `No hay registros para ${isToday ? 'hoy' : formatDate(selectedDay)}.`;
        // Ocultar botón de análisis si no hay registros
        elements.coachButton.style.display = 'none';
    } else if (perfilUsuarioOnline) {
        // MOSTRAR BOTÓN DE ANÁLISIS EN LUGAR DE GENERAR AUTOMÁTICAMENTE
        elements.coachMessage.innerHTML = `
            <div class="text-center">
                <p class="mb-3">📊 Hay registros para ${isToday ? 'hoy' : formatDate(selectedDay)}</p>
                <button id="generateCoachBtn" class="btn btn-primary">
                    <i class="fas fa-robot me-2"></i>Generar Análisis del Coach
                </button>
            </div>
        `;
        
        // Configurar el event listener para el botón
        setTimeout(() => {
            const generateBtn = document.getElementById('generateCoachBtn');
            if (generateBtn) {
                generateBtn.addEventListener('click', () => {
                    generateCoachAnalysis(selectedDay, consumed, expended, perfilUsuarioOnline, isToday, userId);
                });
            }
        }, 100);

        
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
        elements.coachButton.style.display = 'none';
    }
            // ✅ MOSTRAR LA UI INMEDIATAMENTE
        elements.loadingIndicator.style.display = 'none';
        elements.summaryContent.style.display = 'block';
}

const MEAL_TIMES = {
    DESAYUNO: { start: 6, end: 12 },
    ALMUERZO: { start: 12, end: 14.50 },
    MERIENDA: { start: 14.50, end: 20.50 },
    CENA: { start: 20.50, end: 23 },
    COLACION_NOCHE: { start: 23, end: 24 }
};

function getMealCategory(dateObj) {
    const hour = dateObj.getHours();

    if (hour >= MEAL_TIMES.DESAYUNO.start && hour < MEAL_TIMES.DESAYUNO.end) {
        return 'Desayuno';
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
            sortKey: new Date(item.hora).getTime()
        })),
        ...(logExpended || []).map(item => ({
            ...item,
            type: 'gasto',
            sortKey: new Date(item.hora).getTime()
        }))
    ];
    
    if (combinedLog.length === 0) {
        elements.emptyLogMessage.style.display = 'block';
        return;
    }
    elements.emptyLogMessage.style.display = 'none';

    const sortedLog = combinedLog.sort((a, b) => a.sortKey - b.sortKey);

    sortedLog.forEach(item => {
        const dateObj = new Date(item.hora);
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
        
        const deleteButtonHTML = `
            <button type="button" class="delete-btn" 
                onclick="window.deleteLogItem('${item.type}', '${item.id}', ${item.kcal})" 
                aria-label="Eliminar registro">
                <i class="fas fa-trash"></i>
            </button>
        ` ;

        // --- NUEVO CÓDIGO: Generar HTML para los Macros (solo si es consumo) ---
        let macrosHTML = '';
        if (isConsumption) {
            // Aseguramos que los valores sean números y los redondeamos a 1 decimal
            const p = Math.round(item.proteinas * 10) / 10;
            const c = Math.round(item.carbohidratos * 10) / 10;
            const g = Math.round(item.grasas * 10) / 10;
            const f = Math.round(item.fibra * 10) / 10;
            
          macrosHTML = `
            <div class="macro-details mt-2 pt-2 border-top border-light-subtle">
                <div class="row small text-secondary">
                    <!-- Primera fila -->
                    <div class="col-12">
                        🥩 Proteínas: <strong>${p}g</strong>
                    </div>
                    <div class="col-12">
                        🍚 Carbohidratos: <strong>${c}g</strong>
                    </div>
                    <!-- Segunda fila -->
                    <div class="col-12">
                        🥑 Grasas: <strong>${g}g</strong>
                    </div>
                    <div class="col-12">
                        🥕 Fibra: <strong>${f}g</strong>
                    </div>
                </div>
            </div>
        `;

         
        }
        // -----------------------------------------------------------------------

        listItem.innerHTML = `
            <div class="d-flex justify-content-between align-items-start gap-3">
                <div class="flex-grow-1 min-w-0">
                    <div class="meal-category mb-1">
                        ${mealCategory}
                        <span class="meal-time ms-2">${time}</span>
                    </div>
                    <div class="meal-description">${item.descripcion}</div>
                    ${macrosHTML} </div>
                <div class="d-flex flex-column align-items-end gap-2">
                    <span class="badge calorie-badge ${badgeClass}">
                        ${sign}${Math.round(item.kcal)} Kcal
                    </span>
                    ${deleteButtonHTML}
                </div>
            </div>
        `;
        elements.foodLog.appendChild(listItem);
    });
}

async function deleteLogItem(type, itemId, kcalValue) {
    if (!userId || !db /*|| selectedDay !== todayISO*/) {
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
            
            const deleteButton =  `
                <button type="button" class="delete-btn" 
                    onclick="window.deleteLogItem('${type}', '${item.id}', ${item.kcal}); elements.logDetailsModal.hide();">
                    <i class="fas fa-trash"></i>
                </button>
            ` ;

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
        contents: [{ role: "user", parts: [{ text: userQuery }] }],
        systemInstruction: { parts: [{ text: systemPrompt }] },
        generationConfig: {
            temperature: 0.2,
            responseMimeType: "application/json",
            responseSchema: responseSchema
        }
    };

    const MAX_RETRIES = 3;

    for (let i = 0; i < MAX_RETRIES; i++) {
        let currentKey = null;
        
        try {
            // OBTENER LA API KEY CORRECTAMENTE
            if (!API_KEY || typeof API_KEY.getCurrentKey !== 'function') {
                throw new Error("ApiKeyManager no inicializado correctamente");
            }
            
            currentKey = API_KEY.getCurrentKey();
            
            // Validar que tengamos una key válida
            if (!currentKey || typeof currentKey !== 'string') {
                throw new Error("No hay API keys disponibles o son inválidas");
            }
            
            const url = `${getApiUrl()}?key=${currentKey}`;
            console.log(`Intento ${i + 1} con API key: ${currentKey.substring(0, 8)}...`);

            const response = await fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                if (response.status === 404) {
                    console.warn(`Modelo ${getCurrentModel()} no disponible. Rotando...`);
                    rotateModel();
                    if (i < MAX_RETRIES - 1) continue;
                }

                // Manejar errores específicos de rate limit y quota
                if (response.status === 429 || response.status === 403) {
                    console.warn(`Key ${currentKey.substring(0, 8)}... excedió límites (${response.status})`);
                    
                    // Marcar la key como fallida
                    API_KEY.markKeyFailed(currentKey);
                    
                    // Verificar si quedan keys disponibles
                    const availableKeys = API_KEY.getAvailableKeys();
                    if (availableKeys.length === 0) {
                        throw new Error(`Todas las API keys han excedido sus límites. Cooldown activado.`);
                    }
                    
                    // Si no es el último intento, continuar con nueva key
                    if (i < MAX_RETRIES - 1) {
                        console.log(`Rotando a nueva key. Disponibles: ${availableKeys.length}`);
                        await new Promise(res => setTimeout(res, Math.pow(2, i) * 1000));
                        continue;
                    }
                }
                
                // Otros errores HTTP
                const errorText = await response.text().catch(() => 'Sin detalles');
                throw new Error(`HTTP ${response.status}: ${response.statusText}. ${errorText}`);
            }

            const result = await response.json();
            const jsonText = result?.candidates?.[0]?.content?.parts?.[0]?.text;

            if (!jsonText) {
                // Aunque la respuesta fue exitosa, no tiene contenido válido
                console.warn("Respuesta vacía de Gemini, pero HTTP 200 OK");
                throw new Error("Respuesta vacía de la API");
            }

            // Intentar parsear la respuesta JSON
            try {
                const parsed = JSON.parse(jsonText);
                
                // Incrementar contador de solicitudes exitosas
                API_KEY.incrementRequest();
                console.log(`✅ Solicitud completada exitosamente`);
                
                return parsed;
            } catch (parseError) {
                console.error("Error parseando JSON:", parseError);
                console.log("Texto recibido:", jsonText.substring(0, 200) + "...");
                throw new Error("Respuesta JSON inválida de Gemini");
            }

        } catch (error) {
            console.warn(`Intento ${i + 1} fallido:`, error.message);
            
            // Si es el último intento, lanzar el error
            if (i === MAX_RETRIES - 1) {
                // Verificar si es error de rate limit general
                if (error.message.includes("Todas las API keys")) {
                    const waitTime = API_KEY?.config?.cooldownTime || 60000;
                    console.error(`⚠️ Todas las keys en cooldown. Espera ${waitTime/1000} segundos.`);
                }
                throw new Error(`Fallo en AI después de ${MAX_RETRIES} intentos: ${error.message}`);
            }
            
            // Esperar antes de reintentar (exponential backoff)
            const waitTime = Math.pow(2, i) * 1000;
            console.log(`Esperando ${waitTime}ms antes de reintentar...`);
            await new Promise(res => setTimeout(res, waitTime));
        }
    }

    throw new Error("Fallo en AI: Máximo de reintentos alcanzado");
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
            // receta: // agrego recetas previamente guardadas
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

    // 4. Fibra
    if (elements.fibraProgress) {
        elements.fibraProgress.textContent = formatGoal(metas.fibra.actual, metas.fibra.meta);
    }

    // 5. Actualizar Kcal (Total Consumido vs. Total Objetivo)
    if (elements.kcalTargetProgress) {
        elements.kcalTargetProgress.textContent = formatKcalGoal(metas.kcal.actual, metas.kcal.meta);
    }
    
    // 6. Feedback Visual (Kcal Restante/Excedente)
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

    // NUEVA ADICIÓN: Meta de Fibra (25 gramos es el estándar mínimo recomendado)
    const objetivoFibra = 25;

    // --- 2. Calcular el Progreso ---
    const progreso = {
        kcal: { meta: objetivoKcal, actual: caloriasConsumidas, restante: objetivoKcal - caloriasConsumidas },
        proteina: { meta: objetivoProteina, actual: macrosConsumidas.proteinas_dia, restante: objetivoProteina - macrosConsumidas.proteinas_dia },
        carbohidratos: { meta: objetivoCarbos, actual: macrosConsumidas.carbohidratos_dia, restante: objetivoCarbos - macrosConsumidas.carbohidratos_dia },
        grasas: { meta: objetivoGrasas, actual: macrosConsumidas.grasas_dia, restante: objetivoGrasas - macrosConsumidas.grasas_dia },
        fibra: { meta: objetivoFibra, actual: macrosConsumidas.fibra_dia, restante: objetivoFibra - macrosConsumidas.fibra_dia },
        
        // Indicador de Ultraprocesados (la meta es 0 Kcal)
        ultraprocesados: { meta: 0, actual: macrosConsumidas.ultraprocesados_dia },
    };
    
    // Asegurar que las calorías restantes no sean negativas
    progreso.kcal.restante = Math.max(0, progreso.kcal.restante);

    return progreso;
}

// --- Ejecución Inicial ---
initializeFirebase();