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
    if (!modalElement) return;
    const bsModal = new bootstrap.Modal(modalElement);

    document.querySelectorAll('.btn-filtro-receta').forEach(boton => {
        boton.addEventListener('click', (e) => {
            const filtro = e.currentTarget.dataset.filtro;
            document.getElementById('tituloModalRecetas').innerText = `Filtrar: ${e.currentTarget.innerText}`;
            renderRecetasGrid(misRecetas, filtro);
            bsModal.show();
        });
    });
}

// 2. Dibuja la grilla de recetas dentro del modal
// Dentro de tu archivo de recetas.js
export function renderRecetasGrid(recetas, filtroTipo = 'todos') {
    const grid = document.getElementById('recetasGrid');
    if (!grid) return;

    // 1. Limpiar el contenedor antes de renderizar
    grid.innerHTML = '';

    // 2. Filtrado (aseguramos que 'recetas' no sea undefined)
    let filtradas = recetas || [];
    if (filtroTipo === 'alta-proteina') filtradas = recetas.filter(r => (r.proteinas || 0) >= 15);
    else if (filtroTipo === 'bebidas') filtradas = recetas.filter(r => r.unidad === 'ml');
    else if (filtroTipo === 'bajo-grasa') filtradas = recetas.filter(r => (r.grasas || 0) <= 5);

    // 3. Generar HTML
    const html = filtradas.map(receta => `
        <div class="col">
            <div class="card border-0 shadow-sm p-3 h-100" 
                 style="cursor: pointer; border-radius: 16px; background-color: #f8f9fa;" 
                 onclick="window.openRecipeQtyModal('${receta.id}')"> 
                <div class="fw-bold small text-dark mb-1">${receta.nombre}</div>
                <div class="text-xs text-primary fw-bold">${receta.kcal} kcal</div>
            </div>
        </div>
    `).join('');

    grid.innerHTML = html || '<p class="text-center w-100 small text-muted">No hay recetas.</p>';
}

// 3. Abre el modal de cantidad
window.openRecipeQtyModal = (id) => {
    // 1. Buscar la receta en el estado global
    const receta = misRecetas.find(r => r.id === id);
    if (!receta) return;
    
    selectedRecipe = receta;
    
    // 2. Rellenar los campos del segundo modal
    document.getElementById('modalRecipeTitle').innerText = receta.nombre;
    document.getElementById('modalUnitLabel').innerText = receta.unidad || 'g';
    document.getElementById('modalGramsInput').value = 100;

    // 3. CAMBIO DE MODALES (Importante para evitar bugs de scroll)
    const mRecetasEl = document.getElementById('modalRecetas');
    const mQtyEl = document.getElementById('recipeModal');
    
    // Cerramos el de la grilla antes de abrir el de cantidad
    const modalRecetasBS = bootstrap.Modal.getInstance(mRecetasEl);
    if (modalRecetasBS) modalRecetasBS.hide();

    // Pequeño delay para que el DOM respire y abra el nuevo modal limpiamente
    setTimeout(() => {
        const modalQtyBS = new bootstrap.Modal(mQtyEl);
        modalQtyBS.show();
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
            document.getElementById('newRecKcal').value = datos.kcal;
            document.getElementById('newRecProt').value = datos.proteinas;
            document.getElementById('newRecCarb').value = datos.carbohidratos;
            document.getElementById('newRecGrasa').value = datos.grasas;
            document.getElementById('newRecFibra').value = datos.fibra || 0;
            
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

export async function inicializarUIComidas() {
    const recetasDesdeDB = await getCollection('recetas');
    console.log(recetasDesdeDB)
    setMisRecetas(recetasDesdeDB); 
    renderRecetasGrid(recetasDesdeDB);
}