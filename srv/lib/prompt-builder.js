'use strict';
// srv/lib/prompt-builder.js
// ─────────────────────────────────────────────────────────────────
// Responsabilidad: construir prompts y ejecutar las dos llamadas
// al LLM via SAP AI SDK OrchestrationClient.
//
// Llamada 1 — generateSQL():
//   Recibe la pregunta + scope, devuelve SQL validado con CoT.
//   temperature: 0 — determinístico, siempre el mismo SQL para
//   la misma pregunta.
//
// Llamada 2 — synthesize():
//   Recibe la pregunta + datos de HANA, devuelve respuesta en
//   lenguaje natural en español.
//   temperature: 0.3 — algo de fluidez pero sin inventar datos.
//
// Basado en el patrón OrchestrationClient del proyecto de referencia
// pero adaptado para Text2SQL con few-shot examples en lugar de RAG.
// ─────────────────────────────────────────────────────────────────

const { OrchestrationClient } = require('@sap-ai-sdk/orchestration');

// ── Configuración central ──────────────────────────────────────
const RESOURCE_GROUP = 'default'; // ajustar si usas otro resource group
const SQL_MODEL = 'gpt-4o-mini';
const SYNTH_MODEL = 'gpt-4o-mini';

// ── API pública ────────────────────────────────────────────────

/**
 * LLAMADA 1: Genera SQL a partir de una pregunta en lenguaje natural.
 * Usa CoT (Chain of Thought) + few-shot examples para máxima precisión.
 *
 * @param {string} question  - Pregunta del usuario
 * @param {object} scope     - { type, values, label, cacheKey }
 * @returns {Promise<{ sql, tablas_usadas, confianza, razonamiento }>}
 */
async function generateSQL(question, scope) {
  const client = new OrchestrationClient(
    {
      promptTemplating: {
        model: {
          name: SQL_MODEL,
          params: {
            max_tokens: 600, // SQL no necesita más — ahorrar tokens
            temperature: 0 // Determinístico: misma pregunta = mismo SQL
          }
        },
        prompt: {
          template: _buildSQLMessages(question, scope)
        }
      },
      filtering: {
        input: {
          filters: [
            {
              type: 'llama_guard_3_8b',
              config: {
                child_exploitation: true,
                code_interpreter_abuse: true,
                defamation: true,
                elections: true,
                hate: true,
                indiscriminate_weapons: true,
                intellectual_property: true,
                non_violent_crimes: true,
                privacy: true,
                self_harm: true,
                sex_crimes: true,
                sexual_content: true,
                specialized_advice: true,
                violent_crimes: true
              }
            }
          ],
        },
        output: {
          filters: [
            {
              type: 'llama_guard_3_8b',
              config: {
                child_exploitation: true,
                code_interpreter_abuse: true,
                defamation: true,
                elections: true,
                hate: true,
                indiscriminate_weapons: true,
                intellectual_property: true,
                non_violent_crimes: true,
                privacy: true,
                self_harm: true,
                sex_crimes: true,
                sexual_content: true,
                specialized_advice: true,
                violent_crimes: true
              }
            }
          ],
        },
      },
    },
    { resourceGroup: RESOURCE_GROUP }
  );

  const response = await client.chatCompletion();
  const content = response.getContent();
  return _parseSQLResponse(content);
}

/**
 * LLAMADA 2: Sintetiza los datos de HANA en una respuesta natural.
 * No inventa datos — solo reformatea lo que HANA devolvió.
 *
 * @param {string} question      - Pregunta original del usuario
 * @param {Array}  data          - Resultados de HANA
 * @param {string} razonamiento  - CoT del paso anterior (contexto para síntesis)
 * @param {object} scope         - Scope para contextualizar la respuesta
 * @returns {Promise<string>}    - Respuesta en español para el usuario
 */
