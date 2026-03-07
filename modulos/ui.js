
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
        ...(logConsumed || []).map(i => ({ ...i, type: 'consumo', sortKey: new Date(i.hora).getTime() })),
        ...(logExpended || []).map(i => ({ ...i, type: 'gasto', sortKey: new Date(i.hora).getTime() })),
    ].sort((a, b) => a.sortKey - b.sortKey);

    if (combined.length === 0) {
        elements.emptyLogMessage.style.display = 'block';
        return;
    }
    elements.emptyLogMessage.style.display = 'none';

    combined.forEach(item => {
        const dateObj = new Date(item.hora);
        const time = dateObj.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
        const isConsumption = item.type === 'consumo';

        // 1. LÓGICA DE DESCRIPCIÓN (Estructura de Datos)
        let descripcionHTML = "";
        if (isConsumption) {
            if (item.recetasUsadas && item.recetasUsadas.length > 0) {
                const recetas = item.recetasUsadas.map(r => `
                    <div class="d-inline-flex align-items-center bg-light border rounded-pill px-2 py-1 me-1 mb-1" 
                        style="font-size: 0.85rem; cursor: pointer; transition: background 0.2s;"
                        onclick="window.verDetalleReceta('${r.nombre}')"
                        onmouseover="this.style.backgroundColor='#e9ecef'"
                        onmouseout="this.style.backgroundColor='#f8f9fa'">
                        <i class="fas fa-search-plus text-primary me-1" style="font-size: 0.7rem;"></i>
                        <span class="fw-bold text-dark">${r.nombre}</span>
                        <span class="text-muted ms-1">${r.cantidad}${r.unidad}</span>
                    </div>
                `).join('');

                const manual = item.descripcionManual 
                    ? `<div class="mt-2 ps-2 border-start border-2 border-primary-subtle text-muted italic" style="font-size: 0.85rem;">
                        <small class="fw-bold text-uppercase" style="font-size: 0.65rem;">Extras:</small> ${item.descripcionManual}
                       </div>` 
                    : "";
                descripcionHTML = `<div class="d-flex flex-wrap align-items-center">${recetas}</div>${manual}`;
            } else {
                descripcionHTML = `<div class="fw-medium text-dark">${item.descripcion || item.descripcionManual}</div>`;
            }
        } else {
            descripcionHTML = `<div class="fw-medium text-dark"><i class="fas fa-running me-2 text-danger"></i>${item.descripcion}</div>`;
        }

        // 2. BLOQUE DE MACROS (Visualización tipo Dashboard)
        let macrosHTML = '';
        if (isConsumption) {
            macrosHTML = `
            <div class="mt-3 p-2 bg-light rounded-3">
                <div class="row g-2 text-center">
                    <div class="col-3">
                        <div class="text-muted" style="font-size: 0.65rem;">PROT🥩</div>
                        <div class="fw-bold text-dark" style="font-size: 0.85rem;">${item.proteinas}g</div>
                    </div>
                    <div class="col-3 border-start">
                        <div class="text-muted" style="font-size: 0.65rem;">CARBS🍚</div>
                        <div class="fw-bold text-dark" style="font-size: 0.85rem;">${item.carbohidratos}g</div>
                    </div>
                    <div class="col-3 border-start">
                        <div class="text-muted" style="font-size: 0.65rem;">GRASAS🥑</div>
                        <div class="fw-bold text-dark" style="font-size: 0.85rem;">${item.grasas}g</div>
                    </div>
                    <div class="col-3 border-start">
                        <div class="text-muted" style="font-size: 0.65rem;">FIBRA🥕</div>
                        <div class="fw-bold text-dark" style="font-size: 0.85rem;">${item.fibra}g</div>
                    </div>
                </div>
            </div>`;
        }

        // 3. CONSTRUCCIÓN DEL CARD
        const listItem = document.createElement('div');
        listItem.className = 'animate-in mb-3';
        listItem.innerHTML = `
            <div class="card border-0 shadow-sm overflow-hidden" style="border-radius: 12px;">
                <div class="card-body p-3">
                    <div class="d-flex justify-content-between align-items-start mb-2">
                        <div class="min-w-0">
                            <span class="badge ${isConsumption ? 'bg-primary-subtle text-primary' : 'bg-danger-subtle text-danger'} text-uppercase" style="font-size: 0.65rem; letter-spacing: 0.5px;">
                                ${isConsumption ? getMealCategory(dateObj) : 'Ejercicio'}
                            </span>
                            <span class="text-muted ms-2 small">${time}</span>
                        </div>
                        <div class="text-end">
                            <div class="fw-bold ${isConsumption ? 'text-success' : 'text-danger'}" style="font-size: 1.1rem;">
                                ${isConsumption ? '+' : '-'}${Math.round(item.kcal)} <small style="font-size: 0.7rem;">Kcal</small>
                            </div>
                        </div>
                    </div>

                    <div class="meal-content mb-1">
                        ${descripcionHTML}
                    </div>

                    ${macrosHTML}

                    <div class="d-flex justify-content-end mt-2">
                        <button class="btn btn-sm btn-light text-muted p-1 px-2" style="font-size: 0.75rem;" onclick="window.deleteLogItem('${item.type}', '${item.id}', ${item.kcal})">
                            <i class="fas fa-trash-alt me-1"></i> Borrar
                        </button>
                    </div>
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