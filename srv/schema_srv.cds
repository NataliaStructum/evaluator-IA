using {app.evaluator as my} from '../db/schema';

service MyEvaluationsService {
    entity Season                as projection on my.Season;
    entity Empleado              as projection on my.Empleado;
    entity Cargo                 as projection on my.Cargo;
    entity Career_Plan           as projection on my.Career_Plan;
    entity Preparacion           as projection on my.Preparacion;
    entity Empleados_Preparacion as projection on my.Empleados_Preparacion;
}