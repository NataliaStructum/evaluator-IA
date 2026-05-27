'use strict';
// srv/chat-service.js

const cds = require('@sap/cds');
const cache = require('./lib/cache');
const validator = require('./lib/validator');
const sqlRunner = require('./lib/sql-runner');
const audit = require('./lib/audit');
const normalizer = require('./lib/normalizer');

// [PASO 5] Descomentar cuando se agregue IA:
// const promptBuilder = require('./lib/prompt-builder');

module.exports = function () {

  // ── askQuestion ────────────────────────────────────────────
  this.on('askQuestion', async (req) => {
    const startTime = Date.now();
    const { question, temporadas } = req.data;

    // ── Usuario ─────────────────────────────────────────────
    //cambiar que sean datos que vienen del req.user
    const userID = req.user?.id ?? 'anonymous';
    const userName = req.user?.name ?? 'anonymous';

    // ── Normalizar pregunta ─────────────────────────────────
    const normalizedQuestion = normalizer.normalizeQuestion(question);

    // ── Resolver scope ──────────────────────────────────────
    const scope = await _resolveScope(temporadas);

    // ── Base auditoría ──────────────────────────────────────
    const auditBase = {
      userID,
      userName,
      question,
      normalizedQuestion,
      temporada: scope.label,
      llmModel: 'none'
    };

    let sqlResult = null;
    try {
      // ── 1. Revisar caché ──────────────────────────────────
      const cached = await cache.get(normalizedQuestion, scope.cacheKey);

      if (cached) {
        const logID = await audit.log({
          ...auditBase,
          sql: cached.sql,
          tablesUsed: cached.tablesUsed,
          resultCount: cached.registros,
          cacheHit: true,
          latencyMs: Date.now() - startTime,
          success: true
        });

        return {
          respuesta: cached.respuesta,
          sql: cached.sql,
          registros: cached.registros,
          fromCache: true,
          logID
        };
      }

      // ── 2. Obtener SQL ────────────────────────────────────
      // ┌───────────────────────────────────────────────────────┐
      // │ PASO 1 — SQL hardcodeado de prueba                   │
      // │ En Paso 5 reemplazar con:                            │
      // │   const sqlResult = await promptBuilder              │
      // │     .generateSQL(question, scope);                   │
      // └───────────────────────────────────────────────────────┘

      sqlResult = _buildTestSQL(scope);

      // ── 3. Validar SQL ────────────────────────────────────
      const validationError = validator.validate(sqlResult);

      if (validationError) {

        const logID = await audit.log({
          ...auditBase,
          sql: sqlResult.sql,
          tablesUsed: sqlResult.tablas_usadas,
          cacheHit: false,
          latencyMs: Date.now() - startTime,
          success: false,
          errorMsg: validationError
        });
        return {
          respuesta: validationError,
          sql: null,
          registros: 0,
          fromCache: false,
          logID
        };
      }

      // ── 4. Ejecutar en HANA ───────────────────────────────
      const data = await sqlRunner.run(sqlResult.sql);

      // ── 5. Construir respuesta ────────────────────────────
      // ┌───────────────────────────────────────────────────────┐
      // │ PASO 1 — respuesta directa con datos raw             │
      // │ En Paso 5 reemplazar con:                            │
      // │   const respuesta = await promptBuilder.synthesize(  │
      // │     question, data, sqlResult.razonamiento, scope    │
      // │   );                                                 │
      // └───────────────────────────────────────────────────────┘
      const respuesta = _buildTestResponse(data, question, scope);

      // 6. RESULT BASE
      const result = {
        respuesta,
        sql: sqlResult.sql,
        registros: data.length,
        fromCache: false
      };
      /// ── 7. Guardar en caché ───────────────────────────────────────────────────────
      cache.set(normalizedQuestion, scope, { ...result, tablesUsed: sqlResult.tablas_usadas });

      // ── 8. Auditoría ──────────────────────────────────────
      const logID = await audit.log({
        ...auditBase,
        sql: sqlResult.sql,
        tablesUsed: sqlResult.tablas_usadas,
        resultCount: data.length,
        cacheHit: false,
        latencyMs: Date.now() - startTime,
        success: true
      });

      // 9. RESPUESTA FINAL
      return {
        ...result,
        logID
      };

    } catch (err) {

      const logID = await audit.log({
        ...auditBase,
        sql: sqlResult?.sql ?? null,
        cacheHit: false,
        latencyMs: Date.now() - startTime,
        success: false,
        errorMsg: err.message
      });

      throw req.error(500, {
        message: `Error procesando tu consulta: ${err.message} ${logID ? `(logID: ${logID})` : ''}`
      });
    }

  });

  // ── submitFeedback ──────────────────────────────────────────
  this.on('submitFeedback', async (req) => {
    const { auditLogID, helpful, comment } = req.data;
    // debe venir de req.data 
    const userID = req.user?.id ?? 'anonymous';

    try {
      const { ChatResponseFeedback } = cds.entities('app.evaluator.chat');
      await INSERT.into(ChatResponseFeedback).entries({
        ID: cds.utils.uuid(),
        auditLogID,
        userID,
        helpful,
        comment: comment?.substring(0, 500) ?? '',
      });
      return {
        message: helpful
          ? '¡Gracias por tu feedback positivo!'
          : 'Gracias, usaremos tu feedback para mejorar.',
      };
    } catch (err) {
      throw req.error(500, `Error guardando feedback: ${err.message}`);
    }
  });

  // ── getCacheStats ───────────────────────────────────────────
  this.on('getCacheStats', async (req) => {
    const stats = await cache.getStats();
    return {
      active: stats.active,
      totalHits: stats.totalHits,
      totalEntries: stats.totalEntries,
    };
  });

  // ── invalidateCache ─────────────────────────────────────────
  this.on('invalidateCache', async (req) => {
    const { temporadas } = req.data;
    const scope = await _resolveScope(temporadas);
    console.log(scope)
    let removed = 0;

    if (scope.type === 'all') {
      // Invalida TODO el caché
      removed = await cache.invalidateAll();
    } else {
      // Invalida solo las temporadas indicadas una por una
      for (const t of scope.descriptions) {
        removed += await cache.invalidateTemporada(t);
      }
    }

    return {
      message: `${removed} entradas del caché invalidadas (scope: ${scope.label}).`,
    };
  });

};

