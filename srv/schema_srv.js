const cds = require('@sap/cds');
const sqlRunner = require('./lib/sql-runner');


module.exports = function () {

    this.on('ResolverTemporada', async (req) => {

        const { busqueda } = req.data;

        if (!busqueda) {
            return req.error(400, 'Se requiere un valor de búsqueda.');
        }

        return await sqlRunner.resolverTemporada(busqueda);

    });

    this.on('ResolverPlanCarrera', async (req) => {
        const { busqueda, temporadaId } = req.data;

        if (!busqueda) {
            return req.error(400, 'Se requiere el código o descripción del plan de carrera.');
        }

        const resultados = await sqlRunner.resolverPlanCarrera(busqueda, temporadaId || '');

        return resultados;
    });

    this.on('ResolverPersona', async (req) => {
        const { busqueda } = req.data;

        if (!busqueda) {
            return req.error(400, 'Se requiere un valor de búsqueda.');
        }

        return await sqlRunner.resolverPersona(busqueda);
    });

    this.on('GetPreparacionId', async (req) => {

        const { careerPlanCode, evaluatorSapNumber } = req.data;

        if (!careerPlanCode) {
            return req.error(400, 'Se requiere el código del plan de carrera.');
        }

        if (!evaluatorSapNumber) {
            return req.error(400, 'Se requiere el número SAP del evaluador.');
        }

        return {
            preparacionId: generarPreparacionId(
                careerPlanCode,
                evaluatorSapNumber
            )
        };
    });

    // ── Skill: getPosiciones ─────────────────────────────────────
    this.on('getPosiciones', async (req) => {
        const { sapNumber } = req.data;

        if (!sapNumber) {
            return req.error(400, 'Se requiere el número SAP del empleado.');
        }

        const posiciones = await sqlRunner.getPosicionesBySapNumber(sapNumber);
        console.log(posiciones)

        return posiciones;
    });

};


/**
 * Genera el identificador único de una preparación.
 *
 * Formato:
 * PREP-{careerPlanCode}-{evaluatorSapNumber}-{random}
 *
 * Ejemplo:
 * PREP-PC-ADMIN-00009512-48379216
 *
 * @param {string} careerPlanCode Código del plan de carrera.
 * @param {string} evaluatorSapNumber Número SAP del evaluador.
 * @returns {string} Identificador generado.
 */
function generarPreparacionId(careerPlanCode, evaluatorSapNumber) {

    if (!careerPlanCode || !evaluatorSapNumber) {
        throw new Error('Se requiere el código del plan de carrera y el número SAP del evaluador.');
    }

    const random = `${Math.floor(1000 + Math.random() * 9000)}${Math.floor(1000 + Math.random() * 9000)}`;

    return `PREP-${careerPlanCode.toString()}-${evaluatorSapNumber.toString()}-${random}`;
}
