/* ====== configuración ====== */
const TOTAL_FECHAS = 12;
const POR_FECHA = 10;             // los que entran a cada fecha
const PLANTEL = window.JUGADORES || [];
const FIJOS = PLANTEL.map(j => j.nombre);
const FOTOS = Object.fromEntries(PLANTEL.filter(j => j.foto).map(j => [j.nombre, j.foto]));

/* ====== estado ====== */
let fechas = [];
let pozo = {cuota:500, ajuste:0, nota:""};
let cargando = true;
let desbloqueado = false;
let clave = "";                 // la que escribió el encargado; vive solo en memoria
let form = null;
let confirmar = null;           // número de fecha esperando confirmación de borrado
let editando = null;            // {n, golesA, golesB, goleadores} de la fecha en corrección
let vinieron = [];              // los que confirmaron para hoy
let invitados = [];             // nombres agregados a mano, fuera de los fijos
let yaFueron = [];              // capitanes de rondas anteriores
let caps = [];                  // los dos de esta ronda
let sorteando = false;
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
    const [rf, rp] = await Promise.all([
      fetch(API + "fechas?select=*&order=n.asc", {headers:cabeceras()}),
      fetch(API + "pozo?select=*&id=eq.1", {headers:cabeceras()})
    ]);
    if(!rf.ok) throw new Error("HTTP " + rf.status + " " + (await rf.text()));
    fechas = (await rf.json()).map(desdeFila);
    if(rp.ok){
      const p = (await rp.json())[0];
      if(p) pozo = {cuota:p.cuota, ajuste:p.ajuste, nota:p.nota || ""};
    }
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
  return await rpc("cargar_fecha", {
    p_clave:clave, p_dia:f.dia, p_equipo_a:f.equipoA, p_equipo_b:f.equipoB,
    p_goles_a:f.golesA, p_goles_b:f.golesB, p_goleadores:f.goleadores});
}
async function editarFecha(e){
  return await rpc("editar_fecha", {p_clave:clave, p_n:e.n,
    p_goles_a:e.golesA, p_goles_b:e.golesB, p_goleadores:e.goleadores});
}
async function borrarFecha(n){
  return await rpc("borrar_fecha", {p_clave:clave, p_n:n});
}
async function guardarPozo(p){
  return await rpc("guardar_pozo", {p_clave:clave, p_cuota:p.cuota,
                                    p_ajuste:p.ajuste, p_nota:p.nota});
}

/* ====== el sorteo vive en este teléfono ====== */
// No va a Supabase a propósito: el sorteo pasa a las 18 en la cancha, con los
// pibes esperando, y pedir la clave ahí es fricción. El costo es que el
// historial de capitanes es de este aparato.
const LLAVE_LOCAL = "fulbito.sorteo";
function leerLocal(){
  try{
    const d = JSON.parse(localStorage.getItem(LLAVE_LOCAL) || "{}");
    vinieron  = Array.isArray(d.vinieron)  ? d.vinieron  : [];
    invitados = Array.isArray(d.invitados) ? d.invitados : [];
    yaFueron  = Array.isArray(d.yaFueron)  ? d.yaFueron  : [];
  }catch(e){ /* modo incógnito, almacenamiento bloqueado: arranca limpio */ }
}
function guardarLocal(){
  try{
    localStorage.setItem(LLAVE_LOCAL, JSON.stringify({vinieron, invitados, yaFueron}));
  }catch(e){ /* si no se puede guardar, el sorteo igual funciona en esta sesión */ }
}
function plantelDelDia(){ return FIJOS.concat(invitados); }

/* ====== plata ====== */
// 1.000 · 10.000 · 100.000, coma para los decimales. Es el formato de acá.
const PESOS = new Intl.NumberFormat("es-AR", {minimumFractionDigits:0, maximumFractionDigits:2});
function plata(n){ return "$" + PESOS.format(n); }

