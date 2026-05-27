namespace app.evaluator;
using {managed} from '@sap/cds/common';

entity Season : managed {
    key id          : UUID;
        description : String(1000);
        start_date  : Date;
        end_date    : Date;
        season      : String(50);
        year        : Integer;
        month       : Integer;
        created_by  : String(100);
        status      : String(20);
}

entity Cargo {
    key id          : UUID;
        Codigo      : String(10);
        Description : String(255);
        start_date  : String(10);
        end_date    : String(10);
        Liderazgo   : String default 'No';
}

entity Preparacion : managed {
    key id            : String(100);
        temporada     : Association to Season;
        planC         : Association to Career_Plan;
        evaluador     : Association to Empleado;
        status        : String(20);
        conteo        : Integer;
        temporadaText : String(100);
        planCText     : String(100);
        evaluadortext : String(100);
        correo        : String(100);
}

entity Empleados_Preparacion : managed {
    key id                : UUID;
        temporada         : Association to Season;
        preparacion       : String(100);
        empleado          : Association to Empleado;
        lider             : String(10);
        status            : String(100);
        evaluador         : String(1000);
        evaluado          : String(1000);
        id_cargo          : Association to Cargo;
        id_cargo_Codigo   : String(10);
        descripcion_cargo : String(1000);

}

entity Career_Plan : managed {
    key Code         :      String(255);
        Description  :      String(255);
        Status       :      String(50);
        Dependencies : many String(500);
        asistencia   :      Decimal(5, 2);
        temporada    :      Association to Season;
}


entity Empleado {
    key SAP_Number                   : String(100);
        First_Name                   : String(100);
        Last_Name                    : String(100);
        Gender                       : String(100);
        Birth_Date                   : Date;
        Document_Type                : String(100);
        Document_ID                  : String(100);
        Cedula_Ingenio               : String(100);
        Contract_Type                : String(100);
        Contract_Description         : String(100);
        Status                       : String(100);
        Labor_Relationship           : String(100);
        Position                     : String(100);
        Organizational_Key           : String(100);
        Labor_Rel_Description        : String(100);
        Position_Description         : String(100);
        Dependency_Description       : String(100);
        Admission_Reason             : String(100);
        Admission_Reason_Description : String(100);
        Admission_Date_From          : Date;
        Effective_Until              : Date;
        Discharge_Reason             : String(100);
        Discharge_Reason_Description : String(100);
        Submotivo_Baja               : String(100);
        Submotivo_Baja_Description   : String(100);
        Discharge_Date_From          : Date;
        Effective_Until_Discharge    : Date;
        Service_Time                 : String(100);
        email                        : String(200);
        email2                       : String(200);
}
