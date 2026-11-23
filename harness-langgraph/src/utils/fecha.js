/**
 * Día calendario UTC ('YYYY-MM-DD') de un timestamp venga en el
 * formato que venga — SPEC-25 (T25.5): antes se hacía
 * `fecha.slice(0,10)` sobre el string 'YYYY-MM-DD HH:MM:SS' de
 * SQLite; con timestamptz el backend serializa ISO con Z y un
 * slice posicional seguía funcionando de casualidad. Parsear como
 * Date es a prueba de formatos; toISOString mantiene el día UTC
 * (mismo criterio que cuando las fechas eran TEXT en UTC).
 */
export const diaUtc = (fecha) => new Date(fecha).toISOString().slice(0, 10);
