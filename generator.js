/**
 * GENERATOR.JS - Generador de 3 plantillas LaTeX para CV
 * Plantilla 1: Moderna y Limpia (colores, barra lateral)
 * Plantilla 2: Creativa (tcolorbox, tikz decorativo)
 * Plantilla 3: Profesional Clásica (serif, compatible con ATS)
 */

/**
 * Generar los 3 templates completos
 */
function generateAllTemplates(data) {
  return [
    { name: "Moderno Limpio", description: "Layout limpio con sidebar de colores", tex: generateModerno(data) },
    { name: "Creativo", description: "Diseño llamativo con cajas de color", tex: generateCreativo(data) },
    { name: "Profesional Clásico", description: "Formato tradicional, optimizado para ATS", tex: generateClassico(data) }
  ];
}

/* ============================================================
   UTILIDADES DE FORMATO
   ============================================================ */

/**
 * Escapar caracteres especiales de LaTeX
 */
function esc(str) {
  if (!str) return '';
  let result = '';
  for (const ch of str) {
    switch (ch) {
      case '\\': result += '\\textbackslash{}'; break;
      case '{': case '}': result += '\\' + ch; break;
      case '&': result += '\\&'; break;
      case '%': result += '\\%'; break;
      case '$': result += '\\$'; break;
      case '#': result += '\\#'; break;
      case '_': result += '\\_'; break;
      case '~': result += '\\textasciitilde{}'; break;
      case '^': result += '\\textasciicircum{}'; break;
      default: result += ch;
    }
  }
  return result;
}

/**
 * Formatear fecha YYYY-MM a texto legible
 */
function fmtDate(dateStr, isPresent) {
  if (isPresent) return 'Presente';
  if (!dateStr) return '';
  const [year, month] = dateStr.split('-');
  const months = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun',
                   'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
  const m = months[parseInt(month, 10) - 1] || '';
  return m ? `${m} ${year}` : year;
}

/**
 * Obtener resumen de experiencia por area.
 *
 * Estrategia de matcheo: `includes()` (substring, case-insensitive) sobre el
 * texto que une `${empresa} ${cargo} ${funciones}`. Por eso los tokens son
 * GENERICOS de cargo y de funcion: asi funcionan con cualquier CV, no solo con
 * uno en particular.
 *
 * Reglas de diseno de esta lista:
 * 1. Ni un nombre propio. Este archivo se sirve al navegador, asi que no puede
 *    llevar empleadores ni datos de nadie, real o ficticio. Solo cargo y funcion.
 * 2. Sin tokens de 2-3 letras. Matchean DENTRO de palabras mas largas y meten
 *    experiencia ajena al area: "IT" aparecia dentro de "monitoreo" y colaba
 *    seguridad en el area de informatica. Para informatica se usa
 *    "Informacion" (>= 11 caracteres, sin falsos positivos previsibles).
 * 3. Sin tokens redundantes. Como el matcheo es por substring, basta el token
 *    mas corto: "Cocina" ya cubre "Ayudante de Cocina", "Caja" cubre "Caja
 *    registradora", "Venta" cubre "Ventas" y "Postventa".
 *
 * Limitaciones conocidas (NO se arreglan aqui, exceden el alcance de esta lista):
 * - La comparacion no normaliza acentos, asi que "Atencion" no matchea
 *   "Atención". Viene de los datos que escribe la persona.
 * - "SEO" tiene 3 letras y matchea dentro de palabras largas: "Deseo de crecer"
 *   hace entrar un puesto de seguridad en el area de marketing. Se arregla
 *   matching por inicio de palabra (no por substring), no alargando el token.
 * - "Web" solapa informatica y marketing: un puesto de marketing con "analitica
 *   web" tambien entra a informatica. Aqui es solape de dominio legitimo.
 */
const KEYWORDS_EXPERIENCIA = {
  // cocina y gastronomia
  cocina: [
    'Almacen', 'Bodega', 'Casino', 'Cocina', 'Cocinero', 'Garzon', 'Gastronomia',
    'Limpieza', 'Mesa', 'Pasteleria', 'Reposteria', 'Servidor'
  ],
  // atencion al cliente
  atencion: [
    'Atencion', 'Call Center', 'Caja', 'Cajero', 'Cliente', 'Conserje',
    'Garzon', 'Recepcion', 'Retail', 'Venta'
  ],
  // seguridad y vigilancia
  seguridad: [
    'CCTV', 'Construccion', 'Control de accesos', 'Guardia', 'Incendio',
    'Operador', 'Prevencion de perdidas', 'Seguridad', 'Sereno', 'Vigilancia'
  ],
  // ventas y comercial
  ventas: [
    'Atencion al publico', 'Captacion', 'Cajero', 'Comercial', 'Garzon',
    'Retail', 'Venta'
  ],
  informatica: [
    'Desarrollo', 'Django', 'Full Stack', 'Informacion', 'Programacion',
    'Python', 'Soporte', 'Web'
  ],
  corretaje: ['Corretaje', 'Inmobiliaria', 'Propiedades'],
  marketing: ['Analitica', 'Digital', 'Growth', 'Marketing', 'SEO', 'WordPress'],
  integral: [] // todos
};

