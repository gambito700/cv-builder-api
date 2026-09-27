"""
cv-builder-api — Compilador LaTeX para CV Builder
Repo: cv-builder-api  |  Deploy: Render (Docker)
Comunica con: cv-builder-public (GitHub Pages)

AVISO DE SUPERFICIE DE ATAQUE
-----------------------------
Este servicio es PUBLICO y ejecuta `pdflatex` sobre texto que envia cualquiera.
El token de API NO es una frontera de seguridad (el frontend es publico, asi que
el token viaja en el JS del navegador) y CORS tampoco lo es (cualquiera puede
llamar a la API con curl sin respetar CORS). Las defensas reales, en orden de
importancia, son:

  1. `texmf.cnf` con `openin_any = p` / `openout_any = p` (ver TEXMFCNF): sin
     esto, un `.tex` puede leer `/etc/passwd` con `\\input` o escribir ficheros
     arbitrarios con `\\newwrite` + `\\openout`, incluida la imagen Docker.
  2. `-no-shell-escape`: sin `\\write18` no se lanzan procesos.
  3. `preexec_fn` + `resource`: topes de CPU, disco, memoria y `RLIMIT_NPROC=0`.
  4. Token bucket por IP: este SI es el limite real de abuso.
  5. Usuario no-root en el contenedor: si algo se escapa, no puede escribir en
     `/etc` ni en `/app`.

Residual known: la guia de TeX Live (cap. 1.4, "Security considerations") dice
que TeX es robusto pero que los programas aportados por terceros "no alcanzan
el mismo nivel" y recomienda chroot para aislamiento real. El sandbox de este
modulo es defense-in-depth, no un chroot.
"""
from __future__ import annotations

import hmac
import io
import logging
import os
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
import time
import uuid
from collections import OrderedDict

from flask import Flask, jsonify, request, send_file
from werkzeug.exceptions import HTTPException, RequestEntityTooLarge

try:  # `resource` solo existe en Unix. En otro SO el sandbox corre sin rlimits.
    import resource
except ImportError:  # pragma: no cover - solo development en Windows
    resource = None


# ── Configuracion (todo por variable de entorno; ningun secreto en el codigo) ──
def _env_int(name: str, default: int) -> int:
    try:
        return int(os.environ[name])
    except (KeyError, ValueError):
        return default


