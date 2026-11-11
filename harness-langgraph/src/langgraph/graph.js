/**
 * Construye el StateGraph: registra los nodos (funciones de
 * nodes/), los edges fijos y los condicionales (edges/router.js),
 * y lo compila con SqliteSaver → checkpoints.sqlite. Ese archivo es
 * donde queda persistido el estado en cada paso — y del que se
 * restaura cuando POST /resume reanuda la corrida, incluso tras un
 * reinicio del proceso.
 *
 * Devuelve el grafo compilado que ejecuta harness/orchestrator.js.
 *
 *   leer-inventario → analizar-demanda → calcular-cantidad
 *     → decidir-aprobacion → generar-analisis → crear-orden
 *     → ¿pendientes? → notificar → fin
 *                    └─ no → fin
 * (SPEC-12: sin interrupt — la aprobación humana quedó desacoplada
 * en el backend REST; la corrida es atómica).
 */
import { END, START, StateGraph } from '@langchain/langgraph';
import { SqliteSaver } from '@langchain/langgraph-checkpoint-sqlite';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EstadoGrafo } from './state.js';
import { leerInventario } from './nodes/leer-inventario.js';
import { analizarDemanda } from './nodes/analizar-demanda.js';
import { calcularCantidad } from './nodes/calcular-cantidad.js';
import { generarAnalisis } from './nodes/generar-analisis.js';
import { decidirAprobacion } from './nodes/decidir-aprobacion.js';
import { crearOrdenes } from './nodes/crear-orden.js';
import { notificar } from './nodes/notificar.js';
import { fin } from './nodes/fin.js';
import { despuesDeCrearOrdenes } from './edges/router.js';

const here = dirname(fileURLToPath(import.meta.url));

export async function construirGrafo() {
  // Un archivo SQLite junto al proyecto: los checkpoints sobreviven
  // al proceso. Si se reinicia el harness, un POST /resume sigue
  // funcionando con el mismo thread_id.
  const checkpointer = SqliteSaver.fromConnString(join(here, '../../checkpoints.sqlite'));

  const grafo = new StateGraph(EstadoGrafo)
    .addNode('leer-inventario', leerInventario)
    .addNode('analizar-demanda', analizarDemanda)
    .addNode('calcular-cantidad', calcularCantidad)
    .addNode('generar-analisis', generarAnalisis)
    .addNode('decidir-aprobacion', decidirAprobacion)
    .addNode('crear-orden', crearOrdenes)
    .addNode('notificar', notificar)
    .addNode('fin', fin)
    .addEdge(START, 'leer-inventario')
    .addEdge('leer-inventario', 'analizar-demanda')
    .addEdge('analizar-demanda', 'calcular-cantidad')
    .addEdge('calcular-cantidad', 'decidir-aprobacion')
    .addEdge('decidir-aprobacion', 'generar-analisis')
    .addEdge('generar-analisis', 'crear-orden')
    .addConditionalEdges('crear-orden', despuesDeCrearOrdenes, ['notificar', 'fin'])
    .addEdge('notificar', 'fin')
    .addEdge('fin', END)
    .compile({ checkpointer });

  return grafo;
}
