using {app.evaluator as my} from '../db/schema';

service MyEvaluationsService {
    entity Season                as projection on my.Season;
    entity Empleado              as projection on my.Empleado;
    entity Cargo                 as projection on my.Cargo;
    entity Career_Plan           as projection on my.Career_Plan;
    entity Preparacion           as projection on my.Preparacion;
    entity Empleados_Preparacion as projection on my.Empleados_Preparacion;
    entity HistoricoPosiciones   as projection on my.HistoricoPosiciones;

    function getPosiciones(sapNumber: String) returns array of {
        id       : UUID;
        empleado_SAP_Number : String;
        posicion : String;
        descripcion_cargo : String;
    };

    function GetPreparacionId(careerPlanCode: String, evaluatorSapNumber: String) returns {
        preparacionId : String;
    };

    function ResolverPersona(busqueda: String) returns array of {
        sapNumber : String;
        nombreCompleto : String;
        cedulaIngenio : String;
        email : String;
        dependencia : String;
    };

    function ResolverPlanCarrera(busqueda: String, temporadaId: String) returns array of {
        code : String;
        description : String;
    };
}