async function synthesize(question, data, razonamiento, scope) {
  // Sin datos — respuesta directa sin llamar al LLM
  if (!data || data.length === 0) {
    return `No encontré registros que coincidan con tu consulta sobre ${scope.label}.`;
  }

  const client = new OrchestrationClient(
    {
      promptTemplating: {
        model: {
          name: SYNTH_MODEL,
          params: {
            max_tokens: 500,
            temperature: 0.3 // Algo de fluidez pero sin inventar información
          }
        },
        prompt: {
          template: _buildSynthesisMessages(question, data, razonamiento, scope)
        }
      },
      filtering: {
        input: {
          filters: [
            {
              type: 'llama_guard_3_8b',
              config: {
                child_exploitation: true,
                code_interpreter_abuse: true,
                defamation: true,
                elections: true,
                hate: true,
                indiscriminate_weapons: true,
                intellectual_property: true,
                non_violent_crimes: true,
                privacy: true,
                self_harm: true,
                sex_crimes: true,
                sexual_content: true,
                specialized_advice: true,
                violent_crimes: true
              }
            }
          ],
        },
        output: {
          filters: [
            {
              type: 'llama_guard_3_8b',
              config: {
                child_exploitation: true,
                code_interpreter_abuse: true,
                defamation: true,
                elections: true,
                hate: true,
                indiscriminate_weapons: true,
                intellectual_property: true,
                non_violent_crimes: true,
                privacy: true,
                self_harm: true,
                sex_crimes: true,
                sexual_content: true,
                specialized_advice: true,
                violent_crimes: true
              }
            }
          ],
        },
      },
    },
    { resourceGroup: RESOURCE_GROUP }
  );

  const response = await client.chatCompletion();
  return response.getContent();
}

// ── Builder de mensajes: Llamada 1 (SQL) ──────────────────────

/**
 * Construye el array de mensajes para la generación de SQL.
 * Estructura:
 *   [system: schema + reglas]
 *   [user/assistant: few-shot example 1]
 *   [user/assistant: few-shot example 2]
 *   [user/assistant: few-shot example 3]
 *   [user: pregunta real]           ← al final, después de los ejemplos
 */
function _buildSQLMessages(question, scope) {
  return [
    { role: 'system', content: _buildSystemPrompt(scope) },
    ..._getFewShotExamples(),
    { role: 'user', content: _buildUserSQLMessage(question, scope) },
  ];
}

/**
 * System prompt: contexto del schema + reglas de seguridad + instrucciones CoT.
 * Es el componente más importante — define exactamente qué puede y no puede hacer el LLM.
 */
