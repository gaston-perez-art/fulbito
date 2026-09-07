# Apertura 2026 — Fútbol en Familia

Tabla de posiciones y goleadores del torneo del grupo. Fútbol 5, sábados a las 18,
12 fechas del 12/09 al 28/11.

La unidad que compite es el jugador, no el equipo: los equipos se rearman cada
fecha y los puntos quedan pegados a la persona.

**Sitio:** https://gaston-perez-art.github.io/fulbito/

## Cómo cargar una fecha

1. Antes de jugar, en **Sorteo**, marcar quiénes vienen. Entran diez.
2. Al terminar: candado, clave, y los diez ya aparecen en el equipo A.
   Un toque pasa a cada uno al B, según cómo quedaron repartidos.
3. Cargar el marcador y los goles de cada uno.
4. Guardar. Queda visible para todo el grupo al instante.

Solo se puede cargar a quien pasó por el sorteo: si no jugó, no puede sumar
puntos. Para deshacer, cada fecha tiene un tachito en su tarjeta, en la pestaña
Fechas, visible solo con la clave puesta. Borrar una fecha se lleva sus puntos y
sus goles, y las que siguen se renumeran solas.

## Sorteo de capitanes

Antes del partido: se marca quiénes vienen —hasta diez— y salen los dos capitanes
de a uno. El primero que sale elige primero; el reparto se resuelve por WhatsApp.
El que ya fue capitán queda afuera del sorteo hasta que hayan pasado todos, y ahí
la rueda se reinicia sola.

No pide clave: el sorteo pasa en la cancha y pedir clave ahí es fricción. El costo
es que la lista de los que vienen y el historial de capitanes viven en el
`localStorage` del teléfono que sortea, no en la base.

## El pozo

Cada jugador pone una cuota por fecha jugada, aparte de la cancha. El total se
calcula solo: presencias cargadas × cuota. No se lleva a mano y no hay ajustes,
así que cualquiera puede reconstruir el número mirando las fechas. La cuota se
edita desde la pantalla de carga, con la clave.

## Cómo está armado

Sin build, sin dependencias, sin framework. Cuatro archivos:

| Archivo        | Qué tiene                                              |
|----------------|--------------------------------------------------------|
| `index.html`   | Estructura y cabecera                                   |
| `estilos.css`  | Todo el diseño                                          |
| `app.js`       | Cálculo de tabla y goleadores, vistas, capa de datos    |
| `jugadores.js` | El plantel y las fotos                                  |
| `manifest.json`| Nombre e íconos para agregarlo a la pantalla de inicio   |
| `config.js`    | URL y anon key del proyecto de Supabase                 |
| `supabase.sql` | Esquema, RLS y funciones de carga                       |

Los datos viven en Supabase y se leen por REST (`fetch` contra PostgREST), sin
la librería `supabase-js`: son cuatro llamadas y no justifica sumar una
dependencia a un sitio que se despliega copiando archivos.

## Fotos de los jugadores

El que no tiene foto muestra la inicial del nombre sobre un color derivado del
nombre mismo, así que cada uno queda con el suyo y no cambia nunca. Para poner
una foto de verdad: la imagen cuadrada en `fotos/`, y en `jugadores.js`

```js
{nombre:"Gastón", foto:"fotos/gaston.jpg"}
```

No hace falta que estén todas: conviven fotos e iniciales sin que se note.

## Levantarlo local

Cualquier servidor estático sirve. Abrir el `index.html` con doble clic también
funciona, pero un servidor evita sorpresas con las fuentes:

```
cd fulbito
python3 -m http.server 8080
# http://localhost:8080
```

## Montar la base (una sola vez)

1. Crear un proyecto en [supabase.com](https://supabase.com) (plan free).
2. Correr `supabase.sql` entero en el **SQL Editor**. Tal cual está, sin editar nada.
3. Definir la clave de carga con una segunda consulta, cambiando solo el texto
   entre comillas. La misma consulta sirve para cambiarla más adelante:

   ```sql
   insert into public.torneo_config (id, clave_hash)
   values (1, extensions.crypt('la-clave-del-torneo', extensions.gen_salt('bf')))
   on conflict (id) do update set clave_hash = excluded.clave_hash;
   ```

   Hasta que se corra esto, nadie puede escribir: `verificar_clave` devuelve
   false para cualquier clave.
4. En *Project Settings → API* copiar la **Project URL** y la **anon public key**
   y pegarlas en `config.js`.

### Por qué la anon key puede estar en un repo público

Está diseñada para viajar en el navegador de cualquiera: no es un secreto, es un
identificador de proyecto. Lo que protege la base son las políticas de RLS de
`supabase.sql`:

- `fechas` tiene lectura abierta y **ni insert, ni update, ni delete** para `anon`.
- La única forma de escribir es llamando a `cargar_fecha`, `borrar_ultima` o
  `reemplazar_todo`, que son `SECURITY DEFINER` y validan la clave del lado del
  servidor contra un hash bcrypt.
- Ese hash vive en `torneo_config`, una tabla con RLS activo y sin ninguna
  política: con la anon key no se lee ni se escribe.

La clave de carga nunca está en el repo ni en el JavaScript: se escribe en el
teléfono del encargado y se manda al servidor para validarla.

### Un detalle del plan free

Los proyectos gratis se pausan tras 7 días sin actividad de base de datos y hay
que reactivarlos a mano desde el panel. Con el grupo consultando la tabla durante
la semana el contador se reinicia solo; el riesgo aparece si se suspende un
sábado y nadie abre el sitio.

## Reglamento

Está en la pestaña **Reglas** del sitio, que se arma desde `vReglas()` en
`app.js`. Ahí se cambia si se cambia una regla.
