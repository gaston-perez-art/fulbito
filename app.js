/* ====== configuración ====== */
const TOTAL_FECHAS = 12;
const PLANTEL = window.JUGADORES || [];
const FIJOS = PLANTEL.map(j => j.nombre);
const FOTOS = Object.fromEntries(PLANTEL.filter(j => j.foto).map(j => [j.nombre, j.foto]));

/* ====== estado ====== */
let fechas = [];
let cargando = true;
let desbloqueado = false;
let clave = "";                 // la que escribió el encargado; vive solo en memoria
let form = null;
let conectado = false;
let diag = "";                  // texto del último error real

/* ====== capa de datos: Supabase por REST, sin librerías ====== */
const CFG = window.CONFIG || {};
const configurado = Boolean(CFG.url && CFG.key);
const API = configurado ? CFG.url.replace(/\/+$/, "") + "/rest/v1/" : "";

function cabeceras(){
  return {apikey:CFG.key, Authorization:"Bearer " + CFG.key, "Content-Type":"application/json"};
}
async function rpc(nombre, args){
  const r = await fetch(API + "rpc/" + nombre, {
    method:"POST", headers:cabeceras(), body:JSON.stringify(args)});
  const cuerpo = await r.text();
  if(!r.ok){
    let m = cuerpo;
    try{ const j = JSON.parse(cuerpo); m = j.message || j.hint || cuerpo; }catch(e){}
    throw new Error(m);
  }
  return cuerpo ? JSON.parse(cuerpo) : null;
}
function desdeFila(f){
  return {n:f.n, dia:f.dia, equipoA:f.equipo_a, equipoB:f.equipo_b,
          golesA:f.goles_a, golesB:f.goles_b, goleadores:f.goleadores || {}};
}
async function leer(){
  if(!configurado){
    conectado = false;
    diag = "config.js no tiene la URL y la anon key del proyecto de Supabase.";
    cargando = false; pintar(); return;
  }
  try{
    const r = await fetch(API + "fechas?select=*&order=n.asc", {headers:cabeceras()});
    if(!r.ok) throw new Error("HTTP " + r.status + " " + (await r.text()));
    fechas = (await r.json()).map(desdeFila);
    conectado = true; diag = "";
  }catch(e){
    conectado = false;
    diag = "lectura: " + ((e && e.message) || String(e));
  }
  cargando = false; pintar();
}
async function verificarClave(v){
  return await rpc("verificar_clave", {p_clave:v}) === true;
}
async function cargarFecha(f){
  const n = await rpc("cargar_fecha", {
    p_clave:clave, p_dia:f.dia, p_equipo_a:f.equipoA, p_equipo_b:f.equipoB,
    p_goles_a:f.golesA, p_goles_b:f.golesB, p_goleadores:f.goleadores});
  return n;
}
async function borrarUltima(){
  return await rpc("borrar_ultima", {p_clave:clave});
}
async function reemplazarTodo(lista){
  return await rpc("reemplazar_todo", {p_clave:clave, p_fechas:lista});
}

/* ====== avatares ====== */
// El tono sale del nombre pero queda encerrado en la familia fría de la paleta:
// 14 avatares distintos que igual se leen como un solo sistema. Sin ámbar acá:
// el ámbar es del puntero y del goleador, y de nadie más.
function tono(n){
  let h = 0;
  for(const c of n) h = (h * 31 + c.codePointAt(0)) % 360;
  return 231 + (h % 58);
}
function avatar(n){
  const f = FOTOS[n];
  if(f) return `<img class="av" src="${f}" alt="" loading="lazy" decoding="async">`;
  return `<div class="av" style="background:hsl(${tono(n)} 27% 31%)" aria-hidden="true">${
    [...n][0].toUpperCase()}</div>`;
}

