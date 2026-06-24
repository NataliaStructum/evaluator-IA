const cds = require('@sap/cds');
const sqlRunner = require('./lib/sql-runner');


module.exports = function () {

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


