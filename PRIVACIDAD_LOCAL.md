# Privacidad local

ThingForce Graph Studio aplica una arquitectura local-first:

- no registra cuentas de McComicsUp;
- no usa Supabase, VPS, Cloudflare, analítica ni telemetría;
- no transmite el código ni los grafos a servidores de McComics;
- escucha únicamente en `127.0.0.1`;
- conserva la lista de proyectos en `config/projects.json` dentro del equipo;
- guarda los clones de GitHub en `workspace/repositories/` dentro del equipo;
- mantiene el token GitHub sólo en memoria y nunca lo devuelve al navegador;
- descarta la autorización al cerrar el proceso o pulsar **Desconectar**.

El usuario decide qué carpetas registra y qué repositorios autoriza en GitHub. No debe publicarse el puerto 3098 mediante túneles, reenvío de puertos o una interfaz de red.
