// Aviso fire-and-forget al agente (harness-langgraph). Cuando el
// humano aprueba o rechaza una orden, el backend dispara POST /resume
// para que el grafo reanude justo donde quedó pausado — el agente no
// tiene que estar mirando la base para enterarse de la decisión.
// Es "disparar y olvidar": si el agente está apagado o la corrida ya
// terminó, el aviso se pierde y no pasa nada — la aprobación en sí
// nunca falla por culpa de la notificación.
const HARNESS_URL = process.env.HARNESS_URL ?? 'http://localhost:4110';

export function notificarResume(payload = {}) {
  fetch(`${HARNESS_URL}/resume`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).catch(() => {});
}
