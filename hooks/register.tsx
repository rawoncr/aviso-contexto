import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Compactacion, Lectura } from '../types'

const DEFECTO = 600_000
const PASO = 100_000

const lectura = atom({ plugin: 'aviso-contexto', key: 'lectura' } as const, null)
const isAvisado = atom({ plugin: 'aviso-contexto', key: 'isAvisado' } as const, false)
const pospuesto = atom(
  { plugin: 'aviso-contexto', key: 'pospuesto' } as const,
  null as number | null,
)
const compactacion = atom(
  { plugin: 'aviso-contexto', key: 'compactacion' } as const,
  null as Compactacion | null,
)

const miles = (n: number) => `${Math.round(n / 1000).toLocaleString('es-CO')}k`

/**
 * El primer escalón del aviso por encima de `tokens`: el umbral, el umbral más
 * un paso, más dos… Con 600k y pasos de 100k, ocultar a los 650k lo pospone a
 * los 700k, y a los 720k (si la barra se dejó estar), a los 800k: nunca a un
 * escalón que ya se ha pasado, que volvería a avisar en la siguiente medición.
 */
const siguiente = (tokens: number, umbral: number, paso: number) =>
  tokens < umbral ? umbral : umbral + paso * (Math.floor((tokens - umbral) / paso) + 1)

// Compactaciones de la conversación principal que el mod ha visto pasar, con
// su tamaño antes y después. Sirve para saber si el /compact del botón compactó
// de verdad: el comando puede acabar sin hacerlo («Not enough messages…»).
let vistas = 0
let ultima: { antes?: number; despues?: number } = {}

// El motor antepone «<plugin>: $.command.run: » a su mensaje.
const motivo = (err: unknown) => {
  const crudo = err instanceof Error ? err.message : String(err)
  const texto = crudo.replace(/^[\s\S]*?\$\.[a-z]+\.[a-z]+:\s*/i, '').trim()
  if (texto !== '') return texto.length > 220 ? `${texto.slice(0, 220)}…` : texto

  return err instanceof Error ? `${err.name} sin mensaje` : 'error sin mensaje'
}

/**
 * Compacta como si la persona escribiera /compact, y deja dicho en la barra
 * qué pasó. Nunca lanza.
 *
 * No usa $.session.compact: en la app de escritorio (una sesión SDK) el motor
 * lo rechaza siempre —«not available in a headless (-p / SDK) session yet:
 * compaction here runs inside a turn (a /compact prompt)»—. Lo comprobó Ramón
 * el 09/11/2026 pulsando el botón: el rechazo se perdía y la barra quedaba con
 * botones caducados que ya no respondían. `$.command.run` es el /compact
 * tecleado, que sí compacta, y si hay un turno en marcha espera en la cola.
 */
async function compactar($: EngineInterface, isWorking: boolean) {
  const actual = await read($, compactacion)
  if (actual?.fase === 'compactando' || actual?.fase === 'pendiente') return

  await update($, compactacion, (): Compactacion =>
    isWorking ? { fase: 'pendiente' } : { fase: 'compactando' },
  )
  $.ui.toast(
    isWorking
      ? 'Hay un turno en marcha: /compact queda en cola y se hace al terminar.'
      : 'Compactando la conversación… puede tardar un par de minutos.',
    { timeoutMs: 15_000 },
  )

  const antes = vistas
  try {
    const r = await $.command.run({ command: 'compact' })

    if (vistas > antes) {
      await update($, compactacion, () => null)
      await update($, lectura, () => null)
      await update($, isAvisado, () => false)
      const { antes: a, despues: d } = ultima
      $.ui.toast(
        a !== undefined && d !== undefined
          ? `Compactado: de ${miles(a)} a ${miles(d)} tokens.`
          : 'Conversación compactada.',
      )

      return
    }

    const salida = (r.text ?? '').trim()
    const texto = salida === '' ? '/compact terminó sin compactar' : salida.slice(0, 220)
    await update($, compactacion, (): Compactacion => ({ fase: 'error', texto }))
    $.ui.toast(`No se compactó: ${texto}`, { timeoutMs: 30_000 })
  } catch (err) {
    const texto = motivo(err)
    await update($, compactacion, (): Compactacion => ({ fase: 'error', texto }))
    $.ui.toast(`No se pudo compactar: ${texto}`, { timeoutMs: 30_000 })
  }
}

/**
 * «Ocultar»: quita la barra y pospone el aviso al siguiente escalón, en vez de
 * callarlo hasta que el contexto baje del umbral. Así lo pidió Ramón el
 * 09/11/2026: ocultado a los 600k, que vuelva a avisar a los 700k, y así.
 * Antes, ocultar callaba el aviso para el resto de la conversación si nunca se
 * compactaba, y no había forma de recuperarlo. Con solo un error de compactar
 * en la barra, lo quita.
 */
