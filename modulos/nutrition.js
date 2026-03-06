


// ==============================================================================
// ╔══════════════════════════════════════════════════════════════════════════════╗
// ║  BLOQUE 11 — CÁLCULOS NUTRICIONALES                                         ║
// ║  → Mover a nutrition.js                                                     ║
// ╚══════════════════════════════════════════════════════════════════════════════╝
// ==============================================================================

// ====================
// Incorporar en nutrition.js — calcularMacrosDia, calcularMetasDiarias, calcularMetricasNutricionales
// ====================

export function calcularMacrosDia(log_consumido) {
    if (!log_consumido || log_consumido.length === 0) {
        return { proteinas_dia: 0, carbohidratos_dia: 0, grasas_dia: 0, fibra_dia: 0, ultraprocesados_dia: 0 };
    }
    const totales = log_consumido.reduce((acc, item) => {
        acc.proteinas_dia      += item.proteinas      || 0;
        acc.carbohidratos_dia  += item.carbohidratos  || 0;
        acc.grasas_dia         += item.grasas         || 0;
        acc.fibra_dia          += item.fibra          || 0;
        if (item.procesado === 'ultraprocesado') acc.ultraprocesados_dia += item.kcal || 0;
        return acc;
    }, { proteinas_dia: 0, carbohidratos_dia: 0, grasas_dia: 0, fibra_dia: 0, ultraprocesados_dia: 0 });
    Object.keys(totales).forEach(k => totales[k] = parseFloat(totales[k].toFixed(1)));
    return totales;
}

export function calcularMetasDiarias(perfil, macrosConsumidas, caloriasConsumidas) {
    const objetivoKcal    = perfil.calorias_objetivo;
    const objetivoProteina = perfil.peso_actual * 2;
    const carbosPorcentaje = parseFloat(perfil.carbos_rango_porcentaje.split('-')[0]) / 100;
    const grasasPorcentaje = parseFloat(perfil.grasas_rango_porcentaje.split('-')[0]) / 100;
    const objetivoCarbos   = Math.round((objetivoKcal * carbosPorcentaje) / 4);
    const objetivoGrasas   = Math.round((objetivoKcal * grasasPorcentaje) / 9);
    const objetivoFibra    = 25;

    const progreso = {
        kcal:           { meta: objetivoKcal,      actual: caloriasConsumidas,                restante: objetivoKcal - caloriasConsumidas },
        proteina:       { meta: objetivoProteina,  actual: macrosConsumidas.proteinas_dia,    restante: objetivoProteina - macrosConsumidas.proteinas_dia },
        carbohidratos:  { meta: objetivoCarbos,    actual: macrosConsumidas.carbohidratos_dia,restante: objetivoCarbos - macrosConsumidas.carbohidratos_dia },
        grasas:         { meta: objetivoGrasas,    actual: macrosConsumidas.grasas_dia,       restante: objetivoGrasas - macrosConsumidas.grasas_dia },
        fibra:          { meta: objetivoFibra,     actual: macrosConsumidas.fibra_dia,        restante: objetivoFibra - macrosConsumidas.fibra_dia },
        ultraprocesados:{ meta: 0,                 actual: macrosConsumidas.ultraprocesados_dia },
    };
    progreso.kcal.restante = Math.max(0, progreso.kcal.restante);
    return progreso;
}

export function calcularMetricasNutricionales(datos) {
    const { edad, sexo, peso_actual, altura, ritmo_semanal } = datos;
    const fitness_nivel = datos.fitness?.nivel_actividad || datos.nivel_actividad;

    let tmb = sexo === "masculino"
        ? Math.round(10 * peso_actual + 6.25 * altura - 5 * edad + 5)
        : Math.round(10 * peso_actual + 6.25 * altura - 5 * edad - 161);

    const factores = { sedentario: 1.2, ligero: 1.375, moderado: 1.55, activo: 1.725, muy_activo: 1.9 };
    const tdee = Math.round(tmb * (factores[fitness_nivel] || 1.55));
    const deficit = Math.round((ritmo_semanal || 0.5) * 7700 / 7);
    const calorias_objetivo = tdee - deficit;
    const proteina_min = Math.round(peso_actual * 1.6);
    const proteina_max = Math.round(peso_actual * 2.2);

    return { tmb, tdee, calorias_objetivo, proteina_min, proteina_max, fecha_actualizacion_metricas: new Date().toISOString() };
}