/**
 * Una experiencia cae en un area si su texto (empresa + cargo + funciones)
 * contiene alguno de los tokens del area.
 */
function experienciaCaeEnArea(exp, area) {
  const keywords = KEYWORDS_EXPERIENCIA[area] || [];
  if (!exp || keywords.length === 0) return false;
  const text = `${exp.empresa || ''} ${exp.cargo || ''} ${exp.funciones || ''}`.toLowerCase();
  return keywords.some(kw => text.includes(kw.toLowerCase()));
}

function getExperienceByArea(data, area) {
  const experience = Array.isArray(data.experience) ? data.experience : [];
  if (area === 'integral') return experience;

  return experience.filter(exp => experienciaCaeEnArea(exp, area));
}

/* ============================================================
   LINEA DE PERFIL: SE ARMA CON LOS DATOS DEL USUARIO
   ============================================================ */

/**
 * Sustantivo de CATEGORIA por area. Describe a que se dedica la persona, nunca
 * afirma credenciales: aqui no cabe ninguna credencial (horas, calificaciones,
 * diplomas, antiguedad), solo el tipo de trabajo.
 *
 * `informatica` NO esta en esta tabla a proposito: su bucket de tokens mezcla
 * desarrollo y soporte (ver `sustantivoInformatica`), asi que un unico
 * sustantivo obligaria a etiquetar mal a una de las dos specialties.
 */
const SUSTANTIVO_AREA = {
  cocina: 'cocina',
  atencion: 'atención al cliente',
  seguridad: 'seguridad',
  ventas: 'ventas',
  corretaje: 'corretaje',
  marketing: 'marketing'
};

/**
 * Sustantivo de CATEGORIA por grupo de skills. Son las 6 claves del modelo
 * (js/data.js). `idiomas` no es un area de competencia: va aparte, al final.
 */
const SUSTANTIVO_GRUPO_SKILLS = {
  frontend: 'desarrollo web',
  backend: 'desarrollo de software',
  devops: 'infraestructura y despliegue',
  seguridad: 'seguridad',
  marketing: 'marketing'
};

/**
 * Unico token de KEYWORDS_EXPERIENCIA.informatica que es soporte y no
 * desarrollo. El resto de ese bucket describe desarrollo.
 */
const TOKENS_SOPORTE = ['Soporte'];

/**
 * Texto de un valor, listo para comparar: null, undefined y no-cadena son ''.
 */
function perfilTexto(valor) {
  return typeof valor === 'string' ? valor.trim() : '';
}

/**
 * Skills no vacios de un grupo del modelo.
 */
function getSkillsDelGrupo(data, grupo) {
  const skills = data && data.skills ? data.skills[grupo] : null;
  if (!Array.isArray(skills)) return [];
  return skills.filter(s => perfilTexto(s) !== '');
}

/**
 * "1 experiencia" / "2 experiencias". El plural se decide con el numero, nunca
 * a mano, para no escribir "1 experiencias" ni "2 experiencia".
 */
function perfilConteo(cantidad, singular, plural) {
  return `${cantidad} ${cantidad === 1 ? singular : plural}`;
}

/**
 * Une palabras en español: "a", "a y b", "a, b y c".
 * "e" en vez de "y" solo ante palabra común que empieza por i- o hi- (RAE);
 * ante nombre propio va "y" ("Inglés", "Ingeniería" son nombres de programa).
 */
function perfilUnir(palabras) {
  if (palabras.length === 0) return '';
  if (palabras.length === 1) return palabras[0];
  const ultimo = palabras[palabras.length - 1];
  const esComun = /^[a-záéíóúñ]/.test(ultimo);
  const usaE = esComun && (/^hi[aeiouáéíóú]/.test(ultimo) || /^i[^aeiouáéíóú]/.test(ultimo));
  return `${palabras.slice(0, -1).join(', ')} ${usaE ? 'e' : 'y'} ${ultimo}`;
}

/**
 * Suma un area sin repetirla. Si ya esta una mas amplia ("desarrollo" dentro
 * de "desarrollo web") no la vuelve a decir; si la nueva es mas precisa, la
 * reemplaza. Asi "desarrollo" (por un puesto de programacion) y "desarrollo
 * web" (por las skills) no terminan repetidos en la misma linea.
 */
function perfilAgregarArea(lista, sustantivo) {
  for (let i = 0; i < lista.length; i++) {
    if (lista[i].indexOf(sustantivo) !== -1) return lista;
    if (sustantivo.indexOf(lista[i]) !== -1) {
      lista[i] = sustantivo;
      return lista;
    }
  }
  lista.push(sustantivo);
  return lista;
}

