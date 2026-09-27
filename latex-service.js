/**
 * LATEX-SERVICE.JS — Conector cv-builder-public → cv-builder-api
 * Envía el .tex generado a Render y recibe el PDF compilado.
 *
 * Uso desde results.js:
 *   const blob = await compilarLatex(texString, "creativo")
 *   descargarBlob(blob, "cv-visual.pdf")
 */

const CV_API_URL = "https://cv-builder-api.onrender.com";  // ← actualizar con URL real de Render

// ── API key (obligatoria) ────────────────────────────────────────────────────
// La API rechaza con 401 cualquier /compile sin X-API-Key. Pega aqui la MISMA
// clave que configuraste en Render -> Environment -> API_KEY.
//
// AVISO DE SEGURIDAD, sin rodeos: este archivo se sirve publicamente, asi que
// la clave queda visible para cualquiera que abra las devtools. NO es un
// control de acceso, solo una capa extra para frenar el uso automatizado
// anonimo. La barrera real de este servicio es el limite de compilaciones y el
// rate limit del servidor, no este token.
//
// Generar una:  python -c "import secrets; print(secrets.token_urlsafe(32))"
const CV_API_KEY = "";   // ← PEGAR AQUI la clave de Render


/**
 * Ping silencioso al cargar la pantalla de resultados.
 * Despierta Render antes de que el usuario haga clic.
 * No bloquea, no muestra error si falla.
 */
function pingApi() {
    fetch(`${CV_API_URL}/health`, { method: "GET" })
        .catch(() => { /* Render dormido — normal, se despertará al compilar */ });
}

/**
 * Compila un string LaTeX en Render y devuelve un Blob PDF.
 * @param {string} texString  — contenido completo del .tex
 * @param {string} template   — "moderno" | "creativo" | "clasico" (solo para logs)
 * @returns {Promise<Blob>}
 * @throws {Error} si la compilación falla o hay timeout
 */
async function compilarLatex(texString, template = "desconocido") {
    // Fallar aqui y con un mensaje claro es mejor que un 401 opaco del servidor.
    if (!CV_API_KEY) {
        throw new Error(
            "Falta CV_API_KEY en latex-service.js. Pega la clave de Render " +
            "(Environment -> API_KEY) en la constante CV_API_KEY."
        );
    }

    const res = await fetch(`${CV_API_URL}/compile`, {
        method:  "POST",
        headers: {
            "Content-Type": "application/json",
            "X-API-Key":    CV_API_KEY
        },
        body:    JSON.stringify({ tex: texString, template }),
        signal:  AbortSignal.timeout(90_000)   // 90s máximo (cold start + compilación)
    });

    if (!res.ok) {
        let msg = `Error ${res.status}`;
        try {
            const err = await res.json();
            msg = err.error || msg;
        } catch (_) { /* respuesta no JSON */ }
        if (res.status === 401) {
            msg = "API key incorrecta: revisa CV_API_KEY en latex-service.js";
        }
        throw new Error(msg);
    }

    return await res.blob();   // PDF listo para descargar
}

/**
 * Descarga un Blob como archivo.
 * @param {Blob}   blob
 * @param {string} nombre  — nombre del archivo, ej. "cv-visual.pdf"
 */
function descargarBlob(blob, nombre) {
    const url = URL.createObjectURL(blob);
    const a   = document.createElement("a");
    a.href     = url;
    a.download = nombre;
    a.click();
    URL.revokeObjectURL(url);
}
