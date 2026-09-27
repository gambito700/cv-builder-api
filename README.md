# cv-builder-api

El servidor que compila el LaTeX del
[CV Builder](https://github.com/gambito700/cv-builder-public). El frontend
genera el `.tex` en el navegador y se lo manda acá; esta API lo compila con
`pdflatex` y devuelve el PDF. Es la mitad del backend de ese mismo proyecto
fullstack.

Vive en <https://cv-builder-api-lw51.onrender.com>.

## Por qué vive aparte

GitHub Pages solo sirve archivos estáticos, no corre contenedores. Además el
frontend cambia seguido y este servicio casi nunca, y si esta API se cae el
frontend sigue funcionando: el PDF que dibuja el navegador con jsPDF no depende
de ella.

## Los dos endpoints

**`GET /health`** devuelve 200 si está libre y 503 si hay una compilación en
curso. No pide token a propósito: lo usan el ping del frontend y el health check
de Render.

**`POST /compile`** lleva la cabecera `X-API-Key` y un JSON con el `.tex`. El
campo `template` es opcional y solo se usa en los logs.

```json
{ "tex": "\\documentclass{article}...", "template": "clasico" }
```

| Código | Responde | Cuándo |
|---|---|---|
| 200 | el PDF crudo | Compiló |
| 400 | `{error, id}` | Falta `tex` o no parece un documento LaTeX |
| 401 | `{error, id}` | `X-API-Key` incorrecta |
| 413 | `{error}` | El cuerpo pasa el tope |
| 422 | `{error, id, latex_error?}` | Compiló mal. `latex_error` aparece solo si el log trae alguna línea `! ...` |
| 429 | `{error}` | Rate limit |
| 503 | `{error}` | Sin `API_KEY` configurada, o servidor ocupado |

`latex_error` es el motivo real, y es lo que el frontend le muestra a la persona
para que sepa qué arreglar en vez de un "algo salió mal".

El log completo de LaTeX nunca sale del servidor: filtra rutas absolutas,
versiones de paquetes y el eco del input. El cliente recibe un `id` de correlación
y el log se queda en el log del servidor.

## Configuración

| Variable | Por defecto | Para qué sirve |
|---|---|---|
| `API_KEY` | (sin defecto) | Se compara con `X-API-Key`. Sin ella el servicio arranca, pero rechaza todo. |
| `ALLOWED_ORIGIN` | `https://gambito700.github.io` | Origen permitido por CORS |
| `PORT` | `5000` | Puerto de escucha |
| `MAX_TEX_BYTES` | `204800` | Tope del `.tex` recibido |
| `RATE_CAPACITY` | `10` | Tokens del cubo de rate limit |
| `RATE_REFILL_PER_SEC` | `0.2` | Recarga del cubo (0.2/s = 12 por minuto) |
| `RATE_MAX_ENTRIES` | `4096` | Cubos simultáneos en memoria |
| `LATEX_PASSES` | `2` | Cuántas veces corre `pdflatex` por petición |
| `LOG_LEVEL` | `INFO` | Nivel de los logs |

```bash
python -c "import secrets; print(secrets.token_urlsafe(32))"
```

Eso genera la clave. Ojo con CORS: vale lo que diga `ALLOWED_ORIGIN`, pero CORS
no es control de acceso, cualquiera puede llamar a la API con `curl` sin
respetarlo.

## Desplegar en Render

1. **New > Blueprint** apuntando a este repo. Render lee el `render.yaml`.
2. Render pide el valor de `API_KEY` (`sync: false`): pega la clave.
3. Deploy. La primera build tarda bastante, porque instala TeX Live.
4. Copia la URL que dio Render a `CV_API_URL` en `js/latex-service.js` del
   frontend, y pon `CV_URL_PENDIENTE` en `false`. La misma clave va en
   `CV_API_KEY`.

## Seguridad

Esta es la parte que más importa acá: es un servicio público que ejecuta el
LaTeX que mande cualquiera. No es un riesgo teórico, es la vulnerabilidad más
conocida de los compiladores de LaTeX en línea.

- `texmf.cnf` con `openin_any = p` y `openout_any = p`. Sin esto, un
  `\input{/etc/passwd}` lee ficheros del contenedor.
- `-no-shell-escape`: sin `\write18` no se lanzan procesos.
- `preexec_fn` con `resource`: topes de CPU, tamaño, memoria y `RLIMIT_NPROC = 0`.
- `TEXMFHOME` y `TEXMFVAR` en directorios efímeros.
- Token bucket por IP, comprobado **antes** que la clave, para frenar también el
  fuerza bruta sobre el token.

Lo que esto **no** arregla: la clave viaja en el JS del frontend, que es
público, así que cualquiera que abra las herramientas de desarrollo la lee.
Frena el abuso casual, no al atacante con tiempo. El límite real es el rate
limit, y si algún día molesta, la respuesta es un captcha, no una clave más
larga.

## Archivos

| Archivo | Qué es |
|---|---|
| `app.py` | Flask: rutas, sandbox, rate limit y compilación |
| `texmf.cnf` | Modo paranoico de TeX: `openin_any` / `openout_any` |
| `Dockerfile` | Debian slim + TeX Live mínimo + gunicorn |
| `requirements.txt` | Flask y gunicorn pinneados |
| `render.yaml` | Blueprint de Render |
| `generator.js` | Copia de **referencia** del generador del frontend, para saber qué paquetes LaTeX hacen falta. No lo usa este servicio. |