def _env_bool(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


#: Origen del frontend. OJO: CORS NO es control de acceso. Solo evita que el
#: navegador de OTRO sitio haga fetch; curl/requests lo ignoran por completo.
ALLOWED_ORIGIN = os.environ.get("ALLOWED_ORIGIN", "https://gambito700.github.io")

#: Token compartido. SIN VALOR POR DEFECTO a proposito: si falta, el servicio
#: arranca en modo degradado y RECHAZA /compile. Un default tipo "changeme"
#: seria bruteforceable; "falta la variable" es un fallo de config, no una
#: puerta abierta.
API_KEY = os.environ.get("API_KEY", "").strip()
AUTH_OK = bool(API_KEY)

#: Tope del campo `tex`. El cuerpo JSON entero tiene su propio tope mas abajo.
MAX_TEX_BYTES = _env_int("MAX_TEX_BYTES", 200 * 1024)
MAX_CONTENT_LENGTH = _env_int("MAX_CONTENT_LENGTH", 1024 * 1024)

#: Compilacion. 2 pasadas por las referencias internas de LaTeX.
LATEX_PASSES = _env_int("LATEX_PASSES", 2)
COMPILE_TIMEOUT_SECONDS = _env_int("COMPILE_TIMEOUT_SECONDS", 30)
MAX_PDF_BYTES = _env_int("MAX_PDF_BYTES", 20 * 1024 * 1024)
CPU_SECONDS = _env_int("CPU_SECONDS", 25)
MAX_ADDRESS_SPACE_MB = _env_int("MAX_ADDRESS_SPACE_MB", 384)

#: Concurrencia. Con 1 worker las compilaciones ya se serializan; el semaforo
#: protege de verdad si alguien sube `--threads` o `--workers`.
MAX_CONCURRENT_COMPILES = _env_int("MAX_CONCURRENT_COMPILES", 1)
SLOT_WAIT_SECONDS = _env_int("SLOT_WAIT_SECONDS", 5)

#: Token bucket por IP. Es el limite de abuso REAL (ver cabecera del modulo).
RATE_CAPACITY = _env_int("RATE_CAPACITY", 10)
RATE_REFILL_PER_SEC = _env_int("RATE_REFILL_PER_SEC", 0.2)
RATE_MAX_ENTRIES = _env_int("RATE_MAX_ENTRIES", 4096)

#: Autocomprobacion del sandbox al arrancar. Convierte el fallo mas comun
#: ("el servicio devuelve 422 siempre") en un warning visible en el arranque y
#: en un campo de /health, en vez de un 422 silencioso en produccion.
SANDBOX_SELFTEST = _env_bool("SANDBOX_SELFTEST", True)
LOG_LEVEL = os.environ.get("LOG_LEVEL", "INFO").upper()


# ── Logging ───────────────────────────────────────────────────────────────────
if not logging.getLogger().handlers:
    logging.basicConfig(
        level=LOG_LEVEL,
        format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
        stream=sys.stdout,
    )
log = logging.getLogger("cvbuilder")
log.setLevel(LOG_LEVEL)


# ── Utilidades de saneado ─────────────────────────────────────────────────────
_SAFE_TOKEN = re.compile(r"[^A-Za-z0-9._-]")
_ABS_PATH = re.compile(r"(?:/[^\s:'\"()]+)+|[A-Za-z]:\\[^\s]+")
_LATEX_ERROR = re.compile(r"^!.*$")
_XFF_IPV4 = re.compile(r"^(?:\d{1,3}\.){3}\d{1,3}$")

#: `template` viene del cliente: nunca se imprime ni se registra sin filtrar.
def _safe_token(value: object, default: str = "desconocido", limit: int = 32) -> str:
    if not isinstance(value, str):
        return default
    cleaned = _SAFE_TOKEN.sub("", value)[:limit]
    return cleaned or default


def _client_key() -> str:
    """Clave del token bucket.

    Detras del proxy de Render, `remote_addr` es la IP del proxy, asi que
    bucketear por ahi seria un limite GLOBAL (una IP podria agotar el cubo de
    todos). Se usa el elemento MAS A LA DERECHA de X-Forwarded-For: cada proxy
    anade la IP que ve, y el ultimo es el que anade Render, que ve al cliente
    real. El cliente NO puede falsificarlo (si lo enviara, Render lo anade
    detras). Si no hay XFF se cae a remote_addr.
    """
    forwarded = request.headers.get("X-Forwarded-For", "")
    if forwarded:
        rightmost = forwarded.split(",")[-1].strip()
        if _XFF_IPV4.match(rightmost):
            return rightmost
    return request.remote_addr or "desconocido"


# ── Token bucket en memoria ───────────────────────────────────────────────────
class TokenBucketLimiter:
    """Token bucket por clave (IP). Estado en memoria del proceso.

    Con `--workers 1` es un limite global de facto; con mas workers habria que
    moverlo a Redis para que sea un limite real de servicio.
    """

    def __init__(self, capacity: int, refill_per_sec: float,
                 max_entries: int, idle_ttl: float = 900.0) -> None:
        self._capacity = max(1, capacity)
        self._refill = max(0.0001, refill_per_sec)
        self._max_entries = max(16, max_entries)
        self._idle_ttl = idle_ttl
        self._buckets: "OrderedDict[str, list[float]]" = OrderedDict()
        self._lock = threading.Lock()

    def _prune(self, now: float) -> None:
        expired = [k for k, (_, ts) in self._buckets.items() if now - ts > self._idle_ttl]
        for key in expired:
            del self._buckets[key]
        while len(self._buckets) > self._max_entries:
            self._buckets.popitem(last=False)   # descarta la mas antigua

    def allow(self, key: str) -> bool:
        now = time.monotonic()
        with self._lock:
            if len(self._buckets) >= self._max_entries:
                self._prune(now)
            entry = self._buckets.get(key)
            if entry is None:
                tokens, ts = float(self._capacity), now
            else:
                tokens = min(self._capacity, entry[0] + (now - entry[1]) * self._refill)
                ts = now
            allowed = tokens >= 1.0
            if allowed:
                tokens -= 1.0
            self._buckets[key] = [tokens, ts]
            self._buckets.move_to_end(key)
            return allowed


_limiter = TokenBucketLimiter(RATE_CAPACITY, RATE_REFILL_PER_SEC, RATE_MAX_ENTRIES)


# ── Slots de compilacion ──────────────────────────────────────────────────────
_slots = threading.BoundedSemaphore(max(1, MAX_CONCURRENT_COMPILES))
_state_lock = threading.Lock()
_running = 0


# ── Sandbox de LaTeX ──────────────────────────────────────────────────────────
def _sandbox_env(workdir: str) -> dict[str, str]:
    """Entorno efimero para pdflatex.

    `TEXMFCNF` apunta al directorio con nuestro texmf.cnf. Kpathsea lee TODOS
    los texmf.cnf de la ruta y "las definiciones de ficheros anteriores
    pisan a las de ficheros posteriores" (TeX Live Guide, 7.1.2). Como nuestro
    directorio va primero y solo define `openin_any`/`openout_any`, esos dos
    valores pisan a los del sistema y TODO lo demas (TEXMFDIST, TEXFORMATS,
    TEXINPUTS...) sigue viniendo del texmf.cnf del sistema. Por eso el
    fichero puede tener solo dos lineas.

    `TEXMFHOME` y `TEXMFVAR` apuntan a subdirectorios vacios y efimeros: si no,
    el .tex escribiria en el HOME del proceso.
    """
    home = os.path.join(workdir, "texmf-home")
    var = os.path.join(workdir, "texmf-var")
    os.makedirs(home, exist_ok=True)
    os.makedirs(var, exist_ok=True)

    env = dict(os.environ)
    env["TEXMFCNF"] = os.environ.get("TEXMFCNF", "/app/texmf")
    env["TEXMFHOME"] = home
    env["TEXMFVAR"] = var
    env["TEXMFCACHE"] = var
    env["TEXMFCONFIG"] = var
    env["HOME"] = workdir
    env["TEXMFOUTPUT"] = workdir
    return env


def _preexec() -> None:  # pragma: no cover - se ejecuta en el hijo
    """Topes de recurso del proceso pdflatex. Corre en el hijo, tras fork().

    OJO con la seguridad de fork: preexec_fn ejecuta Python en un proceso
    recien bifurcado, asi que no es seguro si hay otros hilos en el padre. Por
    eso el cuerpo es solo llamadas a os.setrlimit (sin locks ni allocations) y
    por eso se compila de una en una. Con `--workers N` (fork desde el hilo
    principal) el riesgo desaparece del todo.
    """
    if resource is None:
        return
    resource.setrlimit(resource.RLIMIT_NPROC, (0, 0))       # sin \write18 ni hijos
    resource.setrlimit(resource.RLIMIT_CPU, (CPU_SECONDS, CPU_SECONDS))
    resource.setrlimit(resource.RLIMIT_FSIZE,
                        (MAX_PDF_BYTES, MAX_PDF_BYTES))     # .pdf, .log y .aux
    if MAX_ADDRESS_SPACE_MB > 0:
        limit = MAX_ADDRESS_SPACE_MB * 1024 * 1024
        resource.setrlimit(resource.RLIMIT_AS, (limit, limit))


def _kill(proc: subprocess.Popen) -> None:
    """Mata el proceso Y sus hijos. `run(timeout=...)` solo lanza excepcion:
    sin esto el pdflatex zombi sigue comiendo CPU del free tier."""
    try:
        if hasattr(os, "killpg") and hasattr(signal, "SIGKILL"):
            os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
        else:
            proc.kill()
    except (OSError, ProcessLookupError):
        proc.kill()
    try:
        proc.wait(timeout=5)      # recolecta el zombie
    except subprocess.TimeoutExpired:  # pragma: no cover
        pass


def _read_tail(path: str, limit: int = 2000) -> str:
    try:
        size = os.path.getsize(path)
        with open(path, "rb") as fh:
            if size > limit:
                fh.seek(size - limit)
            return fh.read().decode("utf-8", "replace")
    except OSError:
        return ""


def _summarize_log(text: str, limit: int = 240) -> str:
    """Resumen sin rutas absolutas ni eco del input del usuario.

    El log COMPLETO se queda en el log del servidor (`log.error`); esto es lo
    unico que se escribe en la linea de estado.
    """
    errors = [m.group(0).strip() for m in
              (_LATEX_ERROR.match(line) for line in text.splitlines()) if m]
    joined = " | ".join(errors[:3]) or "sin linea de error"
    return _ABS_PATH.sub("<ruta>", joined)[:limit]


class CompileTimeout(Exception):
    """pdflatex supero el presupuesto de tiempo de la peticion."""


def compile_tex(tex_code: str, correlation_id: str) -> tuple[bytes | None, str]:
    """Compila un .tex. Devuelve (pdf_bytes, "") o (None, motivo_legible).

    Todo lo que se devuelve aqui va al log del servidor, nunca al cliente.
    """
    workdir = tempfile.mkdtemp(prefix="cvb-")
    try:
        tex_path = os.path.join(workdir, "cv.tex")
        out_log = os.path.join(workdir, "cv.stdout")
        with open(tex_path, "w", encoding="utf-8", newline="") as fh:
            fh.write(tex_code)

        env = _sandbox_env(workdir)
        # cwd == directorio de salida. Imprescindible: en modo paranoido
        # (`openout_any = p`) pdflatex solo puede escribir bajo el directorio
        # ACTUAL, asi que compilar con `-output-directory otro/` rechaza el PDF
        # y el servicio devuelve 422 siempre. Con cwd=tmp y "." los dos
        # directorios son el mismo por construccion.
        cmd = [
            "pdflatex",
            "-no-shell-escape",
            "-interaction=nonstopmode",
            "-halt-on-error",
            "-output-directory", ".",
            "cv.tex",
        ]

        deadline = time.monotonic() + COMPILE_TIMEOUT_SECONDS * LATEX_PASSES
        with open(out_log, "wb") as sink:
            for _ in range(LATEX_PASSES):
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise CompileTimeout()
                proc = subprocess.Popen(
                    cmd, cwd=workdir, env=env,
                    stdin=subprocess.DEVNULL, stdout=sink, stderr=subprocess.STDOUT,
                    start_new_session=(os.name == "posix"),
                )
                try:
                    proc.wait(timeout=remaining)
                except subprocess.TimeoutExpired:
                    _kill(proc)
                    raise CompileTimeout() from None

        pdf_path = os.path.join(workdir, "cv.pdf")
        if not os.path.exists(pdf_path):
            detail = _read_tail(out_log, 2000)
            log.error("id=%s sin PDF | %s", correlation_id,
                      _summarize_log(detail) or "log vacio")
            log.error("id=%s log LaTeX (solo servidor):\n%s", correlation_id, detail)
            return None, "La compilacion no produjo PDF"

        with open(pdf_path, "rb") as fh:
            pdf = fh.read()
        if not pdf.startswith(b"%PDF"):
            log.error("id=%s cv.pdf sin cabecera %%PDF (%dB)", correlation_id, len(pdf))
            return None, "La compilacion produjo un fichero invalido"
        if len(pdf) > MAX_PDF_BYTES:
            log.error("id=%s cv.pdf de %dB supera el tope", correlation_id, len(pdf))
            return None, "El PDF generado supera el tamano maximo"
        return pdf, ""
    except CompileTimeout:
        log.error("id=%s timeout tras %ds de CPU/pared", correlation_id,
                  COMPILE_TIMEOUT_SECONDS * LATEX_PASSES)
        return None, "timeout"
    except FileNotFoundError:
        log.error("pdflatex no encontrado en PATH")
        return None, "pdflatex no disponible"
    except OSError as exc:
        log.exception("id=%s error de E/S: %s", correlation_id, exc)
        return None, "error interno"
    finally:
        shutil.rmtree(workdir, ignore_errors=True)


# ── Autocomprobacion del sandbox ──────────────────────────────────────────────
_SANDBOX_PROBE = (
    "\\documentclass{article}\n"
    "\\begin{document}probe\n\\end{document}\n"
)

sandbox_report: dict[str, object] = {"ok": None, "detail": "no ejecutada"}


def _sandbox_selftest() -> None:
    """Compila un documento minimo con el MISMO camino de codigo.

    No falla el arranque (Render no debe entrar en crash-loop por esto): solo
    deja el resultado visible en /health y en el log.
    """
    started = time.monotonic()
    pdf, reason = compile_tex(_SANDBOX_PROBE, "selftest")
    ok = pdf is not None
    detail = "ok" if ok else reason
    sandbox_report.update(ok=ok, detail=detail)
    if ok:
        log.info("sandbox autocomprobado OK (%dB, %.1fs)", len(pdf or b""),
                 time.monotonic() - started)
    else:
        log.error("ATENCION: sandbox autocomprobacion FALLO (%s). Si /compile "
                  "devuelve 422 siempre, mira aqui: puede ser el limite de "
                  "memoria (MAX_ADDRESS_SPACE_MB=%d), el paquete de TeX o el "
                  "texmf.cnf mal montado.", detail, MAX_ADDRESS_SPACE_MB)


# ── App ───────────────────────────────────────────────────────────────────────
app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = MAX_CONTENT_LENGTH
app.config["PROPAGATE_EXCEPTIONS"] = False
# Quita la cabecera X-Powered-By: no anuncia la pila a un escaner.
app.config["DEBUG"] = False


@app.after_request
def apply_cors(response):
    # OJO: esto NO es control de acceso. CORS lo aplica el NAVEGADOR; curl,
    # requests o fetch desde una consola lo ignoran. El limite real es el
    # token bucket de arriba.
    response.headers["Access-Control-Allow-Origin"] = ALLOWED_ORIGIN
    response.headers["Access-Control-Allow-Methods"] = "POST, OPTIONS"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type, X-API-Key"
    response.headers["Access-Control-Max-Age"] = "86400"
    response.headers["Vary"] = "Origin"
    return response


# ── HEALTH (ping de despertar del frontend + health check de Render) ───────────
@app.route("/health", methods=["GET"])
def health():
    """Sin token a proposito: lo usa el ping del frontend y Render.

    Solo expone contadores operativos, ningun secreto. Si `busy` es true y el
    frontend va a compilar, que avise en vez de colgarse esperando.
    """
    with _state_lock:
        running = _running
    return jsonify({
        "status": "ok",
        "service": "cv-builder-api",
        "detail": f"compiling {running}/{MAX_CONCURRENT_COMPILES}" if running
                  else "idle",
        "busy": running >= MAX_CONCURRENT_COMPILES,
        "compiling": running,
        "compile_slots": MAX_CONCURRENT_COMPILES,
        "auth": "ok" if AUTH_OK else "degraded (API_KEY no configurada)",
        "sandbox": sandbox_report,
        "limits": {
            "max_tex_bytes": MAX_TEX_BYTES,
            "timeout_seconds": COMPILE_TIMEOUT_SECONDS,
            "cpu_seconds": CPU_SECONDS,
            "max_address_space_mb": MAX_ADDRESS_SPACE_MB,
            "max_pdf_bytes": MAX_PDF_BYTES,
            "rate_capacity": RATE_CAPACITY,
            "rate_refill_per_sec": RATE_REFILL_PER_SEC,
            "rlimits": resource is not None,
        },
    })


# ── COMPILE ───────────────────────────────────────────────────────────────────
@app.route("/compile", methods=["POST", "OPTIONS"])
def compile_endpoint():
    correlation_id = uuid.uuid4().hex[:12]
    started = time.monotonic()

    if request.method == "OPTIONS":
        return "", 204

    # 1) Rate limit PRIMERO: asi tambien frena los intentos de adivinar el token.
    if not _limiter.allow(_client_key()):
        log.warning("id=%s rate limit", correlation_id)
        return jsonify({"error": "Demasiadas peticiones",
                        "id": correlation_id}), 429

    # 2) Token. hmac.compare_digest para no filtrar el valor por temporizacion.
    #    Se comparan bytes: con str no-ASCII compare_digest lanza TypeError.
    if not AUTH_OK:
        log.error("id=%s API_KEY no configurada: /compile rechazada", correlation_id)
        return jsonify({"error": "Servicio no configurado (falta API_KEY)",
                        "id": correlation_id}), 503
    provided = request.headers.get("X-API-Key", "")
    if not hmac.compare_digest(provided.encode("utf-8", "replace"),
                               API_KEY.encode("utf-8")):
        log.warning("id=%s X-API-Key invalido", correlation_id)
        return jsonify({"error": "No autorizado", "id": correlation_id}), 401

    # 3) Tope de tamano del cuerpo. Flask lanza 413 por su cuenta.
    if request.content_length is not None and request.content_length > MAX_CONTENT_LENGTH:
        return jsonify({"error": "Cuerpo demasiado grande",
                        "id": correlation_id}), 413

    # 4) Validacion del cuerpo.
    data = request.get_json(silent=True)
    if not isinstance(data, dict) or "tex" not in data:
        return jsonify({"error": "Campo 'tex' requerido", "id": correlation_id}), 400
    tex_code = data.get("tex")
    if not isinstance(tex_code, str) or not tex_code.strip():
        return jsonify({"error": "Campo 'tex' vacio o no texto",
                        "id": correlation_id}), 400
    if len(tex_code.encode("utf-8")) > MAX_TEX_BYTES:
        log.warning("id=%s tex de %dB (tope %d)", correlation_id,
                    len(tex_code.encode("utf-8")), MAX_TEX_BYTES)
        return jsonify({"error": f"El .tex supera {MAX_TEX_BYTES} bytes",
                        "id": correlation_id}), 413
    # Un cuerpo de 200 KB de ruido quema CPU en pdflatex para nada.
    if "\\documentclass" not in tex_code and "\\begin{document}" not in tex_code:
        return jsonify({"error": "El .tex no parece un documento LaTeX",
                        "id": correlation_id}), 400

    template = _safe_token(data.get("template"))
    if tex_code.startswith("\ufeff"):        # BOM: inputenc utf8 lo rechaza
        tex_code = tex_code.lstrip("\ufeff")

    # 5) Slot de compilacion. Todo el trabajo pesado va dentro del semaforo.
    global _running
    if not _slots.acquire(timeout=SLOT_WAIT_SECONDS):
        log.warning("id=%s sin slots libres", correlation_id)
        return jsonify({"error": "Servidor ocupado, reintenta en unos segundos",
                        "id": correlation_id}), 503
    with _state_lock:
        _running += 1
    try:
        pdf, reason = compile_tex(tex_code, correlation_id)
    finally:
        with _state_lock:
            _running -= 1
        _slots.release()

    if pdf is None:
        status = 504 if reason == "timeout" else 422
        # El log de LaTeX NO va al cliente: filtraria rutas absolutas, versiones
        # de paquetes y el eco del input. Va al log del servidor con el id.
        log.warning("id=%s fallo (%s) template=%s en %.1fs", correlation_id,
                    reason, template, time.monotonic() - started)
        return jsonify({"error": "La compilacion fallo", "id": correlation_id}), status

    log.info("id=%s OK template=%s bytes=%d en %.1fs", correlation_id, template,
             len(pdf), time.monotonic() - started)
    # PDF crudo, sin envolver en JSON: el frontend hace res.blob().
    return send_file(
        io.BytesIO(pdf),
        mimetype="application/pdf",
        as_attachment=True,
        download_name="cv.pdf",
    )


# ── Manejo de errores: nada de trazas ni rutas hacia el cliente ────────────────
@app.errorhandler(RequestEntityTooLarge)
def _too_large(_exc: RequestEntityTooLarge):
    return jsonify({"error": "Cuerpo demasiado grande"}), 413


@app.errorhandler(HTTPException)
def _http_error(exc: HTTPException):
    return jsonify({"error": exc.description}), exc.code or 500


@app.errorhandler(Exception)
def _unhandled(exc: Exception):
    # El codigo anterior devolvia str(e) al cliente: eso filtra rutas del
    # servidor. Aqui solo un id, y el detalle se queda en el log.
    correlation_id = uuid.uuid4().hex[:12]
    log.exception("id=%s error no controlado: %s", correlation_id, type(exc).__name__)
    return jsonify({"error": "Error interno", "id": correlation_id}), 500


if SANDBOX_SELFTEST:
    _sandbox_selftest()


# ── ENTRY POINT (solo dev; en produccion manda gunicorn) ──────────────────────
if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 5000)),
            debug=False, use_reloader=False)
