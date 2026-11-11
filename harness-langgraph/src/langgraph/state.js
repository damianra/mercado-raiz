/**
 * Declara el objeto de estado que comparten todos los nodos del
 * grafo. Cada nodo recibe este estado como argumento y devuelve un
 * objeto parcial con los campos que quiere actualizar; LangGraph
 * fusiona cada campo según su `reducer` ("el último gana", merge de
 * objetos, o concatenar).
 *
 * El objeto completo es lo que se serializa a checkpoints.sqlite en
 * cada paso — y lo que se restaura cuando el grafo se reanuda tras
 * una pausa humana.
 *
 * ⚠️ Detalle de implementación: cada campo DEBE declararse con el
 * wrapper Annotation(...) — un objeto plano { reducer, default }
 * parece funcionar en el flujo normal pero el estado se pierde al
 * restaurar un checkpoint post-interrupt. Tampoco compartir el mismo
 * spec entre campos.
 */
import { Annotation } from '@langchain/langgraph';

const ultimoGana = () => Annotation({ reducer: (prev, next) => next ?? prev, default: () => null });
const listaVacia = () => Annotation({ reducer: (prev, next) => next ?? prev, default: () => [] });
const acumulativo = () =>
  Annotation({
    reducer: (prev, next) => [...prev, ...(next ?? [])],
    default: () => [],
  });
const mergeObjeto = () =>
  Annotation({
    reducer: (prev, next) => ({ ...prev, ...(next ?? {}) }),
    default: () => ({}),
  });

export const EstadoGrafo = Annotation.Root({
  /** Escribe: leer-inventario. Leen: analizar-demanda, calcular-cantidad, generar-analisis, crear-orden. */
  productosBajos: listaVacia(),

  /**
   * { [productoId]: { demanda_diaria, tendencia, observacion } }
   * Escribe: analizar-demanda (LLM). Leen: calcular-cantidad, generar-analisis.
   */
  analisisPorProducto: mergeObjeto(),

  /**
   * { [productoId]: { cantidad, monto_total, requiere_aprobacion, analisis_ia } }
   * Escriben: calcular-cantidad → generar-analisis → decidir-aprobacion
   * (cada uno agrega su parte). Lee: crear-orden.
   */
  decisionPorProducto: mergeObjeto(),

  /** Escribe: crear-orden (respuestas del POST /api/ordenes). Lee: fin. */
  ordenesCreadas: listaVacia(),

  /**
   * orden_id de las que esperan decisión humana.
   * Escribe: crear-orden.
   * Leen: edges/router, notificar.
   */
  ordenesPendientes: listaVacia(),


  /** Escriben: todos los nodos ante errores no fatales (concatena). Lee: fin. */
  errores: acumulativo(),
});
