// ─────────────────────────────────────────────────────────────────────────────
// analytics.js
// Funciones de consulta reutilizables para el servicio de analítica CAP
// ─────────────────────────────────────────────────────────────────────────────
const cds = require('@sap/cds');

/**
 * Resuelve el ID de una temporada por nombre (búsqueda parcial, case-insensitive).
 * @param {string} nombre - Nombre o fragmento de la temporada ("Zafra 2025")
 * @returns {object|null} Fila de Temporadas o null si no existe
 */
async function resolverTemporada(nombre) {
  const { Season } = cds.entities('app.evaluator');

  console.log(`[analytics] Resolviendo temporada para nombre: "${nombre}"`);

  const temporadas = await SELECT.from(Season);

  const nombreBusqueda = (nombre || '').toLowerCase().trim();

  return (
    temporadas.find(t =>
      (t.description || '')
        .toLowerCase()
        .includes(nombreBusqueda)
    ) || null
  );
}

/**
 * Cuenta preparaciones por estado y calcula cuántas están completas o pendientes
 * según el estado real de sus empleados asociados.
 *
 * Reglas:
 * - totalPreparacionesConfirmadas: Preparacion.status = 'Confirmado'
 * - totalPreparacionesBorrador: Preparacion.status = 'Guardado'
 * - preparacionesCompletas: todos los empleados de la preparación tienen STATUS = 'Enviado'
 * - preparacionesPendientes: al menos un empleado de la preparación tiene STATUS diferente a 'Enviado' o null
 *
 * @param {string} temporadaId ID de la temporada.
 * @returns {Promise<{
 *   totalPreparacionesConfirmadas: number,
 *   totalPreparacionesBorrador: number,
 *   preparacionesCompletas: number,
 *   preparacionesPendientes: number
 * }>}
 */
async function contarEstadosPrep(temporadaId) {
  const { Preparacion, Empleados_Preparacion } = cds.entities('app.evaluator');

  const estadosPreparacion = await SELECT
    .from(Preparacion)
    .columns('status', 'count(*) as total')
    .where({ temporada_id: temporadaId })
    .groupBy('status');

  let totalPreparacionesConfirmadas = 0;
  let totalPreparacionesBorrador = 0;

  for (const row of estadosPreparacion) {
    const status = row.status || '';
    const total = Number(row.total || 0);

    if (status === 'Guardado') {
      totalPreparacionesBorrador += total;
    }
  }

  const estadosEmpleadosPorPreparacion = await SELECT
    .from(Empleados_Preparacion)
    .columns(
      'preparacion',
      'count(*) as totalEmpleados',
      `sum(case when status = 'Enviado' then 1 else 0 end) as totalEnviados`
    )
    .where({ temporada_id: temporadaId }).and(`status is not null`) // solo consideramos preparaciones que no están en borrador
    .groupBy('preparacion');

  let preparacionesCompletas = 0;
  let preparacionesPendientes = 0;

  for (const row of estadosEmpleadosPorPreparacion) {
    const totalEmpleados = Number(row.totalEmpleados || 0);
    const totalEnviados = Number(row.totalEnviados || 0);

    if (totalEmpleados > 0 && totalEmpleados === totalEnviados) {
      preparacionesCompletas += 1;
    } else {
      preparacionesPendientes += 1;
    }
  }

  totalPreparacionesConfirmadas = estadosEmpleadosPorPreparacion.length
  return {
    totalPreparacionesConfirmadas,
    totalPreparacionesBorrador,
    preparacionesCompletas,
    preparacionesPendientes,
  };
}

/**
 * Cuenta el estado de avance de las evaluaciones de una temporada.
 *
 * Consulta los registros de empleados asociados a evaluaciones en la tabla
 * Reglas de clasificación:
 * - Enviado    → Evaluación completada y retroalimentación finalizada.
 * - Terminado  → Notas registradas, pendiente retroalimentación.
 * - Confirmado → Evaluación habilitada, pendiente de finalizar.
 * - null/otros → Sin estado definido o en borrador.
 *
 * @param {string} temporadaId ID de la temporada a consultar.
 * @returns {Promise<{
 *   completaron: number,
 *   pendientes: number,
 *   total: number,
 *   detalle: {
 *     enviado: number,
 *     terminado: number,
 *     confirmado: number,
 *     borrador: number
 *   }
 * }>}
 */
