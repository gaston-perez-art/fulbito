# Apertura 2026 — Fútbol en Familia

Tabla de posiciones y goleadores del torneo del grupo. Fútbol 5, sábados a las 18,
12 fechas del 12/09 al 28/11.

La unidad que compite es el jugador, no el equipo: los equipos se rearman cada
fecha y los puntos quedan pegados a la persona.

**Sitio:** https://gaston-perez-art.github.io/fulbito/

## Cómo cargar una fecha

1. Entrar al sitio y tocar el candado en la barra de arriba.
2. Poner la clave de carga (la tiene el encargado de la planilla).
3. Tocar el nombre de cada jugador: una vez lo pone en el equipo A, dos veces en
   el B, tres lo saca. Solo aparecen los 13 fijos; los invitados juegan pero no
   puntúan.
4. Cargar el marcador y, abajo, los goles de cada uno.
5. Guardar. Queda visible para todo el grupo al instante.

Si te equivocaste, **Borrar la última fecha cargada** la deshace. El cuadro de
Respaldo copia todo el torneo como texto: sirve para guardarlo aparte y para
restaurarlo si algo se rompe.

## Cómo está armado

Sin build, sin dependencias, sin framework. Cuatro archivos:

| Archivo        | Qué tiene                                              |
|----------------|--------------------------------------------------------|
| `index.html`   | Estructura y cabecera                                   |
| `estilos.css`  | Todo el diseño                                          |
| `app.js`       | Cálculo de tabla y goleadores, vistas, capa de datos    |
| `config.js`    | URL y anon key del proyecto de Supabase                 |
| `supabase.sql` | Esquema, RLS y funciones de carga                       |

Los datos viven en Supabase y se leen por REST (`fetch` contra PostgREST), sin
la librería `supabase-js`: son cuatro llamadas y no justifica sumar una
dependencia a un sitio que se despliega copiando archivos.

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
2. Abrir `supabase.sql`, cambiar `'cambiar-esta-clave'` por la clave de carga
   real y correr el archivo entero en el **SQL Editor**.
3. En *Project Settings → API* copiar la **Project URL** y la **anon public key**
   y pegarlas en `config.js`.

Para cambiar la clave más adelante, correr solo esto en el SQL Editor:

```sql
update public.torneo_config
set clave_hash = extensions.crypt('la-clave-nueva', extensions.gen_salt('bf'))
where id = 1;
```

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
