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
let editando = null;            // {n, golesA, golesB} de la fecha en corrección
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
          golesA:f.goles_a, golesB:f.goles_b};
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
// p_goleadores viaja vacío: la columna sigue en la base y en la firma de la
// función, pero ya no se cuenta quién hizo cada gol.
async function cargarFecha(f){
  return await rpc("cargar_fecha", {
    p_clave:clave, p_dia:f.dia, p_equipo_a:f.equipoA, p_equipo_b:f.equipoB,
    p_goles_a:f.golesA, p_goles_b:f.golesB, p_goleadores:{}});
}
async function editarFecha(e){
  return await rpc("editar_fecha", {p_clave:clave, p_n:e.n,
    p_goles_a:e.golesA, p_goles_b:e.golesB, p_goleadores:{}});
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
    // El invitado que pasó a ser del plantel deja de ser invitado, o queda con
    // dos chips iguales en el sorteo y nadie entiende cuál tocar. Y lo que quedó
    // marcado se reapunta al nombre bueno: un "fede" suelto no tiene chip que
    // tocar, pero entraría igual a la carga como un jugador aparte.
    invitados = invitados.filter(n => !FIJOS.some(f => igual(f, n)));
    const bueno = n => plantelDelDia().find(x => igual(x, n));
    vinieron = vinieron.map(bueno).filter(Boolean);
    yaFueron = yaFueron.map(bueno).filter(Boolean);
  }catch(e){ /* modo incógnito, almacenamiento bloqueado: arranca limpio */ }
}
function guardarLocal(){
  try{
    localStorage.setItem(LLAVE_LOCAL, JSON.stringify({vinieron, invitados, yaFueron}));
  }catch(e){ /* si no se puede guardar, el sorteo igual funciona en esta sesión */ }
}
function plantelDelDia(){ return FIJOS.concat(invitados); }
// Dos nombres son el mismo si solo se diferencian en mayúsculas o acentos.
function igual(a, b){
  const pelado = t => t.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
  return pelado(a) === pelado(b);
}

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
// El plantel más cualquiera que haya jugado una fecha. Un invitado que vino un
// sábado puso la cuota como todos, así que compite como todos: entra a la tabla
// con su única fecha y queda abajo, sin ensuciar la punta.
function participantes(){
  const todos = new Set(FIJOS);
  fechas.forEach(f => f.equipoA.concat(f.equipoB).forEach(n => todos.add(n)));
  return [...todos];
}
function tabla(){
  const t = {};
  participantes().forEach(j => t[j] = {j, pj:0, g:0, e:0, p:0, gf:0, gc:0, pts:0});
  fechas.forEach(f => {
    [["A","B"],["B","A"]].forEach(([yo,rival]) => {
      const gf = f["goles"+yo], gc = f["goles"+rival];
      f["equipo"+yo].forEach(n => {
        const r = t[n];
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
// Cada presencia en una fecha pone la cuota, y eso es todo el pozo. Sin ajustes
// a mano: un número que nadie puede reconstruir mirando las fechas no sirve.
function presencias(f){ return f.equipoA.length + f.equipoB.length; }
function totalPozo(){
  return fechas.reduce((s,f) => s + presencias(f), 0) * pozo.cuota;
}

/* ====== qué hace válida a una fecha ====== */
// Una fecha es los dos equipos y el marcador, y nada más. Antes el chequeo de
// que los goles cerraran tapaba un hueco: un campo vacío vale 0 para Number, y
// 0 a 0 es un resultado posible. Ahora que el marcador es el único dato, se
// pide explícitamente que estén los dos.
function revisar(A, B, gA, gB){
  if(!A.length || !B.length) return "Faltan jugadores en alguno de los dos equipos.";
  const numero = v => String(v).trim() === "" ? NaN : Number(v);
  const a = numero(gA), b = numero(gB);
  if(!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < 0)
    return "Cargá los dos marcadores, con números.";
  return null;
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
      : (editando && editando.n === f.n ? editor() : "");

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
      ${pie}
    </div>`;
  }).join("");
}

// El editor corrige el resultado, que es todo lo que hay para corregir. Los
// equipos no se tocan: si están mal, la fecha se borra y se carga de nuevo.
function editor(){
  return `<div class="editor">
      <div class="marcador">
        <input type="number" id="eGA" inputmode="numeric" value="${editando.golesA}">
        <span>a</span>
        <input type="number" id="eGB" inputmode="numeric" value="${editando.golesB}">
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

// Las reglas viven acá una sola vez: de esta lista salen la pestaña Reglas y
// las respuestas del buscador. "claves" son las palabras con las que la gente
// pregunta lo mismo — plata, guita, cuánto sale — y que no están en el texto.
function reglas(){
  return [
    {t:"Qué es esto",
     d:"Un torneo de " + TOTAL_FECHAS + " fechas donde el que compite es el jugador, no el equipo. " +
       "Los equipos se rearman todos los sábados, pero los puntos quedan pegados a la persona. " +
       "Campeón es el que más puntos junta en toda la temporada.",
     c:"torneo objetivo campeon ganador gana premio funciona sirve trata temporada apertura individual"},
    {t:"Cuándo",
     d:TOTAL_FECHAS + " fechas, los sábados. Cancha y horario a definir.",
     c:"cuando dia dias horario hora cancha donde lugar juega jugar juego sabado sabados empieza arranca termina cierra duracion"},
    {t:"Quién juega",
     d:"Se anota en el grupo de WhatsApp. Entran los primeros " + POR_FECHA + " por orden de anotación. " +
       "Si falta gente se puede traer a alguien de afuera: se lo suma en el sorteo y compite como " +
       "cualquiera —pone la cuota y se lleva los puntos de las fechas que juegue—.",
     c:"anotar anotarse anote lista whatsapp grupo cupo lugares entra entro tarde primeros orden viene vienen venir juega juegan invitado invitados sobra falta faltar gente sumar sumo traer llevar amigo hermano primo ajeno afuera desconocido nuevo"},
    {t:"El partido",
     d:"Fútbol 5. Los dos capitanes salen del sorteo que se hace en la app, y después " +
       "reparten los equipos por WhatsApp. El que sale primero elige primero.",
     c:"partido futbol cinco equipos capitan capitanes sorteo sortear reparto armado dividir eleccion elegir elige primero"},
    {t:"Los puntos",
     d:"Cada fecha te deja 3 puntos si ganás, 1 si empatás y 0 si perdés. Son tuyos y no " +
       "del equipo: la semana que viene jugás con otros y te los llevás igual. " +
       "Si dos terminan con los mismos puntos, desempata la diferencia de gol, después " +
       "los goles a favor y después los partidos ganados.",
     c:"puntos punto gane gano empate empato empatar perdi perder pierdo desempate desempata diferencia tabla posiciones suma cuantos vale"},
    {t:"Los goles",
     d:"No se cuentan por jugador. El marcador es del equipo y es de cada uno de los que " +
       "estuvo adentro: si ganaste 17 a 16, esos 17 son tuyos y esos 16 también te los " +
       "hicieron a vos. En un fútbol 5 nadie puede llevar la cuenta de quién hizo cada gol, " +
       "así que no se intenta. Lo único que hacen los goles es desempatar la tabla.",
     c:"gol goles goleador goleadores artillero anotador hice hizo anote anoto meti convertir conteo contar cuantos marcador resultado favor contra desempate"},
    {t:"El pozo",
     d:"Aparte de lo que sale la cancha, cada uno pone " + plata(pozo.cuota) +
       " por fecha jugada. Se acumula toda la temporada y se ve en la pestaña Pozo.",
     c:"pozo plata guita dinero cuota pagar pago pone cuanto sale cuesta acumulado premio bolsa"},
    {t:"El registro",
     d:"Al terminar se pasa el resultado al grupo y se carga acá: los dos equipos y el " +
       "marcador, nada más. Puede cargar cualquiera que tenga la clave. Lo cargado queda " +
       "firme a las 48 horas.",
     c:"cargar carga anotar resultado clave reclamo reclamar error equivoque corregir editar borrar horas firme planilla mal"}
  ];
}

function vReglas(){
  return reglas().map((r,i) => `<div class="regla"><div class="n">${i+1}</div>
      <p><b>${r.t}</b><small>${r.d}</small></p></div>`).join("") +
    `<div class="consulta">
      <label>¿Te quedó una duda?</label>
      <p class="hint">Escribila y busco en el reglamento.</p>
      <div class="sumar">
        <input type="text" id="duda" placeholder="¿Cuánto suma un empate?"
               autocomplete="off" enterkeyhint="search">
        <button class="secundario" id="btnDuda">Buscar</button>
      </div>
      <div id="respuesta"></div>
    </div>`;
}

// Busca sobre el reglamento, sin inventar nada: si ninguna regla habla del
// tema, lo dice y te manda con Gastón.
const VACIAS = new Set(("que qué como cómo quien quién quienes quiénes " +
  "el la los las un una unos unas de del al a y o u en es son se si no me te " +
  "lo le por para con sin sobre mi tu su hay pasa puedo podemos hace hacer tengo tiene " +
  "vos yo nos nuestro esta este eso esa ese pero mas más muy ya").split(" "));

function pelar(t){
  return t.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
          .replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
}
function buscarEnReglas(pregunta){
  const terminos = pelar(pregunta).filter(p => p.length > 2 && !VACIAS.has(p));
  if(!terminos.length) return [];
  return reglas().map((r,i) => {
    const titulo = pelar(r.t), cuerpo = pelar(r.d), claves = pelar(r.c);
    let punto = 0;
    terminos.forEach(t => {
      // La coincidencia por prefijo sirve para plurales y conjugaciones
      // —gol/goles, empate/empatás— pero pide cuatro letras de las dos partes:
      // sin eso, cualquier palabra que arranque igual da un falso positivo.
      const pega = (lista) => lista.some(p => p.length > 2 && (p === t ||
        (p.length >= 4 && t.length >= 4 && (p.startsWith(t) || t.startsWith(p)))));
      if(pega(titulo)) punto += 3;
      if(pega(claves)) punto += 2;
      if(pega(cuerpo)) punto += 1;
    });
    return {i, r, punto};
  }).filter(x => x.punto > 0).sort((a,b) => b.punto - a.punto);
}
function responder(){
  const campo = document.getElementById("duda");
  const caja = document.getElementById("respuesta");
  if(!campo || !caja) return;
  const hallazgos = buscarEnReglas(campo.value);
  if(!hallazgos.length){
    caja.innerHTML = `<div class="respuesta nada">No encontré eso en el reglamento.
      Preguntale a Gastón.</div>`;
    return;
  }
  // la segunda solo si de verdad compite con la primera
  const corte = hallazgos[0].punto * 0.6;
  const mostrar = hallazgos.filter((h,k) => k === 0 || h.punto >= corte).slice(0, 2);
  caja.innerHTML = mostrar.map((h,k) => `<div class="respuesta${k ? " segunda" : ""}">
      <span class="de">Regla ${h.i+1} · ${h.r.t}</span>
      <p>${h.r.d}</p>
    </div>`).join("");
}

/* ====== carga ====== */
// Los que salieron del sorteo entran directo al equipo A. Un toque los pasa
// al B: el armado se decidió en WhatsApp y acá solo se transcribe.
function nuevoForm(){
  const equipos = {};
  vinieron.forEach(n => equipos[n] = "a");
  return {equipos, golesA:"", golesB:"", msg:null};
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
  // Los invitados están acá como cualquiera: el que vino, vino.
  const habilitados = vinieron.slice();
  if(!habilitados.length){
    return `<div class="vacio">Antes de cargar la fecha hay que marcar quiénes
      vinieron, en la pestaña Sorteo.</div>`;
  }

  const chips = habilitados.map(j => {
    const e = form.equipos[j];
    return `<button class="chip ${e||""}" data-j="${j}">${j}${e ? " " + e.toUpperCase() : ""}</button>`;
  }).join("");
  const sel = habilitados.filter(j => form.equipos[j]);
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

// Los equipos se reconstruyen sobre el plantel del día, no sobre los fijos: si
// no, el invitado se cae justo acá, después de haber pasado por el sorteo y de
// estar en pantalla. Mantiene el orden de la lista y deja a los invitados al final.
function equiposDelForm(){
  const plantel = plantelDelDia();
  return [plantel.filter(j => form.equipos[j] === "a"),
          plantel.filter(j => form.equipos[j] === "b")];
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
  mostrar("chequeo", "btnGuardar", revisar(A, B, gA.value, gB.value));
}
function revisarEdicion(){
  if(!editando) return;
  const gA = document.getElementById("eGA"), gB = document.getElementById("eGB");
  if(!gA || !gB) return;
  editando.golesA = gA.value; editando.golesB = gB.value;
  const f = fechas.find(x => x.n === editando.n);
  if(!f) return;
  mostrar("eChequeo", "btnEditarOk", revisar(f.equipoA, f.equipoB, gA.value, gB.value));
}
document.addEventListener("keydown", e => {
  if(e.key === "Enter" && e.target.id === "duda"){ e.preventDefault(); responder(); }
});
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
    if(form) delete form.equipos[j];   // si la carga estaba abierta, se va de ahí también
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
    const escrito = campo.value.trim();
    if(!escrito) return;
    // Si ya está en la lista, es el mismo aunque lo escriban distinto: "fede" y
    // "Fede" serían dos jugadores en la tabla, con la mitad de los puntos cada uno.
    const nombre = plantelDelDia().find(n => igual(n, escrito)) || escrito;
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
    editando = {n:f.n, golesA:f.golesA, golesB:f.golesB};
    repintar("v-fechas", vFechas); revisarEdicion(); return;
  }
  if(t.id === "btnEditarNo"){
    editando = null; repintar("v-fechas", vFechas); return;
  }
  if(t.id === "btnEditarOk"){
    const cambio = {n:editando.n, golesA:Number(editando.golesA),
                    golesB:Number(editando.golesB)};
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
    else delete form.equipos[j];
    form.golesA = document.getElementById("gA").value;
    form.golesB = document.getElementById("gB").value;
    form.msg = null; repintarCarga(); return;
  }
  if(t.id === "btnDuda"){ responder(); return; }

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
    const crudoA = document.getElementById("gA").value;
    const crudoB = document.getElementById("gB").value;
    const err = revisar(A, B, crudoA, crudoB);
    if(err){ mostrar("chequeo", "btnGuardar", err); return; }
    const gA = Number(crudoA), gB = Number(crudoB);
    form.golesA = gA; form.golesB = gB;
    const hoy = new Date();
    const nueva = {equipoA:A, equipoB:B, golesA:gA, golesB:gB,
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