async function contarEstadosEmpleadosPrep(temporadaId) {
  const { Empleados_Preparacion } = cds.entities('app.evaluator');

  const rows = await SELECT
    .from(Empleados_Preparacion)
    .columns('status', 'count(*) as total')
    .where({ temporada_id: temporadaId })
    .groupBy('status');

  const resultado = {
    completaron: 0,
    pendientes: 0,
    total: 0,
    detalle: {
      enviado: 0,
      terminado: 0,
      confirmado: 0,
      borrador: 0
    }
  };

  for (const row of rows) {
    const total = Number(row.total);
    resultado.total += total;

    switch (row.status) {
      case 'Enviado':
        resultado.completaron += total;
        resultado.detalle.enviado = total;
        break;

      case 'Terminado':
        resultado.pendientes += total;
        resultado.detalle.terminado = total;
        break;

      case 'Confirmado':
        resultado.pendientes += total;
        resultado.detalle.confirmado = total;
        break;

      case null:
        resultado.pendientes += total;
        resultado.detalle.borrador += total;
        break;

      default:
        break;
    }
  }

  return resultado;
}

/**
 * Redondea a 2 decimales y evita NaN.
 * @param {number} value
 * @returns {number}
 */
function pct(value) {
  return isNaN(value) ? 0 : Math.round(value * 100) / 100;
}


/**
 * Busca registros de evaluaciones aplicando filtros opcionales.
 *
 * La búsqueda se realiza sobre la vista analítica VER_EVALUATION_DETAIL,
 * la cual contiene información consolidada de:
 * - Temporada
 * - Preparación
 * - Plan de carrera
 * - Evaluador
 * - Empleado
 * - Estado de la evaluación
 *
 * Todos los filtros son opcionales y se combinan mediante AND.
 *
 * Los parámetros deben corresponder a identificadores previamente resueltos
 * por otras skills o funciones de búsqueda.
 *
 * @param {Object} filters Filtros de búsqueda.
 * @param {string} [filters.temporadaId] ID de la temporada.
 * @param {string} [filters.planCarreraId] ID del plan de carrera.
 * @param {string} [filters.evaluadorSapNumber] SAP Number del evaluador.
 * @param {string} [filters.empleadoSapNumber] SAP Number del empleado.
 * @param {string} [filters.estado] Estado amigable de la evaluación.
 * @param {string} [filters.preparacionId] ID de la preparación.
 *
 * @returns {Promise<Array>} Registros encontrados.
 */
async function searchEvaluationRecords(filters = {}) {

  const {
    temporadaId,
    planCarreraId,
    evaluadorSapNumber,
    empleadoSapNumber,
    estado,
    preparacionId
  } = filters;

  const { VER_EVALUATION_DETAIL } = cds.entities('app.evaluator');

  const where = {};

  if (temporadaId && temporadaId != '') {
    where.temporadaId = temporadaId;
  }

  if (planCarreraId && planCarreraId != '') {
    where.planCarreraId = planCarreraId;
  }

  if (evaluadorSapNumber && evaluadorSapNumber != '') {
    where.evaluadorSapNumber = evaluadorSapNumber;
  }

  if (empleadoSapNumber && empleadoSapNumber != '') {
    where.empleadoSapNumber = empleadoSapNumber;
  }

  estadoValue = estado ? estado.toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '') : null;
  if (estadoValue && estadoValue != '') {
    where.estadoEvTexto = estadoValue;
  }

  if (preparacionId && preparacionId != '') {
    where.preparacionId = preparacionId;
  }

  if (Object.keys(where).length === 0) {
    return [];
  }
  
  return await SELECT
    .from(VER_EVALUATION_DETAIL)
    .where(where)
    .limit(100);
}


module.exports = {
  resolverTemporada,
  contarEstadosPrep,
  contarEstadosEmpleadosPrep,
  pct,
  searchEvaluationRecords
};
