'use strict';
// srv/lib/audit.js
// ─────────────────────────────────────────────────────────────────
// Responsabilidad única: persistir registros de auditoría en la
// tabla ChatAuditLog de HANA.
//
// Fire-and-forget: nunca bloquea la respuesta al usuario.
// Si el log falla, se registra en consola pero no rompe el flujo.
// ─────────────────────────────────────────────────────────────────

const cds = require('@sap/cds');

/**
 * Escribe un registro en ChatAuditLog.
 * Se llama con await pero internamente no lanza excepciones al caller.
 *
 * @param {object} entry
 * @param {string}  entry.userID          - ID del usuario (del JWT de BTP)
 * @param {string}  entry.userName        - Nombre del usuario
 * @param {string}  entry.question        - Pregunta original del usuario
 * @param {string}  [entry.sql]           - SQL generado por el LLM
 * @param {Array}   [entry.tablesUsed]    - Tablas usadas en el SQL
 * @param {number}  [entry.resultCount]   - Registros devueltos por HANA
 * @param {boolean} [entry.cacheHit]      - Si vino del caché
 * @param {string}  [entry.llmModel]      - Modelo LLM usado
 * @param {number}  [entry.latencyMs]     - Tiempo total de respuesta en ms
 * @param {boolean} [entry.success]       - Si la operación fue exitosa
 * @param {string}  [entry.errorMsg]      - Mensaje de error si success=false
 * @param {string}  [entry.temporada]     - Temporada del contexto
 * @returns {Promise<string|null>}        - UUID del log creado, o null si falló
 */
async function log(entry) {
  try {
    const db = await cds.connect.to('db');
    const { ChatAuditLog } = cds.entities('app.evaluator.chat');

    const logID = cds.utils.uuid();

    await cds.spawn(async () => {
      await INSERT.into(ChatAuditLog).entries({
        ID: logID,
        userID: _truncate(entry.userID ?? 'anonymous', 50),
        userName: _truncate(entry.userName ?? 'anonymous', 100),
        question: _truncate(entry.question ?? '', 1000),
        normalizedQuestion: _truncate(entry.normalizedQuestion ?? '', 1000),
        sqlGenerated: _truncate(entry.sql ?? '', 2000),
        tablesUsed: _truncate(
          Array.isArray(entry.tablesUsed)
            ? entry.tablesUsed.join(', ')
            : (entry.tablesUsed ?? ''),
          200
        ),
        resultCount: entry.resultCount ?? 0,
        cacheHit: entry.cacheHit ?? false,
        llmModel: _truncate(entry.llmModel ?? 'none', 50),
        latencyMs: entry.latencyMs ?? 0,
        success: entry.success ?? true,
        errorMsg: _truncate(entry.errorMsg ?? '', 500),
        temporada: _truncate(entry.temporada ?? '', 1000),
      });
    })
    return logID;

  } catch (err) {
    // El fallo del log nunca debe afectar al usuario
    console.error('[audit] Error escribiendo log de auditoría:', err.message);
    return null;
  }
}

/**
 * Trunca un string al máximo de caracteres indicado.
 * Evita errores de HANA por strings más largos que la columna.
 *
 * @param {string} str
 * @param {number} max
 * @returns {string}
 */
function _truncate(str, max) {
  if (!str) return '';
  return String(str).substring(0, max);
}

module.exports = { log };
