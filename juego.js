/* ====== La Torre · experimento ======
   Vive aparte a propósito: si no prende, se borran juego.js, juego.css y las
   tres líneas del index.html, y la app queda como estaba. app.js no sabe que
   esto existe; de acá se toman la lista del plantel, los avatares y la conexión
   a Supabase, que ya están armados ahí.

   La mecánica: un bloque se desliza sobre la pila y hay que soltarlo alineado.
   Lo que sobresale se cae, y el bloque nuevo queda del ancho que se solapó. La
   dificultad no está programada: la torre se angosta porque uno la angostó.
   Lo único que sube solo es la velocidad. */

const TORRE = {
  ALTO: 20,        // alto de cada bloque, en px
  VISIBLES: 12,    // bloques a la vista antes de que la cámara empiece a bajar
  // Por encima del 50% del área es imposible perder: dos bloques de ese ancho
  // siempre se cruzan, no importa dónde se suelten. Los primeros serían de
  // regalo, así que el primero arranca abajo de la mitad.
  ANCHO0: 45,      // ancho del primero, en % del área
  PERFECTO: 1.2,   // desvío que todavía cuenta como perfecto, en %
  V0: 0.62,        // velocidad inicial, en % por cuadro de 60fps
  VMAX: 2.4,
  MINIMO: 1.5      // por debajo de esto no queda dónde apoyar
};

const LLAVE_TORRE = "fulbito.torre";
let torre = null;                        // la partida en curso
let yoSoy = "";                          // quién juega en este teléfono
let miMejor = {altura:0, perfectos:0};
let records = [];                        // la tabla del grupo
let cuadro = null;                       // el requestAnimationFrame en vuelo

/* ====== lo que queda en el teléfono ====== */
function leerTorre(){
  try{
    const d = JSON.parse(localStorage.getItem(LLAVE_TORRE) || "{}");
    yoSoy = typeof d.yo === "string" ? d.yo : "";
    miMejor = {altura: d.altura || 0, perfectos: d.perfectos || 0};
    // el que eligió un nombre que ya no está en el plantel vuelve a elegir
    if(yoSoy && !plantelDelDia().includes(yoSoy)) yoSoy = "";
  }catch(e){ /* almacenamiento bloqueado: se juega igual, sin récord */ }
}
function guardarTorre(){
  try{
    localStorage.setItem(LLAVE_TORRE,
      JSON.stringify({yo:yoSoy, altura:miMejor.altura, perfectos:miMejor.perfectos}));
  }catch(e){ /* idem */ }
}

/* ====== la tabla del grupo ======
   Si la tabla no existe todavía —el SQL no se corrió— no es un error que haya
   que mostrarle a nadie: el juego anda igual con el récord del teléfono. */
async function leerRecords(){
  if(!configurado) return;
  try{
    const r = await fetch(
      API + "torre_records?select=*&order=altura.desc,perfectos.desc,creado.asc",
      {headers:cabeceras()});
    if(!r.ok) throw new Error("HTTP " + r.status);
    records = await r.json();
  }catch(e){ records = []; }
  pintarTabla();
}
async function subirRecord(){
  if(!configurado || !yoSoy) return;
  try{
    await rpc("guardar_record",
      {p_jugador:yoSoy, p_altura:miMejor.altura, p_perfectos:miMejor.perfectos});
    await leerRecords();
  }catch(e){ /* el récord local ya quedó; la tabla se pone al día la próxima */ }
}

/* ====== la partida ====== */
function nuevaTorre(){
  return {pila:[{x:(100 - TORRE.ANCHO0)/2, w:TORRE.ANCHO0}],
          actual:null, altura:0, perfectos:0, racha:0, vivo:true};
}
function velocidad(){ return Math.min(TORRE.VMAX, TORRE.V0 + torre.altura * 0.055); }

function proximoBloque(){
  const ult = torre.pila[torre.pila.length - 1];
  const porIzquierda = torre.altura % 2 === 0;
  torre.actual = {x: porIzquierda ? 0 : 100 - ult.w, w: ult.w, dir: porIzquierda ? 1 : -1};
}

// El bloque rebota entre los dos bordes. dt se mide contra un cuadro de 60fps:
// en una pantalla de 120Hz el bloque va a la misma velocidad, no al doble.
function mover(dt){
  const a = torre.actual, v = velocidad() * (dt / 16.67);
  a.x += v * a.dir;
  if(a.x + a.w >= 100){ a.x = 100 - a.w; a.dir = -1; }
  if(a.x <= 0){ a.x = 0; a.dir = 1; }
}

