import { misRecetas, setMisRecetas } from "./state.js";
import { getCollection, saveReceta } from "./firestore.js";
import { fetchGeminiFoodData } from "./gemini.js";

let stagingComidas = [];
let selectedRecipe = null;

export function getStagingComidas() { return stagingComidas; }
export function clearStaging() { stagingComidas = []; renderStagingUI(); }


// 1. Activa los botones de la interfaz principal para abrir el selector
export function setupFiltrosUI() {
    const modalElement = document.getElementById('modalRecetas');
    const inputBusqueda = document.getElementById('searchRecetas'); // El ID del nuevo input
    if (!modalElement) return;
    
    const bsModal = new bootstrap.Modal(modalElement);
    let filtroActivo = 'todos';

    // --- FUNCIÓN AUXILIAR DE RENDERIZADO ---
    const ejecutarFiltrado = () => {
        const texto = inputBusqueda ? inputBusqueda.value.toLowerCase() : '';
        renderRecetasGrid(misRecetas, filtroActivo, texto);
    };

    // 1. Eventos para los Botones de Filtro
    document.querySelectorAll('.btn-filtro-receta').forEach(boton => {
        boton.addEventListener('click', (e) => {
            filtroActivo = e.currentTarget.dataset.filtro;
            
            // Actualizar UI del título
            document.getElementById('tituloModalRecetas').innerText = `Filtrar: ${e.currentTarget.innerText}`;
            
            ejecutarFiltrado();
            bsModal.show();
        });
    });

    // 2. Evento para el Buscador (si existe en el DOM)
    inputBusqueda?.addEventListener('input', () => {
        ejecutarFiltrado();
    });

    // 3. Limpiar buscador al cerrar el modal (Opcional, para UX limpia)
    modalElement.addEventListener('hidden.bs.modal', () => {
        if (inputBusqueda) inputBusqueda.value = '';
        filtroActivo = 'todos';
    });
}
// 2. Dibuja la grilla de recetas dentro del modal
// Dentro de tu archivo de recetas.js
export function renderRecetasGrid(recetas, filtroTipo = 'todos', busqueda = '') {
    const grid = document.getElementById('recetasGrid');
    if (!grid) return;

    grid.innerHTML = '';

    let filtradas = recetas || [];
    if (filtroTipo === 'alta-proteina') filtradas = recetas.filter(r => (r.proteinas || 0) >= 15);
    else if (filtroTipo === 'bebidas') filtradas = recetas.filter(r => r.unidad === 'ml');
    else if (filtroTipo === 'bajo-grasa') filtradas = recetas.filter(r => (r.grasas || 0) <= 5);
    else if (filtroTipo === 'fibra') filtradas = recetas.filter(r => (r.fibra || 0) >= 5);

    // 2. Filtrado por Texto (Buscador)
    if (busqueda.trim() !== "") {
        filtradas = filtradas.filter(r => 
            r.nombre.toLowerCase().includes(busqueda.trim().toLowerCase())
        );
    }

    const html = filtradas.map(receta => {
        // Redondeamos para que la visualización sea limpia
        const p = Math.round(receta.proteinas || 0);
        const c = Math.round(receta.carbohidratos || 0);
        const g = Math.round(receta.grasas || 0);
        const f = Math.round(receta.fibra || 0);

        return `
        <div class="col">
            <div class="card border-0 shadow-sm h-100 recipe-card" 
                 onclick="window.openRecipeQtyModal('${receta.id}')"> 
                <div class="card-body p-3">
                    <div class="d-flex justify-content-between align-items-start mb-2">
                        <div class="fw-bold text-dark small text-truncate" style="max-width: 70%;">
                            ${receta.nombre}
                        </div>
                        <span class="badge rounded-pill bg-primary-subtle text-primary border border-primary-subtle" style="font-size: 0.7rem;">
                            ${Math.round(receta.kcal)} kcal
                        </span>
                    </div>

                    <div class="d-flex gap-1 mt-2 justify-content-between">
                        <div class="macro-item text-center">
                            <div class="text-muted" style="font-size: 0.6rem; text-transform: uppercase;">PROT</div>
                            <div class="fw-bold text-primary" style="font-size: 0.75rem;">${p}g</div>
                        </div>
                        <div class="macro-item text-center">
                            <div class="text-muted" style="font-size: 0.6rem; text-transform: uppercase;">CARBS</div>
                            <div class="fw-bold text-warning" style="font-size: 0.75rem;">${c}g</div>
                        </div>
                        <div class="macro-item text-center">
                            <div class="text-muted" style="font-size: 0.6rem; text-transform: uppercase;">GRASAS</div>
                            <div class="fw-bold text-success" style="font-size: 0.75rem;">${g}g</div>
                        </div>
                         <div class="macro-item text-center">
                            <div class="text-muted" style="font-size: 0.6rem; text-transform: uppercase;">FIBRA</div>
                            <div class="fw-bold text-success" style="font-size: 0.75rem;">${f}g</div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `}).join('');

    grid.innerHTML = html || `
        <div class="col-12 text-center p-5">
            <i class="fas fa-utensils text-light mb-2" style="font-size: 2rem;"></i>
            <p class="small text-muted">No se encontraron recetas.</p>
        </div>`;
}
window.openRecipeQtyModal = (id) => {
    const receta = misRecetas.find(r => r.id === id);
    if (!receta) return;
    
    selectedRecipe = receta;
    
    // 1. Título y Unidad
    document.getElementById('modalRecipeTitle').innerText = receta.nombre;
    const unidadLarga = { 'g': 'gramos', 'ml': 'mililitros', 'unidad': 'unidades' };
    const textoUnidad = unidadLarga[receta.unidad] || receta.unidad || 'gramos';
    document.getElementById('modalUnitLabel').innerText = textoUnidad;

    // 2. Configurar Input
    const inputGrams = document.getElementById('modalGramsInput');
    inputGrams.value = 100; // Valor inicial por defecto
    inputGrams.placeholder = `Cantidad en ${textoUnidad}`;

    // 3. Función interna para calcular y mostrar macros
    const actualizarVistaMacros = () => {
        const cantidad = parseFloat(inputGrams.value) || 0;
        // Fórmula: (Macro / 100) * cantidad
        const kcal = Math.round((receta.kcal / 100) * cantidad);
        const p = Math.round((receta.proteinas / 100) * cantidad);
        const c = Math.round((receta.carbohidratos / 100) * cantidad);
        const g = Math.round((receta.grasas / 100) * cantidad);

        document.getElementById('recipeModalMacros').innerHTML = `
            <div class="d-flex justify-content-between align-items-center mb-2">
                <span class="badge bg-primary fs-6">${kcal} kcal</span>
                <small class="text-muted">Macros para ${cantidad}${receta.unidad || 'g'}</small>
            </div>
            <div class="row g-2 text-center">
                <div class="col-4">
                    <div class="p-2 border rounded-3 bg-white">
                        <div class="text-xs text-muted">Prot</div>
                        <div class="fw-bold text-primary">${p}g</div>
                    </div>
                </div>
                <div class="col-4">
                    <div class="p-2 border rounded-3 bg-white">
                        <div class="text-xs text-muted">Carb</div>
                        <div class="fw-bold text-warning">${c}g</div>
                    </div>
                </div>
                <div class="col-4">
                    <div class="p-2 border rounded-3 bg-white">
                        <div class="text-xs text-muted">Grasa</div>
                        <div class="fw-bold text-success">${g}g</div>
                    </div>
                </div>
            </div>
        `;
    };

    // 4. Escuchar cambios en el input (mientras escribe)
    inputGrams.oninput = actualizarVistaMacros;

    // 5. Render inicial (para los 100g por defecto)
    actualizarVistaMacros();

    // 6. Cambio de modales (Bootstrap logic)
    const modalRecetasBS = bootstrap.Modal.getInstance(document.getElementById('modalRecetas'));
    if (modalRecetasBS) modalRecetasBS.hide();

    setTimeout(() => {
        const modalQtyBS = new bootstrap.Modal(document.getElementById('recipeModal'));
        modalQtyBS.show();
        // Foco automático para mejorar UX en el iPhone
        setTimeout(() => inputGrams.focus(), 400);
    }, 150);
};

