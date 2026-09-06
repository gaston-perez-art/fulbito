/* Conexión a Supabase.
   La anon key es pública por diseño: va en el repo y en el navegador de todos.
   Lo que la hace segura son las políticas RLS de supabase.sql — lectura abierta,
   escritura solo por las funciones que validan la clave de carga.
   Si alguno de los dos valores queda vacío, el sitio muestra el aviso de "sin conexión". */
window.CONFIG = {
  url: "",   // https://xxxxxxxxxxxx.supabase.co
  key: ""    // anon public key
};