// ── _resolveScope ───────────────────────────────────────────────
//
// Interpreta el array de temporadas y retorna un objeto scope
// que usan el SQL builder, el caché y el log de forma consistente.
//
// Casos:
//   null / []            → todas las temporadas  (type: 'all')
//   ['ALL']              → todas las temporadas  (type: 'all')
//   ['2024-B']           → una temporada         (type: 'one')
//   ['2024-A', '2024-B'] → varias temporadas     (type: 'many')

async function _resolveScope(temporadas) {

  // Sin input o array vacío → todas
  if (!temporadas || temporadas.length === 0) {
    return {
      type: 'all',
      values: [],
      descriptions: [],
      label: 'todas las temporadas',
      cacheKey: '__all__'
    };
  }

  // Normalizar IDs
  const normalized = temporadas
    .map(t => String(t).trim())
    .filter(Boolean);

  // Detectar ALL/TODAS

  const hasAll = normalized.some(t => {
    const upper = t.toUpperCase();
    return (upper === 'ALL' || upper === 'TODAS');
  });

  if (hasAll) {
    return {
      type: 'all',
      values: [],
      descriptions: [],
      label: 'TODAS LAS TEMPORADAS',
      cacheKey: '__all__'
    };
  }

  // Buscar temporadas reales
  const temporadasDB = await sqlRunner.getSeasonsByIDs(normalized);

  // Descriptions
  const descriptions = temporadasDB
    .map(t => t.description)
    .filter(Boolean);

  // Cache key usando descriptions
  const normalizedDescriptions = descriptions
    .map(d => normalizer.normalizeTemporadaDesc(d))
    .sort();
  const cacheKey = normalizedDescriptions.join('__');

  // Una temporada
  if (normalized.length === 1) {
    return {
      type: 'one',
      values: normalized,
      descriptions,
      label: descriptions[0] ?? '',
      cacheKey
    };
  }

  // Varias temporadas
  return {
    type: 'many',
    values: normalized.sort(),
    descriptions: descriptions.sort(),
    label: descriptions.join(', '),
    cacheKey
  };
}


// ── Helpers de desarrollo (se eliminan en Paso 5) ───────────────

function _buildTestSQL(scope) {
  let whereClause = '';

  if (scope.type === 'one') {
    whereClause = `WHERE P.TEMPORADA_ID = '${scope.values[0]}'`;
  } else if (scope.type === 'many') {
    const list = scope.values.map(t => `'${t}'`).join(', ');
    whereClause = `WHERE P.TEMPORADA_ID IN (${list})`;
  }
  // type 'all' → sin WHERE
return {
    sql: `
      SELECT
        P.ID,
        P.TEMPORADATEXT,
        P.PLANCTEXT,
        P.EVALUADORTEXT,
        P.STATUS,
        P.CONTEO
      FROM APP_EVALUATOR_PREPARACION as P
      ${whereClause}
      ORDER BY P.CREATEDAT DESC
    `.trim(),
    tablas_usadas: ['PREPARACION'],
    confianza: 'alta',
    razonamiento: `SQL hardcodeado — scope: ${scope.label}`,
  };
}

function _buildTestResponse(data, question, scope) {
  if (!data || data.length === 0) {
    return `No se encontraron registros para: "${question}"`;
  }

  const lines = data.map((row, i) => {
    const status = row.STATUS ?? '-';
    const plan = row.PLANCTEXT ?? '-';
    const eval_ = row.EVALUADORTEXT ?? '-';
    const count = row.CONTEO ?? 0;
    const temp = row.TEMPORADATEXT ?? '-';
    return `${i + 1}. [${status}] ${plan} (${temp}) — Evaluador: ${eval_} (${count} empleados)`;
  });

  return `[MODO PRUEBA] ${data.length} preparación(es) — ${scope.label}:\n\n${lines.join('\n')}`;
}