function soltar(){
  if(!torre || !torre.vivo || !torre.actual) return;
  const ult = torre.pila[torre.pila.length - 1], a = torre.actual;
  const izq = Math.max(a.x, ult.x), der = Math.min(a.x + a.w, ult.x + ult.w);
  const solape = der - izq;

  if(solape <= TORRE.MINIMO){                 // no quedó dónde apoyar
    caer(a.x, a.w);
    return perder();
  }
  if(Math.abs(a.x - ult.x) <= TORRE.PERFECTO){
    torre.pila.push({x:ult.x, w:ult.w});      // perfecto: no se angosta
    torre.perfectos++; torre.racha++;
    destello();
  }else{
    if(a.x < ult.x) caer(a.x, izq - a.x);     // el pedazo que sobresalió
    else            caer(der, (a.x + a.w) - der);
    torre.pila.push({x:izq, w:solape});
    torre.racha = 0;
  }
  torre.altura++;
  torre.actual = null;
  dibujarPila();
  proximoBloque();
  dibujarActual();
}

function perder(){
  torre.vivo = false;
  torre.actual = null;
  const el = document.getElementById("torreActual");
  if(el) el.style.display = "none";
  if(cuadro){ cancelAnimationFrame(cuadro); cuadro = null; }
  const mejoro = torre.altura > miMejor.altura;
  if(mejoro){
    miMejor = {altura:torre.altura, perfectos:torre.perfectos};
    guardarTorre();
  }
  torre.record = mejoro;
  pintarVelo();
  if(mejoro) subirRecord();
}

/* ====== dibujo ======
   La pila se redibuja solo cuando se apoya un bloque. Entre bloque y bloque se
   mueve un único elemento. Todo cuelga de la cámara, que baja a medida que la
   torre sube, así que el bloque que cae acompaña sin cuentas aparte. */
function color(i){ return `hsl(${(212 + i * 9) % 360} 44% ${33 + (i % 3) * 5}%)`; }

function dibujarPila(){
  const pila = document.getElementById("torrePila");
  if(!pila) return;
  pila.innerHTML = torre.pila.map((b,i) =>
    `<i style="bottom:${i * TORRE.ALTO}px;left:${b.x}%;width:${b.w}%;background:${color(i)}"></i>`
  ).join("");
  const camara = document.getElementById("torreCamara");
  const sobra = Math.max(0, torre.pila.length - TORRE.VISIBLES);
  if(camara) camara.style.transform = `translateY(${sobra * TORRE.ALTO}px)`;
  const alt = document.getElementById("torreAltura");
  if(alt) alt.textContent = torre.altura;
  const r = document.getElementById("torreRacha");
  if(r) r.textContent = torre.racha > 1 ? torre.racha + " seguidos" : "";
}

function dibujarActual(){
  const el = document.getElementById("torreActual");
  if(!el || !torre.actual) return;
  const a = torre.actual;
  el.style.bottom = (torre.pila.length * TORRE.ALTO) + "px";
  el.style.left = a.x + "%";
  el.style.width = a.w + "%";
  el.style.background = color(torre.pila.length);
  el.style.display = "block";
}

function caer(x, w){
  const area = document.getElementById("torreCaidos");
  if(!area) return;
  const el = document.createElement("i");
  el.style.cssText = `bottom:${torre.pila.length * TORRE.ALTO}px;left:${x}%;` +
                     `width:${w}%;background:${color(torre.pila.length)}`;
  area.appendChild(el);
  setTimeout(() => el.remove(), 900);
}

function destello(){
  const el = document.getElementById("torreArea");
  if(!el) return;
  el.classList.remove("perfecto");
  void el.offsetWidth;                 // reinicia la animación
  el.classList.add("perfecto");
}

/* ====== el bucle ======
   Se corta solo si la pestaña deja de estar a la vista: nadie quiere un
   requestAnimationFrame girando mientras se mira la tabla. */
function visible(){
  const s = document.getElementById("v-torre");
  return Boolean(s && s.classList.contains("on"));
}
function bucle(t){
  if(!torre || !torre.vivo || !visible()){ cuadro = null; return; }
  if(torre.actual){
    // una pestaña que vuelve de segundo plano no adelanta medio metro
    const dt = Math.min(50, t - (bucle.ultimo || t));
    bucle.ultimo = t;
    mover(dt);
    dibujarActual();
  }
  cuadro = requestAnimationFrame(bucle);
}
function arrancarBucle(){
  if(cuadro || !torre || !torre.vivo) return;
  bucle.ultimo = 0;
  cuadro = requestAnimationFrame(bucle);
}

function jugar(){
  torre = nuevaTorre();
  pintarVelo();
  dibujarPila();
  proximoBloque();
  dibujarActual();
  arrancarBucle();
}

/* ====== vistas ======
   El área se arma una sola vez y no se vuelve a tocar: si se reescribiera
   entera en cada repintado, la partida en curso se borraría sola. Lo único
   que cambia es el velo de adelante y la tabla de abajo. */
