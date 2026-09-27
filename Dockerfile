# cv-builder-api — Dockerfile
# Base: Debian bookworm-slim | TeX Live minimo | ~640 MB imagen (ver nota de tamano)
#
# TAMANO REAL (medido sobre el indice de Debian bookworm/main, campo
# Installed-Size summing the Depends closure):
#   TeX Live instalado ................. 506 MB  (114 paquetes)
#   debian:bookworm-slim (raiz) ........  77 MB  (26.9 MB comprimido)
#   python3 + pip3 .....................  34 MB
#   flask + gunicorn + deps (pip) ......  25 MB
#   --------------------------------------------------
#   TOTAL aproximado ................... ~640 MB
# El comentario anterior de "~452 MB disco" se quedaba corto en ~190 MB.
#
# NO incluye (a proposito, por tamano):
#   texlive-fonts-extra .... +1620 MB  (las 3 plantillas no lo necesitan)
#   texlive-science ......... +445 MB
#   texlive-luatex .......... +323 MB  (solo se usa pdflatex)
#   texlive-plain-generic ... +303 MB
#   texlive-xetex ........... +499 MB
#
# SI es imprescindible texlive-latex-extra: es el unico paquete que trae
# tcolorbox, que usa la plantilla "creativa". Las 3 plantillas de
# cv-builder-public (js/generator.js) necesitan ademas:
#   geometry, inputenc, fontenc, lmodern, xcolor, tikz, tabularx, enumitem,
#   hyperref, parskip, tcolorbox, titlesec
# => cubiertos por latex-base + latex-recommended + latex-extra + pictures +
#    fonts-recommended. NO quites ninguno: sin tcolorbox no compila la
#    plantilla creativa, y sin pictures no compila el tikz decorativo.

FROM debian:bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive

# ── Sistema base ──────────────────────────────────────────────────────────────
RUN apt-get update && apt-get install -y --no-install-recommends \
    # pdflatex (symlink a pdftex) y nucleo LaTeX
    texlive-latex-base \
    texlive-latex-recommended \
    # tcolorbox y titlesec (plantillas creativa y clasica) — ~77 MB, obligatorio
    texlive-latex-extra \
    # tikz/pgf: decoracion de las plantillas — ~75 MB
    texlive-pictures \
    # lmodern + psnfss (las plantillas piden lmodern)
    texlive-fonts-recommended \
    # babel espanol. OJO: hoy ninguna plantilla lo usa (generator.js no hace
    # \usepackage[spanish]{babel}); se mantiene por si se anade, son 15 MB.
    texlive-lang-spanish \
    # Python. gunicorn NO se instala por apt: se pinnea en requirements.txt
    # para que la version la controle pip y no el repositorio de Debian.
    python3 \
    python3-pip \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# ── Sandbox de LaTeX ──────────────────────────────────────────────────────────
# kpathsea busca texmf.cnf en TEXMFCNF y lo pone por delante del del sistema
# (TeX Live Guide 7.1.2).(openin_any = p / openout_any = p)
WORKDIR /app
COPY texmf.cnf ./texmf/texmf.cnf
ENV TEXMFCNF=/app/texmf

# ── App ───────────────────────────────────────────────────────────────────────
COPY requirements.txt .
RUN pip3 install --no-cache-dir --break-system-packages -r requirements.txt

COPY app.py .

