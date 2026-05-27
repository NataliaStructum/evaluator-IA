// srv/chat-service.cds

using {app.evaluator.chat as chat} from '../db/chat-schema';
using {app.evaluator} from '../db/schema';

service ChatService {

    // ── Acción principal del chatbot ──────────────────────────
    type ChatResponse {
        respuesta : String;
        sql       : String;
        registros : Integer;
        fromCache : Boolean;
        logID     : UUID;
    }

    /**
     * temporadas — array que controla el scope de la consulta:
     *
     *   null o []                → todas las temporadas
     *   ['ALL']                  → todas las temporadas (alias explícito)
     *   ['2024-B']               → una temporada específica
     *   ['2024-A', '2024-B']     → varias temporadas al tiempo
     */
    action askQuestion(
        question   : String   @mandatory,
        temporadas : array of String   // null | [] | ['ALL'] | ['2024-B'] | ['2024-A','2024-B']
    ) returns ChatResponse;

    // ── Preguntas sugeridas ───────────────────────────────────
    @readonly
    entity SuggestedQuestions as
        projection on chat.ChatSuggestedQuestions
        where
            active = true
        order by
            orderPriority asc;

    // ── Feedback ──────────────────────────────────────────────
    action submitFeedback(
        auditLogID : UUID    @mandatory,
        helpful    : Boolean @mandatory,
        comment    : String
    ) returns {
        message : String
    };

    // ── Auditoría ─────────────────────────────────────────────
    @readonly
    entity AuditLog as
        projection on chat.ChatAuditLog
        order by
            timestamp desc;

    // ── Monitoreo del caché ───────────────────────────────────
    @readonly
    entity ChatCache as
        projection on chat.ChatCache
        order by
            createdAt desc;


    action getCacheStats() returns {
        active       : Integer;
        totalHits    : Integer;
        totalEntries : Integer;
    };

    /**
     * temporadas en invalidateCache sigue la misma lógica:
     *   ['ALL'] o [] → invalida todo el caché
     *   ['2024-B']   → invalida solo esa temporada
     */
    action invalidateCache(
        temporadas : array of String @mandatory
    ) returns {
        message : String
    };

}
