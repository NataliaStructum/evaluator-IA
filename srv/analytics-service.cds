// ─────────────────────────────────────────────────────────────────────────────
// Servicio de Analítica para Joule Studio
// analytics-service.cds
// ─────────────────────────────────────────────────────────────────────────────
using {app.evaluator} from '../db/schema';
// ─── Servicio de Analítica ─────────────────────────────────────────────────────

service AnalyticsService {

  // ── Tipos de respuesta ──────────────────────────────────────────────────────

  type ResumenTemporada {
      temporadaId: UUID;
      temporadaNombre: String;
      temporadaEstado: String;

      totalPreparacionesConfirmadas: Integer;
      totalPreparacionesBorrador: Integer;
      preparacionesCompletas: Integer;
      preparacionesPendientes: Integer;
      pctPreparacionesCompletadas: Decimal(5,2);
      pctPreparacionesPendientes: Decimal(5,2);

      totalEmpleados: Integer;
      evaluacionesCompletadas: Integer;
      evaluacionesPendientes: Integer;
      pctEvaluacionesCompletadas: Decimal(5,2);
      pctEvaluacionesPendientes: Decimal(5,2);

      evaluacionesEnBorrador: Integer; // pendientes por confirmar creacion de preparacion
      evaluacionesEnProgreso: Integer; //En registro de notas
      evaluacionesEnRetroalimentacion: Integer; //En retroalimentacion
      evaluacionesFinalizadas: Integer; //firmadas y completas
    };

  // ── Skill 1: ConsultarResumenTemporadaAnalitica ─────────────────────────────
  // Resumen general de una temporada (abiertos, cerrados, completados, %)
  function ConsultarResumenTemporada(
    temporadaNombre : String
  ) returns ResumenTemporada;
}