/**
 * El area informatica mezcla los tokens de desarrollo con el de soporte, asi
 * que se parte el bucket en dos para no afirmar "soporte técnico" a quien solo
 * programa, ni "desarrollo" a quien solo da soporte. Los tokens se leen de
 * KEYWORDS_EXPERIENCIA, no de una copia: no pueden desincronizarse.
 */
function sustantivoInformatica(experiencias) {
  const keywords = KEYWORDS_EXPERIENCIA.informatica || [];
  const texto = experiencias.map(e =>
    `${perfilTexto(e && e.empresa)} ${perfilTexto(e && e.cargo)} ${perfilTexto(e && e.funciones)}`
  ).join(' ').toLowerCase();
  if (texto.trim() === '') return null;

  const matchea = (tokens) => tokens.some(kw => texto.indexOf(kw.toLowerCase()) !== -1);
  const soporte = matchea(TOKENS_SOPORTE);
  const desarrollo = matchea(keywords.filter(kw => TOKENS_SOPORTE.indexOf(kw) === -1));

  if (soporte && desarrollo) return 'desarrollo y soporte técnico';
  if (soporte) return 'soporte técnico';
  if (desarrollo) return 'desarrollo';
  return null;
}

/**
 * Areas de competencia con evidencia escrita por la persona: un puesto que cae
 * en el area, o skills cargadas en un grupo que pertenece al area.
 */
function getAreasCompetencia(data) {
  const experience = Array.isArray(data.experience) ? data.experience : [];
  const areas = [];

  for (const area of Object.keys(SUSTANTIVO_AREA)) {
    const delArea = experience.filter(exp => experienciaCaeEnArea(exp, area));
    if (delArea.length > 0) perfilAgregarArea(areas, SUSTANTIVO_AREA[area]);
  }

  const informatica = sustantivoInformatica(
    experience.filter(exp => experienciaCaeEnArea(exp, 'informatica'))
  );
  if (informatica) perfilAgregarArea(areas, informatica);

  for (const grupo of Object.keys(SUSTANTIVO_GRUPO_SKILLS)) {
    if (getSkillsDelGrupo(data, grupo).length > 0) {
      perfilAgregarArea(areas, SUSTANTIVO_GRUPO_SKILLS[grupo]);
    }
  }

  return areas;
}

/**
 * Programas de formacion que la persona escribio. Se aplica el mismo filtro que
 * las plantillas (descarta "Incompleto") para no nombrar en el perfil algo que
 * el documento no muestra.
 */
function getProgramasFormacion(data) {
  const education = Array.isArray(data.education) ? data.education : [];
  return education
    .filter(ed => ed && ed.estado !== 'Incompleto')
    .map(ed => perfilTexto(ed.programa))
    .filter(programa => programa !== '');
}

/**
 * Trayectoria en cantidad: cuantas experiencias, cuantas certificaciones,
 * cuantos proyectos. Los numeros salen de contar los datos, no de constantes.
 */
function getTrayectoria(data) {
  const cuentaConCampo = (lista, campo) => {
    const arr = Array.isArray(lista) ? lista : [];
    return arr.filter(item => perfilTexto(item && item[campo]) !== '').length;
  };
  const experience = Array.isArray(data.experience) ? data.experience : [];
  const experiencias = experience.filter(e => e &&
    [e.empresa, e.cargo, e.funciones].some(campo => perfilTexto(campo) !== '')).length;

  const partes = [];
  if (experiencias > 0) {
    partes.push(perfilConteo(experiencias, 'experiencia laboral', 'experiencias laborales'));
  }
  const certificaciones = cuentaConCampo(data.certifications, 'nombre');
  if (certificaciones > 0) {
    partes.push(perfilConteo(certificaciones, 'certificación', 'certificaciones'));
  }
  const proyectos = cuentaConCampo(data.projects, 'nombre');
  if (proyectos > 0) {
    partes.push(perfilConteo(proyectos, 'proyecto', 'proyectos'));
  }
  return partes;
}

/**
 * Obtener la linea de perfil del CV, armada SOLO con lo que la persona escribio.
 *
 * No hay diccionario de frases por area. Cada palabra sale de los datos:
 * sustantivos de categoria (SUSTANTIVO_AREA, SUSTANTIVO_GRUPO_SKILLS), los
 * programas de formacion que escribio y conteos reales de sus listas. No puede
 * aparecer ninguna credencial (horas, calificaciones, diplomas, antiguedad) que
 * no este en los datos, porque no hay de donde sacarla.
 *
 * Sin nada escrito devuelve '' a proposito, sin placeholder ni texto de
 * relleno. Las 3 plantillas LaTeX omiten el bloque entero (titulo y cuerpo) en
 * ese caso, para no dejar un titulo huerfano ni un hueco.
 *
 * `area` sigue en la firma porque las 3 plantillas lo pasan, pero la linea ya
 * no depende de el: focusArea viene preseleccionado ("integral") en el modelo,
 * asi que usarlo seria afirmar algo que la persona no eligio.
 */
