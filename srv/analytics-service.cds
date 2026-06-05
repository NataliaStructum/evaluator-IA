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


  type EvaluationDetail {
    temporadaId           : UUID;
    temporada             : String;
    estadoTemp            : String;
    start_date            : Date;
    end_date              : Date;

    preparacionId        : String;
    planCarreraId         : String;
    planCText             : String;

    evaluadorSapNumber    : String;
    cedula_evaluador      : String;
    nombre_evaluador      : String;
    email_evaluador       : String;

    empleadoSapNumber     : String;
    nombre_empleado       : String;
    cedula_empleado       : String;
    email_empleado        : String;

    createdAt             : Timestamp;
    modifiedAt            : Timestamp;
    lider                 : String;
    estadoEv              : String;
    estadoEvTexto         : String;
    comentariosEv         : String;
    comentariosEm         : String;
    posicion              : String;
    descripcion_cargo     : String;
}

  // ── Skill 2: SearchEvaluationRecords ─────────────────────────────
  // Buscar registros de evaluación por id de temporada, plan carrera, evaluador, empleado, estado y preparación
  function SearchEvaluationRecords(
    temporadaId : String,
    planCarreraId : String,
    evaluadorSapNumber : String,
    empleadoSapNumber : String,
    estado : String,
    preparacionId : String
  ) returns many EvaluationDetail;
}