function limpiarModalesForzado() {
    // 1. Quitar la capa oscura manualmente
    const backdrops = document.querySelectorAll('.modal-backdrop');
    backdrops.forEach(b => b.remove());

    // 2. Devolver el scroll al cuerpo de la página
    document.body.classList.remove('modal-open');
    document.body.style.overflow = '';
    document.body.style.paddingRight = '';
}

// 4. Confirma y añade al "Plato"
window.confirmRecipeAddition = () => {
    const cantidad = parseFloat(document.getElementById('modalGramsInput').value);
    if (!selectedRecipe || isNaN(cantidad)) return;

    // Agregar al array de staging
    stagingComidas.push({
        ...selectedRecipe,
        idTemp: crypto.randomUUID(),
        cantidad: cantidad
    });

    // CERRAR MODAL CORRECTAMENTE
    const modalEl = document.getElementById('recipeModal');
    const modalInstance = bootstrap.Modal.getInstance(modalEl);
    
    if (modalInstance) {
        modalInstance.hide();
    }

    // EJECUTAR LIMPIEZA después de un breve delay para que BS termine su animación
    setTimeout(() => {
        limpiarModalesForzado();
        renderStagingUI();
    }, 150);
};

// 5. Renderiza los items en espera (El "Plato")
function renderStagingUI() {
    const container = document.getElementById('stagingContainer');
    if (!container) return;

    if (stagingComidas.length === 0) {
        container.innerHTML = "";
        container.classList.add('d-none');
        return;
    }

    container.classList.remove('d-none');
    container.innerHTML = `
        <div class="staging-plate mb-3 animate-in">
            <div class="staging-header d-flex justify-content-between align-items-center">
                <span><i class="fas fa-utensils me-2"></i>Plato a registrar</span>
                <span class="badge bg-white text-primary">${stagingComidas.length}</span>
            </div>
            <div class="p-2">
                ${stagingComidas.map(item => `
                    <div class="d-flex align-items-center gap-2 mb-2 staging-item p-2 rounded-3">
                        <span class="small flex-grow-1 text-truncate fw-medium text-dark">${item.nombre}</span>
                        <div class="d-flex align-items-center gap-1">
                            <input type="number" value="${item.cantidad}" 
                                class="form-control form-control-sm staging-input text-center p-0" 
                                style="width: 55px; height: 30px;"
                                onchange="window.updateStagingQty('${item.idTemp}', this.value)">
                            <small class="text-muted" style="font-size: 0.7rem">${item.unidad || 'g'}</small>
                        </div>
                        <button type="button" class="btn btn-sm text-danger border-0 p-1 ms-1" 
                            onclick="window.removeStagingItem('${item.idTemp}')">
                            <i class="fas fa-times-circle"></i>
                        </button>
                    </div>
                `).join('')}
                <div class="text-center py-1">
                    <small class="text-secondary italic" style="font-size: 0.75rem">Toca "Registrar" para guardar todo el plato</small>
                </div>
            </div>
        </div>
    `;
}