/* ====== cálculo ====== */
function tabla(){
  const t = {};
  FIJOS.forEach(j => t[j] = {j, pj:0, g:0, e:0, p:0, gf:0, gc:0, pts:0});
  fechas.forEach(f => {
    [["A","B"],["B","A"]].forEach(([yo,rival]) => {
      const gf = f["goles"+yo], gc = f["goles"+rival];
      f["equipo"+yo].forEach(n => {
        const r = t[n]; if(!r) return;
        r.pj++; r.gf += gf; r.gc += gc;
        if(gf > gc){ r.g++; r.pts += 3; } else if(gf === gc){ r.e++; r.pts += 1; } else r.p++;
      });
    });
  });
  return Object.values(t).map(r => ({...r, dif:r.gf - r.gc,
      ef: r.pj ? Math.round(r.pts / (r.pj*3) * 100) : 0}))
    .sort((x,y) => (x.pj?0:1)-(y.pj?0:1) || y.pts-x.pts || y.dif-x.dif
                || y.gf-x.gf || y.g-x.g || x.j.localeCompare(y.j));
}
function goleadores(){
  const g = {};
  fechas.forEach(f => Object.entries(f.goleadores||{}).forEach(([n,c]) => {
    if(FIJOS.includes(n)) g[n] = (g[n]||0) + c;
  }));
  const pj = {}; tabla().forEach(r => pj[r.j] = r.pj);
  return Object.entries(g).filter(([,c]) => c > 0)
    .map(([n,c]) => ({n, c, pj:pj[n]||0}))
    .sort((x,y) => y.c-x.c || x.pj-y.pj || x.n.localeCompare(y.n));
}

/* ====== vistas ====== */
function vTabla(){
  if(cargando) return `<div class="vacio">Cargando…</div>`;
  if(!conectado && !fechas.length) return `<div class="vacio">No se pudo leer la tabla.<br>
    <span class="mono">${diag}</span></div>`;
  const t = tabla();
  if(!fechas.length) return `<div class="vacio">Todavía no se jugó ninguna fecha.<br>
    La tabla arranca el sábado 12/09.</div>`;

  // empatados en la punta: los que igualan al primero en toda la cadena de desempate
  const l = t[0];
  const punta = t.filter(r => r.pj && r.pts === l.pts && r.dif === l.dif
                           && r.gf === l.gf && r.g === l.g);
  const solo = punta.length === 1;
  const nombres = punta.map(r => r.j);
  const podio = solo
    ? `<div class="puntero">
        <div class="caras">${avatar(l.j)}</div>
        <div class="txt">
          <div class="rot">Puntero</div>
          <div class="nom">${l.j}</div>
          <div class="det">${l.pj} ${l.pj === 1 ? "fecha" : "fechas"} · ${l.g}G ${l.e}E ${l.p}P · ${l.ef}% efectivo</div>
        </div>
        <div class="pts"><b>${l.pts}</b><span>puntos</span></div>
      </div>`
    : `<div class="puntero multi">
        <div class="caras">${nombres.slice(0,2).map(avatar).join("")}${
          nombres.length > 2 ? `<div class="av mas">+${nombres.length - 2}</div>` : ""}</div>
        <div class="txt">
          <div class="rot">Empatados en la punta</div>
          <div class="nom">${nombres.length} jugadores</div>
          <div class="det">${nombres.join(" · ")}</div>
        </div>
        <div class="pts"><b>${l.pts}</b><span>puntos</span></div>
      </div>`;

  const filas = t.map((r,i) => {
    const mini = r.pj
      ? `${r.pj} ${r.pj === 1 ? "fecha" : "fechas"} · ${r.g}G ${r.e}E ${r.p}P · ${r.gf}-${r.gc}`
      : "todavía no jugó";
    return `<div class="fila${solo && i === 0 ? " lider" : ""}${r.pj ? "" : " zapatero"}">
      <div class="rk">${i+1}</div>
      ${avatar(r.j)}
      <div class="id"><div class="nm">${r.j}</div><div class="mini">${mini}</div></div>
      <div class="dif ${r.dif>0?"dif-pos":r.dif<0?"dif-neg":""}">${r.dif>0?"+":""}${r.dif}</div>
      <div class="pt">${r.pts}</div>
    </div>`;
  }).join("");

  return podio + `<div class="tabla">
      <div class="cab"><span class="c-jug">Jugador</span><span>Dif</span><span>Pts</span></div>
      ${filas}
    </div>
    <p class="nota">La segunda línea de cada jugador son las fechas que jugó, cómo le fue
      y los goles a favor y en contra del equipo en el que estuvo.
      No hay mínimo de fechas: campeón es el que más puntos suma.</p>`;
}