# ── Autocomprobacion en tiempo de build ───────────────────────────────────────
# Falla el BUILD (no el deploy) si el sandbox o los paquetes estan rotos. Es la
# unica red de seguridad para el fallo "pdflatex responde 422 siempre":
# formato no generado, texmf.cnf mal montado, paquete que falta, usuario sin
# permiso de escritura. Ver tambien SANDBOX_SELFTEST en app.py.
#
# El bloque de ataques es lo importante: si `openin_any = p` NO esta activo, un
# atacante podria hacer \input{/proc/self/environ} y sacar la API_KEY y demas
# variables de entorno dentro de un PDF. Eso rompe el build.
RUN set -eu; \
    d="$(mktemp -d)"; \
    printf '%s\n' '\documentclass{article}' '\usepackage{tcolorbox}' \
        '\usepackage{tikz}' '\usepackage{enumitem}' '\usepackage{tabularx}' \
        '\usepackage{titlesec}' '\usepackage[spanish]{babel}' \
        '\begin{document}build-ok\end{document}' > "$d/cv.tex"; \
    cd "$d"; \
    run() { HOME="$d" TEXMFCNF=/app/texmf \
        pdflatex -no-shell-escape -interaction=nonstopmode -halt-on-error \
                 -output-directory . "$1" > out.log 2>&1; }; \
    run cv.tex \
        || { tail -n 40 out.log; echo "FALLO: pdflatex no compila en la imagen"; exit 1; }; \
    head -c 4 cv.pdf | grep -q '%PDF' \
        || { echo "FALLO: no se genero PDF"; exit 1; }; \
    echo "OK: sandbox y paquetes LaTeX verificados en build"; \
    # --- ataque 1: lectura fuera del directorio actual (rompe el build) ---
    printf '%s\n' '\documentclass{article}' '\begin{document}' \
        '\input{/etc/passwd}' '\end{document}' > leer.tex; \
    if run leer.tex; then \
        echo "FALLO DE SEGURIDAD: \\\\input{/etc/passwd} FUNCIONO. openin_any=no"; \
        exit 1; \
    else \
        echo "OK: \\\\input{/etc/passwd} bloqueado por openin_any=p"; \
    fi; \
    # --- ataque 2: lectura de /proc/self/environ (filtraria la API_KEY) ---
    printf '%s\n' '\documentclass{article}' '\begin{document}' \
        '\input{/proc/self/environ}' '\end{document}' > leer2.tex; \
    if run leer2.tex; then \
        echo "FALLO DE SEGURIDAD: \\\\input{/proc/self/environ} FUNCIONO (API_KEY filtrable)"; \
        exit 1; \
    else \
        echo "OK: \\\\input{/proc/self/environ} bloqueado"; \
    fi; \
    # --- ataque 3: escritura fuera del directorio actual (solo aviso) ---
    printf '%s\n' '\documentclass{article}' '\begin{document}' '\newwrite\o' \
        '\openout\o=/tmp/cvb-pwned.txt' '\immediate\write\o{x}' \
        '\closeout\o' 'x\end{document}' > escribir.tex; \
    rm -f /tmp/cvb-pwned.txt; \
    run escribir.tex || true; \
    if [ -e /tmp/cvb-pwned.txt ]; then \
        echo "AVISO: \\\\openout a /tmp FUNCIONO. openout_any=no esta aplicando."; \
        rm -f /tmp/cvb-pwned.txt; \
    else \
        echo "OK: \\\\openout a ruta absoluta bloqueado por openout_any=p"; \
    fi; \
    rm -rf "$d"; \
    echo "Autocomprobacion completada"

# ── Usuario no-root ───────────────────────────────────────────────────────────
# Si un .tex escapa del sandbox, root leeria/escribira cualquier ruta del
# contenedor. Sin root, el peor caso se queda en el directorio de trabajo.
RUN useradd --create-home --shell /usr/sbin/nologin --uid 10001 cvb \
    && chown -R cvb:cvb /app
USER cvb

ENV PORT=5000
# exec para que gunicorn sea PID 1 y reciba el SIGTERM de Render.
# ${PORT:-5000}: si Render define PORT, manda Render; si no, 5000.
# --threads 4 con 1 worker: /health sigue respondiendo aunque haya una
# compilacion en curso (con --workers 1 sync, un compile de 30s bloquearia el
# health check). MAX_CONCURRENT_COMPILES=1 limita la memoria: el free tier son
# 512 MB y no da para dos pdflatex en paralelo.
# --graceful-timeout 90 = lo que tarda como mucho un compile (60s), y es lo
# que permite el maxShutdownDelaySeconds del blueprint. Con 30 (el default)
# Render mataria el worker a mitad de una compilacion en cada deploy.
CMD ["sh", "-c", "exec gunicorn app:app \
     --bind 0.0.0.0:${PORT:-5000} \
     --worker-class gthread \
     --workers 1 \
     --threads 4 \
     --timeout 120 \
     --graceful-timeout 90 \
     --access-logfile - \
     --error-logfile -"]