// FUNCIONES GLOBALES (Para que funcionen los onclick e onchange)
window.updateStagingQty = (idTemp, valor) => {
    const item = stagingComidas.find(i => i.idTemp === idTemp);
    if (item) item.cantidad = parseFloat(valor) || 0;
};

window.removeStagingItem = (idTemp) => {
    stagingComidas = stagingComidas.filter(i => i.idTemp !== idTemp);
    renderStagingUI();
};

document.getElementById('btnCalcularMacrosIA')?.addEventListener('click', async () => {
    const descripcion = document.getElementById('newRecIngredientes').value;
    if (!descripcion) return alert("Escribe los ingredientes primero");

    const btn = document.getElementById('btnCalcularMacrosIA');
    const loader = document.getElementById('loadingIA');

    try {
        btn.classList.add('d-none');
        loader.classList.remove('d-none');

        // Llamada a tu función existente de Gemini
        const datos = await fetchGeminiFoodData(descripcion); 

        if (datos) {
            // Rellenamos los inputs del modal automáticamente
            // Usamos Math.round() para que siempre sean números enteros
            document.getElementById('newRecKcal').value = Math.round(datos.kcal || 0);
            document.getElementById('newRecProt').value = Math.round(datos.proteinas || 0);
            document.getElementById('newRecCarb').value = Math.round(datos.carbohidratos || 0);
            document.getElementById('newRecGrasa').value = Math.round(datos.grasas || 0);
            document.getElementById('newRecFibra').value = Math.round(datos.fibra || 0);
            
            // Feedback visual de éxito
            btn.innerHTML = '<i class="fas fa-sync me-1"></i> Recalcular';
        }
    } catch (error) {
        console.error("Error calculando macros:", error);
    } finally {
        btn.classList.remove('d-none');
        loader.classList.add('d-none');
    }
});

// Manejador del formulario de nueva receta
document.getElementById('formNuevaReceta')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const nuevaReceta = {
        id: crypto.randomUUID(), // Generamos ID temporal
        nombre: document.getElementById('newRecNombre').value,
        ingredientes: document.getElementById('newRecIngredientes').value,
        kcal: parseFloat(document.getElementById('newRecKcal').value),
        proteinas: parseFloat(document.getElementById('newRecProt').value),
        carbohidratos: parseFloat(document.getElementById('newRecCarb').value),
        grasas: parseFloat(document.getElementById('newRecGrasa').value),
        fibra: parseFloat(document.getElementById('newRecFibra').value) || 0,
        unidad: 'g' // Por defecto gramos
    };

    // Aquí llamarías a tu función de Firebase para guardar en Firestore
    // Ejemplo: await guardarEnFirestore('recetas', nuevaReceta);

    // En tu modal de nueva receta:
    saveReceta(nuevaReceta)
    
    console.log("Nueva receta creada:", nuevaReceta);
    
    // Cerrar modal y limpiar
    bootstrap.Modal.getInstance(document.getElementById('modalNuevaReceta')).hide();
    e.target.reset();
    
    // Opcional: Refrescar la grilla si el modal de recetas está abierto
    // renderRecetasGrid(misRecetas);
});