function vGoles(){
  if(cargando) return `<div class="vacio">Cargando…</div>`;
  const g = goleadores();
  if(!g.length) return `<div class="vacio">Sin goles cargados todavía.</div>`;
  const max = g[0].c;
  return g.map((x,i) => `<div class="gol">
      <div class="n">${i+1}</div>
      ${avatar(x.n)}
      <div class="id"><div class="nm">${x.n}</div>
        <div class="mini">${x.pj} ${x.pj === 1 ? "fecha" : "fechas"} · ${
          (x.c / Math.max(x.pj,1)).toFixed(1).replace(".",",")} por fecha</div></div>
      <div class="bar"><i style="width:${Math.round(x.c/max*100)}%"></i></div>
      <div class="c">${x.c}</div>
    </div>`).join("") +
    `<p class="nota">Se cuentan solo los goles de los ${FIJOS.length} fijos.
      Si empatan, va arriba el que jugó menos fechas.</p>`;
}
function vFechas(){
  if(cargando) return `<div class="vacio">Cargando…</div>`;
  if(!fechas.length) return `<div class="vacio">Sin fechas jugadas.</div>`;
  return [...fechas].reverse().map(f => {
    const an = Object.entries(f.goleadores||{}).filter(([,c]) => c>0)
      .sort((a,b) => b[1]-a[1])
      .map(([n,c]) => c>1 ? `${n} (${c})` : n).join(" · ");
    return `<div class="fecha">
      <div class="top"><span>Fecha ${f.n}</span><span>${f.dia||""}</span></div>
      <div class="duelo">
        <div class="lado"><b>Equipo A</b>${f.equipoA.join(", ")}</div>
        <div class="res"><span class="${f.golesA<f.golesB?"pierde":""}">${f.golesA}</span>
          <span class="punto">·</span>
          <span class="${f.golesB<f.golesA?"pierde":""}">${f.golesB}</span></div>
        <div class="lado der"><b>Equipo B</b>${f.equipoB.join(", ")}</div>
      </div>
      ${an ? `<div class="anot">Goles: ${an}</div>` : ""}
    </div>`;
  }).join("");
}
function vReglas(){
  const R = [
    ["Cuándo","12 fechas, sábados a las 18. Arranca el 12/09 y cierra el 28/11. Hay dos sábados comodín para reprogramar lo que se suspenda por lluvia."],
    ["Quién puntúa","Solo los " + FIJOS.length + " fijos: " + FIJOS.join(", ") + ". Los invitados juegan, pero no suman puntos ni goles a la tabla."],
    ["El partido","Fútbol 5, partido largo y corrido. El sistema de relevos se define en el lanzamiento y se ajusta en las primeras fechas."],
    ["Los equipos","Se arman antes de arrancar. Una vez que empezó el partido no se cambian: el resultado de la fecha es el del partido completo."],
    ["Los puntos","3 por ganar, 1 por empatar, 0 por perder. El punto es del jugador, no del equipo."],
    ["Los goles","GF y GC son los del equipo en el que jugaste esa fecha. La tabla de goleadores cuenta goles individuales."],
    ["Desempates","Puntos, después diferencia de gol, después goles a favor, después partidos ganados."],
    ["Campeón","El que más puntos suma al cabo de las " + TOTAL_FECHAS + " fechas. No hay mínimo de partidos jugados: cuenta lo que sumaste, jugaste las que jugaste."],
    ["El registro","Al terminar, el resultado y los goleadores se pasan al grupo y se cargan acá. El responsable es Gastón, pero cualquiera con la clave puede cargar la fecha desde el celular."],
    ["Reclamos","Lo cargado queda firme a las 48 horas. Lo que se discuta, se discute antes y en el grupo."]
  ];
  return R.map((r,i) => `<div class="regla"><div class="n">${i+1}</div>
    <p><b>${r[0]}</b><small>${r[1]}</small></p></div>`).join("");
}