function getPerfil(data, area) {
  const d = data || {};
  const partes = [];

  // Hasta 4 areas se nombran: es lo que entra comodo en una linea. Con mas de
  // 4 se cuenta ("6 areas de competencia") en vez de soltar una lista larga; el
  // conteo sigue siendo exacto y las areas ya se ven en sus secciones.
  const areas = getAreasCompetencia(d);
  if (areas.length === 1) {
    partes.push(`Perfil en ${areas[0]}.`);
  } else if (areas.length > 1 && areas.length <= 4) {
    partes.push(`Perfil en ${perfilUnir(areas)}.`);
  } else if (areas.length > 4) {
    partes.push(`Perfil en ${perfilConteo(areas.length, 'área de competencia', 'áreas de competencia')}.`);
  }

  const programas = getProgramasFormacion(d);
  if (programas.length > 0 && programas.length <= 3) {
    partes.push(`Formación en ${perfilUnir(programas)}.`);
  } else if (programas.length > 3) {
    partes.push(`Formación en ${perfilConteo(programas.length, 'programa', 'programas')}.`);
  }

  const trayectoria = getTrayectoria(d);
  if (trayectoria.length > 0) partes.push(`${perfilUnir(trayectoria)}.`);

  if (partes.length === 0) {
    // Unico dato escrito: los idiomas del grupo de skills, que son los unicos
    // que las plantillas LaTeX imprimen (personal.idiomas no se dibuja).
    const idiomas = getSkillsDelGrupo(d, 'idiomas');
    if (idiomas.length > 0) {
      partes.push(idiomas.length <= 3
        ? `Idiomas: ${perfilUnir(idiomas)}.`
        : `Idiomas: ${perfilConteo(idiomas.length, 'idioma', 'idiomas')}.`);
    }
  }

  return partes.join(' ');
}

/**
 * Obtener habilidades relevantes segun area
 */
function getSkillsByArea(data, area) {
  const relevance = {
    cocina: { kitchen: true, service: true, tech: false, security: false, marketing: false },
    atencion: { kitchen: false, service: true, tech: false, security: false, marketing: false },
    seguridad: { kitchen: false, service: false, tech: false, security: true, marketing: false },
    ventas: { kitchen: false, service: true, tech: false, security: false, marketing: false },
    informatica: { kitchen: false, service: false, tech: true, security: false, marketing: true },
    corretaje: { kitchen: false, service: true, tech: false, security: false, marketing: false },
    marketing: { kitchen: false, service: false, tech: true, security: false, marketing: true },
    integral: { kitchen: true, service: true, tech: true, security: true, marketing: true }
  };

  const rel = relevance[area] || relevance.integral;
  const skills = [];

  if (rel.tech) {
    skills.push(...(data.skills.frontend || []));
    skills.push(...(data.skills.backend || []));
    skills.push(...(data.skills.devops || []));
  }
  if (rel.security) {
    skills.push(...(data.skills.seguridad || []));
  }
  if (rel.marketing) {
    skills.push(...(data.skills.marketing || []));
  }
  if (rel.kitchen) {
    skills.push('Mise en place', 'Manipulación de alimentos', 'Cocina caliente/fría', 'Control de inventarios');
  }
  if (rel.service) {
    skills.push('Atención al cliente', 'Manejo de caja', 'Servicio en mesa', 'Comunicación efectiva');
  }

  // Idiomas siempre
  skills.push(...(data.skills.idiomas || []));

  return [...new Set(skills)]; // deduplicar
}


/* ============================================================
   TEMPLATE 1: MODERNO LIMPIO
   ============================================================ */
