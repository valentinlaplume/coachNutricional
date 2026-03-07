
// ==============================================================================
// ╔══════════════════════════════════════════════════════════════════════════════╗
// ║  BLOQUE 19 — ONBOARDING                                                     ║
// ║  → Mover a onboarding.js                                                    ║
// ╚══════════════════════════════════════════════════════════════════════════════╝
// ==============================================================================

// ====================
// Incorporar en onboarding.js — onboardingSteps, finalizarOnboarding, showOnboardingModal
// ====================

// ==============================================================================
// === modulos/onboarding.js ===
// ==============================================================================
// Flujo de onboarding en página completa dedicada (4 pasos + pantalla resumen).
// Se monta sobre un <div id="onboarding-screen"> que debe existir en el HTML.
//
// IMPORTS NECESARIOS en este archivo:
// ==============================================================================

import { calcularMetricasNutricionales } from './nutrition.js';
import { savePerfil }                    from './firestore.js';
import { onLoginSuccess }                from './auth.js';


// ==============================================================================
// === CONFIGURACIÓN DE PASOS ===
// ==============================================================================

const onboardingSteps = [
    {
        id: "datos_basicos",
        titulo: "Contanos sobre vos",
        subtitulo: "Necesitamos estos datos para calcular tus necesidades calóricas exactas.",
        emoji: "🧬",
        campos: [
            {
                key: "sexo",
                tipo: "cards",
                label: "Sexo biológico",
                opciones: [
                    { value: "masculino", label: "Masculino", emoji: "♂️" },
                    { value: "femenino",  label: "Femenino",  emoji: "♀️" },
                ]
            },
            { key: "edad",        tipo: "number", label: "Edad",    placeholder: "25",   min: 14, max: 90, unidad: "años" },
            { key: "peso_actual", tipo: "number", label: "Peso",    placeholder: "75",   min: 30, max: 250, unidad: "kg" },
            { key: "altura",      tipo: "number", label: "Altura",  placeholder: "175",  min: 100, max: 230, unidad: "cm" },
        ]
    },
    {
        id: "objetivo",
        titulo: "¿Cuál es tu objetivo?",
        subtitulo: "Esto define tu plan calórico y la velocidad de progreso.",
        emoji: "🎯",
        campos: [
            {
                key: "objetivo",
                tipo: "cards",
                label: "Tu objetivo principal",
                opciones: [
                    { value: "perder_peso",    label: "Perder peso",     emoji: "🔥", desc: "Déficit calórico controlado" },
                    { value: "definicion",     label: "Definición",      emoji: "⚡", desc: "Perder grasa, mantener músculo" },
                    { value: "mantener",       label: "Mantener",        emoji: "⚖️", desc: "Equilibrio y bienestar" },
                    { value: "ganar_musculo",  label: "Ganar músculo",   emoji: "💪", desc: "Superávit + entrenamiento" },
                ]
            },
            { key: "peso_objetivo", tipo: "number", label: "Peso objetivo", placeholder: "70", min: 30, max: 250, unidad: "kg" },
            {
                key: "ritmo_semanal",
                tipo: "cards",
                label: "Ritmo de cambio semanal",
                opciones: [
                    { value: 0.25, label: "Suave",    emoji: "🐢", desc: "±0.25 kg/sem" },
                    { value: 0.5,  label: "Moderado", emoji: "🚶", desc: "±0.5 kg/sem" },
                    { value: 0.75, label: "Intenso",  emoji: "🏃", desc: "±0.75 kg/sem" },
                ]
            },
        ]
    },
    {
        id: "actividad",
        titulo: "Tu actividad física",
        subtitulo: "Usamos esto para calcular tu gasto energético total (TDEE).",
        emoji: "🏋️",
        campos: [
            {
                key: "fitness.nivel_actividad",
                tipo: "cards",
                label: "Nivel de actividad general",
                opciones: [
                    { value: "sedentario",  label: "Sedentario",   emoji: "🛋️",  desc: "Trabajo de oficina, poco movimiento" },
                    { value: "ligero",      label: "Ligero",       emoji: "🚶",  desc: "Ejercicio 1-2 días/semana" },
                    { value: "moderado",    label: "Moderado",     emoji: "🚴",  desc: "Ejercicio 3-5 días/semana" },
                    { value: "activo",      label: "Activo",       emoji: "🏃",  desc: "Ejercicio intenso 6-7 días/semana" },
                    { value: "muy_activo",  label: "Muy activo",   emoji: "⚡",  desc: "Atleta / trabajo físico exigente" },
                ]
            },
            {
                key: "fitness.tipo_entrenamiento",
                tipo: "cards",
                label: "Tipo de entrenamiento principal",
                opciones: [
                    { value: "Fuerza",                           label: "Fuerza",         emoji: "🏋️" },
                    { value: "Cardio",                           label: "Cardio",          emoji: "🏃" },
                    { value: "Fuerza (4 días) + Cardio (1 día)", label: "Fuerza + Cardio", emoji: "⚡" },
                    { value: "Crossfit / funcional",             label: "Crossfit",        emoji: "🔥" },
                    { value: "Deportes",                         label: "Deportes",        emoji: "⚽" },
                    { value: "Ninguno por ahora",                label: "Ninguno",         emoji: "😌" },
                ]
            },
            { key: "fitness.frecuencia_semanal", tipo: "number", label: "Días de entreno por semana", placeholder: "4", min: 0, max: 7, unidad: "días" },
        ]
    },
    {
        id: "habitos",
        titulo: "Tus hábitos",
        subtitulo: "Pequeños detalles que hacen la diferencia en tu recuperación.",
        emoji: "🌙",
        campos: [
            { key: "salud_y_sostenibilidad.hora_habitual_dormir",      tipo: "time", label: "¿A qué hora te dormís?",    placeholder: "23:00" },
            { key: "salud_y_sostenibilidad.hora_habitual_despertar",   tipo: "time", label: "¿A qué hora te levantás?",  placeholder: "07:00" },
            {
                key: "salud_y_sostenibilidad.nivel_estres_dia",
                tipo: "slider",
                label: "Nivel de estrés habitual",
                min: 1, max: 10,
                labels: ["Muy bajo", "Bajo", "Moderado", "Alto", "Muy alto"]
            },
            {
                key: "salud_y_sostenibilidad.tiempo_libre_cocina_semanal",
                tipo: "cards",
                label: "¿Cuánto tiempo tenés para cocinar por día?",
                opciones: [
                    { value: "15 mins por dia", label: "15 min",  emoji: "⚡", desc: "Muy poco tiempo" },
                    { value: "30 mins por dia", label: "30 min",  emoji: "🕐", desc: "Tiempo ajustado" },
                    { value: "40 mins por dia", label: "40 min",  emoji: "🍳", desc: "Tiempo normal" },
                    { value: "60 mins por dia", label: "60+ min", emoji: "👨‍🍳", desc: "Me gusta cocinar" },
                ]
            },
        ]
    },
];


