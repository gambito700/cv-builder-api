# cv-builder-api

Compilador LaTeX en PDF para [CV Builder](https://github.com/gambito700/cv-builder-public).
No la ve el usuario: el frontend estatico genera el `.tex` en el navegador y se lo
manda a esta API, que lo compila y devuelve el PDF.

## Por que vive aparte

- Se despliega en Render con Docker; GitHub Pages no puede servir contenedores.
- El frontend cambia seguido, este servicio casi nunca. Separate permite desplegar
  cada uno cuando toca.
- Si esta API se cae, el frontend sigue funcionando: el PDF que genera el propio
  navegador con jsPDF es independiente de este servicio.

## Contrato

### GET /health

Despierta el free tier. No pide token a proposito: lo usan el ping del frontend y el
health check de Render. Devuelve 200 si esta libre, 503 si hay una compilacion en
curso.

### POST /compile

Cabecera `X-API-Key`, cuerpo `application/json`:

```json
{ "tex": "\\documentclass{article}...", "template": "clasico" }
```

`template` es opcional y solo se usa para los logs.

Respuestas:

| Codigo | Cuerpo | Cuando |
|---|---|---|
| 200 | PDF crudo, `Content-Type: application/pdf` | Compilo |
| 400 | `{error, id}` | Falta `tex`, o no parece un documento LaTeX |
| 401 | `{error, id}` | `X-API-Key` incorrecto |
| 413 | `{error}` | El cuerpo supera el tope |
| 422 | `{error, id}` | La compilacion fallo |
| 429 | `{error}` | Rate limit |
| 503 | `{error}` | Sin `API_KEY` configurada, o servidor ocupado |

El log de LaTeX NUNCA se devuelve al cliente: puede filtrar rutas absolutas,
versiones de paquetes y el eco del input. El cliente recibe un `id` de correlacion
y el log completo queda en el log del servidor.

CORS: `Access-Control-Allow-Origin` vale `ALLOWED_ORIGIN`, por defecto
`https://gambito700.github.io`. CORS no es control de acceso: cualquiera puede
llamar a la API con `curl` sin respetarlo.

## Variables de entorno

| Variable | Por defecto | Para que sirve |
|---|---|---|
| `API_KEY` | (sin defecto) | Valor que se compara con `X-API-Key`. Sin esta variable el servicio arranca, pero rechaza todo. |
| `ALLOWED_ORIGIN` | `https://gambito700.github.io` | Origen permitido por CORS |
| `PORT` | `5000` | Puerto de escucha |
| `MAX_TEX_BYTES` | `204800` | Tope del `.tex` recibido |
| `RATE_CAPACITY` | `10` | Tokens del cubo de rate limit |
| `RATE_REFILL_PER_SEC` | `0.2` | Recarga del cubo (0.2/s = 12 por minuto) |
| `RATE_MAX_ENTRIES` | `4096` | Cubos simultaneos en memoria |
| `TEXMFCNF` | `/app/texmf` | Directorio con el `texmf.cnf` del sandbox |

Generar la clave:

```bash
python -c "import secrets; print(secrets.token_urlsafe(32))"
```

## Desplegar en Render

1. New > Blueprint, apuntar a este repositorio. Render detecta `render.yaml`.
2. Render pide el valor de `API_KEY` (`sync: false`): pegar la clave generada.
3. Deploy. La primera build tarda bastante: instala TeX Live.
4. Copiar la URL que da Render y ponerla en `js/latex-service.js` del frontend
   (`CV_API_URL`, y `CV_URL_PENDIENTE` en `false`).
5. Poner la misma clave en `CV_API_KEY` del frontend.

## Seguridad

Este servicio es **publico y ejecuta LaTeX que manda cualquiera**. No es un riesgo
teorico, es la clase de vulnerabilidad mas conocida de los servicios de compilacion
LaTeX en linea. Las defensas:

- `texmf.cnf` con `openin_any = p` y `openout_any = p`: sin esto, un `\input{/etc/passwd}`
  lee ficheros del contenedor y un `\openout` escribe donde el proceso pueda.
- `-no-shell-escape`: sin `\write18` no se lanzan procesos.
- `preexec_fn` + `resource`: topes de CPU, tamano de fichero, memoria y
  `RLIMIT_NPROC = 0`.
- `TEXMFHOME`/`TEXMFVAR` en directorios efimeros.
- Token bucket por IP, comprobado **antes** que la clave, para frenar tambien el
  fuerza bruta sobre el token.
- Tope de tamano de entrada y de concurrencia.

Lo que **no** resuelve: la clave viaja en el JS del frontend, que es publico, asi
que cualquiera que abra las herramientas de desarrollo la lee. La clave frena el
abuso casual, no al atacante con tiempo. El limite real es el rate limit, y si el
servicio llega a molestar, la respuesta correcta es un captcha o Statsig/Fingerprint,
no alargar la clave.

## Ficheros

| Fichero | Que es |
|---|---|
| `app.py` | Flask. Rutas, sandbox, rate limit, compilacion |
| `texmf.cnf` | Modo paranoido de TeX: `openin_any`/`openout_any` |
| `Dockerfile` | Debian slim + TeX Live minimo + gunicorn |
| `requirements.txt` | Flask y gunicorn pinneados |
| `render.yaml` | Blueprint de Render |
| `generator.js` | Copia de REFERENCIA del generador del frontend, para saber que paquetes LaTeX hacen falta. No lo usa este servicio y no se edita aqui. |