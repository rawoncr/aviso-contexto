import { expect, test } from 'claude-code/testing'

const BAND = {
  plugin: 'aviso-contexto',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 10 },
} as const

// Nada hay debajo del mod: estos hooks hacen de motor.
const motor = (on: any, toasts: string[] = []) => {
  on('session.measure', (_: unknown, e: { changed: unknown }) => ({ changed: e.changed }))
  on('ui.toast', (_: unknown, e: { text: string }) => {
    toasts.push(e.text)

    return { value: undefined }
  })
  on('ui.render', ($: any, e: any) => {
    const { Text } = $.ui.resolve(e)

    return <Text>motor</Text>
  })
}

const medida = (tokens: number | undefined) =>
  ({
    context: { tokens, window: 1_000_000 },
    rateLimits: [],
    changed: ['context'],
  }) as const

test('por debajo del umbral no hay barra', async ($, on) => {
  motor(on)

  await $.session.measure(medida(500_000))

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect(await ui.find({ type: 'Text', text: /Contexto/ })).toBeUndefined()
    await ui.unmount()
  }
})

test('al pasar de 600k sale la barra con tokens y porcentaje', async ($, on) => {
  motor(on)

  await $.session.measure(medida(642_000))

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    const texto = await ui.find({ type: 'Text', text: /Contexto/ })
    expect(texto?.text).toMatch(/642k de 1\.000k tokens \(64 %\)/)
    expect(await ui.find({ key: 'compactar' })).toBeDefined()
    await ui.unmount()
  }
})

test('al bajar del umbral la barra se quita', async ($, on) => {
  motor(on)

  await $.session.measure(medida(700_000))
  await $.session.measure(medida(120_000))

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /Contexto/ })).toBeUndefined()
  await ui.unmount()
})

// «Ocultar» pospone el aviso al siguiente escalón de 100k (Ramón, 09/11/2026).
// Antes lo callaba hasta bajar del umbral: sin compactar, no volvía nunca.

const hayBarra = async ($: any, surface: 'terminal' | 'desktop' = 'desktop') => {
  const ui = await $.ui.mount({ ...BAND, surface })
  const texto = await ui.find({ type: 'Text', text: /Contexto/ })
  await ui.unmount()

  return texto !== undefined
}

const ocultar = async ($: any, surface: 'terminal' | 'desktop' = 'desktop') => {
  const ui = await $.ui.mount({ ...BAND, surface })
  const label = (await ui.find({ key: 'ocultar' }))?.props.label
  await ui.press({ key: 'ocultar' })
  await ui.unmount()

  return label
}

test('Ocultar pospone el aviso 100k: oculto a los 650k, vuelve a los 700k', async ($, on) => {
  const toasts: string[] = []
  motor(on, toasts)

  for (const surface of ['terminal', 'desktop'] as const) {
    toasts.length = 0

    await $.session.measure(medida(650_000))
    expect(await ocultar($, surface)).toBe('Ocultar hasta 700k')
    expect(toasts.at(-1)).toBe('Aviso oculto: vuelve a los 700k tokens.')
    expect(await hayBarra($, surface)).toBe(false)

    // Entre 650k y 700k sigue oculto, sin toast nuevo.
    await $.session.measure(medida(690_000))
    expect(await hayBarra($, surface)).toBe(false)
    expect(toasts.length).toBe(2)

    // A los 700k vuelve, con su toast.
    await $.session.measure(medida(700_000))
    expect(await hayBarra($, surface)).toBe(true)
    expect(toasts.at(-1)).toMatch(/Contexto en 700k tokens/)

    // Y ocultar otra vez lo lleva a los 800k.
    expect(await ocultar($, surface)).toBe('Ocultar hasta 800k')
    await $.session.measure(medida(799_000))
    expect(await hayBarra($, surface)).toBe(false)
    await $.session.measure(medida(805_000))
    expect(await hayBarra($, surface)).toBe(true)

    // Limpia para la otra superficie.
    await $.session.measure(medida(100_000))
  }
})

test('Ocultar nunca pospone a un escalón ya pasado', async ($, on) => {
  const toasts: string[] = []
  motor(on, toasts)

  // La barra salió a los 610k y se dejó estar hasta los 720k.
  await $.session.measure(medida(610_000))
  await $.session.measure(medida(720_000))
  expect(await ocultar($)).toBe('Ocultar hasta 800k')

  await $.session.measure(medida(760_000))
  expect(await hayBarra($)).toBe(false)
  await $.session.measure(medida(800_000))
  expect(await hayBarra($)).toBe(true)
})

test('al bajar del umbral lo pospuesto se olvida: el próximo cruce avisa en 600k', async ($, on) => {
  motor(on)

  await $.session.measure(medida(650_000))
  await ocultar($)
  await $.session.measure(medida(200_000))
  await $.session.measure(medida(610_000))
  expect(await hayBarra($)).toBe(true)
})

test('compactar también olvida lo pospuesto', async ($, on) => {
  motor(on)
  compactaDeVerdad($, on)

  await $.session.measure(medida(650_000))
  await ocultar($)
  await $.command.run({
    command: 'compact',
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 80 },
  } as any)
  // Sin medición por debajo del umbral entre medias: aun así avisa en 600k.
  await $.session.measure(medida(620_000))
  expect(await hayBarra($)).toBe(true)
})

test('el paso se configura', { options: { snoozeStepTokens: 50_000 } }, async ($, on) => {
  motor(on)

  await $.session.measure(medida(620_000))
  expect(await ocultar($)).toBe('Ocultar hasta 650k')
  await $.session.measure(medida(649_000))
  expect(await hayBarra($)).toBe(false)
  await $.session.measure(medida(650_000))
  expect(await hayBarra($)).toBe(true)
})

