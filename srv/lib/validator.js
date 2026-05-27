'use strict';
// srv/lib/validator.js
// ─────────────────────────────────────────────────────────────────
// Responsabilidad única: validar que el SQL generado por el LLM
// sea seguro antes de enviarlo a HANA.
//
// Tres capas de validación:
//   1. Solo operaciones SELECT
//   2. Blacklist de palabras peligrosas
//   3. Whitelist de tablas permitidas
//
// Retorna null si es válido, o un string con el motivo del rechazo.
// ─────────────────────────────────────────────────────────────────

// Operaciones que nunca deben aparecer en el SQL generado
const SQL_BLACKLIST = [
  'DELETE',
  'UPDATE',
  'INSERT',
  'DROP',
  'ALTER',
  'TRUNCATE',
  'EXEC',
  'EXECUTE',
  'GRANT',
  'REVOKE',
  'CREATE',
  'REPLACE',
  '--',    // comentarios SQL que podrían ocultar inyecciones
  ';--',
  'UNION', // prevenir UNION-based SQL injection
];

// Únicas tablas del schema app.evaluator que el chatbot puede consultar.
// Nombres tal como aparecen en HANA (en mayúsculas, con namespace).
// El LLM puede generarlos con o sin namespace — normalizamos antes de validar.
const ALLOWED_TABLES = [
  'PREPARACION',
  'EMPLEADOS_PREPARACION',
  'SEASON',
  'EMPLEADO',
  'CARGO',
  'CAREER_PLAN',
  // Versiones con namespace completo que HANA puede requerir
  'APP_EVALUATOR_PREPARACION',
  'APP_EVALUATOR_EMPLEADOS_PREPARACION',
  'APP_EVALUATOR_SEASON',
  'APP_EVALUATOR_EMPLEADO',
  'APP_EVALUATOR_CARGO',
  'APP_EVALUATOR_CAREER_PLAN',
];

/**
 * Valida el resultado de generateSQL() antes de ejecutarlo.
 *
 * @param {object} sqlResult - Objeto retornado por el LLM con { sql, tablas_usadas, confianza }
 * @returns {string|null} - null si es válido, string con el error si no lo es
 */
function validate(sqlResult) {
  // ── Validar que el objeto tenga la forma esperada ──────────
  if (
    !sqlResult ||
    typeof sqlResult !== 'object' ||
    !('sql' in sqlResult) ||
    !('tablas_usadas' in sqlResult) ||
    !('confianza' in sqlResult) ||
    !('razonamiento' in sqlResult)
  ) { 
    return 'Respuesta del LLM con formato inválido.';
  }

  if (sqlResult.confianza.trim().toLowerCase() === 'baja') {
    return 'No pude interpretar bien tu pregunta. ¿Puedes reformularla con más detalle?';
  }

  const sql = sqlResult.sql;

  if (!sql || typeof sql !== 'string' || sql.trim().length === 0) {
    return 'El LLM no generó una consulta SQL.';
  }

  // ── Capa 1: Solo SELECT ────────────────────────────────────
  const trimmedUpper = sql.trim().toUpperCase();
  if (!trimmedUpper.startsWith('SELECT')) {
    return 'Solo se permiten consultas de lectura (SELECT).';
  }

  // ── Capa 2: Blacklist ──────────────────────────────────────
  for (const forbidden of SQL_BLACKLIST) {
    // Buscar como palabra completa para evitar falsos positivos
    // ej: "CREATED_BY" no debería coincidir con "CREATE"
    const regex = new RegExp(`\\b${forbidden}\\b`, 'i');
    if (regex.test(sql)) {
      return `Consulta rechazada: contiene operación no permitida (${forbidden}).`;
    }
  }

  // ── Capa 3: Whitelist de tablas ────────────────────────────
  const tablas = sqlResult.tablas_usadas ?? [];
  for (const tabla of tablas) {
    const tablaUpper = tabla.toUpperCase().replace(/-/g, '_');
    if (!ALLOWED_TABLES.includes(tablaUpper)) {
      return `Tabla no permitida en esta consulta: "${tabla}".`;
    }
  }

  return null; // ✅ válido
}


/**
 * Retorna la lista de tablas permitidas.
 * Útil para incluirlas en el contexto del prompt.
 *
 * @returns {string[]}
 */
function getAllowedTables() {
  return ALLOWED_TABLES;
}

module.exports = { validate, getAllowedTables };