function generateModerno(data) {
  const p = data.personal;
  const area = data.focusArea;
  const exp = getExperienceByArea(data, area);
  const skills = getSkillsByArea(data, area);
  const perfil = getPerfil(data, area);

  // Sin linea de perfil no se dibuja el bloque entero: ni titulo, ni cuerpo, ni
  // su vspace. Si se dejara el titulo solo, quedaria huerfano sobre un hueco.
  const perfilBlock = perfil ? `
  %% --- PERFIL ---
  {\\small\\bfseries\\color{sidebar} PERFIL PROFESIONAL}
  \\vspace{2pt}

  {\\footnotesize ${esc(perfil)}}
  \\vspace{6pt}
` : '';

  // Construir seccion de experiencia
  let expLines = '';
  exp.forEach(e => {
    const fecha = e.presente ? `${fmtDate(e.fechaInicio, false)}--Presente` :
                  `${fmtDate(e.fechaInicio, false)}--${fmtDate(e.fechaFin, false)}`;
    const funcs = e.funciones ? e.funciones.split('\n').filter(f => f.trim()).slice(0, 5).map(f => `\\item ${esc(f.trim())}`).join('\n    ') : '';
    expLines += `  ${esc(fecha)} & \\textbf{${esc(e.cargo)}} -- ${esc(e.empresa)}, ${esc(e.ubicacion)}${funcs ? `. \\begin{itemize}[leftmargin=1em, itemsep=0pt]\n    ${funcs}\n  \\end{itemize}` : '.'} \\\\\n`;
  });

  // Construir seccion de educacion
  let eduLines = '';
  data.education.forEach(ed => {
    if (ed.estado === 'Incompleto') return;
    const notaStr = ed.nota && ed.nota !== '-' && ed.nota !== 'En curso' && ed.nota !== 'Incompleto' ? ` -- Nota: ${esc(ed.nota)}` : '';
    const horasStr = ed.horas > 0 ? ` (${ed.horas}h)` : '';
    eduLines += `  \\item \\textbf{${esc(ed.programa)}} -- ${esc(ed.institucion)}${horasStr}${notaStr} (${ed.ano || 'N/A'})\n`;
  });

  // Skills agrupados
  const techSkills = skills.filter(s =>
    ['HTML5', 'CSS3', 'JavaScript ES6+', 'Bootstrap 5', 'jQuery', 'Responsive Design',
     'Python', 'Django', 'FastAPI', 'SQL', 'SQLite', 'ORM', 'REST APIs',
     'Docker', 'Git', 'GitHub', 'Linux', 'CI/CD basico', 'Selenium'].includes(s)
  );
  const otherSkills = skills.filter(s =>
    !techSkills.includes(s)
  );

  const techStr = techSkills.join(', ');
  const otherStr = otherSkills.join(', ');

  return `%% ============================================================
%% CV -- ${esc(p.nombre)} -- Plantilla Moderna y Limpia
%% Generado por CV Builder -- Edición dibujada a mano
%%
%% COMPILACIÓN: pdflatex cv.tex (ejecutar 2 veces)
%% REQUISITOS: pdflatex, paquetes: geometry, xcolor, tikz,
%%   tabularx, enumitem, lmodern, hyperref
%% ============================================================
\\documentclass[10pt]{article}

%% --- Paquetes ---
\\usepackage[a4paper,
  top=8mm, bottom=8mm, left=10mm, right=10mm,
  ignoreheadfoot, nomarginpar]{geometry}
\\usepackage[utf8]{inputenc}
\\usepackage[T1]{fontenc}
\\usepackage{lmodern}
\\usepackage{xcolor}
\\usepackage{tikz}
\\usepackage{tabularx}
\\usepackage{enumitem}
\\usepackage{hyperref}
\\usepackage{parskip}

\\hypersetup{
  colorlinks, linkcolor=black, urlcolor=black,
  pdfstartview=FitH
}

\\setlength\\parindent{0em}
\\linespread{0.9}

%% --- Colores ---
\\definecolor{sidebar}{HTML}{2d5da1}
\\definecolor{accent}{HTML}{ff4d4d}
\\definecolor{dark}{HTML}{2d2d2d}

%% --- Configuración de listas ---
\\setlist[itemize]{leftmargin=1.2em, itemsep=0pt, parsep=1pt}

\\begin{document}

%% --- ENCABEZADO ---
%% Franja lateral alineada EXACTAMENTE con la columna del sidebar.
%% Ancho = 0.35\textwidth + margen izq (10mm). Así el texto blanco del
%% sidebar queda SIEMPRE dentro de la franja azul. (Antes 52mm fijo dejaba
%% ~14mm de texto/skills en blanco sobre el fondo blanco = "sale de columna".)
\\newlength{\\sidebarwidth}
\\setlength{\\sidebarwidth}{\\dimexpr 0.35\\textwidth + 10mm\\relax}
\\begin{tikzpicture}[remember picture, overlay]
  \\fill[sidebar] (current page.north west) rectangle
    ([xshift=\\sidebarwidth]current page.south west);
\\end{tikzpicture}

\\begin{minipage}[t]{0.35\\textwidth}
  \\vspace{4mm}
  \\color{white}
  \\begin{center}
    {\\fontsize{14}{17}\\selectfont\\bfseries ${esc(p.nombre)}}
    \\vspace{6pt}

    {\\small ${esc(p.direccion)}, ${esc(p.ciudad)}, Chile}
    \\vspace{4pt}

    {\\footnotesize
      ${esc(p.telefono)}\\\\
      \\href{mailto:${esc(p.email)}}{${esc(p.email)}}\\\\
      ${p.github ? `\\href{${esc(p.github)}}{GitHub}` : ''}\\\\
      ${p.portafolio ? `\\href{${esc(p.portafolio)}}{Portafolio}` : ''}
    }
  \\end{center}

  \\vspace{10pt}

  %% --- HABILIDADES EN SIDEBAR ---
  \\color{white}
  {\\small\\bfseries HABILIDADES}
  \\vspace{4pt}

  {\\footnotesize
    ${techStr ? `\\textbf{Tec:} ${esc(techStr)}\\\\` : ''}
    ${otherStr ? `\\textbf{Otros:} ${esc(otherStr)}` : ''}
  }
\\end{minipage}%
\\hfill
\\begin{minipage}[t]{0.60\\textwidth}
  \\vspace{4mm}
${perfilBlock}
  %% --- EXPERIENCIA ---
  {\\small\\bfseries\\color{sidebar} EXPERIENCIA LABORAL}
  \\vspace{2pt}

  {\\footnotesize
  \\begin{tabularx}{\\textwidth}{@{} l X}
    ${expLines}
  \\end{tabularx}}
  \\vspace{6pt}

  %% --- EDUCACIÓN ---
  {\\small\\bfseries\\color{sidebar} FORMACIÓN Y CERTIFICACIONES}
  \\vspace{2pt}

  {\\footnotesize
  \\begin{itemize}
    ${eduLines}
  \\end{itemize}}

\\end{minipage}

\\vfill

%% --- PIE ---
\\begin{center}
  {\\tiny\\color{dark} CV generado con CV Builder -- ${new Date().getFullYear()}}
\\end{center}

\\end{document}`;
}


