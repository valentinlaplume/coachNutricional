// Simulación de la estructura de datos que obtendrías de Firestore/un archivo local
const perfilUsuario = {
    valentin: {
        edad: 25,
        sexo: 'masculino',
        peso_actual: 75,
        altura: 175,
        peso_objetivo: 72,
        objetivo: 'definición',
        ritmo_semanal: 0.5,
        tdee: 2712, // Mantenemos el TDEE solo como ejemplo de campo de solo lectura

        proteina_min: 105,
        proteina_max: 165,
        carbos_rango_porcentaje: '40-50%',
        grasas_rango_porcentaje: '25-35%',

        preferencias: {
            evita_ultraprocesados: true,
            alergias_medicas: ['ninguna'],
            cantidad_comidas_al_dia: 4,
            habilidades_cocina: 'básico',
            suplementos_actuales: ['creatina'],
        },
        
        fitness: { 
            nivel_actividad: 'moderado',
            tipo_entrenamiento: 'Fuerza (4 días) + Cardio (1 día)', 
            frecuencia_semanal: 5, 
            horario_entrenamiento: 'Tarde (17:30h)', 
            experiencia_entrenamiento: 'Intermedio-Avanzado', 
            objetivo_estetico: 'Hombros, espalda y abdominales marcados', 
            objetivo_rendimiento_cuantificable: 'Ser mas atlético',
        },
        
        salud_y_sostenibilidad: { 
            nivel_estres_dia: 4,
            hora_habitual_dormir: '00:30', 
            hora_habitual_despertar: '08:30', 
            tiempo_libre_cocina_semanal: '40 mins por dia',
            dias_flexibilidad_preferidos: ['Sábado noche', 'Domingo tarde/noche'],
        },
        
        preferencias_alimentarias: {
            opciones_rapidas_faciles: [ "Huevo", "Yogurt", "Atún en lata" ], // Simplificamos para el ejemplo
            carbohidratos_favoritos: [ "Pan integral", "Frutas", "Papa" ],
            proteinas_favoritas: [ "Pollo", "Carne", "Pescado" ],
            platos_favoritos_completos: [ "Tarta de espinaca", "Lentejas" ],
        }
    },
    // ... otros usuarios
};

// Función de utilidad para convertir un textarea (separado por salto de línea) a Array
const textareaToArray = (text) => {
    return text.split('\n')
               .map(item => item.trim())
               .filter(item => item.length > 0);
};

// Función de utilidad para convertir un Array a texto (separado por salto de línea)
const arrayToTextarea = (arr) => arr.join('\n');

// =================================================================
// 1. CARGA DE DATOS EN EL FORMULARIO
// =================================================================

function loadProfile(username) {
    const data = perfilUsuario[username];
    if (!data) return;

    // --- 1. Datos Base y Objetivos ---
    document.getElementById('inputEdad').value = data.edad;
    document.getElementById('selectSexo').value = data.sexo;
    document.getElementById('inputAltura').value = data.altura;
    document.getElementById('inputPesoActual').value = data.peso_actual;
    document.getElementById('inputPesoObjetivo').value = data.peso_objetivo;
    document.getElementById('selectObjetivo').value = data.objetivo;
    document.getElementById('inputRitmoSemanal').value = data.ritmo_semanal;

    // --- 2. Macros y Cálculo ---
    document.getElementById('inputTDEE').value = data.tdee;
    document.getElementById('inputProteinaMin').value = data.proteina_min;
    document.getElementById('inputProteinaMax').value = data.proteina_max;
    document.getElementById('inputCarbosRango').value = data.carbos_rango_porcentaje;
    document.getElementById('inputGrasasRango').value = data.grasas_rango_porcentaje;

    // --- 3. Fitness y Entrenamiento ---
    document.getElementById('selectNivelActividad').value = data.fitness.nivel_actividad;
    document.getElementById('inputTipoEntrenamiento').value = data.fitness.tipo_entrenamiento;
    document.getElementById('inputObjetivoRendimiento').value = data.fitness.objetivo_rendimiento_cuantificable;
    document.getElementById('inputFrecuenciaSemanal').value = data.fitness.frecuencia_semanal;
    // ... otros campos fitness si se añaden al HTML ...

    // --- 4. Hábitos y Restricciones (Una selección) ---
    document.getElementById('checkEvitaUltraprocesados').checked = data.preferencias.evita_ultraprocesados;
    document.getElementById('inputAlergias').value = data.preferencias.alergias_medicas.join(', ');
    document.getElementById('inputHoraDormir').value = data.salud_y_sostenibilidad.hora_habitual_dormir;
    document.getElementById('inputHoraDespertar').value = data.salud_y_sostenibilidad.hora_habitual_despertar;
    document.getElementById('inputTiempoCocina').value = data.salud_y_sostenibilidad.tiempo_libre_cocina_semanal;

    // --- 5. Preferencias Alimentarias (Textareas) ---
    document.getElementById('textareaProteinas').value = arrayToTextarea(data.preferencias_alimentarias.proteinas_favoritas);
    document.getElementById('textareaCarbohidratos').value = arrayToTextarea(data.preferencias_alimentarias.carbohidratos_favoritos);
    document.getElementById('textareaPlatosFavoritos').value = arrayToTextarea(data.preferencias_alimentarias.platos_favoritos_completos);
}

