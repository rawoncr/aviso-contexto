export type Lectura = { tokens: number; window: number }

/**
 * Lo que pasa con el botón «Compactar ahora».
 * - `compactando`: el motor está resumiendo la conversación.
 * - `pendiente`: había un turno en marcha; /compact espera en cola a que acabe.
 * - `error`: no se pudo, con el porqué tal como lo dio el motor.
 */
export type Compactacion =
  | { fase: 'compactando' }
  | { fase: 'pendiente' }
  | { fase: 'error'; texto: string }

declare module 'claude-code' {
  interface PluginState {
    'aviso-contexto': {
      /** El contexto por encima del umbral, o null si está por debajo. */
      lectura: Lectura | null
      /** Ya se avisó con un toast en este cruce del umbral. */
      isAvisado: boolean
      /**
       * El umbral al que «Ocultar» pospuso el aviso (el configurado más un paso,
       * dos pasos…), o null mientras rige el configurado.
       */
      pospuesto: number | null
      /** El estado del botón de compactar, o null si no se ha pulsado. */
      compactacion: Compactacion | null
    }
  }
}
