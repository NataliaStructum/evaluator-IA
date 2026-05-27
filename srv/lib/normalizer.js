'use strict';

/**
 * Retorna la lista de tablas permitidas.
 * Útil para incluirlas en el contexto del prompt.
 *
 * @returns {string[]}
 */
function normalizeQuestion(question) {
  return question
    ?.trim()
    ?.toLowerCase()
    ?.normalize('NFD')
    ?.replace(/[\u0300-\u036f]/g, '')
    ?.replace(/[¿?¡!.,;:()"]/g, '')
    ?.replace(/\s+/g, ' ')
    ?.trim();
}


function normalizeTemporadaDesc(text) {

  return text
    ?.trim()
    ?.toLowerCase()
    ?.normalize('NFD')
    ?.replace(/[\u0300-\u036f]/g, '')
    ?.replace(/[¿?¡!.,;:()"]/g, '')
    ?.replace(/\s+/g, '-');
}

module.exports = { normalizeQuestion, normalizeTemporadaDesc };