/* ====== avatares ====== */
// El tono sale del nombre pero queda encerrado en la familia fría de la paleta:
// 14 avatares distintos que igual se leen como un solo sistema. Sin ámbar acá:
// el ámbar es del puntero, del goleador y del pozo, y de nadie más.
function tono(n){
  let h = 0;
  for(const c of n) h = (h * 31 + c.codePointAt(0)) % 360;
  return 231 + (h % 58);
}
function avatar(n){
  const f = FOTOS[n];
  if(f) return `<img class="av" src="${f}" alt="" decoding="async">`;
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
// Cada presencia en una fecha pone la cuota, y eso es todo el pozo. Sin ajustes
// a mano: un número que nadie puede reconstruir mirando las fechas no sirve.
function presencias(f){ return f.equipoA.length + f.equipoB.length; }
function totalPozo(){
  return fechas.reduce((s,f) => s + presencias(f), 0) * pozo.cuota;
}

/* ====== qué hace válida a una fecha ====== */
// La suma de los goles de cada equipo tiene que dar exactamente su marcador.
// Ni más —no puede haber goles de la nada— ni menos: si faltan, alguien no
// quedó anotado y la tabla de goleadores arranca torcida.
function sumaDe(lista, gols){ return lista.reduce((s,j) => s + (gols[j]||0), 0); }
function revisar(A, B, gA, gB, gols){
  if(!A.length || !B.length) return "Faltan jugadores en alguno de los dos equipos.";
  if(!Number.isInteger(gA) || !Number.isInteger(gB) || gA < 0 || gB < 0)
    return "Cargá el resultado con números.";
  const sA = sumaDe(A, gols), sB = sumaDe(B, gols);
  if(sA === gA && sB === gB) return null;
  const faltan = [];
  if(sA !== gA) faltan.push(`el A hizo ${gA} y tenés ${sA} repartidos`);
  if(sB !== gB) faltan.push(`el B hizo ${gB} y tenés ${sB} repartidos`);
  return "Los goles no cierran: " + faltan.join("; ") + ".";
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
          <div class="rot">Empate en la punta</div>
          <div class="nom">${nombres.length} jugadores</div>
          <div class="det">${nombres.join(" · ")}</div>
        </div>
        <div class="pts"><b>${l.pts}</b><span>puntos</span></div>
      </div>`;

  const filas = t.map((r,i) => {
    const stats = r.pj
      ? `<span class="tag pj"><b>${r.pj}</b> PJ</span>
         <span class="tag chico"><b>${r.g}</b>G</span>
         <span class="tag chico"><b>${r.e}</b>E</span>
         <span class="tag chico"><b>${r.p}</b>P</span>
         <span class="tag gfgc"><b>${r.gf}</b>-<b>${r.gc}</b></span>`
      : `<span class="tag nada">todavía no jugó</span>`;
    return `<div class="fila${solo && i === 0 ? " lider" : ""}${r.pj ? "" : " zapatero"}">
      <div class="rk">${i+1}</div>
      ${avatar(r.j)}
      <div class="id"><div class="nm">${r.j}</div><div class="stats">${stats}</div></div>
      <div class="dif ${r.dif>0?"dif-pos":r.dif<0?"dif-neg":""}">${r.dif>0?"+":""}${r.dif}</div>
      <div class="pt">${r.pts}</div>
    </div>`;
  }).join("");

  return podio + `<div class="tabla">
      <div class="cab"><span class="c-jug">Jugador</span><span>Dif</span><span>Pts</span></div>
      ${filas}
    </div>
    <div class="glosario">
      <div><b>PJ</b><span>Partidos jugados</span></div>
      <div><b>G</b><span>Ganados · suma 3 puntos</span></div>
      <div><b>E</b><span>Empatados · suma 1 punto</span></div>
      <div><b>P</b><span>Perdidos · no suma</span></div>
      <div><b>17-14</b><span>Goles a favor y en contra del equipo en el que jugó</span></div>
      <div><b>DIF</b><span>Diferencia de gol: los que hizo menos los que recibió</span></div>
      <div><b>PTS</b><span>Puntos acumulados. El que más suma es el campeón</span></div>
    </div>`;
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
    </div>`).join("");
}