/* ============================================================
   TEMPLATE 2: CREATIVO
   Sin fontawesome5 ni decoration=snake — compila en Render free tier.
   Los \faIcon{} se reemplazan por texto en negrita dentro del título
   de cada caja; la banda de encabezado usa \fill plano sin decoraciones.
   ============================================================ */
function generateCreativo(data) {
  const p = data.personal;
  const area = data.focusArea;
  const exp = getExperienceByArea(data, area);
  const skills = getSkillsByArea(data, area);
  const perfil = getPerfil(data, area);

  // Sin linea de perfil no se abre la caja: una coloredbox vacia igual dibuja
  // marco, fondo y titulo, o sea un recuadro azul con "Perfil Profesional" y
  // nada adentro. Se omite el bloque entero, con su vspace.
  const perfilBlock = perfil ? `
%% --- PERFIL ---
\\begin{coloredbox}[title={Perfil Profesional}]
  ${esc(perfil)}
\\end{coloredbox}

\\vspace{6pt}
` : '';

  // Experiencia
  let expBlock = '';
  exp.forEach(e => {
    const fecha = e.presente ? `${fmtDate(e.fechaInicio, false)} -- Presente` :
                  `${fmtDate(e.fechaInicio, false)} -- ${fmtDate(e.fechaFin, false)}`;
    const funcs = e.funciones ? e.funciones.split('\n').filter(f => f.trim()).slice(0, 5) : [];
    const funcsStr = funcs.length > 0 ?
      `\\begin{itemize}[leftmargin=1em, itemsep=0pt]\n${funcs.map(f => `    \\item ${esc(f.trim())}`).join('\n')}\n  \\end{itemize}` : '';
    expBlock += `  \\textbf{${esc(e.cargo)}} \\hfill {\\small\\color{gray} ${esc(fecha)}}\\\\
  {\\small ${esc(e.empresa)}, ${esc(e.ubicacion)}}${funcsStr ? `\\\\
  ${funcsStr}` : ''}
  \\vspace{6pt}\n`;
  });

  // Educacion
  let eduBlock = '';
  data.education.forEach(ed => {
    if (ed.estado === 'Incompleto') return;
    const notaStr = ed.nota && ed.nota !== '-' && ed.nota !== 'En curso' ? ` -- ${esc(ed.nota)}` : '';
    const horasStr = ed.horas > 0 ? ` (${ed.horas}h)` : '';
    eduBlock += `  \\item \\textbf{${esc(ed.programa)}}\\\\
    {\\small ${esc(ed.institucion)}${horasStr}${notaStr} -- ${ed.ano || 'N/A'}}\n`;
  });

  // Skills por categoria
  const catSkills = {};
  const catNames = { frontend: 'Frontend', backend: 'Backend', devops: 'DevOps',
                     seguridad: 'Seguridad', marketing: 'Marketing', idiomas: 'Idiomas' };
  for (const [cat, items] of Object.entries(data.skills)) {
    if (items && items.length > 0) catSkills[cat] = items;
  }

  let skillsBlock = '';
  for (const [cat, items] of Object.entries(catSkills)) {
    skillsBlock += `  \\textbf{${catNames[cat] || cat}:} ${items.map(esc).join(', ')}\\\\\n`;
  }

  return `%% ============================================================
%% CV -- ${esc(p.nombre)} -- Plantilla Creativa
%% Generado por CV Builder -- Edición dibujada a mano
%%
%% COMPILACIÓN: pdflatex cv.tex (ejecutar 2 veces)
%% REQUISITOS: pdflatex, paquetes: geometry, xcolor, tcolorbox,
%%   tikz, enumitem, hyperref, lmodern
%% (sin fontawesome5 — compatible con Render free tier)
%% ============================================================
\\documentclass[10pt]{article}

%% --- Paquetes ---
\\usepackage[a4paper,
  top=10mm, bottom=10mm, left=12mm, right=12mm]{geometry}
\\usepackage[utf8]{inputenc}
\\usepackage[T1]{fontenc}
\\usepackage{lmodern}
\\usepackage{xcolor}
\\usepackage{tcolorbox}
\\tcbuselibrary{skins,breakable}
\\usepackage{tikz}
\\usepackage{enumitem}
\\usepackage{hyperref}
\\usepackage{parskip}

\\hypersetup{
  colorlinks, linkcolor=blue!60!black,
  urlcolor=blue!60!black, pdfstartview=FitH
}

\\setlength\\parindent{0em}
\\linespread{0.9}

%% --- Colores ---
\\definecolor{primary}{HTML}{2d5da1}
\\definecolor{accent}{HTML}{ff4d4d}
\\definecolor{dark}{HTML}{2d2d2d}

%% --- Caja decorativa ---
\\newtcolorbox{coloredbox}[1][]{
  colback=primary!5!white,
  colframe=primary,
  boxrule=1.5pt,
  arc=3mm,
  left=6pt, right=6pt, top=4pt, bottom=4pt,
  fonttitle=\\bfseries\\color{white},
  coltitle=white,
  colbacktitle=primary,
  attach boxed title to top left={xshift=4mm, yshift=-3mm},
  boxed title style={arc=2mm, boxrule=0pt},
  #1
}

\\begin{document}

%% --- ENCABEZADO: banda de color plana (sin decoration=snake) ---
\\begin{tikzpicture}[remember picture, overlay]
  \\fill[primary!12] (current page.north west) rectangle
    ([yshift=-34mm]current page.north east);
  \\fill[primary] ([yshift=-34mm]current page.north west) rectangle
    ([yshift=-36mm]current page.north east);
\\end{tikzpicture}

\\begin{center}
  {\\fontsize{24}{28}\\selectfont\\bfseries\\color{primary} ${esc(p.nombre)}}
  \\vspace{4pt}

  {\\small ${esc(p.direccion)}, ${esc(p.ciudad)}, Chile}
  \\vspace{2pt}

  {\\footnotesize
    ${esc(p.telefono)} \\quad | \\quad
    \\href{mailto:${esc(p.email)}}{${esc(p.email)}} \\quad | \\quad
    ${p.github ? `\\href{${esc(p.github)}}{GitHub}` : ''} \\quad | \\quad
    ${p.portafolio ? `\\href{${esc(p.portafolio)}}{Portafolio}` : ''}
  }
\\end{center}

\\vspace{8pt}
${perfilBlock}
%% --- HABILIDADES ---
\\begin{coloredbox}[title={Habilidades}]
  ${skillsBlock}
\\end{coloredbox}

\\vspace{6pt}

%% --- EXPERIENCIA ---
{\\large\\bfseries\\color{primary} Experiencia Laboral}
\\vspace{4pt}

${expBlock}

%% --- EDUCACIÓN ---
{\\large\\bfseries\\color{primary} Formación y Certificaciones}
\\vspace{4pt}

\\begin{itemize}[leftmargin=1.5em, itemsep=2pt]
  ${eduBlock}
\\end{itemize}

\\vfill

%% --- PIE: línea de color plana ---
\\begin{tikzpicture}[remember picture, overlay]
  \\fill[accent] ([yshift=12mm]current page.south west) rectangle
    ([yshift=14mm]current page.south east);
\\end{tikzpicture}

\\begin{center}
  {\\tiny\\color{gray} Generado con CV Builder -- ${new Date().getFullYear()}}
\\end{center}

\\end{document}`;
}


