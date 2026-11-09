# aviso-contexto

Un mod para Claude Code que avisa cuando la conversación se ha hecho demasiado larga.

Cada mensaje que mandas obliga a Claude a releer la conversación entera. Pasados los
600.000 tokens eso sale caro y lento, y no se nota hasta que ya ha pasado. El mod lo
enseña en una barra encima de donde escribes:

> **Contexto: 642k de 1.000k tokens (64 %).** Cada llamada lo relee entero.
> `[ Compactar ahora ]` `[ Ocultar hasta 700k ]`

- **Compactar ahora** resume la conversación, igual que escribir `/compact`. Si Claude
  está respondiendo, el botón dice «Compactar al terminar» y lo hace en cuanto acaba. Si
  no se puede compactar, el motivo sale en la propia barra.
- **Ocultar hasta 700k** quita la barra y la deja callada hasta el siguiente escalón:
  con el umbral en 600k avisa otra vez a los 700k, luego a los 800k, y así.
- Al compactar, o si el contexto baja del umbral, todo vuelve a empezar: el próximo
  aviso es otra vez a los 600k.

La primera vez que se pasa cada escalón sale además un aviso flotante unos segundos.

## Instalar

Necesita una versión reciente de Claude Code: está probado con la 2.1.317 (la de la app
de escritorio en noviembre de 2026). La 2.1.215 no lo carga.

### Desde esta carpeta

Copia la carpeta `aviso-contexto` a tu ordenador y, en una terminal:

```bash
claude plugin marketplace add /ruta/a/aviso-contexto
```

```bash
claude plugin install aviso-contexto@aviso-contexto
```

Funciona en las sesiones que se abran después, también en la app de escritorio. No
muevas ni borres la carpeta después de instalarlo: Claude Code lo lee desde ahí.

### Desde GitHub

En la terminal de Claude Code:

```
/plugin install aviso-contexto --marketplace rawoncr/aviso-contexto
```

o desde una terminal normal:

```bash
claude plugin install aviso-contexto --marketplace rawoncr/aviso-contexto
```

En la app de escritorio, donde `/plugin` no funciona: pulsa **+** junto a la caja de
texto, luego **Plugins**,
**Add marketplace** con `rawoncr/aviso-contexto`, y después **Add plugin**.

## Ajustes

| Ajuste | Por defecto | Qué hace |
|---|---|---|
| Umbral de aviso (tokens) | 600.000 | A partir de cuántos tokens sale la barra. |
| Paso al ocultar (tokens) | 100.000 | Cuánto más tiene que crecer el contexto para que vuelva a avisar después de «Ocultar». |

Se cambian en `/config`, en la fila del mod, o al instalar:

```bash
claude plugin install aviso-contexto@aviso-contexto --config warnAtTokens=400000
```

## Para tocar el código

`hooks/register.tsx` es el mod entero y `hooks/register.test.tsx` sus pruebas. Desde
esta carpeta:

```bash
claude plugin validate .
```

```bash
claude plugin test .
```

Una cosa que no es obvia: en la app de escritorio el mod no puede compactar llamando a
`$.session.compact()`, que allí siempre falla. Por eso el botón ejecuta `/compact` como si
lo hubieras escrito tú.