/* ====== carga ====== */
function nuevoForm(){
  return {equipos:{}, golesA:"", golesB:"", goleadores:{}, msg:null};
}
function vCarga(){
  if(!desbloqueado){
    return `${!conectado ? `<div class="aviso err"><b>Sin conexión con la base.</b>
        No se puede cargar hasta que vuelva.<br>
        <span class="mono">${diag || "sin detalle"}</span></div>` : ""}
      <div class="campo"><label>Clave de carga</label>
      <input type="password" id="clave" placeholder="Solo quien lleva la planilla">
      ${form && form.msg ? `<div class="aviso err" style="margin-top:12px">${form.msg}</div>` : ""}
      </div><button class="primario" id="btnAbrir">Entrar</button>`;
  }
  if(!form) form = nuevoForm();
  const n = fechas.length + 1;
  const chips = FIJOS.map(j => {
    const e = form.equipos[j];
    return `<button class="chip ${e||""}" data-j="${j}">${j}${e ? " " + e.toUpperCase() : ""}</button>`;
  }).join("");
  const sel = FIJOS.filter(j => form.equipos[j]);
  const anot = sel.map(j => `<div class="anotador">
      <div class="nm">${j} <span style="color:var(--tenue);font-size:12px">${form.equipos[j].toUpperCase()}</span></div>
      <button data-g="${j}" data-d="-1">−</button>
      <div class="v">${form.goleadores[j]||0}</div>
      <button data-g="${j}" data-d="1">+</button>
    </div>`).join("");
  const cA = sel.filter(j => form.equipos[j]==="a").length;
  const cB = sel.filter(j => form.equipos[j]==="b").length;
  const estado = conectado
    ? `<div class="aviso ok">Sincronizado. Lo que cargues lo ve todo el grupo.</div>`
    : `<div class="aviso err"><b>Sin conexión con la base.</b> No guardes hasta que vuelva:
        lo que cargues ahora se pierde.<br>
        <span class="mono">${diag || "sin detalle"}</span></div>`;
  return estado + `${form.msg ? `<div class="aviso ${form.msg.t}">${form.msg.x}</div>` : ""}
    <div class="campo">
      <label>Fecha ${n} · equipos (${cA} vs ${cB})</label>
      <p class="hint">Tocá una vez para el equipo A, dos veces para el B, tres para sacarlo.</p>
      <div class="chips" id="chips">${chips}</div>
    </div>
    <div class="campo"><label>Resultado</label>
      <div class="marcador">
        <input type="number" id="gA" inputmode="numeric" value="${form.golesA}" placeholder="A">
        <span>a</span>
        <input type="number" id="gB" inputmode="numeric" value="${form.golesB}" placeholder="B">
      </div>
      <p class="hint" style="text-align:center">izquierda equipo A · derecha equipo B</p>
    </div>
    ${sel.length ? `<div class="campo"><label>Goleadores</label>${anot}</div>` : ""}
    <button class="primario" id="btnGuardar">Guardar fecha ${n}</button>
    ${fechas.length ? `<button class="secundario" id="btnBorrar">Borrar la última fecha cargada</button>` : ""}
    <div class="campo" style="margin-top:26px">
      <label>Respaldo</label>
      <p class="hint">Copiá este texto y guardalo. Pegándolo acá y tocando Restaurar
        se reemplazan todas las fechas de la base por las del respaldo.</p>
      <textarea id="respaldo" rows="4">${JSON.stringify(fechas)}</textarea>
      <button class="secundario" id="btnRestaurar">Restaurar desde el respaldo</button>
    </div>`;
}

/* ====== render + eventos ====== */
function pintar(){
  document.getElementById("v-tabla").innerHTML  = vTabla();
  document.getElementById("v-goles").innerHTML  = vGoles();
  document.getElementById("v-fechas").innerHTML = vFechas();
  document.getElementById("v-reglas").innerHTML = vReglas();
  document.getElementById("v-carga").innerHTML  = vCarga();
  document.getElementById("hFecha").textContent = fechas.length;
  document.getElementById("hTexto").textContent =
    fechas.length === 1 ? "fecha jugada de 12" : "fechas jugadas de 12";
  document.getElementById("hBarra").innerHTML =
    Array.from({length:TOTAL_FECHAS}, (_,i) =>
      `<i class="${i < fechas.length ? "on" : ""}"></i>`).join("");
}
function verCarga(){ document.querySelector('nav [data-v="carga"]').click(); }
// Repinta solo el formulario y deja el scroll donde estaba. Cambiar de pestaña
// manda arriba de todo, y eso en medio de una carga es insoportable.
function repintarCarga(){
  const y = window.scrollY;
  document.getElementById("v-carga").innerHTML = vCarga();
  window.scrollTo(0, y);
}
function avisar(){
  const a = document.querySelector("#v-carga .aviso.err");
  if(a) a.scrollIntoView({block:"center", behavior:"smooth"});
}

document.querySelectorAll("nav button").forEach(b => b.onclick = () => {
  document.querySelectorAll("nav button").forEach(x => x.classList.remove("on"));
  document.querySelectorAll("section").forEach(x => x.classList.remove("on"));
  b.classList.add("on");
  document.getElementById("v-" + b.dataset.v).classList.add("on");
  window.scrollTo({top:0});
});