function _buildSystemPrompt(scope) {
  console.log(_buildScopeContext(scope))
  return `
Eres un experto en SQL para SAP HANA especializado en sistemas de evaluación de desempeño de colaboradores en un ingenio azucarero.
Tu única función es traducir preguntas en lenguaje natural a consultas SQL válidas para SAP HANA.
═══════════════════════════════════════════════════
ESQUEMA DE BASE DE DATOS — TABLAS DISPONIBLES
═══════════════════════════════════════════════════
TABLA: APP_EVALUATOR_PREPARACION (alias: P)
  ID                    : String — ID preparación
  TEMPORADA_ID          : String — FK temporada
  TEMPORADATEXT         : String — nombre temporada
  PLANC_CODE            : String — FK plan carrera
  PLANCTEXT             : String — nombre plan carrera
  EVALUADOR_SAP_NUMBER  : String — ID evaluador
  EVALUADORTEXT         : String — nombre evaluador
  STATUS                : String — 'Guardado' (borrador), 'Confirmado' (evaluación habilitada), 'Terminado' (evaluadores terminaron de ingresar notas; no representa retroalimentación individual)
  CONTEO                : Integer — cantidad empleados a evaluar en esta preparación
  CORREO                : String — correo evaluador
  CREATEDAT             : Timestamp — fecha creación

TABLA: APP_EVALUATOR_EMPLEADOS_PREPARACION (alias: EP)
  TEMPORADA_ID          : String — FK temporada
  PREPARACION           : String — FK preparación
  EMPLEADO_SAP_NUMBER   : String — FK empleado
  ID_CARGO_CODIGO       : String — código cargo evaluado
  DESCRIPCION_CARGO     : String — nombre cargo evaluado
  EVALUADOR             : String(1000) — comentarios evaluador
  EVALUADO              : String(1000) — autoevaluación empleado
  LIDER                 : String — 'Si'/'No'
  STATUS                : String — null (borrador), 'Confirmado' (visible al evaluador), 'Terminado' (notas registradas, falta retroalimentación), 'Enviado' (retroalimentación finalizada, proceso individual completo)

TABLA: APP_EVALUATOR_SEASON (alias: S)
  ID                    : String — ID temporada
  DESCRIPTION           : String — nombre temporada
  STATUS                : String — 'abierta'/'cerrada'
  STARTDATE             : Date — fecha inicio
  ENDDATE               : Date — fecha fin
  CREATEDAT             : Timestamp — fecha creación
  SEASON                : String — tipo temporada ('Zafra'/'Mantenimiento')

TABLA: APP_EVALUATOR_CAREER_PLAN (alias: CP)
  CODE                  : String(255) — ID plan carrera
  DESCRIPTION           : String(255) — nombre plan carrera
  STATUS                : String(50) — estado plan 'Activo'/'Inactivo'
  DEPENDENCIES          : String[] — dependencias asociadas
  ASISTENCIA            : Decimal(5,2) — porcentaje asistencia
  TEMPORADA_ID          : String — FK temporada

TABLA: APP_EVALUATOR_EMPLEADO (alias: E)
  SAP_NUMBER            : String(100) — ID empleado
  FIRST_NAME            : String(100) — nombres
  LAST_NAME             : String(100) — apellidos
  GENDER                : String(100) — género
  CEDULA_INGENIO        : String(100) — documento identidad en el ingenio
  STATUS                : String(100) — estado empleado
  CONTRACT_TYPE         : String(100) — tipo contrato
  POSITION              : String(100) — código posición actual
  POSITION_DESCRIPTION  : String(100) — nombre cargo actual
  DEPENDENCY_DESCRIPTION: String(100) — dependencia
  ADMISSION_DATE_FROM   : Date — fecha ingreso
  EMAIL                 : String(200) — correo principal
═══════════════════════════════════════════════════
REGLAS ABSOLUTAS — NUNCA VIOLAR
═══════════════════════════════════════════════════
1. SOLO puedes generar sentencias SELECT
2. NUNCA uses: DELETE, UPDATE, INSERT, DROP, ALTER, TRUNCATE, EXEC, GRANT, REVOKE, UNION
3. NUNCA accedas a tablas fuera de las listadas arriba
4. Limita SIEMPRE con TOP 1000 máximo (HANA usa TOP, no LIMIT)
5. Si la pregunta es ambigua o no se puede responder con estas tablas, retorna confianza "baja" y sql vacío
6. Los IDs usados en los ejemplos son ilustrativos. Para la pregunta real, usa siempre los TEMPORADA_ID entregados en el scope actual. Nunca copies valores de temporada desde los ejemplos.
═══════════════════════════════════════════════════
REGLAS DE NEGOCIO
═══════════════════════════════════════════════════
- En APP_EVALUATOR_EMPLEADOS_PREPARACION un empleado solo ha finalizado su proceso de evaluación cuando STATUS = 'Enviado'.
- En APP_EVALUATOR_EMPLEADOS_PREPARACION el estado 'Terminado' sigue considerándose pendiente porque aún falta la retroalimentación.
- No confundir los estados de APP_EVALUATOR_PREPARACION con los estados de APP_EVALUATOR_EMPLEADOS_PREPARACION.
═══════════════════════════════════════════════════
CONTEXTO DE SCOPE ACTUAL
═══════════════════════════════════════════════════
${_buildScopeContext(scope)}
═══════════════════════════════════════════════════
PROCESO DE RAZONAMIENTO (Chain of Thought)
═══════════════════════════════════════════════════
Antes de generar el SQL, razona internamente estos pasos:
  1. ¿Qué tablas necesito? ¿Necesito JOIN?
  2. ¿Qué filtros aplican? (temporada, estado, empleado, etc.)
  3. ¿Qué columnas son necesarias para responder la pregunta?
  4. ¿Necesito agregación? (COUNT, SUM, GROUP BY)
  5. ¿El resultado debe ordenarse? (ORDER BY)
  6. ¿Hay ambigüedad en la pregunta? → confianza baja
═══════════════════════════════════════════════════
FORMATO DE RESPUESTA — OBLIGATORIO
═══════════════════════════════════════════════════
Responde ÚNICAMENTE con un objeto JSON válido, sin markdown, sin texto adicional:
{
  "razonamiento": "descripción breve del paso a paso seguido",
  "sql": "SELECT ...",
  "tablas_usadas": ["APP_EVALUATOR_PREPARACION", ...],
  "confianza": "alta|media|baja"
}
`.trim();
}

/**
 * Contexto de scope para el system prompt.
 * Le dice al LLM exactamente qué temporadas debe considerar.
 */
