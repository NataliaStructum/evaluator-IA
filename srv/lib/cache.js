'use strict';
// srv/lib/cache.js
// ─────────────────────────────────────────────────────────────────
// Caché de respuestas del chatbot — implementación en tabla HANA.
// Compartido entre todos los usuarios e instancias de CF.
//
// LÓGICA DE TTL INTELIGENTE:
//
//   La clave es siempre consultar el estado real de las temporadas
//   involucradas en el scope antes de decidir cuánto tiempo cachear.
//
//   ┌─────────────────────────────────────────────────────────────┐
//   │ CASO 1 — scope 'one' o 'many', todas cerradas              │
//   │   → TTL LARGO (30 días)                                    │
//   │   La data no va a cambiar. Puede haber meses enteros        │
//   │   sin actividad donde todas las temporadas estén cerradas.  │
//   │                                                             │
//   │ CASO 2 — scope 'one' o 'many', alguna activa               │
//   │   → TTL CORTO (30 min)                                     │
//   │   Evaluaciones en curso, empleados que completan, etc.      │
//   │                                                             │
//   │ CASO 3 — scope 'all', TODAS las temporadas cerradas         │
//   │   → TTL LARGO (30 días)                                     │
//   │   Si no hay ninguna temporada activa en todo el sistema,    │
//   │   la respuesta es estable aunque abarque todas.             │
//   │                                                             │
//   │ CASO 4 — scope 'all', alguna temporada activa              │
//   │   → TTL CORTO (30 min)                                     │
//   │                                                             │
//   │ CASO 5 — scope 'none' (sin filtro explícito)               │
//   │   → TTL CORTO siempre (no sabemos qué temporadas toca)     │
//   └─────────────────────────────────────────────────────────────┘
//
// ESTADO CERRADO:
//   Se considera "cerrada" una temporada cuyo Season.status = 'CLOSED'.
//   Ajustar el valor en la constante CLOSED_STATUS si difiere.
// ─────────────────────────────────────────────────────────────────

const cds = require('@sap/cds');
const normalizer = require('./normalizer');

// ── Constantes ─────────────────────────────────────────────────
const TTL = {
  SHORT: 30 * 60 * 1000,              // 30 minutos — temporadas activas
  LONG: 30 * 24 * 60 * 60 * 1000,   // 30 días    — todas cerradas
};

// Valor de Season.status que indica temporada cerrada.
// Ajustar si en tu schema usas otro valor ('Cerrada', 'INACTIVE', etc.)
const CLOSED_STATUS = 'cerrada';

// Intervalo mínimo entre limpiezas de registros expirados
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // 1 hora
let lastCleanup = 0;

// ── API pública ────────────────────────────────────────────────

/**
 * Busca una respuesta cacheada en HANA.
 *
 * @param {string} question  - Pregunta original del usuario
 * @param {string} scopeKey  - Key del scope (__all__, 2024-B, etc.)
 * @returns {Promise<object|null>}
 */
async function get(question, scopeKey) {
  try {
    const db = await cds.connect.to('db');
    const key = _buildKey(question, scopeKey);
    const now = new Date();

    const entry = await SELECT.one
      .from('app.evaluator.chat.ChatCache')
      .where({ questionKey: key, active: true })
      .and('expiresAt >', now);

    if (!entry) return null;

    // Incrementar hits — fire and forget
    _incrementHits(db, entry.ID).catch(() => { });

    // Limpieza periódica — fire and forget
    _maybeCleanup(db).catch(() => { });

    return {
      respuesta: entry.respuesta,
      sql: entry.sql,
      tablesUsed: entry.tablesUsed,
      registros: entry.registros,
      fromCache: true,
      logID: null,
    };

  } catch (err) {
    console.error('[cache] Error en get:', err.message);
    return null; // fallo silencioso — el flujo sigue sin caché
  }
}