function vPozo(){
  if(cargando) return `<div class="vacio">Cargando…</div>`;
  const pres = fechas.reduce((s,f) => s + presencias(f), 0);
  const total = totalPozo();
  const objetivo = TOTAL_FECHAS * POR_FECHA * pozo.cuota;
  const avance = objetivo ? Math.min(100, Math.round(total / objetivo * 100)) : 0;

  const desglose = [...fechas].reverse().map(f => `<div class="linea">
      <span class="q">Fecha ${f.n}</span>
      <span class="m">${presencias(f)} jugadores</span>
      <span class="v">${plata(presencias(f) * pozo.cuota)}</span>
    </div>`).join("");

  return `<div class="pozo">
      <div class="brillo" aria-hidden="true"></div>
      <div class="destello" aria-hidden="true"></div>
      <div class="cara" aria-hidden="true">🤑</div>
      <div class="rot">Pozo acumulado</div>
      <div class="monto">${plata(total)}</div>
      <div class="avance-pozo"><i style="width:${avance}%"></i></div>
      <div class="sub">${avance}% del objetivo de ${plata(objetivo)}</div>
    </div>
    ${desglose ? `<div class="campo" style="margin-top:22px">
      <label>Fecha por fecha</label>
      <div class="desglose">${desglose}</div></div>`
      : `<div class="vacio" style="padding:26px 20px">El pozo arranca con la primera fecha.</div>`}
    <p class="nota">Cada jugador pone ${plata(pozo.cuota)} por fecha jugada, aparte de la cancha.</p>`;
}

function vFechas(){
  if(cargando) return `<div class="vacio">Cargando…</div>`;
  if(!fechas.length) return `<div class="vacio">Sin fechas jugadas.</div>`;
  return [...fechas].reverse().map(f => {
    const an = Object.entries(f.goleadores||{}).filter(([,c]) => c>0)
      .sort((a,b) => b[1]-a[1])
      .map(([n,c]) => c>1 ? `${n} (${c})` : n).join(" · ");

    const herramientas = desbloqueado
      ? `<button class="tacho" data-editar="${f.n}" aria-label="Corregir la fecha ${f.n}">
          <svg viewBox="0 0 20 20" width="15" height="15" aria-hidden="true"><path
            d="M3.6 16.4l.6-3.3L12.9 4.4a1.6 1.6 0 0 1 2.3 0l.4.4a1.6 1.6 0 0 1 0 2.3L6.9 15.8l-3.3.6zM11.9 5.5l2.6 2.6"
            fill="none" stroke="currentColor" stroke-width="1.5"
            stroke-linecap="round" stroke-linejoin="round"/></svg>
         </button>
         <button class="tacho" data-borrar="${f.n}" aria-label="Borrar la fecha ${f.n}">
          <svg viewBox="0 0 20 20" width="15" height="15" aria-hidden="true"><path
            d="M3.5 5.5h13M8 5.5V4.2a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1.3M5.6 5.5l.7 10.1a1.5 1.5 0 0 0 1.5 1.4h4.4a1.5 1.5 0 0 0 1.5-1.4l.7-10.1"
            fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
         </button>`
      : "";

    const pie = confirmar === f.n
      ? `<div class="borrar">
           <span>Se van sus puntos y sus goles.</span>
           <button class="no" data-cancelar="1">No</button>
           <button class="si" data-borrar-ok="${f.n}">Borrar</button>
         </div>`
      : (editando && editando.n === f.n ? editor(f) : "");

    return `<div class="fecha">
      <div class="top"><span>Fecha ${f.n}</span>
        <span class="der">${f.dia||""}${herramientas}</span></div>
      <div class="duelo">
        <div class="lado">
          <div class="caritas">${f.equipoA.map(avatar).join("")}</div>
          <div class="quienes">${f.equipoA.join(", ")}</div>
        </div>
        <div class="res"><span class="${f.golesA<f.golesB?"pierde":""}">${f.golesA}</span>
          <span class="punto">·</span>
          <span class="${f.golesB<f.golesA?"pierde":""}">${f.golesB}</span></div>
        <div class="lado der">
          <div class="caritas">${f.equipoB.map(avatar).join("")}</div>
          <div class="quienes">${f.equipoB.join(", ")}</div>
        </div>
      </div>
      ${an ? `<div class="anot">Goles: ${an}</div>` : ""}
      ${pie}
    </div>`;
  }).join("");
}

