# Referencia rápida

| Servicio | Dirección local |
|---|---|
| Dashboard | `http://127.0.0.1:5173` |
| API | `http://127.0.0.1:3098` |
| Proyectos | `http://127.0.0.1:3098/api/projects` |
| OpenAPI | `http://127.0.0.1:3098/openapi.json` |

Orden recomendado para una IA:

```text
projects → search → trace → impact → read/node/bridge → editar → regenerar → probar
```

Ejemplo de llamada MCP/HTTP local:

```json
{
  "tool": "graph_search",
  "args": {
    "projectId": "mi-proyecto",
    "query": "calculate total",
    "limit": 20
  }
}
```