window.verDetalleReceta = function(nombreReceta) {
    // 1. Buscar la receta en tu array local (ajusta 'misRecetas' al nombre de tu variable)
    const receta = misRecetas.find(r => r.nombre === nombreReceta);
    
    if (!receta) {
        alert("No se encontraron detalles para esta receta.");
        return;
    }

    // 2. Llenar el contenido del modal
    document.getElementById('modalRecetaTitulo').innerText = receta.nombre;
    
    // Lista de ingredientes (si los tienes guardados)
    const listaIngredientes = receta.ingredientes ? receta.ingredientes.map(ing => `
        <li class="list-group-item d-flex justify-content-between align-items-center">
            ${ing.nombre}
            <span class="badge bg-primary rounded-pill">${ing.cantidad}${ing.unidad || 'g'}</span>
        </li>
    `).join('') : '<li class="list-group-item text-muted">No hay ingredientes detallados.</li>';

    document.getElementById('modalRecetaCuerpo').innerHTML = `
        <div class="mb-4">
            <h6 class="h6 text-uppercase text-secondary mb-3" style="letter-spacing: 0.5px;">Ingredientes</h6>
            <ul class="list-group list-group-flush shadow-sm" style="border-radius: 12px; overflow: hidden;">
                ${listaIngredientes}
            </ul>
        </div>
        <div class="card border-0 shadow-sm p-3" style="background-color: var(--color-background);">
            <h6 class="h6 text-uppercase text-secondary mb-3">Macros por 100g</h6>
            <div class="row text-center g-2">
                <div class="col-3"><div class="fw-bold text-dark">${receta.proteinas}g</div><small class="text-muted">Prot</small></div>
                <div class="col-3"><div class="fw-bold text-dark">${receta.carbohidratos}g</div><small class="text-muted">Carbs</small></div>
                <div class="col-3"><div class="fw-bold text-dark">${receta.grasas}g</div><small class="text-muted">Grasas</small></div>
                <div class="col-3"><div class="fw-bold text-primary">${receta.kcal}</div><small class="text-primary fw-bold">Kcal</small></div>
            </div>
        </div>
    `;

    // 3. Mostrar el modal (usando Bootstrap)
    const modalInstance = new bootstrap.Modal(document.getElementById('modalDetalleReceta'));
    modalInstance.show();
};


// Trigger del botón al input oculto
document.getElementById('btnCamaraIA')?.addEventListener('click', () => {
    document.getElementById('inputCamaraNutricional').click();
});

// Cuando se selecciona/saca la foto
document.getElementById('inputCamaraNutricional')?.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const loader = document.getElementById('loadingIA');
    const status = document.getElementById('statusIA');
    
    try {
        loader.classList.remove('d-none');
        status.innerText = "Leyendo imagen...";

        // 1. Convertir imagen a Base64
        const base64Image = await toBase64(file);

        // 2. Enviar a Gemini (necesitas ajustar tu función fetchGemini para aceptar imágenes)
        const datos = await fetchGeminiFoodData("Informacion/Tabla nutricional de producto", base64Image);

        if (datos) {
            // 3. Rellenar los campos del modal mágicamente
            // document.getElementById('newRecNombre').value = datos.nombre || "";
            document.getElementById('newRecKcal').value = datos.kcal;
            document.getElementById('newRecProt').value = datos.proteinas;
            document.getElementById('newRecCarb').value = datos.carbohidratos;
            document.getElementById('newRecGrasa').value = datos.grasas;
            document.getElementById('newRecFibra').value = datos.fibra || 0;
            status.innerText = "¡Listo!";
        }
    } catch (error) {
        console.error("Error con la cámara:", error);
        alert("No se pudo leer la tabla. Intenta con una foto más clara.");
    } finally {
        setTimeout(() => loader.classList.add('d-none'), 2000);
    }
});

// Helper para convertir archivo a Base64
const toBase64 = file => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = error => reject(error);
});

export async function inicializarUIComidas() {
    const recetasDesdeDB = await getCollection('recetas');
    console.log(recetasDesdeDB)
    setMisRecetas(recetasDesdeDB); 
    renderRecetasGrid(recetasDesdeDB);
}