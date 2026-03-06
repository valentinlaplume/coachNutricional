
// ==============================================================================
// ╔══════════════════════════════════════════════════════════════════════════════╗
// ║  BLOQUE 14 — UI: RENDER DEL LOG Y MACROS                                    ║
// ║  → Mover a ui.js                                                            ║
// ╚══════════════════════════════════════════════════════════════════════════════╝
// ==============================================================================

// ====================
// Incorporar en ui.js — sanitizeHTML, renderCombinedLog,
// renderMacronutrients, renderTargetProgress, updateWeekSummaryUI,
// showLogDetails, updateActiveUserUI
// ====================

import { getElements } from './elements.js';
let elements = getElements();

import {
    currentLogData,
    selectedDay,
    todayISO,
    formatDate,
    getDayNameShort,
    getActivePersonName,
    weekData,       
    activePersonId,
    activePersonName
} from './state.js';

import { getDailyDocRef  } from './firestore.js';
import {  getMealCategory  } from './coach.js';



function sanitizeHTML(html) {
    const allowedTags = ['br', 'strong', 'b', 'i', 'em', 'span', 'hr'];
    const temp = document.createElement('div');
    temp.innerHTML = html;
    const allElements = temp.getElementsByTagName('*');
    for (let i = allElements.length - 1; i >= 0; i--) {
        const el = allElements[i];
        if (!allowedTags.includes(el.tagName.toLowerCase())) el.replaceWith(el.textContent);
    }
    for (let el of temp.getElementsByTagName('*')) {
        while (el.attributes.length > 0) el.removeAttribute(el.attributes[0].name);
    }
    return temp.innerHTML;
}

export function updateWeekSummaryUI() {
    let totalConsumed = 0, totalExpended = 0;
    for (const dateISO in weekData) {
        totalConsumed  += weekData[dateISO].consumido || 0;
        totalExpended  += weekData[dateISO].gastado   || 0;
    }
    const netBalance = Number((totalConsumed - totalExpended).toFixed(2));
    elements.totalConsumidoSemana.textContent = totalConsumed;
    elements.totalGastadoSemana.textContent   = totalExpended;
    elements.netBalanceSemana.textContent     = netBalance;
    elements.balanceNetoSemanaBox.style.background =
        netBalance > 1000  ? 'linear-gradient(135deg, #ff9500 0%, #ff3b30 100%)' :
        netBalance < -1000 ? 'linear-gradient(135deg, #34c759 0%, #30d158 100%)' :
                             'linear-gradient(135deg, #007aff 0%, #5ac8fa 100%)';
}

export function updateActiveUserUI() {
    elements.activeUserName.textContent = activePersonName;
    elements.emptyLogUser.textContent   = activePersonName;
}

export function renderMacronutrients(macros) {
    elements.proteinasDiaDisplay.textContent      = Math.round(macros.proteinas_dia * 10) / 10;
    elements.carbohidratosDiaDisplay.textContent  = Math.round(macros.carbohidratos_dia * 10) / 10;
    elements.grasasDiaDisplay.textContent         = Math.round(macros.grasas_dia * 10) / 10;
    elements.fibraDiaDisplay.textContent          = Math.round(macros.fibra_dia * 10) / 10;
    elements.ultraprocesadosDiaDisplay.textContent= Math.round(macros.ultraprocesados_dia);
}

export function renderTargetProgress(metas) {
    const fmtG    = (a, m) => `${Math.round(a)}g / ${Math.round(m)}g`;
    const fmtKcal = (a, m) => `${Math.round(a)} Kcal / ${Math.round(m)} Kcal`;
    if (elements.proteinaProgress)      elements.proteinaProgress.textContent      = fmtG(metas.proteina.actual, metas.proteina.meta);
    if (elements.carbohidratosProgress) elements.carbohidratosProgress.textContent = fmtG(metas.carbohidratos.actual, metas.carbohidratos.meta);
    if (elements.grasasProgress)        elements.grasasProgress.textContent        = fmtG(metas.grasas.actual, metas.grasas.meta);
    if (elements.fibraProgress)         elements.fibraProgress.textContent         = fmtG(metas.fibra.actual, metas.fibra.meta);
    if (elements.kcalTargetProgress)    elements.kcalTargetProgress.textContent    = fmtKcal(metas.kcal.actual, metas.kcal.meta);
    if (elements.kcalRestanteDisplay) {
        const excedente = metas.kcal.actual - metas.kcal.meta;
        if (metas.kcal.restante > 0) {
            elements.kcalRestanteDisplay.textContent = `(Quedan ${Math.round(metas.kcal.restante)} Kcal)`;
            elements.kcalRestanteDisplay.className = 'text-success fw-bold';
        } else if (excedente <= 0) {
            elements.kcalRestanteDisplay.textContent = '(¡Meta alcanzada!)';
            elements.kcalRestanteDisplay.className = 'text-info fw-bold';
        } else {
            elements.kcalRestanteDisplay.textContent = `(Excedido por ${Math.round(excedente)} Kcal)`;
            elements.kcalRestanteDisplay.className = 'text-danger fw-bold';
        }
    }
}