function montarTorre(){
  const s = document.getElementById("v-torre");
  if(!s || s.dataset.listo) return;
  s.dataset.listo = "1";
  s.innerHTML = `
    <div class="torre-area" id="torreArea">
      <div class="torre-hud"><b id="torreAltura">0</b><span id="torreRacha"></span></div>
      <div class="torre-camara" id="torreCamara">
        <div class="torre-pila" id="torrePila"></div>
        <i class="torre-actual" id="torreActual"></i>
        <div class="torre-caidos" id="torreCaidos"></div>
      </div>
      <div class="torre-velo" id="torreVelo"></div>
    </div>
    <div id="torreTabla"></div>`;
}

function pintarVelo(){
  const velo = document.getElementById("torreVelo");
  if(!velo) return;

  if(!yoSoy){
    velo.className = "torre-velo on";
    velo.innerHTML = `<h3>¿Quién sos?</h3>
      <p>Una vez, y queda en este teléfono. Es para la tabla del grupo, no es una cuenta.</p>
      <div class="chips">${plantelDelDia().map(n =>
        `<button class="chip" data-yo="${n}">${n}</button>`).join("")}</div>`;
    return;
  }
  if(!torre){
    velo.className = "torre-velo on";
    velo.innerHTML = `<h3>La Torre</h3>
      <p>Soltá el bloque alineado con el de abajo. Lo que sobresale se cae y la
         torre se angosta. Cuando no queda dónde apoyar, se terminó.</p>
      <button class="primario" id="btnJugar">Jugar</button>
      ${miMejor.altura ? `<p class="hint">Tu récord: ${miMejor.altura}</p>` : ""}
      <p class="hint torre-yo">Jugás como <b>${yoSoy}</b> · <button
         class="torre-cambiar" data-cambiar="1">cambiar</button></p>`;
    return;
  }
  if(!torre.vivo){
    velo.className = "torre-velo on fin";
    velo.innerHTML = `<div class="rot">${torre.record ? "¡Récord!" : "Altura"}</div>
      <div class="torre-final">${torre.altura}</div>
      <p class="hint">${torre.perfectos} ${torre.perfectos === 1 ? "perfecto" : "perfectos"}${
        torre.record ? "" : ` · tu récord sigue siendo ${miMejor.altura}`}</p>
      <button class="primario" id="btnJugar">Otra vez</button>
      <button class="secundario" id="btnDesafiar">Desafiar al grupo</button>`;
    return;
  }
  velo.className = "torre-velo";
  velo.innerHTML = "";
}

function pintarTabla(){
  const caja = document.getElementById("torreTabla");
  if(!caja) return;
  if(!records.length){
    caja.innerHTML = `<p class="hint torre-nota">La tabla del grupo aparece cuando
      alguien deja su marca. El récord de este teléfono se guarda igual.</p>`;
    return;
  }
  caja.innerHTML = `<div class="campo" style="margin-top:22px">
      <label>Récords del grupo</label>
      ${records.map((r,i) => `<div class="torre-fila${r.jugador === yoSoy ? " yo" : ""}">
        <div class="n">${i+1}</div>
        ${avatar(r.jugador)}
        <div class="id"><div class="nm">${r.jugador}</div>
          <div class="mini">${r.perfectos} ${r.perfectos === 1 ? "perfecto" : "perfectos"}</div></div>
        <div class="c">${r.altura}</div>
      </div>`).join("")}
    </div>`;
}

function pintarTorre(){ montarTorre(); pintarVelo(); pintarTabla(); }

/* ====== desafiar al grupo ======
   No manda nada a ningún lado: copia el texto y el que juega lo pega donde
   quiera. El desafío es el número, porque el juego es el mismo para todos. */
async function desafiar(btn){
  const texto = `Llegué a ${torre.altura} en La Torre. A ver vos: ` + location.href;
  try{
    await navigator.clipboard.writeText(texto);
    btn.textContent = "Copiado, pegalo en el grupo";
  }catch(e){
    btn.textContent = texto;          // sin permiso de portapapeles, a mano
    btn.classList.add("torre-texto");
  }
}

/* ====== eventos ====== */
document.addEventListener("pointerdown", e => {
  const area = e.target.closest("#torreArea");
  if(!area) return;
  if(e.target.closest(".torre-velo") || e.target.closest("button")) return;
  soltar();
});
document.addEventListener("keydown", e => {
  if(e.code === "Space" && visible() && torre && torre.vivo){ e.preventDefault(); soltar(); }
});
document.addEventListener("click", e => {
  const t = e.target.closest("button");
  if(!t) return;
  if(t.dataset.yo){
    yoSoy = t.dataset.yo; guardarTorre(); pintarTorre(); return;
  }
  if(t.dataset.cambiar){
    yoSoy = ""; guardarTorre(); pintarVelo(); return;
  }
  if(t.id === "btnJugar"){ jugar(); return; }
  if(t.id === "btnDesafiar"){ desafiar(t); return; }
});
// Volver a la pestaña con una partida a medio jugar la retoma donde quedó.
document.querySelectorAll('nav [data-v="torre"]').forEach(b =>
  b.addEventListener("click", () => { pintarTorre(); arrancarBucle(); }));

leerTorre();
pintarTorre();
leerRecords();
