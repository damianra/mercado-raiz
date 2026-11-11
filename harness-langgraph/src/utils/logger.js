/**
 * Funciones de log a stdout con timestamp. Las llaman todos los
 * módulos (nodos, clients, harness): todo lo que el agente informa
 * sale por acá a la consola donde corre `npm run agente`.
 */

const ts = () => new Date().toISOString().slice(11, 19);

export const log = (...args) => console.log(`[${ts()}]`, ...args);

/** Título de sección — para separar fases en la consola. */
export const seccion = (titulo) => {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  ${titulo}`);
  console.log(`${'─'.repeat(60)}`);
};
