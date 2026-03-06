
// ====================
// Incorporar en plans.js (o auth.js si es pequeño)
// ====================
const PLAN_LIMITS = {
    free:    { coach_consultas_mes: 10,       dias_historial: 7,        exportar_datos: false, graficos_avanzados: false, multiples_objetivos: false },
    pro:     { coach_consultas_mes: 60,       dias_historial: 90,       exportar_datos: true,  graficos_avanzados: true,  multiples_objetivos: false },
    premium: { coach_consultas_mes: Infinity, dias_historial: Infinity, exportar_datos: true,  graficos_avanzados: true,  multiples_objetivos: true  },
};

// ====================
// Incorporar en plans.js
// ====================
function checkFeatureAccess(perfil, feature) {
    const plan = perfil.suscripcion?.plan || "free";
    const estado = perfil.suscripcion?.estado;
    const planEfectivo = estado === "trial" ? "pro" : plan;
    const limites = PLAN_LIMITS[planEfectivo];

    if (feature === "coach_consultas_mes") {
        const usadas = perfil.uso?.coach_consultas_mes || 0;
        const max = limites.coach_consultas_mes;
        if (usadas >= max) {
            return { permitido: false, razon: `Alcanzaste el límite de ${max} consultas este mes. Actualizá tu plan para continuar.` };
        }
        return { permitido: true };
    }
    if (typeof limites[feature] === "boolean") {
        return { permitido: limites[feature], razon: limites[feature] ? undefined : `Esta función requiere plan Pro o Premium.` };
    }
    return { permitido: true };
}