test('con solo un error de compactar, Ocultar lo quita', async ($, on) => {
  motor(on)
  on('command.run', () => ({ text: 'Not enough messages to compact.' }))

  await $.session.measure(medida(650_000))
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.press({ key: 'compactar' })
  await ui.unmount()
  // El contexto baja por otro lado y queda solo el error en la barra.
  await $.session.measure(medida(300_000))
  const conError = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await conError.find({ type: 'Text', text: /Not enough messages/ })).toBeDefined()
  await conError.unmount()

  expect(await ocultar($)).toBe('Ocultar')
  const vacia = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await vacia.find({ type: 'Text', text: /Not enough messages/ })).toBeUndefined()
  await vacia.unmount()
})

test('el aviso con toast sale una vez por cruce', async ($, on) => {
  const toasts: string[] = []
  motor(on, toasts)

  await $.session.measure(medida(610_000))
  await $.session.measure(medida(630_000))
  expect(toasts.length).toBe(1)
  expect(toasts[0]).toMatch(/610k tokens/)

  await $.session.measure(medida(100_000))
  await $.session.measure(medida(605_000))
  expect(toasts.length).toBe(2)
})

// El botón «Compactar ahora». El 09/11/2026 no hacía nada en el escritorio:
// $.session.compact no existe en una sesión SDK, el rechazo se perdía y la
// barra seguía igual. Ahora el botón corre /compact como si se tecleara.

const MENSAJES = { ...BAND, surface: 'desktop' } as const
const RESUMEN = [{ role: 'user', text: 'resumen', toolUses: [] }] as const

// Lo que hace el motor con /compact: compactar la conversación, que pasa por
// el hook session.compact del mod, y escribir su línea en el transcript.
const compactaDeVerdad = (motorDelTest: any, on: any, llamadas: { n: number } = { n: 0 }) => {
  on('command.run', async (_: unknown, e: { command: string }) => {
    if (e.command !== 'compact') return { text: '' }
    llamadas.n += 1
    await motorDelTest.session.compact({ trigger: 'manual', messages: RESUMEN })

    return { text: 'Compacted' }
  })
  on('session.compact', () => ({ messages: RESUMEN, tokensBefore: 650_000, tokensAfter: 40_000 }))
}

test('compactar con éxito avisa y quita la barra', async ($, on) => {
  const toasts: string[] = []
  motor(on, toasts)
  compactaDeVerdad($, on)

  await $.session.measure(medida(650_000))
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    if (surface === 'terminal') {
      await ui.press({ key: 'compactar' })
      expect(toasts.some(t => /Compactando/.test(t))).toBe(true)
      expect(toasts.some(t => /de 650k a 40k tokens/.test(t)), toasts.join(' | ')).toBe(true)
    }
    expect(await ui.find({ type: 'Text', text: /Contexto/ })).toBeUndefined()
    await ui.unmount()
  }
})

test('si /compact acaba sin compactar, la barra dice por qué y deja reintentar', async ($, on) => {
  const toasts: string[] = []
  motor(on, toasts)
  on('command.run', () => ({ text: 'Not enough messages to compact.' }))

  await $.session.measure(medida(650_000))
  const ui = await $.ui.mount(MENSAJES)
  await ui.press({ key: 'compactar' })
  await ui.unmount()

  expect(toasts.some(t => /No se compactó: Not enough messages/.test(t)), toasts.join(' | ')).toBe(true)
  const otra = await $.ui.mount(MENSAJES)
  expect(await otra.find({ type: 'Text', text: /Not enough messages/ })).toBeDefined()
  expect((await otra.find({ key: 'compactar' }))?.props.label).toBe('Reintentar')
  await otra.unmount()
})

test('si el motor rechaza el comando, el error sale en la barra', async ($, on) => {
  const toasts: string[] = []
  motor(on, toasts)
  on('command.run', () => {
    throw new Error('el motor rechaza /compact')
  })

  await $.session.measure(medida(650_000))
  const ui = await $.ui.mount(MENSAJES)
  await ui.press({ key: 'compactar' })
  await ui.unmount()

  expect(toasts.some(t => /^No se (pudo compactar|compactó): \S/.test(t)), toasts.join(' | ')).toBe(true)
  const otra = await $.ui.mount(MENSAJES)
  expect((await otra.find({ key: 'compactar' }))?.props.label).toBe('Reintentar')
  await otra.unmount()
})

test('con un turno en marcha el botón lo dice y /compact va a la cola', async ($, on) => {
  const toasts: string[] = []
  motor(on, toasts)
  const llamadas = { n: 0 }
  compactaDeVerdad($, on, llamadas)

  await $.session.measure(medida(650_000))
  const ui = await $.ui.mount({ ...MENSAJES, props: { ...MENSAJES.props, isWorking: true } })
  expect((await ui.find({ key: 'compactar' }))?.props.label).toBe('Compactar al terminar')
  await ui.press({ key: 'compactar' })
  await ui.unmount()

  expect(llamadas.n).toBe(1)
  expect(toasts.some(t => /queda en cola/.test(t))).toBe(true)
  expect(toasts.some(t => /de 650k a 40k tokens/.test(t))).toBe(true)
})

test('un /compact tecleado también quita la barra', async ($, on) => {
  motor(on)
  compactaDeVerdad($, on)

  await $.session.measure(medida(650_000))
  await $.command.run({
    command: 'compact',
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 80 },
  } as any)

  const ui = await $.ui.mount(MENSAJES)
  expect(await ui.find({ type: 'Text', text: /Contexto/ })).toBeUndefined()
  await ui.unmount()
})