// ==============================================================================
// === ESTADO INTERNO DEL ONBOARDING ===
// ==============================================================================

let currentStep = 0;
let datosRecolectados = {};


// ==============================================================================
// === FUNCIÓN PRINCIPAL: MOSTRAR ONBOARDING ===
// ==============================================================================

export function showOnboardingModal() {
    currentStep = 0;
    datosRecolectados = {};
    injectOnboardingHTML();
    renderStep(0);
}


// ==============================================================================
// === INYECCIÓN DEL HTML BASE ===
// ==============================================================================

function injectOnboardingHTML() {
    // Ocultar el resto de la app
    const appMain = document.getElementById('app-main');
    if (appMain) appMain.style.display = 'none';

    // Crear o limpiar el contenedor
    let screen = document.getElementById('onboarding-screen');
    if (!screen) {
        screen = document.createElement('div');
        screen.id = 'onboarding-screen';
        document.body.appendChild(screen);
    }

    screen.innerHTML = `
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=DM+Sans:wght@300;400;500&display=swap');

        #onboarding-screen {
            position: fixed;
            inset: 0;
            background: #0a0a0f;
            z-index: 9999;
            display: flex;
            flex-direction: column;
            font-family: 'DM Sans', sans-serif;
            overflow-y: auto;
            color: #f0ede8;
        }

        /* ── PROGRESS BAR ── */
        .ob-progress-bar-wrap {
            position: sticky;
            top: 0;
            z-index: 10;
            background: #0a0a0f;
            padding: 20px 32px 0;
        }
        .ob-progress-meta {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 10px;
        }
        .ob-logo {
            font-family: 'Syne', sans-serif;
            font-weight: 800;
            font-size: 1.1rem;
            color: #c8f03e;
            letter-spacing: -0.5px;
        }
        .ob-step-label {
            font-size: 0.78rem;
            color: #666;
            letter-spacing: 0.08em;
            text-transform: uppercase;
        }
        .ob-progress-track {
            height: 3px;
            background: #1e1e28;
            border-radius: 2px;
            overflow: hidden;
        }
        .ob-progress-fill {
            height: 100%;
            background: linear-gradient(90deg, #c8f03e, #7aef8a);
            border-radius: 2px;
            transition: width 0.5s cubic-bezier(0.4, 0, 0.2, 1);
        }

        /* ── MAIN CONTENT ── */
        .ob-content {
            flex: 1;
            max-width: 560px;
            width: 100%;
            margin: 0 auto;
            padding: 48px 32px 120px;
        }

        /* ── STEP HEADER ── */
        .ob-step-emoji {
            font-size: 2.8rem;
            margin-bottom: 16px;
            display: block;
            animation: ob-float 3s ease-in-out infinite;
        }
        @keyframes ob-float {
            0%, 100% { transform: translateY(0); }
            50%       { transform: translateY(-6px); }
        }
        .ob-step-titulo {
            font-family: 'Syne', sans-serif;
            font-weight: 800;
            font-size: clamp(1.6rem, 5vw, 2.2rem);
            color: #f0ede8;
            margin: 0 0 8px;
            line-height: 1.15;
            letter-spacing: -0.03em;
        }
        .ob-step-subtitulo {
            font-size: 0.9rem;
            color: #888;
            margin: 0 0 36px;
            line-height: 1.5;
        }

        /* ── FIELD LABEL ── */
        .ob-field { margin-bottom: 28px; }
        .ob-label {
            display: block;
            font-size: 0.78rem;
            font-weight: 500;
            color: #888;
            letter-spacing: 0.08em;
            text-transform: uppercase;
            margin-bottom: 10px;
        }

        /* ── INPUT NUMBER / TIME ── */
        .ob-input-wrap {
            display: flex;
            align-items: center;
            gap: 12px;
            background: #13131a;
            border: 1.5px solid #1e1e28;
            border-radius: 12px;
            padding: 0 16px;
            transition: border-color 0.2s;
        }
        .ob-input-wrap:focus-within {
            border-color: #c8f03e;
            box-shadow: 0 0 0 3px rgba(200, 240, 62, 0.08);
        }
        .ob-input-wrap input {
            flex: 1;
            background: transparent;
            border: none;
            outline: none;
            font-family: 'Syne', sans-serif;
            font-size: 1.6rem;
            font-weight: 700;
            color: #f0ede8;
            padding: 16px 0;
            width: 100%;
        }
        .ob-input-wrap input::placeholder { color: #2e2e3a; }
        .ob-input-unidad {
            font-size: 0.85rem;
            color: #555;
            font-weight: 500;
            white-space: nowrap;
        }

        /* ── CARDS ── */
        .ob-cards {
            display: grid;
            gap: 10px;
        }
        .ob-cards.cols-2 { grid-template-columns: 1fr 1fr; }
        .ob-cards.cols-3 { grid-template-columns: 1fr 1fr 1fr; }

        .ob-card {
            background: #13131a;
            border: 1.5px solid #1e1e28;
            border-radius: 12px;
            padding: 14px 16px;
            cursor: pointer;
            transition: all 0.2s;
            display: flex;
            align-items: center;
            gap: 12px;
            user-select: none;
        }
        .ob-card:hover {
            border-color: #2e2e3a;
            background: #16161f;
        }
        .ob-card.selected {
            border-color: #c8f03e;
            background: rgba(200, 240, 62, 0.06);
        }
        .ob-card.selected .ob-card-emoji { transform: scale(1.2); }
        .ob-card-emoji {
            font-size: 1.4rem;
            transition: transform 0.2s;
            flex-shrink: 0;
        }
        .ob-card-text { flex: 1; min-width: 0; }
        .ob-card-label {
            font-family: 'Syne', sans-serif;
            font-size: 0.9rem;
            font-weight: 700;
            color: #f0ede8;
            white-space: nowrap;
        }
        .ob-card-desc {
            font-size: 0.72rem;
            color: #666;
            margin-top: 1px;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .ob-card-check {
            width: 18px;
            height: 18px;
            border-radius: 50%;
            border: 1.5px solid #2e2e3a;
            flex-shrink: 0;
            transition: all 0.2s;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .ob-card.selected .ob-card-check {
            background: #c8f03e;
            border-color: #c8f03e;
        }
        .ob-card.selected .ob-card-check::after {
            content: '';
            width: 5px;
            height: 9px;
            border: 2px solid #0a0a0f;
            border-top: none;
            border-left: none;
            transform: rotate(45deg) translateY(-1px);
        }

        /* ── SLIDER ── */
        .ob-slider-wrap { position: relative; }
        .ob-slider {
            -webkit-appearance: none;
            appearance: none;
            width: 100%;
            height: 6px;
            background: #1e1e28;
            border-radius: 3px;
            outline: none;
            cursor: pointer;
        }
        .ob-slider::-webkit-slider-thumb {
            -webkit-appearance: none;
            appearance: none;
            width: 22px;
            height: 22px;
            border-radius: 50%;
            background: #c8f03e;
            cursor: pointer;
            box-shadow: 0 0 0 4px rgba(200, 240, 62, 0.15);
            transition: box-shadow 0.2s;
        }
        .ob-slider::-webkit-slider-thumb:hover {
            box-shadow: 0 0 0 8px rgba(200, 240, 62, 0.2);
        }
        .ob-slider-value {
            font-family: 'Syne', sans-serif;
            font-size: 2.2rem;
            font-weight: 800;
            color: #c8f03e;
            text-align: center;
            margin-bottom: 8px;
        }
        .ob-slider-labels {
            display: flex;
            justify-content: space-between;
            margin-top: 8px;
        }
        .ob-slider-label {
            font-size: 0.65rem;
            color: #444;
            text-align: center;
        }

        /* ── ERROR ── */
        .ob-error {
            color: #ff6b6b;
            font-size: 0.78rem;
            margin-top: 8px;
            display: none;
        }
        .ob-error.visible { display: block; }

        /* ── BOTTOM NAV ── */
        .ob-nav {
            position: fixed;
            bottom: 0;
            left: 0;
            right: 0;
            background: linear-gradient(to top, #0a0a0f 70%, transparent);
            padding: 20px 32px 32px;
            display: flex;
            gap: 12px;
            max-width: 560px;
            margin: 0 auto;
            width: 100%;
            left: 50%;
            transform: translateX(-50%);
        }
        .ob-btn-back {
            flex: 0 0 52px;
            height: 52px;
            border-radius: 12px;
            border: 1.5px solid #1e1e28;
            background: transparent;
            color: #888;
            font-size: 1.2rem;
            cursor: pointer;
            transition: all 0.2s;
        }
        .ob-btn-back:hover { border-color: #2e2e3a; color: #f0ede8; }
        .ob-btn-next {
            flex: 1;
            height: 52px;
            border-radius: 12px;
            border: none;
            background: #c8f03e;
            color: #0a0a0f;
            font-family: 'Syne', sans-serif;
            font-weight: 700;
            font-size: 0.95rem;
            cursor: pointer;
            letter-spacing: 0.02em;
            transition: all 0.2s;
            position: relative;
            overflow: hidden;
        }
        .ob-btn-next:hover {
            background: #d4f852;
            transform: translateY(-1px);
            box-shadow: 0 8px 24px rgba(200, 240, 62, 0.25);
        }
        .ob-btn-next:active { transform: translateY(0); }
        .ob-btn-next:disabled {
            background: #1e1e28;
            color: #444;
            transform: none;
            box-shadow: none;
            cursor: not-allowed;
        }

        /* ── STEP TRANSITION ── */
        .ob-step-enter {
            animation: ob-slide-in 0.35s cubic-bezier(0.4, 0, 0.2, 1) forwards;
        }
        @keyframes ob-slide-in {
            from { opacity: 0; transform: translateX(30px); }
            to   { opacity: 1; transform: translateX(0); }
        }
        .ob-step-exit {
            animation: ob-slide-out 0.25s cubic-bezier(0.4, 0, 0.2, 1) forwards;
        }
        @keyframes ob-slide-out {
            from { opacity: 1; transform: translateX(0); }
            to   { opacity: 0; transform: translateX(-30px); }
        }

        /* ── PANTALLA RESUMEN ── */
        .ob-resumen {
            animation: ob-slide-in 0.4s cubic-bezier(0.4, 0, 0.2, 1) forwards;
        }
        .ob-resumen-header {
            text-align: center;
            margin-bottom: 36px;
        }
        .ob-resumen-check {
            width: 72px;
            height: 72px;
            background: rgba(200, 240, 62, 0.1);
            border: 2px solid #c8f03e;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 2rem;
            margin: 0 auto 20px;
            animation: ob-pulse 2s ease-in-out infinite;
        }
        @keyframes ob-pulse {
            0%, 100% { box-shadow: 0 0 0 0 rgba(200, 240, 62, 0.3); }
            50%       { box-shadow: 0 0 0 12px rgba(200, 240, 62, 0); }
        }
        .ob-resumen-titulo {
            font-family: 'Syne', sans-serif;
            font-weight: 800;
            font-size: 1.8rem;
            color: #f0ede8;
            margin-bottom: 6px;
        }
        .ob-resumen-sub {
            font-size: 0.85rem;
            color: #666;
        }
        .ob-metricas-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 12px;
            margin-bottom: 28px;
        }
        .ob-metrica-card {
            background: #13131a;
            border: 1px solid #1e1e28;
            border-radius: 14px;
            padding: 18px 16px;
            position: relative;
            overflow: hidden;
        }
        .ob-metrica-card::before {
            content: '';
            position: absolute;
            top: 0; left: 0; right: 0;
            height: 2px;
            background: linear-gradient(90deg, #c8f03e, #7aef8a);
        }
        .ob-metrica-card.full { grid-column: 1 / -1; }
        .ob-metrica-label {
            font-size: 0.68rem;
            color: #666;
            text-transform: uppercase;
            letter-spacing: 0.08em;
            margin-bottom: 6px;
        }
        .ob-metrica-valor {
            font-family: 'Syne', sans-serif;
            font-size: 1.8rem;
            font-weight: 800;
            color: #c8f03e;
            line-height: 1;
        }
        .ob-metrica-unidad {
            font-size: 0.75rem;
            color: #555;
            margin-top: 3px;
        }
        .ob-macros-wrap {
            background: #13131a;
            border: 1px solid #1e1e28;
            border-radius: 14px;
            padding: 18px 16px;
            margin-bottom: 28px;
        }
        .ob-macros-titulo {
            font-size: 0.68rem;
            color: #666;
            text-transform: uppercase;
            letter-spacing: 0.08em;
            margin-bottom: 14px;
        }
        .ob-macro-row {
            display: flex;
            align-items: center;
            gap: 12px;
            margin-bottom: 10px;
        }
        .ob-macro-row:last-child { margin-bottom: 0; }
        .ob-macro-nombre {
            width: 90px;
            font-size: 0.8rem;
            color: #888;
        }
        .ob-macro-bar-wrap {
            flex: 1;
            height: 6px;
            background: #1e1e28;
            border-radius: 3px;
            overflow: hidden;
        }
        .ob-macro-bar {
            height: 100%;
            border-radius: 3px;
            transition: width 1s cubic-bezier(0.4, 0, 0.2, 1) 0.3s;
        }
        .ob-macro-gramos {
            font-family: 'Syne', sans-serif;
            font-size: 0.85rem;
            font-weight: 700;
            color: #f0ede8;
            width: 60px;
            text-align: right;
        }

        @media (max-width: 480px) {
            .ob-content { padding: 32px 20px 100px; }
            .ob-progress-bar-wrap { padding: 16px 20px 0; }
            .ob-cards.cols-3 { grid-template-columns: 1fr 1fr; }
        }
    </style>

    <!-- PROGRESS BAR -->
    <div class="ob-progress-bar-wrap">
        <div class="ob-progress-meta">
            <span class="ob-logo">🥗 NutriCoach</span>
            <span class="ob-step-label" id="ob-step-label">Paso 1 de ${onboardingSteps.length}</span>
        </div>
        <div class="ob-progress-track">
            <div class="ob-progress-fill" id="ob-progress-fill" style="width: 0%"></div>
        </div>
    </div>

    <!-- CONTENIDO DEL PASO -->
    <div class="ob-content" id="ob-step-content"></div>

    <!-- NAVEGACIÓN FIJA -->
    <div class="ob-nav">
        <button class="ob-btn-back" id="ob-btn-back" onclick="window.__ob_back()" style="display:none">←</button>
        <button class="ob-btn-next" id="ob-btn-next" onclick="window.__ob_next()">Continuar →</button>
    </div>
    `;

    // Exponer handlers globales
    window.__ob_next = handleNext;
    window.__ob_back = handleBack;
}


