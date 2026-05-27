// db/chat-schema.cds

namespace app.evaluator.chat;

using {
  cuid,
  managed
} from '@sap/cds/common';

// ─────────────────────────────────────────────────────────
// 1. LOG DE AUDITORÍA
// Todo lo que pasa en el chatbot queda registrado aquí
// ─────────────────────────────────────────────────────────
entity ChatAuditLog : cuid {
  timestamp          : DateTime @cds.on.insert: $now;
  userID             : String(50);
  userName           : String(100);
  question           : String(1000);
  normalizedQuestion : String(1000);
  sqlGenerated       : String(2000);
  tablesUsed         : String(200);
  resultCount        : Integer default 0;
  cacheHit           : Boolean default false;
  llmModel           : String(50);
  latencyMs          : Integer default 0;
  success            : Boolean default true;
  errorMsg           : String(500);
  temporada          : String(1000);
}

// ─────────────────────────────────────────────────────────
// 2. PREGUNTAS FRECUENTES / SUGERIDAS
// Preguntas que RRHH define como útiles y aparecen
// como sugerencias en la UI del chatbot
// ─────────────────────────────────────────────────────────
entity ChatSuggestedQuestions : cuid, managed {
  question       : String(500) @mandatory;
  category       : String(50); // 'temporada', 'empleado', 'estado'
  temporadaScope : String(20); // si aplica solo a una temporada
  active         : Boolean default true;
  usageCount     : Integer default 0; // cuántas veces se usó
  orderPriority  : Integer default 0; // orden en la UI
}

// ─────────────────────────────────────────────────────────
// 3. FEEDBACK DE RESPUESTAS
// RRHH puede marcar si una respuesta fue útil o no
// Esto alimenta la mejora del prompt con el tiempo
// ─────────────────────────────────────────────────────────
entity ChatResponseFeedback : cuid {
  auditLogID : UUID; // → ChatAuditLog.ID
  timestamp  : DateTime @cds.on.insert: $now;
  userID     : String(50);
  helpful    : Boolean; // 👍 o 👎
  comment    : String(500); // opcional: "la respuesta estaba incompleta"
}

// ─────────────────────────────────────────────────────────
// 4. CACHE DE LAS RESPUESTAS
// Se guarda la respuesta de cada pregunta + scope para servirla rápido si vuelve a preguntar algo similar
// ─────────────────────────────────────────────────────────

entity ChatCache {
  key ID          : UUID;
      questionKey : String(1000) @mandatory; // pregunta normalizada + cacheKey del scope
      scopeKey    : String(200) @mandatory; // __all__ | __none__ | 2024-B | 2024-A__2024-B
      scopeType   : String(20)  @mandatory; // 'all' | 'none' | 'one' | 'many'
      respuesta   : LargeString @mandatory; // respuesta sintetizada
      sql         : String(2000); // SQL que generó el resultado
      tablesUsed  : String(200);
      registros   : Integer default 0;
      hits        : Integer default 0; // cuántas veces se sirvió desde caché
      createdAt   : DateTime    @cds.on.insert: $now;
      expiresAt   : DateTime    @mandatory; // cuando expira / Cuándo expira — calculado según estado de temporadas:temporadas activas→ +30 minutos, todas cerradas→ +30 días
      active      : Boolean default true;
}