document.addEventListener("click", async e => {
  const t = e.target;

  if(t.id === "btnAbrir"){
    const v = document.getElementById("clave").value;
    form = form || nuevoForm();
    if(!conectado){ form.msg = "Sin conexión con la base."; pintar(); verCarga(); return; }
    t.disabled = true;
    try{
      if(await verificarClave(v)){ clave = v; desbloqueado = true; form = nuevoForm(); }
      else form.msg = "Clave incorrecta.";
    }catch(err){
      form.msg = "No se pudo validar la clave: " + err.message;
    }
    pintar(); verCarga(); return;
  }
  if(t.closest("#chips") && t.dataset.j){
    const j = t.dataset.j, e0 = form.equipos[j];
    if(!e0) form.equipos[j] = "a";
    else if(e0 === "a") form.equipos[j] = "b";
    else { delete form.equipos[j]; delete form.goleadores[j]; }
    form.golesA = document.getElementById("gA").value;
    form.golesB = document.getElementById("gB").value;
    form.msg = null; repintarCarga(); return;
  }
  // Sumar o restar un gol no repinta nada: toca el número y listo. Es el gesto
  // que más se repite en la noche y no puede mover la pantalla.
  if(t.dataset.g){
    const j = t.dataset.g;
    const v = Math.max(0, (form.goleadores[j]||0) + Number(t.dataset.d));
    form.goleadores[j] = v;
    const casilla = t.parentElement.querySelector(".v");
    if(casilla) casilla.textContent = v;
    return;
  }
  if(t.id === "btnGuardar"){
    const A = FIJOS.filter(j => form.equipos[j] === "a");
    const B = FIJOS.filter(j => form.equipos[j] === "b");
    const gA = Number(document.getElementById("gA").value);
    const gB = Number(document.getElementById("gB").value);
    form.golesA = gA; form.golesB = gB;
    if(!A.length || !B.length){
      form.msg = {t:"err", x:"Faltan jugadores en alguno de los dos equipos."};
      repintarCarga(); avisar(); return;
    }
    if(!Number.isInteger(gA) || !Number.isInteger(gB) || gA < 0 || gB < 0){
      form.msg = {t:"err", x:"Cargá el resultado con números."};
      repintarCarga(); avisar(); return;
    }
    const gols = {};
    Object.entries(form.goleadores).forEach(([j,c]) => { if(c > 0) gols[j] = c; });
    const sumA = A.reduce((s,j) => s + (gols[j]||0), 0);
    const sumB = B.reduce((s,j) => s + (gols[j]||0), 0);
    if(sumA > gA || sumB > gB){
      form.msg = {t:"err", x:"Hay más goleadores cargados que goles en el marcador."};
      repintarCarga(); avisar(); return;
    }
    const hoy = new Date();
    const nueva = {equipoA:A, equipoB:B, golesA:gA, golesB:gB, goleadores:gols,
      dia: hoy.toLocaleDateString("es-AR", {day:"2-digit", month:"2-digit"})};
    t.disabled = true; t.textContent = "Guardando…";
    try{
      const n = await cargarFecha(nueva);
      fechas.push({...nueva, n});
      conectado = true; diag = "";
      form = nuevoForm();
      form.msg = {t:"ok", x:"Fecha " + n + " cargada. Ya la ve todo el grupo."};
      pintar(); document.querySelector('nav [data-v="tabla"]').click(); return;
    }catch(err){
      form.msg = {t:"err", x:"No se guardó: " + err.message + ". Nada se perdió, probá de nuevo."};
      repintarCarga(); avisar(); return;
    }
  }
  if(t.id === "btnRestaurar"){
    let d;
    try{
      d = JSON.parse(document.getElementById("respaldo").value);
      if(!Array.isArray(d)) throw new Error("formato");
    }catch(err){
      form.msg = {t:"err", x:"El respaldo no se pudo leer."};
      repintarCarga(); avisar(); return;
    }
    t.disabled = true;
    try{
      await reemplazarTodo(d.map((f,i) => ({n:i+1, dia:f.dia||"", equipo_a:f.equipoA,
        equipo_b:f.equipoB, goles_a:f.golesA, goles_b:f.golesB, goleadores:f.goleadores||{}})));
      await leer();
      form = nuevoForm();
      form.msg = {t:"ok", x:"Restauradas " + fechas.length + " fechas."};
    }catch(err){
      form.msg = {t:"err", x:"No se pudo restaurar: " + err.message};
    }
    pintar(); verCarga(); return;
  }
  if(t.id === "btnBorrar"){
    t.disabled = true;
    try{
      await borrarUltima();
      fechas.pop();
      form = nuevoForm();
      form.msg = {t:"ok", x:"Se borró la última fecha."};
    }catch(err){
      form = form || nuevoForm();
      form.msg = {t:"err", x:"No se pudo borrar: " + err.message};
    }
    pintar(); verCarga(); return;
  }
});

pintar();
leer();