async function ocultar($: EngineInterface, umbral: number, paso: number) {
  const l = await read($, lectura)
  if (l !== null) {
    const nuevo = siguiente(l.tokens, umbral, paso)
    await update($, pospuesto, () => nuevo)
    await update($, lectura, () => null)
    await update($, isAvisado, () => false)
    $.ui.toast(`Aviso oculto: vuelve a los ${miles(nuevo)} tokens.`)
  }
  if ((await read($, compactacion))?.fase === 'error') {
    await update($, compactacion, () => null)
  }
}

export const register: Register = (on, options) => {
  const configurado = Number(options.warnAtTokens)
  const umbral = configurado > 0 ? configurado : DEFECTO
  const pasoConfigurado = Number(options.snoozeStepTokens)
  const paso = pasoConfigurado > 0 ? pasoConfigurado : PASO

  // Tras cada turno de la sesión principal el motor mide el contexto.
  // `tokens` es lo que releyó la última respuesta (sin caché + escrito + leído).
  on('session.measure', async ($, e, next) => {
    const { tokens, window } = e.context
    const tope = (await read($, pospuesto)) ?? umbral

    if (tokens !== undefined && tokens >= tope) {
      const actual: Lectura = { tokens, window }
      await update($, lectura, () => actual)

      if (!(await read($, isAvisado))) {
        await update($, isAvisado, () => true)
        $.ui.toast(
          `Contexto en ${miles(tokens)} tokens. Conviene /compact o una sesión nueva: cada llamada relee todo.`,
          { timeoutMs: 20_000 },
        )
      }
    } else {
      // Por debajo (o sin lectura, tras compactar): se rearma para el próximo cruce.
      if ((await read($, lectura)) !== null) await update($, lectura, () => null)
      if (await read($, isAvisado)) await update($, isAvisado, () => false)
      // Por debajo del umbral configurado lo pospuesto ya no cuenta: el próximo
      // cruce avisa en el umbral de siempre.
      if (tokens !== undefined && tokens < umbral && (await read($, pospuesto)) !== null) {
        await update($, pospuesto, () => null)
      }
    }

    return next(e)
  })

  // Si se compacta (a mano, automático o con el botón), la barra se quita
  // sin esperar a la próxima medición.
  on('session.compact', async ($, e, next) => {
    const r = await next(e)

    // Solo observa: un fallo aquí nunca debe impedir una compactación.
    try {
      if (r.messages !== undefined && e.agentId === undefined && e.trigger !== 'precompute') {
        vistas += 1
        ultima = { antes: r.tokensBefore, despues: r.tokensAfter }
        await update($, lectura, () => null)
        await update($, isAvisado, () => false)
        await update($, pospuesto, () => null)
        // Un /compact a mano también resuelve un error que dejó el botón.
        if ((await read($, compactacion))?.fase === 'error') {
          await update($, compactacion, () => null)
        }
      }
    } catch {
      // la próxima medición lo rearma
    }

    return r
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const l = await read($, lectura)
    const estado = await read($, compactacion)
    const isQuiet = e.props.hasSurvey || (l === null && estado === null)

    if (isQuiet) {
      return next(e)
    }

    const { Box, Button, Text } = $.ui.resolve(e)
    const pct = l !== null && l.window > 0 ? Math.round((l.tokens / l.window) * 100) : null
    const isOcupado = estado?.fase === 'compactando' || estado?.fase === 'pendiente'

    return (
      <Box>
        {l === null ? null : (
          <Text color="warning" bold>
            Contexto: {miles(l.tokens)} de {miles(l.window)} tokens
            {pct === null ? '' : ` (${pct} %)`}.{' '}
          </Text>
        )}
        {estado?.fase === 'compactando' ? (
          <Text dimColor>Compactando… </Text>
        ) : estado?.fase === 'pendiente' ? (
          <Text dimColor>/compact en cola: se hace al terminar el turno. </Text>
        ) : estado?.fase === 'error' ? (
          <Text color="error">No se pudo compactar: {estado.texto}. Prueba /compact. </Text>
        ) : (
          <Text dimColor>Cada llamada lo relee entero. </Text>
        )}
        {isOcupado ? null : (
          <Button
            key="compactar"
            label={
              estado?.fase === 'error'
                ? 'Reintentar'
                : e.props.isWorking
                  ? 'Compactar al terminar'
                  : 'Compactar ahora'
            }
            onPress={() => compactar($, e.props.isWorking)}
          />
        )}
        {l === null && estado?.fase !== 'error' ? null : (
          <Button
            key="ocultar"
            label={l === null ? 'Ocultar' : `Ocultar hasta ${miles(siguiente(l.tokens, umbral, paso))}`}
            onPress={() => ocultar($, umbral, paso)}
          />
        )}
      </Box>
    )
  })
}