// =================================================================
// 2. ENVÍO DEL FORMULARIO Y ACTUALIZACIÓN DE DATOS
// =================================================================

function saveProfile(event) {
    event.preventDefault();
    const currentUsername = 'valentin'; // Asume que estás configurando a Valentín

    // Recoger los valores del DOM
    const formData = {
        // 1. Datos Base y Objetivos
        edad: parseInt(document.getElementById('inputEdad').value),
        sexo: document.getElementById('selectSexo').value,
        peso_actual: parseFloat(document.getElementById('inputPesoActual').value),
        altura: parseInt(document.getElementById('inputAltura').value),
        peso_objetivo: parseFloat(document.getElementById('inputPesoObjetivo').value),
        objetivo: document.getElementById('selectObjetivo').value,
        ritmo_semanal: parseFloat(document.getElementById('inputRitmoSemanal').value),

        // 2. Macros y Cálculo
        proteina_min: parseInt(document.getElementById('inputProteinaMin').value),
        proteina_max: parseInt(document.getElementById('inputProteinaMax').value),
        carbos_rango_porcentaje: document.getElementById('inputCarbosRango').value,
        grasas_rango_porcentaje: document.getElementById('inputGrasasRango').value,
        
        // --- Sub-objetos ---

        preferencias: {
            evita_ultraprocesados: document.getElementById('checkEvitaUltraprocesados').checked,
            alergias_medicas: document.getElementById('inputAlergias').value.split(',').map(s => s.trim()).filter(s => s),
            // Las comidas al día y habilidades de cocina no se incluyeron en este HTML simplificado, pero seguirían la misma lógica.
        },
        
        fitness: { 
            nivel_actividad: document.getElementById('selectNivelActividad').value,
            tipo_entrenamiento: document.getElementById('inputTipoEntrenamiento').value,
            objetivo_rendimiento_cuantificable: document.getElementById('inputObjetivoRendimiento').value,
            frecuencia_semanal: parseInt(document.getElementById('inputFrecuenciaSemanal').value),
        },
        
        salud_y_sostenibilidad: { 
            hora_habitual_dormir: document.getElementById('inputHoraDormir').value, 
            hora_habitual_despertar: document.getElementById('inputHoraDespertar').value,
            tiempo_libre_cocina_semanal: document.getElementById('inputTiempoCocina').value,
        },
        
        preferencias_alimentarias: {
            proteinas_favoritas: textareaToArray(document.getElementById('textareaProteinas').value),
            carbohidratos_favoritos: textareaToArray(document.getElementById('textareaCarbohidratos').value),
            platos_favoritos_completos: textareaToArray(document.getElementById('textareaPlatosFavoritos').value),
        }
    };
    
    // NOTA: Aquí iría la LÓGICA DE CÁLCULO (TMB, TDEE, Calorías Objetivo)
    // Usarías las fórmulas de Harris-Benedict o Mifflin-St Jeor con formData.edad, formData.peso_actual, etc.
    // Esto es CRÍTICO para que el perfil esté completo.
    
    // Ejemplo de cómo actualizarías tu objeto global (en un entorno de una sola página)
    perfilUsuario[currentUsername] = { ...perfilUsuario[currentUsername], ...formData };
    
    console.log("Nuevo Perfil Guardado:", perfilUsuario[currentUsername]);
    
    // --- 3. Guardar en Firebase (asumiendo que tienes una función global) ---
    // if (typeof saveToFirestore === 'function') {
    //     saveToFirestore(currentUsername, perfilUsuario[currentUsername])
    //         .then(() => alert('¡Perfil actualizado con éxito!'))
    //         .catch(error => console.error('Error al guardar:', error));
    // } else {
    //     alert('Datos listos para guardar. Implementa la conexión a Firestore.');
    // }
    
    alert('¡Perfil actualizado con éxito! Serás redirigido.');
    window.location.href = 'index.html';

}

// Inicializar: Cargar datos al cargar la página y configurar el listener de envío
document.addEventListener('DOMContentLoaded', () => {
    // Simular que estamos editando a Valentín
    loadProfile('valentin'); 
    
    const form = document.getElementById('userProfileForm');
    if (form) {
        form.addEventListener('submit', saveProfile);
    }
});