// El editor corrige el resultado y los goleadores. Los equipos no se tocan:
// si están mal, la fecha se borra y se carga de nuevo.
function editor(f){
  const fila = (j, eq) => `<div class="anotador">
      <div class="nm">${j} <span style="color:var(--tenue);font-size:var(--t-2)">${eq}</span></div>
      <button data-eg="${j}" data-d="-1">−</button>
      <div class="v">${editando.goleadores[j]||0}</div>
      <button data-eg="${j}" data-d="1">+</button>
    </div>`;
  return `<div class="editor">
      <div class="marcador">
        <input type="number" id="eGA" inputmode="numeric" value="${editando.golesA}">
        <span>a</span>
        <input type="number" id="eGB" inputmode="numeric" value="${editando.golesB}">
      </div>
      <div class="campo" style="margin:14px 0 0">
        <label>Goleadores</label>
        ${f.equipoA.map(j => fila(j,"A")).join("")}
        ${f.equipoB.map(j => fila(j,"B")).join("")}
      </div>
      <div id="eChequeo"></div>
      <div class="acciones">
        <button class="secundario" id="btnEditarNo">Cancelar</button>
        <button class="primario" id="btnEditarOk">Guardar cambios</button>
      </div>
    </div>`;
}

function vSorteo(){
  const plantel = plantelDelDia();
  const chips = plantel.map(j => {
    const si = vinieron.includes(j);
    const inv = invitados.includes(j);
    return `<button class="chip ${si ? "si" : ""}" data-vino="${j}">${j}${
      inv ? ` <span class="x" data-quitar="${j}">×</span>` : ""}</button>`;
  }).join("");

  const listos = vinieron.length;
  const puede = listos >= 2 && caps.length < 2 && !sorteando;
  const rotulo = caps.length === 0 ? "Sortear el primer capitán"
                                   : "Sortear el segundo capitán";

  const casilla = (i) => {
    const n = caps[i];
    return `<div class="capitan ${n ? "listo" : ""}">
      <div class="rot">Capitán ${i+1}${i === 0 ? " · elige primero" : ""}</div>
      <div class="cara">${n ? avatar(n) : `<div class="av vacia">?</div>`}</div>
      <div class="nom">${n || "—"}</div>
    </div>`;
  };

  return `<div class="campo">
      <label>Quiénes vienen · ${listos} de ${POR_FECHA}</label>
      <div class="chips" id="vinieron">${chips}</div>
      <div class="sumar">
        <input type="text" id="nuevoInv" placeholder="Sumar a alguien que no está en la lista"
               autocomplete="off">
        <button class="secundario" id="btnInvitado">Sumar</button>
      </div>
    </div>

    <div class="duplaCap">${casilla(0)}${casilla(1)}</div>

    ${caps.length === 2
      ? `<button class="primario" id="btnOtraRonda">Sortear otra vez</button>`
      : `<button class="primario" id="btnSortear" ${puede ? "" : "disabled"}>${rotulo}</button>
         ${caps.length ? `<button class="secundario" id="btnOtraRonda">Empezar de nuevo</button>` : ""}`}
    <p class="hint" style="margin-top:14px">El armado del equipo se define por
      votación en WhatsApp.</p>

    <div class="campo" style="margin-top:26px">
      <label>Ya fueron capitanes</label>
      ${yaFueron.length
        ? `<div class="chips">${yaFueron.map(n => `<span class="chip quieto">${n}</span>`).join("")}</div>
           <button class="secundario" id="btnReiniciar">Reiniciar la rueda de capitanes</button>`
        : `<p class="hint">Todavía nadie. A medida que salgan, quedan afuera del
            sorteo hasta que hayan pasado todos.</p>`}
      <p class="hint" style="margin-top:12px">La rueda vive en este teléfono.</p>
    </div>`;
}