function _buildScopeContext(scope) {
  switch (scope.type) {
    case 'all':
      return 'El usuario quiere información de TODAS las temporadas. No apliques filtro de temporada a menos que la pregunta lo requiera explícitamente.';
    case 'none':
      return 'No se especificó una temporada concreta. No apliques filtro de temporada, excepto si la pregunta menciona explícitamente una temporada específica.';
    case 'one':
      return `El usuario está consultando específicamente por la temporada: "${scope.values[0]}". Es obligatorio aplicar WHERE TEMPORADA_ID = '${scope.values[0]}' en la consulta.`;
    case 'many':
      return `El usuario está consultando estas temporadas: ${scope.values.map(v => `"${v}"`).join(', ')}. Es obligatorio aplicar WHERE TEMPORADA_ID IN (${scope.values.map(v => `'${v}'`).join(', ')}) en la consulta.`;
    default:
      return 'Sin contexto de temporada.';
  }
}

/**
 * Mensaje del usuario para la generación SQL.
 * Simple y directo — el contexto ya está en el system prompt.
 */
function _buildUserSQLMessage(question, scope) {
  return `Scope actual: ${_buildScopeContext(scope)} Pregunta:${question}`.trim();
}

// ── Few-shot examples ─────────────────────────────────────────
//
// 3 pares user/assistant que muestran al LLM exactamente
// el formato esperado con las tablas reales del proyecto.
// Cubren los patrones más frecuentes: conteo, JOIN, ambigüedad.
//
// PERSONALIZAR: reemplazar los valores de ejemplo ('2024-B', nombres)
// con valores reales de tu HANA para máxima efectividad.

function _getFewShotExamples() {
  return [

    // ── Ejemplo 1: conteo con filtro de temporada ─────────────
    // Patrón: COUNT + WHERE simple
    {
      role: 'user',
      content: 'Pregunta: ¿Cuántas preparaciones hay en la temporada Zafra 2025?',
    },
    {
      role: 'assistant',
      content: JSON.stringify({
        razonamiento: 'Necesito contar registros de PREPARACION filtrando por TEMPORADA_ID. No necesito JOIN. Debo usar el TEMPORADA_ID del scope actual, no el valor del ejemplo.',
        sql: `SELECT COUNT(*) AS TOTAL FROM APP_EVALUATOR_PREPARACION WHERE TEMPORADA_ID = 'ID_TEMPORADA_EJEMPLO'`,
        tablas_usadas: ['APP_EVALUATOR_PREPARACION'],
        confianza: 'alta',
      }),
    },

    // ── Ejemplo 2: JOIN + filtro de estado ────────────────────
    // Patrón: JOIN entre las dos tablas principales + filtro de estado
    {
      role: 'user',
      content: 'Pregunta: ¿Qué empleados tienen su evaluación pendiente en la temporada Mantenimiento 2025?',
    },
    {
      role: 'assistant',
      content: JSON.stringify({
        razonamiento: `Necesito empleados cuya evaluación aún no esté finalizada, por lo tanto debo excluir los registros con STATUS = 'Enviado'. La información principal del estado, temporada y empleado se encuentra en EMPLEADOS_PREPARACION. Para obtener el nombre completo del empleado necesito hacer JOIN con la tabla EMPLEADO usando EMPLEADO_SAP_NUMBER = SAP_NUMBER y concatenar FIRST_NAME y LAST_NAME. Debo usar el TEMPORADA_ID del scope actual, no el valor del ejemplo.`,
        sql: `SELECT TOP 1000
  EP.EMPLEADO_SAP_NUMBER,
  E.FIRST_NAME || ' ' || E.LAST_NAME AS NOMBRE_COMPLETO,
  EP.TEMPORADA_ID,
  EP.STATUS
FROM APP_EVALUATOR_EMPLEADOS_PREPARACION as EP
JOIN APP_EVALUATOR_EMPLEADO as E ON EP.EMPLEADO_SAP_NUMBER = E.SAP_NUMBER
WHERE EP.STATUS != 'Enviado'
  AND EP.TEMPORADA_ID = 'ID_TEMPORADA_EJEMPLO'
ORDER BY E.LAST_NAME, E.FIRST_NAME`,
        tablas_usadas: ['APP_EVALUATOR_EMPLEADOS_PREPARACION', ' APP_EVALUATOR_EMPLEADO'],
        confianza: 'alta',
      }),
    },

    // ── Ejemplo 3: pregunta ambigua → confianza baja ──────────
    // Enseñarle al LLM cuándo debe devolver confianza baja
    // es igual de importante que enseñarle a generar buen SQL.
    {
      role: 'user',
      content: 'Pregunta: ¿Cómo va todo?',
    },
    {
      role: 'assistant',
      content: JSON.stringify({
        razonamiento: 'La pregunta es demasiado vaga y no indica qué información específica del sistema de evaluaciones se necesita. No es posible generar un SQL útil.',
        sql: '',
        tablas_usadas: [],
        confianza: 'baja',
      }),
    },
    // ── Ejemplo 4: filtro de estado ────────────────────
    // Enseñar la logica de negocio específica del proceso de evaluación, que solo se considera finalizado cuando STATUS = 'Enviado'. Esto es crucial para preguntas sobre pendientes.
    {
      role: 'user',
      content: 'Pregunta: ¿Cuántos empleados hacen falta por terminar el proceso de evaluación?'
    },
    {
      role: 'assistant',
      content: JSON.stringify({
        razonamiento:
          'El proceso solo finaliza cuando STATUS = "Enviado". Los estados null, Confirmado y Terminado siguen pendientes. Debo contar los registros que aún no están en Enviado. Debo usar el TEMPORADA_ID del scope actual, no el valor del ejemplo.',
        sql:
          `SELECT COUNT(*) AS TOTAL_EMPLEADOS_PENDIENTES 
FROM APP_EVALUATOR_EMPLEADOS_PREPARACION 
WHERE TEMPORADA_ID = 'ID_TEMPORADA_EJEMPLO' AND STATUS NOT IN ('Enviado')`,
        tablas_usadas: [
          'APP_EVALUATOR_EMPLEADOS_PREPARACION'
        ],
        confianza: 'alta'
      })
    }
  ];
}