/**
 * Guarda una respuesta en caché con TTL inteligente.
 *
 * @param {string} question  - Pregunta original
 * @param {object} scope     - Objeto scope { type, values, cacheKey, label }
 * @param {object} value     - { respuesta, sql, registros }
 */
async function set(question, scope, value) {
  try {
    const db = await cds.connect.to('db');
    const key = _buildKey(question, scope.cacheKey);

    // Determinar TTL consultando estado real de temporadas en HANA
    const ttlMs = await _resolveTTL(db, scope);
    const expiresAt = new Date(Date.now() + ttlMs);
    const ttlLabel = ttlMs === TTL.LONG ? '30 días' : '30 min';

    // Desactivar entrada anterior si existe (evita duplicados)
    await UPDATE('app.evaluator.chat.ChatCache')
      .set({ active: false })
      .where({ questionKey: key, active: true });

    // Insertar entrada nueva
    await INSERT.into('app.evaluator.chat.ChatCache').entries({
      ID: cds.utils.uuid(),
      questionKey: key,
      scopeKey: scope.cacheKey,
      scopeType: scope.type,
      respuesta: value.respuesta,
      sql: (value.sql ?? '').substring(0, 2000),
      tablesUsed: (Array.isArray(value.tablesUsed) ? value.tablesUsed.join(', ') : (value.tablesUsed ?? '')).substring(0, 200),
      registros: value.registros ?? 0,
      hits: 0,
      expiresAt,
      active: true,
    });

    console.log(`[cache] SET key="${key}" ttl=${ttlLabel} expires=${expiresAt.toISOString()}`);

  } catch (err) {
    // No crítico — el usuario ya tiene su respuesta
    console.error('[cache] Error en set:', err.message);
  }
}

/**
 * Invalida entradas que contienen una temporada específica en su scopeKey.
 * Afecta entradas de tipo 'one' y 'many' que incluyan esta temporada.
 *
 * @param {string} temporada
 * @returns {Promise<number>}
 */
async function invalidateTemporada(temporada) {
  try {
    temporada = normalizer.normalizeTemporadaDesc(temporada);
    const result = await UPDATE('app.evaluator.chat.ChatCache')
      .set({ active: false })
      .where(`(scopeKey LIKE '%${temporada}%' or scopeKey = '__all__') AND active = true`);

    const count = result ?? 0;
    console.log(`[cache] Invalidadas ${count} entradas para temporada "${temporada}"`);
    return count;

  } catch (err) {
    console.error('[cache] Error en invalidateTemporada:', err.message);
    return 0;
  }
}

/**
 * Invalida TODO el caché activo.
 *
 * @returns {Promise<number>}
 */
async function invalidateAll() {
  try {
    const result = await UPDATE('app.evaluator.chat.ChatCache')
      .set({ active: false })
      .where({ active: true });

    const count = result ?? 0;
    console.log(`[cache] Caché completo invalidado: ${count} entradas`);
    return count;

  } catch (err) {
    console.error('[cache] Error en invalidateAll:', err.message);
    return 0;
  }
}

/**
 * Estadísticas del caché para monitoreo.
 *
 * @returns {Promise<object>}
 */
async function getStats() {
  try {
    const now = new Date();

    const [activeRow, expiredRow, hitsRow] = await Promise.all([
      SELECT.one
        .from('app.evaluator.chat.ChatCache')
        .columns('COUNT(*) as cnt')
        .where({ active: true })
        .and('expiresAt >', now),

      SELECT.one
        .from('app.evaluator.chat.ChatCache')
        .columns('COUNT(*) as cnt')
        .where({ active: true })
        .and('expiresAt <=', now),

      SELECT.one
        .from('app.evaluator.chat.ChatCache')
        .columns('SUM(hits) as totalHits')
        .where({ active: true }),
    ]);

    return {
      active: Number(activeRow?.cnt ?? 0),
      expired: Number(expiredRow?.cnt ?? 0),
      totalHits: Number(hitsRow?.totalHits ?? 0),
      totalEntries: Number(activeRow?.cnt ?? 0) + Number(expiredRow?.cnt ?? 0),
    };

  } catch (err) {
    console.error('[cache] Error en getStats:', err.message);
    return { active: 0, expired: 0, totalHits: 0, totalEntries: 0 };
  }
}