function vReglas(){
  const R = [
    ["Qué es esto",
     "Un torneo de " + TOTAL_FECHAS + " fechas donde el que compite es el jugador, no el equipo. " +
     "Los equipos se rearman todos los sábados, pero los puntos quedan pegados a la persona. " +
     "Campeón es el que más puntos junta en toda la temporada."],
    ["Cuándo",
     TOTAL_FECHAS + " fechas, los sábados. Cancha y horario a definir."],
    ["Quién juega",
     "Se anota en el grupo de WhatsApp. Entran los primeros " + POR_FECHA +
     " por orden de anotación."],
    ["El partido",
     "Fútbol 5. Los dos capitanes salen del sorteo que se hace en la app, y después " +
     "reparten los equipos por WhatsApp. El que sale primero elige primero."],
    ["Los puntos",
     "Cada fecha te deja 3 puntos si ganás, 1 si empatás y 0 si perdés. Son tuyos y no " +
     "del equipo: la semana que viene jugás con otros y te los llevás igual. " +
     "Si dos terminan con los mismos puntos, desempata la diferencia de gol, después " +
     "los goles a favor y después los partidos ganados."],
    ["El pozo",
     "Aparte de lo que sale la cancha, cada uno pone " + plata(pozo.cuota) +
     " por fecha jugada. Se acumula toda la temporada y se ve en la pestaña Pozo."],
    ["El registro",
     "Al terminar se pasan resultado y goleadores al grupo y se cargan acá. Puede cargar " +
     "cualquiera que tenga la clave. Lo cargado queda firme a las 48 horas."]
  ];
  return R.map((r,i) => `<div class="regla"><div class="n">${i+1}</div>
    <p><b>${r[0]}</b><small>${r[1]}</small></p></div>`).join("");
}

/* ====== carga ====== */
// Los que salieron del sorteo entran directo al equipo A. Un toque los pasa
// al B: el armado se decidió en WhatsApp y acá solo se transcribe.
function nuevoForm(){
  const equipos = {};
  vinieron.filter(n => FIJOS.includes(n)).forEach(n => equipos[n] = "a");
  return {equipos, golesA:"", golesB:"", goleadores:{}, msg:null};
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

  // Solo se carga a quien pasó por el sorteo: si no jugó, no puede sumar puntos.
  const habilitados = vinieron.filter(j => FIJOS.includes(j));
  if(!habilitados.length){
    return `<div class="vacio">Antes de cargar la fecha hay que marcar quiénes
      vinieron, en la pestaña Sorteo.</div>`;
  }

  const chips = habilitados.map(j => {
    const e = form.equipos[j];
    return `<button class="chip ${e||""}" data-j="${j}">${j}${e ? " " + e.toUpperCase() : ""}</button>`;
  }).join("");
  const sel = habilitados.filter(j => form.equipos[j]);
  const anot = sel.map(j => `<div class="anotador">
      <div class="nm">${j} <span style="color:var(--tenue);font-size:var(--t-2)">${form.equipos[j].toUpperCase()}</span></div>
      <button data-g="${j}" data-d="-1">−</button>
      <div class="v">${form.goleadores[j]||0}</div>
      <button data-g="${j}" data-d="1">+</button>
    </div>`).join("");
  const cA = sel.filter(j => form.equipos[j]==="a").length;
  const cB = sel.filter(j => form.equipos[j]==="b").length;

  return `${!conectado ? `<div class="aviso err"><b>Sin conexión con la base.</b>
      No guardes hasta que vuelva: lo que cargues ahora se pierde.<br>
      <span class="mono">${diag || "sin detalle"}</span></div>` : ""}
    ${form.msg ? `<div class="aviso ${form.msg.t}">${form.msg.x}</div>` : ""}
    <div class="campo">
      <label>Fecha ${n} · equipos (${cA} vs ${cB})</label>
      <p class="hint">Vienen del sorteo, todos en el A. Tocá para pasarlos al B.</p>
      <div class="chips" id="chips">${chips}</div>
    </div>
    <div class="campo"><label>Resultado</label>
      <div class="marcador">
        <input type="number" id="gA" inputmode="numeric" value="${form.golesA}" placeholder="A">
        <span>a</span>
        <input type="number" id="gB" inputmode="numeric" value="${form.golesB}" placeholder="B">
      </div>
    </div>
    ${sel.length ? `<div class="campo"><label>Goleadores</label>${anot}</div>` : ""}
    <div id="chequeo"></div>
    <button class="primario" id="btnGuardar">Guardar fecha ${n}</button>

    <div class="campo" style="margin-top:30px">
      <label>Cuota del pozo</label>
      <p class="hint">Lo que pone cada jugador por fecha jugada.</p>
      <input type="number" id="pCuota" inputmode="numeric" value="${pozo.cuota}">
      <button class="secundario" id="btnPozo">Guardar la cuota</button>
    </div>`;
}