/* ============================================================
   TEMPLATE 3: PROFESIONAL CLASSICO
   ============================================================ */
function generateClassico(data) {
  const p = data.personal;
  const area = data.focusArea;
  const exp = getExperienceByArea(data, area);
  const skills = getSkillsByArea(data, area);
  const perfil = getPerfil(data, area);

  // Sin linea de perfil no se emite el \section: quedaria el titulo con su
  // \titlerule dibujados sobre un cuerpo vacio. Se omite el bloque entero.
  const perfilBlock = perfil ? `
%% --- PERFIL ---
\\section{Perfil Profesional}
${esc(perfil)}
` : '';

  // Experiencia en tabla
  let expRows = '';
  exp.forEach(e => {
    const fecha = e.presente ? `${fmtDate(e.fechaInicio, false)}--Pres.` :
                  `${fmtDate(e.fechaInicio, false)}--${fmtDate(e.fechaFin, false)}`;
    const funcs = e.funciones ? e.funciones.split('\n').filter(f => f.trim()).slice(0, 5).map(f => `\\item ${esc(f.trim())}`).join('\n    ') : '';
    expRows += `  ${esc(fecha)} & \\textbf{${esc(e.cargo)}} -- ${esc(e.empresa)}, ${esc(e.ubicacion)}${funcs ? `. \\begin{itemize}[leftmargin=1em, itemsep=0pt]\n    ${funcs}\n  \\end{itemize}` : '.'} \\\\\n`;
  });

  // Educacion
  let eduRows = '';
  data.education.forEach(ed => {
    if (ed.estado === 'Incompleto') return;
    const notaStr = ed.nota && ed.nota !== '-' && ed.nota !== 'En curso' ? ` -- Nota: ${esc(ed.nota)}` : '';
    const horasStr = ed.horas > 0 ? ` (${ed.horas}h)` : '';
    eduRows += `  \\item \\textbf{${esc(ed.programa)}} -- ${esc(ed.institucion)}${horasStr}${notaStr} (${ed.ano || 'N/A'})\n`;
  });

  // Skills formateados
  const skillGroups = {};
  const catNames = { frontend: 'Frontend', backend: 'Backend', devops: 'DevOps',
                     seguridad: 'Seguridad', marketing: 'Marketing', idiomas: 'Idiomas' };
  for (const [cat, items] of Object.entries(data.skills)) {
    if (items && items.length > 0) {
      skillGroups[cat] = items;
    }
  }

  let skillRows = '';
  for (const [cat, items] of Object.entries(skillGroups)) {
    skillRows += `  \\textbf{${catNames[cat] || cat}:} & ${items.map(esc).join(', ')} \\\\\n`;
  }

  return `%% ============================================================
%% CV -- ${esc(p.nombre)} -- Plantilla Profesional Clásica
%% Generado por CV Builder -- Edición dibujada a mano
%%
%% COMPILACIÓN: pdflatex cv.tex (ejecutar 2 veces)
%% REQUISITOS: pdflatex, paquetes: geometry, titlesec,
%%   enumitem, tabularx, hyperref, lmodern
%% ============================================================
\\documentclass[11pt]{article}

%% --- Paquetes ---
\\usepackage[a4paper,
  top=12mm, bottom=12mm, left=15mm, right=15mm]{geometry}
\\usepackage[utf8]{inputenc}
\\usepackage[T1]{fontenc}
\\usepackage{lmodern}
\\usepackage{titlesec}
\\usepackage{enumitem}
\\usepackage{tabularx}
\\usepackage{hyperref}
\\usepackage{parskip}

\\hypersetup{
  colorlinks, linkcolor=black, urlcolor=black,
  pdfstartview=FitH
}

\\setlength\\parindent{0em}
\\linespread{1.0}

%% --- Secciones con líneas ---
\\titleformat{\\section}{\\large\\bfseries\\uppercase}{}{0em}{}[\\titlerule]
\\titlespacing{\\section}{0pt}{12pt}{6pt}

\\begin{document}

%% --- ENCABEZADO ---
\\begin{center}
  {\\fontsize{22}{26}\\selectfont\\bfseries ${esc(p.nombre)}}
  \\vspace{4pt}

  {\\small ${esc(p.direccion)}, ${esc(p.ciudad)}, Chile}
  \\vspace{2pt}

  {\\footnotesize
    ${esc(p.telefono)} \\quad | \\quad
    \\href{mailto:${esc(p.email)}}{${esc(p.email)}} \\quad | \\quad
    ${p.github ? `\\href{${esc(p.github)}}{${esc(p.github)}}` : ''} \\quad | \\quad
    ${p.portafolio ? `\\href{${esc(p.portafolio)}}{${esc(p.portafolio)}}` : ''}
  }
\\end{center}

\\vspace{4pt}
${perfilBlock}
%% --- HABILIDADES ---
\\section{Habilidades}
\\begin{tabularx}{\\textwidth}{@{} r X}
${skillRows}\\end{tabularx}

%% --- EXPERIENCIA ---
\\section{Experiencia Laboral}
\\begin{tabularx}{\\textwidth}{@{} l X}
${expRows}\\end{tabularx}

%% --- EDUCACIÓN ---
\\section{Formación y Certificaciones}
\\begin{itemize}[leftmargin=1.5em, itemsep=2pt]
  ${eduRows}
\\end{itemize}

%% --- FORTALEZAS ---
\\section{Fortalezas}
\\textbf{Autodidacta} y orientado a resultados \\quad--\\quad
\\textbf{Aprendizaje rápido} \\quad--\\quad
\\textbf{Disponibilidad inmediata} y turnos rotativos \\quad--\\quad
\\textbf{Trabajo en equipo} y bajo presión \\quad--\\quad
\\textbf{Responsabilidad} y puntualidad

\\vfill

\\begin{center}
  {\\tiny CV generado con CV Builder -- ${new Date().getFullYear()}}
\\end{center}

\\end{document}`;
}
