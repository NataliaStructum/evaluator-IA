'use strict';
// srv/lib/sql-runner.js
// ─────────────────────────────────────────────────────────────────
// Responsabilidad única: ejecutar SQL en HANA via CDS y manejar
// los errores de ejecución de forma controlada.
//
// No valida el SQL (eso es trabajo de validator.js).
// No genera el SQL (eso es trabajo de prompt-builder.js).
// Solo ejecuta y retorna los datos o lanza un error descriptivo.
// ─────────────────────────────────────────────────────────────────

const cds = require('@sap/cds');

// Límite de registros que puede retornar una query.
// Protege contra queries que devuelvan tablas completas accidentalmente.
const MAX_ROWS = 3000;

/**
 * Ejecuta una query SQL en HANA y retorna los resultados.
 *
 * @param {string} sql - SQL validado listo para ejecutar
 * @returns {Promise<Array>} - Array de objetos con los resultados
 * @throws {Error} - Si la query falla en HANA
 */
async function run(sql) {
  // Inyectar TOP si la query no lo tiene, como capa adicional de seguridad
  // HANA usa TOP, no LIMIT
  const sqlWithLimit = _injectTopClause(sql, MAX_ROWS);

  try {
    const db = await cds.connect.to('db');
    const result = await db.run(sqlWithLimit);

    // CDS puede retornar un objeto único si es COUNT(*) u otro escalar
    if (!result) return [];
    if (Array.isArray(result)) return result;

    // Si es un objeto único (ej: resultado de COUNT), lo envuelve en array
    return [result];

  } catch (err) {
    // Wrappear el error de HANA en algo más legible para el log de auditoría
    // sin exponer detalles técnicos al usuario final
    const message = _parseHanaError(err);
    throw new Error(message);
  }
}

/**
 * Inyecta TOP N en el SELECT si la query no lo tiene ya.
 * Maneja SELECT DISTINCT y SELECT con comentarios al inicio.
 *
 * @param {string} sql
 * @param {number} limit
 * @returns {string}
 */
function _injectTopClause(sql, limit) {
  const trimmed = sql.trim();

  // Si ya tiene TOP o LIMIT, no tocar
  const upperSql = trimmed.toUpperCase();
  if (upperSql.includes(' TOP ') || upperSql.includes('\nTOP ')) return trimmed;
  if (upperSql.includes(' LIMIT ') || upperSql.includes('\nLIMIT ')) return trimmed;

  // Insertar TOP después de SELECT o SELECT DISTINCT
  return trimmed
    .replace(/^SELECT DISTINCT\s+/i, `SELECT DISTINCT TOP ${limit} `)
    .replace(/^SELECT\s+/i, `SELECT TOP ${limit} `);
}

/**
 * Convierte errores técnicos de HANA en mensajes más descriptivos.
 * No exponer stack traces ni detalles de schema al log de usuario.
 *
 * @param {Error} err
 * @returns {string}
 */
function _parseHanaError(err) {
  const msg = err.message ?? '';

  if (msg.includes('invalid table name') || msg.includes('not found')) {
    return 'La consulta referencia una tabla que no existe en el esquema.';
  }
  if (msg.includes('invalid column name')) {
    return 'La consulta referencia una columna que no existe.';
  }
  if (msg.includes('syntax error') || msg.includes('parse error')) {
    return 'El SQL generado tiene un error de sintaxis.';
  }
  if (msg.includes('permission') || msg.includes('privilege')) {
    return 'Sin permisos para acceder a ese recurso.';
  }

  // Error genérico — loguear el original en consola para debugging
  console.error('[sql-runner] Error HANA no categorizado:', err.message);
  return 'Error al ejecutar la consulta en la base de datos.';
}

async function getSeasonsByIDs(ids = []) {

  if (!ids.length) return [];
  const db = await cds.connect.to('db');

  return await db.run(
    SELECT.from('app.evaluator.Season')
      .columns(
        'id',
        'description',
        'status'
      )
      .where({
        id: { in: ids }
      })
  );
}