/* ====== render + eventos ====== */
function pintar(){
  document.getElementById("v-tabla").innerHTML  = vTabla();
  document.getElementById("v-goles").innerHTML  = vGoles();
  document.getElementById("v-fechas").innerHTML = vFechas();
  document.getElementById("v-pozo").innerHTML   = vPozo();
  document.getElementById("v-sorteo").innerHTML = vSorteo();
  document.getElementById("v-reglas").innerHTML = vReglas();
  document.getElementById("v-carga").innerHTML  = vCarga();
  document.getElementById("hFecha").textContent = fechas.length;
  document.getElementById("hTexto").textContent =
    fechas.length === 1 ? "fecha jugada de 12" : "fechas jugadas de 12";
  document.getElementById("hBarra").innerHTML =
    Array.from({length:TOTAL_FECHAS}, (_,i) =>
      `<i class="${i < fechas.length ? "on" : ""}"></i>`).join("");
  revisarCarga(); revisarEdicion();
}
function verCarga(){ document.querySelector('nav [data-v="carga"]').click(); }

// El error se muestra mientras se carga, no al apretar Guardar, y el botón
// queda bloqueado hasta que la fecha cierre.
function equiposDelForm(){
  return [FIJOS.filter(j => form.equipos[j] === "a"),
          FIJOS.filter(j => form.equipos[j] === "b")];
}
function mostrar(idAviso, idBoton, err){
  const caja = document.getElementById(idAviso), btn = document.getElementById(idBoton);
  if(caja) caja.innerHTML = err ? `<div class="aviso err">${err}</div>` : "";
  if(btn) btn.disabled = Boolean(err);
}
function revisarCarga(){
  if(!desbloqueado || !form) return;
  const gA = document.getElementById("gA"), gB = document.getElementById("gB");
  if(!gA || !gB) return;
  form.golesA = gA.value; form.golesB = gB.value;
  const [A,B] = equiposDelForm();
  const gols = {};
  Object.entries(form.goleadores).forEach(([j,c]) => { if(c > 0) gols[j] = c; });
  mostrar("chequeo", "btnGuardar",
          revisar(A, B, Number(gA.value), Number(gB.value), gols));
}
function revisarEdicion(){
  if(!editando) return;
  const gA = document.getElementById("eGA"), gB = document.getElementById("eGB");
  if(!gA || !gB) return;
  editando.golesA = gA.value; editando.golesB = gB.value;
  const f = fechas.find(x => x.n === editando.n);
  if(!f) return;
  const gols = {};
  Object.entries(editando.goleadores).forEach(([j,c]) => { if(c > 0) gols[j] = c; });
  mostrar("eChequeo", "btnEditarOk",
          revisar(f.equipoA, f.equipoB, Number(gA.value), Number(gB.value), gols));
}
document.addEventListener("input", e => {
  if(e.target.id === "gA" || e.target.id === "gB") revisarCarga();
  if(e.target.id === "eGA" || e.target.id === "eGB") revisarEdicion();
});
// Repinta una sola sección y deja el scroll donde estaba. Cambiar de pestaña
// manda arriba de todo, y eso en medio de una carga es insoportable.
function repintar(id, vista){
  const y = window.scrollY;
  document.getElementById(id).innerHTML = vista();
  window.scrollTo(0, y);
}
function repintarCarga(){ repintar("v-carga", vCarga); revisarCarga(); }
const quieto = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

// Las dos animaciones llevan red: si requestAnimationFrame no corre —pestaña en
// segundo plano, ahorro de batería— un temporizador las cierra igual. Ninguna
// animación puede quedarse con el número final ni dejar un botón trabado.
function animarPozo(){
  const el = document.querySelector("#v-pozo .monto");
  if(!el) return;
  const total = totalPozo();
  const fin = () => { el.textContent = plata(total); };
  if(quieto() || total <= 0){ fin(); return; }
  const dur = 1100, t0 = performance.now();
  let vivo = true;
  const red = setTimeout(() => { vivo = false; fin(); }, dur + 500);
  (function paso(t){
    if(!vivo) return;
    const p = Math.min(1, (t - t0) / dur);
    el.textContent = plata(Math.round(total * (1 - Math.pow(1 - p, 3))));
    if(p < 1) requestAnimationFrame(paso);
    else { clearTimeout(red); vivo = false; fin(); }
  })(t0);
}