// ── Builder de mensajes: Llamada 2 (Síntesis) ─────────────────

/**
 * Construye los mensajes para la síntesis de respuesta natural.
 * Solo dos mensajes — system + user con los datos de HANA.
 * No necesita few-shot porque el task es más libre y directo.
 * 
 * - Para listas de más de 10 elementos, resume y menciona el total
 */
function _buildSynthesisMessages(question, data, razonamiento, scope) {
  return [
    {
      role: 'system',
      content: `
Eres un asistente de análisis de desempeño de colaboradores en un ingenio azucarero.

Tu función es responder preguntas de RRHH en español claro y conciso,
basándote ÚNICAMENTE en los datos que se te proporcionan.

REGLAS:
- Responde siempre en español
- NO inventes información que no esté en los datos
- Si los datos muestran múltiples registros con el mismo nombre, listarlos todos y pedir clarificación
- Usa un tono profesional pero accesible
- Si hay 0 registros, explícalo claramente
- Responde segun la pregunta, no te limites a describir los datos
- Nunca menciones SQL, tablas, ni términos técnicos en tu respuesta

REGLAS DE INTERPRETACIÓN DE NEGOCIO:
- Los estados pueden tener significados distintos según la tabla de origen.
- En APP_EVALUATOR_EMPLEADOS_PREPARACION: 'Enviado' = proceso individual finalizado, 'Terminado' = notas registradas pero falta retroalimentación.
- Si la pregunta habla de empleados pendientes, faltantes o sin finalizar, considera pendiente cualquier estado distinto de 'Enviado'.
- Nunca interpretes automáticamente la palabra 'Terminado' como proceso finalizado sin considerar estas reglas.
      `.trim(),
    },
    {
      role: 'user',
      content: `
Pregunta del usuario: ${question}

Alcance de la consulta: ${scope.label}

Datos encontrados (${data.length} registro${data.length !== 1 ? 's' : ''}):
${JSON.stringify(data.slice(0, 30), null, 2)}

${data.length > 30 ? `(Se muestran 30 de ${data.length} registros totales)` : ''}

Proporciona una respuesta clara y útil para el área de RRHH.
      `.trim(),
    },
  ];
}

// ── Parser de respuesta SQL ────────────────────────────────────

/**
 * Parsea la respuesta JSON del LLM para la generación SQL.
 * Maneja casos donde el LLM agrega markdown o texto extra.
 */
function _parseSQLResponse(content) {
  try {
    // Intentar parsear directo
    return JSON.parse(content);
  } catch {
    // El LLM a veces envuelve en ```json ... ``` — limpiar
    const match = content.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        // Si sigue fallando, retornar confianza baja
      }
    }

    console.warn('[prompt-builder] No se pudo parsear respuesta del LLM:', content);
    return {
      razonamiento: 'Error parseando respuesta del LLM',
      sql: '',
      tablas_usadas: [],
      confianza: 'baja',
    };
  }
}

module.exports = { generateSQL, synthesize };