export function renderCombinedLog(logConsumed, logExpended) {
    elements.foodLog.innerHTML = '';
    const combined = [
        ...(logConsumed  || []).map(i => ({ ...i, type: 'consumo', sortKey: new Date(i.hora).getTime() })),
        ...(logExpended  || []).map(i => ({ ...i, type: 'gasto',   sortKey: new Date(i.hora).getTime() })),
    ].sort((a, b) => a.sortKey - b.sortKey);

    if (combined.length === 0) { elements.emptyLogMessage.style.display = 'block'; return; }
    elements.emptyLogMessage.style.display = 'none';

    combined.forEach(item => {
        const dateObj     = new Date(item.hora);
        const time        = dateObj.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false });
        const isConsumption = item.type === 'consumo';
        const badgeClass  = isConsumption ? 'bg-success' : 'bg-danger';
        const sign        = isConsumption ? '+' : '-';
        const mealCategory= isConsumption ? getMealCategory(dateObj) : 'Ejercicio';

        let macrosHTML = '';
        if (isConsumption) {
            const p = Math.round(item.proteinas*10)/10, c = Math.round(item.carbohidratos*10)/10,
                  g = Math.round(item.grasas*10)/10,    f = Math.round(item.fibra*10)/10;
            macrosHTML = `
            <div class="macro-details mt-2 pt-2 border-top border-light-subtle">
                <div class="row small text-secondary">
                    <div class="col-12">🥩 Proteínas: <strong>${p}g</strong></div>
                    <div class="col-12">🍚 Carbohidratos: <strong>${c}g</strong></div>
                    <div class="col-12">🥑 Grasas: <strong>${g}g</strong></div>
                    <div class="col-12">🥕 Fibra: <strong>${f}g</strong></div>
                </div>
            </div>`;
        }

        const listItem = document.createElement('div');
        listItem.className = 'log-item-card animate-in';
        listItem.innerHTML = `
            <div class="d-flex justify-content-between align-items-start gap-3">
                <div class="flex-grow-1 min-w-0">
                    <div class="meal-category mb-1">${mealCategory}<span class="meal-time ms-2">${time}</span></div>
                    <div class="meal-description">${item.descripcion}</div>
                    ${macrosHTML}
                </div>
                <div class="d-flex flex-column align-items-end gap-2">
                    <span class="badge calorie-badge ${badgeClass}">${sign}${Math.round(item.kcal)} Kcal</span>
                    <button type="button" class="delete-btn"
                        onclick="window.deleteLogItem('${item.type}', '${item.id}', ${item.kcal})"
                        aria-label="Eliminar registro">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>`;
        elements.foodLog.appendChild(listItem);
    });
}

function showLogDetails(type) {
    const isConsumption = type === 'consumo';
    const log    = isConsumption ? currentLogData.log_consumido : currentLogData.log_gastado;
    const total  = isConsumption ? currentLogData.consumido : currentLogData.gastado;
    const title  = `${isConsumption ? 'Consumo' : 'Gasto'} de ${activePersonName} (${getDayNameShort(selectedDay)}, ${formatDate(selectedDay)})`;

    elements.logDetailsModalTitle.textContent = title;
    elements.modalTotalLabel.textContent      = isConsumption ? 'Total Consumido' : 'Total Gastado';
    elements.modalTotalValue.textContent      = `${total} Kcal`;
    elements.modalTotalValue.className        = `px-4 py-2 text-white fw-bold rounded-pill ${isConsumption ? 'bg-success' : 'bg-danger'}`;
    elements.modalLogContent.innerHTML        = '';

    if (!log || log.length === 0) {
        elements.modalLogContent.innerHTML = `<p class="text-center text-muted p-4">No hay registros.</p>`;
    } else {
        [...log].sort((a, b) => new Date(b.hora) - new Date(a.hora)).forEach(item => {
            const time = new Date(item.hora).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false });
            const el = document.createElement('div');
            el.className = 'log-item-card';
            el.innerHTML = `
                <div class="d-flex justify-content-between align-items-center gap-3">
                    <div class="flex-grow-1 min-w-0">
                        <div class="meal-category">${item.descripcion}</div>
                        <div class="meal-time">${time}</div>
                    </div>
                    <div class="d-flex align-items-center gap-2">
                        <span class="badge calorie-badge ${isConsumption ? 'bg-success' : 'bg-danger'}">
                            ${isConsumption ? '+' : '-'}${item.kcal} Kcal
                        </span>
                        <button type="button" class="delete-btn"
                            onclick="window.deleteLogItem('${type}', '${item.id}', ${item.kcal}); elements.logDetailsModal.hide();">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </div>`;
            elements.modalLogContent.appendChild(el);
        });
    }
    elements.logDetailsModal.show();
}


// ==============================================================================
// ╔══════════════════════════════════════════════════════════════════════════════╗
// ║  BLOQUE 18 — UI HELPERS GENERALES                                           ║
// ║  → Mover a ui.js                                                            ║
// ╚══════════════════════════════════════════════════════════════════════════════╝
// ==============================================================================

// ====================
// Incorporar en ui.js — showLoadingButton, showUpgradeModal,
// closeUpgradeModal, showToast
// ====================

function showLoadingButton(btnId, loading) {
    const btn = document.getElementById(btnId);
    if (!btn) return;
    btn.disabled = loading;
    btn.dataset.originalText = btn.dataset.originalText || btn.textContent;
    btn.textContent = loading ? "Cargando..." : btn.dataset.originalText;
}

function showUpgradeModal(razon) {
    document.getElementById("upgrade-reason").textContent = razon;
    document.getElementById("upgrade-modal").style.display = "flex";
}

function closeUpgradeModal() {
    document.getElementById("upgrade-modal").style.display = "none";
}

export function showToast(msg, type = "info") {
    const toast = document.createElement("div");
    toast.className = `toast toast-${type}`;
    toast.textContent = msg;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 4000);
}

export function setupSummaryClickHandlers() {
    elements.consumidoBox.addEventListener('click', () => showLogDetails('consumo'));
    elements.gastadoBox.addEventListener('click',   () => showLogDetails('gasto'));
}