/**
 * Obtiene el histórico de posiciones de un empleado.
 *
 * @param {string} sapNumber Número SAP del empleado.
 * @returns {Promise<Array>} Historial de posiciones del empleado.
 */
async function getPosicionesBySapNumber(sapNumber) {

  if (!sapNumber) return [];

  const db = await cds.connect.to('db');

  return await db.run(
    SELECT.from('app.evaluator.HistoricoPosiciones as H')
      .leftJoin('app.evaluator.Cargo as C')
      .on('H.posicion = C.codigo')
      .columns(
        'H.id as id',
        'H.empleado_SAP_Number as empleadoSapNumber',
        'H.Posicion as posicion',
        'C.Description as descripcionCargo'
      )
      .where({
        'H.empleado_SAP_Number': sapNumber
      })
  );
}



async function resolverPersona(busqueda) {
  if (!busqueda) return [];

  const db = await cds.connect.to('db');

  const value = `%${busqueda
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')}%`;

  return await db.run(
    `
    SELECT TOP 10
      SAP_NUMBER        AS "sapNumber",
      FIRST_NAME || ' ' || LAST_NAME AS "nombreCompleto",
      CEDULA_INGENIO   AS "cedulaIngenio",
      EMAIL            AS "email",
      DEPENDENCY_DESCRIPTION AS "dependencia"
    FROM APP_EVALUATOR_EMPLEADO
    WHERE LOWER(SAP_NUMBER) LIKE ?
       OR LOWER(CEDULA_INGENIO) LIKE ?
       OR LOWER(EMAIL) LIKE ?
       OR LOWER(FIRST_NAME || ' ' || LAST_NAME) LIKE ?
    `,
    [value, value, value, value]
  );
}


/**
 * Busca uno o varios planes de carrera por código o descripción.
 *
 * @param {string} busqueda Texto ingresado por el usuario.
 * @returns {Promise<Array>} Planes de carrera encontrados.
 */
async function resolverPlanCarrera(busqueda, temporadaId) {
  if (!busqueda) return [];

  const db = await cds.connect.to('db');

  const value = `%${busqueda
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')}%`;

  return await db.run(
    `
    SELECT TOP 10
      CODE         AS "code",
      DESCRIPTION  AS "description",
      TEMPORADA_ID AS "temporadaId"
    FROM APP_EVALUATOR_CAREER_PLAN
    WHERE LOWER(CODE) LIKE ?
       OR (
            TEMPORADA_ID = ?
            AND LOWER(DESCRIPTION) LIKE ?
          )
    `,
    [value, temporadaId, value]
  );
}


/**
 * Busca temporadas por su descripción.
 *
 * Permite encontrar temporadas aunque el usuario escriba el nombre
 * con diferentes combinaciones de mayúsculas, minúsculas o sin tildes.
 *
 * Ejemplos:
 * - Zafra 2025
 * - zafra 2025
 * - ZAFRA 2025
 * - mantenimiento 2024
 *
 * @param {string} busqueda Nombre de la temporada.
 * @returns {Promise<Array>} Temporadas encontradas.
 */
async function resolverTemporada(busqueda) {

  if (!busqueda) return [];

  const db = await cds.connect.to('db');

  const value = `%${busqueda
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')}%`;

  return await db.run(
    `
    SELECT TOP 10
      ID          AS "id",
      DESCRIPTION AS "description",
      STATUS      AS "status",
      START_DATE  AS "startDate",
      END_DATE    AS "endDate"
    FROM APP_EVALUATOR_SEASON
    WHERE LOWER(DESCRIPTION) LIKE ?
    `,
    [value]
  );
}

module.exports = { run, getSeasonsByIDs, getPosicionesBySapNumber, resolverPersona, resolverPlanCarrera, resolverTemporada };