// Los nombres pasan cada vez más lento hasta frenar en el que salió.
function ruleta(slot, pool, elegido){
  return new Promise(listo => {
    const fin = () => { slot.textContent = elegido; listo(); };
    if(quieto() || pool.length < 2) return fin();
    const t0 = performance.now(), dur = 1400;
    let ultimo = 0, vivo = true;
    const red = setTimeout(() => { vivo = false; fin(); }, dur + 500);
    (function paso(t){
      if(!vivo) return;
      const p = (t - t0) / dur;
      if(p >= 1){ clearTimeout(red); vivo = false; return fin(); }
      if(t - ultimo > 55 + 260 * p * p){
        slot.textContent = pool[Math.floor(Math.random() * pool.length)];
        ultimo = t;
      }
      requestAnimationFrame(paso);
    })(t0);
  });
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
  if(b.dataset.v === "pozo") animarPozo();
});

/* ====== swipe entre pestañas ====== */
// Se descarta cualquier gesto que sea más vertical que horizontal, para no
// robarle el scroll a la página, y los que arrancan sobre un campo de texto.
(function swipe(){
  const pestanas = [...document.querySelectorAll("nav button")];
  let x0 = 0, y0 = 0, valido = false;
  addEventListener("touchstart", e => {
    if(e.touches.length !== 1){ valido = false; return; }
    const el = e.target instanceof Element ? e.target : null;
    if(el && el.closest("input, textarea, .chips")){ valido = false; return; }
    x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; valido = true;
  }, {passive:true});
  addEventListener("touchend", e => {
    if(!valido) return;
    valido = false;
    const t = e.changedTouches[0];
    const dx = t.clientX - x0, dy = t.clientY - y0;
    if(Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    const i = pestanas.findIndex(b => b.classList.contains("on"));
    const destino = pestanas[i + (dx < 0 ? 1 : -1)];
    if(destino) destino.click();
  }, {passive:true});
})();

document.addEventListener("click", async e => {
  // El dedo cae donde cae: sobre el svg del tacho, sobre la × de un chip, sobre
  // el texto de un botón. Subimos al elemento que lleva la acción antes de
  // decidir nada, porque e.target solo por casualidad es el botón.
  const t = e.target.closest("button, [data-quitar]");
  if(!t) return;

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

  /* --- sorteo de capitanes --- */
  if(t.dataset.quitar){                       // sacar un invitado de la lista
    const j = t.dataset.quitar;
    invitados = invitados.filter(n => n !== j);
    vinieron  = vinieron.filter(n => n !== j);
    yaFueron  = yaFueron.filter(n => n !== j);
    caps      = caps.filter(n => n !== j);
    guardarLocal(); repintar("v-sorteo", vSorteo); return;
  }
  if(t.dataset.vino){
    const j = t.dataset.vino;
    if(vinieron.includes(j)) vinieron = vinieron.filter(n => n !== j);
    else if(vinieron.length < POR_FECHA) vinieron = vinieron.concat(j);
    else return;                              // entran diez, y no hay más que decir
    guardarLocal(); repintar("v-sorteo", vSorteo); return;
  }
  if(t.id === "btnInvitado"){
    const campo = document.getElementById("nuevoInv");
    const nombre = campo.value.trim();
    if(!nombre) return;
    if(!plantelDelDia().includes(nombre)) invitados = invitados.concat(nombre);
    if(!vinieron.includes(nombre) && vinieron.length < POR_FECHA) vinieron = vinieron.concat(nombre);
    campo.value = "";
    guardarLocal(); repintar("v-sorteo", vSorteo); return;
  }
  if(t.id === "btnOtraRonda"){
    caps = []; repintar("v-sorteo", vSorteo); return;
  }
  if(t.id === "btnReiniciar"){
    yaFueron = []; caps = [];
    guardarLocal(); repintar("v-sorteo", vSorteo); return;
  }
  if(t.id === "btnSortear"){
    if(sorteando || caps.length >= 2) return;
    const i = caps.length;
    let pool = vinieron.filter(n => !yaFueron.includes(n) && !caps.includes(n));
    if(!pool.length){                         // se agotó la rueda: arranca de nuevo
      yaFueron = caps.slice();
      pool = vinieron.filter(n => !caps.includes(n));
    }
    if(!pool.length) return;
    const elegido = pool[Math.floor(Math.random() * pool.length)];
    sorteando = true;
    t.disabled = true; t.textContent = "Sorteando…";
    const slot = document.querySelectorAll("#v-sorteo .capitan .nom")[i];
    await ruleta(slot, pool, elegido);
    caps = caps.concat(elegido);
    yaFueron = yaFueron.concat(elegido);
    sorteando = false;
    guardarLocal(); repintar("v-sorteo", vSorteo); return;
  }

  /* --- borrar una fecha, desde la pestaña Fechas --- */
  if(t.dataset.borrar){
    confirmar = Number(t.dataset.borrar); editando = null;
    repintar("v-fechas", vFechas); return;
  }
  if(t.dataset.editar){
    const f = fechas.find(x => x.n === Number(t.dataset.editar));
    if(!f) return;
    confirmar = null;
    editando = {n:f.n, golesA:f.golesA, golesB:f.golesB, goleadores:{...(f.goleadores||{})}};
    repintar("v-fechas", vFechas); revisarEdicion(); return;
  }
  if(t.id === "btnEditarNo"){
    editando = null; repintar("v-fechas", vFechas); return;
  }
  // el más y el menos del editor no repintan: tocan el número y revalidan
  if(t.dataset.eg){
    const j = t.dataset.eg;
    const v = Math.max(0, (editando.goleadores[j]||0) + Number(t.dataset.d));
    editando.goleadores[j] = v;
    const casilla = t.parentElement.querySelector(".v");
    if(casilla) casilla.textContent = v;
    revisarEdicion(); return;
  }
  if(t.id === "btnEditarOk"){
    const gols = {};
    Object.entries(editando.goleadores).forEach(([j,c]) => { if(c > 0) gols[j] = c; });
    const cambio = {n:editando.n, golesA:Number(editando.golesA),
                    golesB:Number(editando.golesB), goleadores:gols};
    t.disabled = true; t.textContent = "Guardando…";
    try{
      await editarFecha(cambio);
      editando = null;
      await leer();
      document.querySelector('nav [data-v="fechas"]').click();
    }catch(err){
      t.disabled = false; t.textContent = "Guardar cambios";
      mostrar("eChequeo", "btnEditarOk", "No se pudo guardar: " + err.message);
    }
    return;
  }
  if(t.dataset.cancelar){
    confirmar = null;
    repintar("v-fechas", vFechas); return;
  }
  if(t.dataset.borrarOk){
    const n = Number(t.dataset.borrarOk);
    t.disabled = true; t.textContent = "Borrando…";
    try{
      await borrarFecha(n);
      confirmar = null;
      await leer();
      document.querySelector('nav [data-v="fechas"]').click();
    }catch(err){
      confirmar = null;
      repintar("v-fechas", vFechas);
      alertaFechas("No se pudo borrar: " + err.message);
    }
    return;
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
    revisarCarga(); return;
  }

  if(t.id === "btnPozo"){
    const nuevo = {...pozo,
      cuota: Math.max(0, Math.round(Number(document.getElementById("pCuota").value) || 0))};
    t.disabled = true;
    try{
      await guardarPozo(nuevo);
      pozo = nuevo;
      form.msg = {t:"ok", x:"Pozo actualizado: " + plata(totalPozo()) + "."};
    }catch(err){
      form.msg = {t:"err", x:"No se pudo guardar el pozo: " + err.message};
    }
    pintar(); verCarga(); return;
  }

  if(t.id === "btnGuardar"){
    const [A,B] = equiposDelForm();
    const gA = Number(document.getElementById("gA").value);
    const gB = Number(document.getElementById("gB").value);
    form.golesA = gA; form.golesB = gB;
    const gols = {};
    Object.entries(form.goleadores).forEach(([j,c]) => { if(c > 0) gols[j] = c; });
    const err = revisar(A, B, gA, gB, gols);
    if(err){ mostrar("chequeo", "btnGuardar", err); return; }
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

});

function alertaFechas(texto){
  const s = document.getElementById("v-fechas");
  s.insertAdjacentHTML("afterbegin", `<div class="aviso err">${texto}</div>`);
}

leerLocal();
pintar();
leer();
