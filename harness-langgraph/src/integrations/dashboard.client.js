/**
 * Consulta de KPIs: GET /api/dashboard/stats. La usa el nodo fin al
 * cerrar la corrida para loguear el estado del tablero (pendientes,
 * aprobadas, stock bajo) después de que el agente actuó.
 */
import { api } from './backend-client.js';

export const obtenerStats = () => api.get('/dashboard/stats');