// ==============================================================================
// === RENDER DE UN PASO ===
// ==============================================================================

function renderStep(index) {
    const step      = onboardingSteps[index];
    const total     = onboardingSteps.length;
    const progreso  = ((index) / total) * 100;

    // Progress bar
    document.getElementById('ob-progress-fill').style.width = `${progreso}%`;
    document.getElementById('ob-step-label').textContent = `Paso ${index + 1} de ${total}`;

    // Botón atrás
    const btnBack = document.getElementById('ob-btn-back');
    btnBack.style.display = index > 0 ? 'flex' : 'none';
    btnBack.style.alignItems = 'center';
    btnBack.style.justifyContent = 'center';

    // Generar HTML del paso
    const container = document.getElementById('ob-step-content');
    container.innerHTML = `
        <div class="ob-step-enter">
            <span class="ob-step-emoji">${step.emoji}</span>
            <h2 class="ob-step-titulo">${step.titulo}</h2>
            <p class="ob-step-subtitulo">${step.subtitulo}</p>
            ${step.campos.map(campo => renderCampo(campo, index)).join('')}
        </div>
    `;

    // Restaurar valores guardados
    step.campos.forEach(campo => restaurarValor(campo));

    // Init sliders
    step.campos.filter(c => c.tipo === 'slider').forEach(campo => {
        const slider = document.getElementById(`ob-slider-${campo.key}`);
        const display = document.getElementById(`ob-slider-val-${campo.key}`);
        if (slider && display) {
            slider.addEventListener('input', () => {
                display.textContent = slider.value;
                actualizarSliderFill(slider);
            });
            actualizarSliderFill(slider);
        }
    });

    // Scroll top
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function actualizarSliderFill(slider) {
    const pct = ((slider.value - slider.min) / (slider.max - slider.min)) * 100;
    slider.style.background = `linear-gradient(90deg, #c8f03e ${pct}%, #1e1e28 ${pct}%)`;
}


// ==============================================================================
// === RENDER DE CADA TIPO DE CAMPO ===
// ==============================================================================

function renderCampo(campo, stepIndex) {
    const saved = getNestedValue(datosRecolectados, campo.key);

    if (campo.tipo === 'cards') {
        const cols = campo.opciones.length <= 2 ? 'cols-2'
                   : campo.opciones.length === 3 ? 'cols-3'
                   : campo.opciones.length >= 5  ? 'cols-2'
                   : 'cols-2';
        return `
        <div class="ob-field" id="ob-field-${campo.key.replace(/\./g,'-')}">
            <label class="ob-label">${campo.label}</label>
            <div class="ob-cards ${cols}">
                ${campo.opciones.map(op => `
                    <div class="ob-card ${saved == op.value ? 'selected' : ''}"
                         data-key="${campo.key}" data-value="${op.value}"
                         onclick="window.__ob_select(this)">
                        <span class="ob-card-emoji">${op.emoji}</span>
                        <div class="ob-card-text">
                            <div class="ob-card-label">${op.label}</div>
                            ${op.desc ? `<div class="ob-card-desc">${op.desc}</div>` : ''}
                        </div>
                        <div class="ob-card-check"></div>
                    </div>
                `).join('')}
            </div>
            <div class="ob-error" id="ob-err-${campo.key.replace(/\./g,'-')}">Seleccioná una opción</div>
        </div>`;
    }

    if (campo.tipo === 'number') {
        return `
        <div class="ob-field" id="ob-field-${campo.key.replace(/\./g,'-')}">
            <label class="ob-label" for="ob-input-${campo.key.replace(/\./g,'-')}">${campo.label}</label>
            <div class="ob-input-wrap">
                <input type="number" inputmode="numeric"
                    id="ob-input-${campo.key.replace(/\./g,'-')}"
                    data-key="${campo.key}"
                    placeholder="${campo.placeholder}"
                    min="${campo.min}" max="${campo.max}"
                    value="${saved || ''}"
                    class="ob-input-number" />
                <span class="ob-input-unidad">${campo.unidad}</span>
            </div>
            <div class="ob-error" id="ob-err-${campo.key.replace(/\./g,'-')}">Ingresá un valor válido</div>
        </div>`;
    }

    if (campo.tipo === 'time') {
        return `
        <div class="ob-field" id="ob-field-${campo.key.replace(/\./g,'-')}">
            <label class="ob-label" for="ob-input-${campo.key.replace(/\./g,'-')}">${campo.label}</label>
            <div class="ob-input-wrap">
                <input type="time"
                    id="ob-input-${campo.key.replace(/\./g,'-')}"
                    data-key="${campo.key}"
                    value="${saved || campo.placeholder}"
                    class="ob-input-number"
                    style="font-size:1.4rem" />
            </div>
            <div class="ob-error" id="ob-err-${campo.key.replace(/\./g,'-')}"></div>
        </div>`;
    }

    if (campo.tipo === 'slider') {
        const val = saved || Math.round((campo.min + campo.max) / 2);
        return `
        <div class="ob-field" id="ob-field-${campo.key.replace(/\./g,'-')}">
            <label class="ob-label">${campo.label}</label>
            <div class="ob-slider-value" id="ob-slider-val-${campo.key}">${val}</div>
            <div class="ob-slider-wrap">
                <input type="range" class="ob-slider"
                    id="ob-slider-${campo.key}"
                    data-key="${campo.key}"
                    min="${campo.min}" max="${campo.max}" value="${val}" step="1" />
            </div>
            ${campo.labels ? `
            <div class="ob-slider-labels">
                ${campo.labels.map(l => `<span class="ob-slider-label">${l}</span>`).join('')}
            </div>` : ''}
        </div>`;
    }

    return '';
}

function restaurarValor(campo) {
    // Las cards ya se restauran en el template, acá solo sliders y números si hacen falta
}


// ==============================================================================
// === SELECCIÓN DE CARDS ===
// ==============================================================================

window.__ob_select = function(card) {
    const key = card.dataset.key;
    // Deseleccionar todas las del mismo key
    document.querySelectorAll(`.ob-card[data-key="${key}"]`).forEach(c => c.classList.remove('selected'));
    card.classList.add('selected');
    // Limpiar error
    const errId = `ob-err-${key.replace(/\./g,'-')}`;
    const errEl = document.getElementById(errId);
    if (errEl) errEl.classList.remove('visible');
};


// ==============================================================================
// === RECOLECCIÓN Y VALIDACIÓN DE DATOS DEL PASO ACTUAL ===
// ==============================================================================

function recolectarPasoActual() {
    const step  = onboardingSteps[currentStep];
    let valid   = true;

    step.campos.forEach(campo => {
        const keyId = campo.key.replace(/\./g, '-');

        if (campo.tipo === 'cards') {
            const selected = document.querySelector(`.ob-card[data-key="${campo.key}"].selected`);
            if (!selected) {
                const errEl = document.getElementById(`ob-err-${keyId}`);
                if (errEl) errEl.classList.add('visible');
                valid = false;
            } else {
                let value = selected.dataset.value;
                // Convertir a número si es numérico
                if (!isNaN(value) && value !== '') value = parseFloat(value);
                setNestedValue(datosRecolectados, campo.key, value);
            }
        }

        if (campo.tipo === 'number') {
            const input = document.getElementById(`ob-input-${keyId}`);
            const val   = parseFloat(input?.value.trim());
            if (!input || isNaN(val) || val < campo.min || val > campo.max) {
                const errEl = document.getElementById(`ob-err-${keyId}`);
                if (errEl) { errEl.textContent = `Ingresá un valor entre ${campo.min} y ${campo.max}`; errEl.classList.add('visible'); }
                valid = false;
            } else {
                setNestedValue(datosRecolectados, campo.key, val);
            }
        }

        if (campo.tipo === 'time') {
            const input = document.getElementById(`ob-input-${keyId}`);
            if (input?.value) setNestedValue(datosRecolectados, campo.key, input.value);
        }

        if (campo.tipo === 'slider') {
            const slider = document.getElementById(`ob-slider-${campo.key}`);
            if (slider) setNestedValue(datosRecolectados, campo.key, parseInt(slider.value));
        }
    });

    return valid;
}


// ==============================================================================
// === NAVEGACIÓN ENTRE PASOS ===
// ==============================================================================

async function handleNext() {
    if (currentStep < onboardingSteps.length) {
        if (!recolectarPasoActual()) return;   // Validación falló
    }

    if (currentStep < onboardingSteps.length - 1) {
        currentStep++;
        renderStep(currentStep);
    } else {
        // Último paso → mostrar resumen
        await mostrarResumen();
    }
}

function handleBack() {
    if (currentStep > 0) {
        currentStep--;
        renderStep(currentStep);
    }
}


// ==============================================================================
// === PANTALLA RESUMEN DE MÉTRICAS ===
// ==============================================================================

// async function mostrarResumen() {
//     // Calcular métricas
//     const metricas = calcularMetricasNutricionales(datosRecolectados);

//     // Progress al 100%
//     document.getElementById('ob-progress-fill').style.width = '100%';
//     document.getElementById('ob-step-label').textContent = '¡Listo!';

//     // Calcular macros sugeridos
//     const protGramos  = Math.round((datosRecolectados.peso_actual || 0) * 1.9);
//     const grasGramos  = Math.round((metricas.calorias_objetivo * 0.25) / 9);
//     const carbGramos  = Math.round((metricas.calorias_objetivo - protGramos*4 - grasGramos*9) / 4);
//     const totalMacroKcal = protGramos*4 + grasGramos*9 + Math.max(0, carbGramos)*4;

//     const protPct = Math.round(protGramos*4 / totalMacroKcal * 100);
//     const grasPct = Math.round(grasGramos*9 / totalMacroKcal * 100);
//     const carbPct = 100 - protPct - grasPct;

//     const container = document.getElementById('ob-step-content');
//     container.innerHTML = `
//     <div class="ob-resumen">
//         <div class="ob-resumen-header">
//             <div class="ob-resumen-check">✓</div>
//             <h2 class="ob-resumen-titulo">Tu plan está listo</h2>
//             <p class="ob-resumen-sub">Basado en tus datos, estas son tus métricas personalizadas.</p>
//         </div>

//         <div class="ob-metricas-grid">
//             <div class="ob-metrica-card">
//                 <div class="ob-metrica-label">Metabolismo basal (TMB)</div>
//                 <div class="ob-metrica-valor">${metricas.tmb}</div>
//                 <div class="ob-metrica-unidad">kcal en reposo</div>
//             </div>
//             <div class="ob-metrica-card">
//                 <div class="ob-metrica-label">Gasto total diario (TDEE)</div>
//                 <div class="ob-metrica-valor">${metricas.tdee}</div>
//                 <div class="ob-metrica-unidad">kcal con actividad</div>
//             </div>
//             <div class="ob-metrica-card full">
//                 <div class="ob-metrica-label">🎯 Calorías objetivo diarias</div>
//                 <div class="ob-metrica-valor" style="font-size:2.4rem">${metricas.calorias_objetivo}</div>
//                 <div class="ob-metrica-unidad">
//                     ${metricas.calorias_objetivo < metricas.tdee
//                         ? `Déficit de ${metricas.tdee - metricas.calorias_objetivo} kcal → ${datosRecolectados.ritmo_semanal} kg/sem`
//                         : `Superávit de ${metricas.calorias_objetivo - metricas.tdee} kcal`}
//                 </div>
//             </div>
//         </div>

//         <div class="ob-macros-wrap">
//             <div class="ob-macros-titulo">Distribución de macros sugerida</div>
//             <div class="ob-macro-row">
//                 <span class="ob-macro-nombre">🥩 Proteína</span>
//                 <div class="ob-macro-bar-wrap">
//                     <div class="ob-macro-bar" style="width:0%; background:#c8f03e" data-pct="${protPct}"></div>
//                 </div>
//                 <span class="ob-macro-gramos">${protGramos}g</span>
//             </div>
//             <div class="ob-macro-row">
//                 <span class="ob-macro-nombre">🍚 Carbos</span>
//                 <div class="ob-macro-bar-wrap">
//                     <div class="ob-macro-bar" style="width:0%; background:#7aef8a" data-pct="${carbPct}"></div>
//                 </div>
//                 <span class="ob-macro-gramos">${Math.max(0, carbGramos)}g</span>
//             </div>
//             <div class="ob-macro-row">
//                 <span class="ob-macro-nombre">🥑 Grasas</span>
//                 <div class="ob-macro-bar-wrap">
//                     <div class="ob-macro-bar" style="width:0%; background:#f0c93e" data-pct="${grasPct}"></div>
//                 </div>
//                 <span class="ob-macro-gramos">${grasGramos}g</span>
//             </div>
//         </div>
//     </div>
//     `;

//     // Animar barras de macros con delay
//     setTimeout(() => {
//         document.querySelectorAll('.ob-macro-bar').forEach(bar => {
//             bar.style.width = `${bar.dataset.pct}%`;
//         });
//     }, 200);

//     // Cambiar botón a "Empezar"
//     const btnNext = document.getElementById('ob-btn-next');
//     btnNext.textContent = '🚀 Empezar mi plan';
//     btnNext.onclick = () => guardarYEntrar(metricas);

//     // Ocultar botón atrás
//     document.getElementById('ob-btn-back').style.display = 'none';
// }

async function mostrarResumen() {
    const metricas = calcularMetricasNutricionales(datosRecolectados);
    const peso = datosRecolectados.peso_actual || 0;
    const objetivo = datosRecolectados.objetivo; // Asumiendo 'perder', 'mantener', 'ganar'

    // 1. CÁLCULO DINÁMICO DE PROTEÍNA
    // Ajustamos el factor según el objetivo para proteger músculo o optimizar síntesis
    let factorProteina = 1.8; 
    if (objetivo === 'perder') factorProteina = 2.2; // Mayor protección en déficit
    if (objetivo === 'ganar') factorProteina = 1.7;  // El superávit ya ayuda, no hace falta tanta
    
    const protGramos = Math.round(peso * factorProteina);

    // 2. CÁLCULO DE GRASAS CON MÍNIMO DE SEGURIDAD
    // Usamos el 25% de las kcal, pero nunca menos de 0.7g por kilo de peso
    const kcalGrasasSugeridas = metricas.calorias_objetivo * 0.25;
    let grasGramos = Math.round(kcalGrasasSugeridas / 9);
    const minGrasasSaludable = Math.round(peso * 0.7);

    if (grasGramos < minGrasasSaludable) {
        grasGramos = minGrasasSaludable;
    }

    // 3. CARBOHIDRATOS (RESTO DE CALORÍAS)
    const kcalRestantes = metricas.calorias_objetivo - (protGramos * 4) - (grasGramos * 9);
    const carbGramos = Math.round(Math.max(0, kcalRestantes) / 4);

    // 4. CÁLCULO DE PORCENTAJES REALES PARA LA UI
    const totalKcalFinal = (protGramos * 4) + (grasGramos * 9) + (carbGramos * 4);
    const protPct = Math.round((protGramos * 4 / totalKcalFinal) * 100);
    const grasPct = Math.round((grasGramos * 9 / totalKcalFinal) * 100);
    const carbPct = 100 - protPct - grasPct;

    // Lógica de advertencia
    const ritmoSemanas = datosRecolectados.ritmo_semanal || 0;
    const esAgresivo = ritmoSemanas > 1.0;
    const advertenciaHtml = esAgresivo 
    ? `<div class="ob-alert-warning" style="color: #ff9800; font-size: 0.85rem; margin-top: 8px; font-weight: 600;">
        ⚠️ Ritmo agresivo: Priorizá la proteína para cuidar tu músculo.
       </div>` 
    : '';

    // --- RENDERIZADO DE UI ---
    document.getElementById('ob-progress-fill').style.width = '100%';
    document.getElementById('ob-step-label').textContent = '¡Listo!';

    const container = document.getElementById('ob-step-content');
    container.innerHTML = `
    <div class="ob-resumen">
        <div class="ob-resumen-header">
            <div class="ob-resumen-check">✓</div>
            <h2 class="ob-resumen-titulo">Tu plan está listo</h2>
            <p class="ob-resumen-sub">Basado en tus datos de <b>${peso}kg</b> y objetivo de <b>${objetivo}</b>.</p>
        </div>

        <div class="ob-metricas-grid">
            <div class="ob-metrica-card">
                <div class="ob-metrica-label">Metabolismo basal (TMB)</div>
                <div class="ob-metrica-valor">${metricas.tmb}</div>
                <div class="ob-metrica-unidad">kcal en reposo</div>
            </div>
            <div class="ob-metrica-card">
                <div class="ob-metrica-label">Gasto total diario (TDEE)</div>
                <div class="ob-metrica-valor">${metricas.tdee}</div>
                <div class="ob-metrica-unidad">kcal con actividad</div>
            </div>
            <div class="ob-metrica-card full">
                <div class="ob-metrica-label">🎯 Calorías objetivo diarias</div>
                <div class="ob-metrica-valor" style="font-size:2.4rem">${metricas.calorias_objetivo}</div>
                <div class="ob-metrica-unit-wrap">
                    <div class="ob-metrica-unidad">
                        ${metricas.calorias_objetivo < metricas.tdee
                            ? `Déficit de ${metricas.tdee - metricas.calorias_objetivo} kcal → -${ritmoSemanas} kg/sem`
                            : `Superávit de ${metricas.calorias_objetivo - metricas.tdee} kcal`}
                    </div>
                    ${advertenciaHtml}
                </div>
            </div>
        </div>

        <div class="ob-macros-wrap">
            <div class="ob-macros-titulo">Distribución de macros sugerida</div>
            <div class="ob-macro-row">
                <span class="ob-macro-nombre">🥩 Proteína (${factorProteina}g/kg)</span>
                <div class="ob-macro-bar-wrap">
                    <div class="ob-macro-bar" style="width:0%; background:#c8f03e" data-pct="${protPct}"></div>
                </div>
                <span class="ob-macro-gramos">${protGramos}g</span>
            </div>
            <div class="ob-macro-row">
                <span class="ob-macro-nombre">🍚 Carbos</span>
                <div class="ob-macro-bar-wrap">
                    <div class="ob-macro-bar" style="width:0%; background:#7aef8a" data-pct="${carbPct}"></div>
                </div>
                <span class="ob-macro-gramos">${carbGramos}g</span>
            </div>
            <div class="ob-macro-row">
                <span class="ob-macro-nombre">🥑 Grasas (Mín. salud)</span>
                <div class="ob-macro-bar-wrap">
                    <div class="ob-macro-bar" style="width:0%; background:#f0c93e" data-pct="${grasPct}"></div>
                </div>
                <span class="ob-macro-gramos">${grasGramos}g</span>
            </div>
        </div>
    </div>`;

    // Animación y setup de botones igual que antes...
    setTimeout(() => {
        document.querySelectorAll('.ob-macro-bar').forEach(bar => {
            bar.style.width = `${bar.dataset.pct}%`;
        });
    }, 200);

    const btnNext = document.getElementById('ob-btn-next');
    btnNext.textContent = '🚀 Empezar mi plan';
    btnNext.onclick = () => guardarYEntrar({...metricas, macros: {protGramos, grasGramos, carbGramos}});
    document.getElementById('ob-btn-back').style.display = 'none';
}


// ==============================================================================
// === GUARDAR EN FIRESTORE Y ENTRAR A LA APP ===
// ==============================================================================

async function guardarYEntrar(metricas) {
    const btnNext = document.getElementById('ob-btn-next');
    btnNext.disabled = true;
    btnNext.textContent = 'Guardando...';

    try {
        await finalizarOnboarding({ ...datosRecolectados, ...metricas });
        // Limpiar onboarding screen
        const screen = document.getElementById('onboarding-screen');
        if (screen) screen.remove();
    } catch (error) {
        console.error('Error guardando onboarding:', error);
        btnNext.disabled = false;
        btnNext.textContent = '🚀 Empezar mi plan';
        alert('Error al guardar. Intentá de nuevo.');
    }
}


// ==============================================================================
// === EXPORTS ===
// ==============================================================================

export async function finalizarOnboarding(datosCompletos) {
    await savePerfil({ ...datosCompletos, onboarding_completado: true });
    onLoginSuccess();
}


// ==============================================================================
// === HELPERS: ACCESO A OBJETOS ANIDADOS (ej: "fitness.nivel_actividad") ===
// ==============================================================================

function setNestedValue(obj, path, value) {
    const keys = path.split('.');
    let current = obj;
    for (let i = 0; i < keys.length - 1; i++) {
        if (!current[keys[i]] || typeof current[keys[i]] !== 'object') {
            current[keys[i]] = {};
        }
        current = current[keys[i]];
    }
    current[keys[keys.length - 1]] = value;
}

function getNestedValue(obj, path) {
    return path.split('.').reduce((acc, key) => acc?.[key], obj);
}
