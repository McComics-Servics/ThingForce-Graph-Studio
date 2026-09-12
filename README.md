# ThingForce™ Graph Studio

Aplicación local para convertir cualquier repositorio de código en un grafo consultable por una persona o por un agente de IA mediante MCP. El código, los grafos y las credenciales permanecen en la computadora del usuario.

## Qué incluye

- Dashboard visual multiproyecto.
- Escáner local autónomo para proyectos Ruby, JavaScript, TypeScript, Python, Java, C/C++, C#, Go, Rust, PHP, Swift y otros formatos de texto.
- Búsqueda, trazado de dependencias, análisis de impacto y lectura acotada de código.
- Servidor MCP por `stdio` con nueve herramientas.
- Conexión independiente a GitHub mediante Device Flow.
- Importación de repositorios públicos o privados autorizados por el usuario.
- Selector de carpetas para Windows, macOS y Linux; la ruta también puede escribirse manualmente.

## Privacidad y coste

ThingForce Graph Studio no necesita cuenta de McComicsUp, Supabase, VPS, Cloudflare ni un backend remoto. El servidor escucha únicamente en `127.0.0.1`; no contiene telemetría y no envía grafos o código a McComics.

La GitHub App sólo solicita lectura de contenido y metadatos. Su token se mantiene en la memoria del proceso local y se descarta al desconectar o cerrar el programa. Los repositorios importados se clonan dentro de `workspace/repositories/`, que está excluido de Git.

Consulta [PRIVACIDAD_LOCAL.md](PRIVACIDAD_LOCAL.md) y [PROTOCOLO_IA.md](PROTOCOLO_IA.md).

## Requisitos

- Node.js 20 o posterior.
- Git.
- Python 3 es opcional y mejora el análisis AST de proyectos Python.
- Linux: `zenity` es opcional para el selector gráfico de carpetas.

## Inicio

Windows:

```text
Start-Dashboard.bat
```

macOS o Linux:

```sh
chmod +x Start-Dashboard.command
./Start-Dashboard.command
```

También puede iniciarse manualmente:

```sh
npm install
npm run start:dashboard
```

El supervisor abre:

- Dashboard: `http://127.0.0.1:5173`
- API local: `http://127.0.0.1:3098`

## Analizar un proyecto

### Carpeta local

1. Abre **Proyectos**.
2. Pulsa **Añadir y generar proyecto**.
3. Elige la carpeta o escribe su ruta absoluta.
4. Asigna un nombre y pulsa **Crear proyecto y grafo**.

### GitHub

1. Abre **Proyectos → GitHub independiente**.
2. Pulsa **Conectar GitHub**.
3. Copia el código mostrado y autoriza la aplicación en GitHub.
4. Para repositorios privados, instala [ThingForce Graph](https://github.com/apps/thingforce-graph) únicamente en los repositorios que quieras analizar.
5. Busca el repositorio y pulsa **Analizar**.

El acceso a GitHub no comparte identidad ni sesión con Google o McComicsUp.

## Conectar una IA mediante MCP

Copia `mcp-config.example.json`, reemplaza `RUTA_ABSOLUTA` por la ruta real de esta carpeta y agrega ese bloque a la configuración MCP de tu cliente. Reinicia el cliente y llama primero a `graph_projects`.

Herramientas disponibles:

1. `graph_projects`
2. `graph_search`
3. `graph_trace`
4. `graph_impact`
5. `graph_bridge`
6. `graph_node`
7. `graph_read`
8. `lsp_definition` (Solargraph opcional)
9. `lsp_references` (Solargraph opcional)

## Desarrollo y pruebas

```sh
npm ci
npm test
npm run lint
npm run build
```

Los archivos `config/projects.json`, `workspace/` y `public/projects/` contienen datos locales y nunca deben publicarse.

© 2026 McComicsUp. Todos los derechos reservados.
