// ─────────────────────────────────────────────────────────────────────────────
// analytics-service.js
// Handlers CAP para el servicio de analítica – 6 skills para Joule Studio
// ─────────────────────────────────────────────────────────────────────────────

const cds = require('@sap/cds');
const {
  resolverTemporada,
  contarEstadosPrep,
  contarEstadosEmpleadosPrep,
  pct,
  searchEvaluationRecords
} = require('./lib/analytics');


module.exports = function () {

  // ── Skill 1: ConsultarResumenTemporada ─────────────────────────────────────
  this.on('ConsultarResumenTemporada', async (req) => {
    const { temporadaNombre } = req.data;

    if (!temporadaNombre) {
      return req.error(400, 'Se requiere el nombre de la temporada.');
    }

    const temporada = await resolverTemporada(temporadaNombre);
    if (!temporada) {
      return req.error(404, `No se encontró la temporada "${temporadaNombre}".`);
    }

    console.log(temporada.ID)
    const { totalPreparacionesConfirmadas,
      totalPreparacionesBorrador,
      preparacionesCompletas,
      preparacionesPendientes } = await contarEstadosPrep(temporada.id);
    const { completaron, pendientes, total, detalle } = await contarEstadosEmpleadosPrep(temporada.id);

    return {
      temporadaId: temporada.id,
      temporadaNombre: temporada.nombre,
      temporadaEstado: temporada.status,

      totalPreparacionesConfirmadas: totalPreparacionesConfirmadas,
      totalPreparacionesBorrador: totalPreparacionesBorrador,
      preparacionesCompletas: preparacionesCompletas,
      preparacionesPendientes: preparacionesPendientes,
      pctPreparacionesCompletadas: totalPreparacionesConfirmadas > 0 ? pct((preparacionesCompletas / totalPreparacionesConfirmadas) * 100) : 0,
      pctPreparacionesPendientes: totalPreparacionesConfirmadas > 0 ? pct((preparacionesPendientes / totalPreparacionesConfirmadas) * 100) : 0,

      totalEmpleados: total,
      evaluacionesCompletadas: completaron,
      evaluacionesPendientes: pendientes,
      pctEvaluacionesCompletadas: total > 0 ? pct((completaron / total) * 100) : 0,
      pctEvaluacionesPendientes: total > 0 ? pct((pendientes / total) * 100) : 0,

      evaluacionesEnBorrador: detalle.borrador, // pendientes por confirmar creacion de preparacion
      evaluacionesEnProgreso: detalle.confirmado, //En registro de notas
      evaluacionesEnRetroalimentacion: detalle.terminado, //En retroalimentacion
      evaluacionesFinalizadas: detalle.enviado, //firmadas y completas
    };
  });

  this.on('SearchEvaluationRecords', async req => {
    const {
      temporadaId,
      planCarreraId,
      evaluadorSapNumber,
      empleadoSapNumber,
      estado,
      preparacionId
    } = req.data;

    if ( (!temporadaId || temporadaId == '') && (!planCarreraId || planCarreraId == '') && (!evaluadorSapNumber || evaluadorSapNumber == '') && (!empleadoSapNumber || empleadoSapNumber == '') && (!estado || estado == '') && (!preparacionId || preparacionId == '')) {
      return req.error(400, 'Se requiere al menos un filtro para realizar la búsqueda.');
    }

    const result = await searchEvaluationRecords(req.data);
    return {
      totalRegistros: result.length,
      registros: result
    };
  }
  );


};