// ── TTL resolution ─────────────────────────────────────────────

/**
 * Determina el TTL apropiado consultando el estado real de las
 * temporadas en HANA.
 *
 * La lógica completa:
 *
 *   scope 'none'
 *     → TTL corto siempre. Sin filtro explícito no sabemos
 *       qué temporadas toca la pregunta.
 *
 *   scope 'one' o 'many'
 *     → Consulta Season para esas temporadas específicas.
 *     → Si TODAS cerradas → TTL largo.
 *     → Si alguna activa  → TTL corto.
 *
 *   scope 'all'
 *     → Consulta Season para TODAS las temporadas del sistema.
 *     → Si no hay NINGUNA activa (período sin actividad, ej: meses
 *       de off-season) → TTL largo.
 *     → Si hay alguna activa → TTL corto.
 */
async function _resolveTTL(db, scope) {
  if (scope.type === 'none') {
    return TTL.SHORT;
  }

  try {
    let query = SELECT.one
      .from('app.evaluator.Season')
      .columns('COUNT(*) as cnt')
      .where({ status: { '!=': CLOSED_STATUS } });

    // Para scopes específicos filtrar solo esas temporadas
    if (scope.type === 'one' || scope.type === 'many') {
      query = query.and({ id: { in: scope.values } });
    }
    // Para scope 'all' no agregar filtro adicional —
    // buscamos si HAY ALGUNA temporada activa en todo el sistema

    const result = await query;
    const hayActivas = Number(result?.cnt ?? 1) > 0;

    if (!hayActivas) {
      // Todas las temporadas relevantes están cerradas
      const scopeDesc = scope.type === 'all'
        ? 'en todo el sistema'
        : `en scope [${scope.label}]`;
      console.log(`[cache] Todas las temporadas cerradas ${scopeDesc} → TTL largo (30 días)`);
      return TTL.LONG;
    }

    return TTL.SHORT;

  } catch (err) {
    // Si no puede consultar, usar TTL corto por seguridad
    console.warn('[cache] No se pudo consultar estado de temporadas, usando TTL corto:', err.message);
    return TTL.SHORT;
  }
}

// ── Helpers internos ───────────────────────────────────────────

/**
 * Normaliza la pregunta y construye la key compuesta con el scopeKey.
 * Garantiza que variaciones de mayúsculas/puntuación/espacios
 * apunten a la misma entrada de caché.
 */
function _buildKey(question, scopeKey) {

  const normalized = normalizer.normalizeQuestion(question);

  return `${normalized}__${scopeKey}`;
}

/**
 * Incrementa el contador de hits de una entrada.
 * Fire-and-forget — no bloquea el flujo de respuesta.
 */
async function _incrementHits(db, id) {
  await UPDATE('app.evaluator.chat.ChatCache')
    .set('hits = hits + 1')
    .where({ ID: id });
}

/**
 * Desactiva registros expirados periódicamente.
 * Máximo una vez por hora para no sobrecargar HANA.
 * Fire-and-forget — no bloquea el flujo principal.
 */
async function _maybeCleanup(db) {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) return;
  lastCleanup = now;

  try {
    const expired = new Date().toISOString();
    const result = await UPDATE('app.evaluator.chat.ChatCache')
      .set({ active: false })
      .where(`expiresAt <= '${expired}' AND active = true`);

    if (result > 0) {
      console.log(`[cache] Limpieza: ${result} entradas expiradas desactivadas`);
    }
  } catch (err) {
    console.warn('[cache] Error en limpieza periódica:', err.message);
  }
}

module.exports = { get, set, invalidateTemporada, invalidateAll, getStats, TTL };