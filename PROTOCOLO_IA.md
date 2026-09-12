# Protocolo operativo para agentes de IA

## Límite de seguridad

La API y el dashboard son locales. No expongas `127.0.0.1:3098` a Internet ni uses túneles. El registro, generación, borrado, selector de carpetas y apertura de archivos son operaciones administrativas locales.

## Secuencia obligatoria

1. Ejecuta `graph_projects`.
2. Confirma con el usuario el `projectId` correcto si existe más de uno.
3. Usa `graph_search` para localizar evidencia.
4. Usa `graph_trace` y `graph_impact` antes de una modificación.
5. Usa `graph_read`, `graph_node` y `graph_bridge` cuando corresponda.
6. Realiza el cambio mínimo autorizado.
7. Regenera el grafo y ejecuta las pruebas propias del proyecto.

No asumas nombres ni rutas. No presentes coincidencias textuales como prueba semántica. El grafo es un índice derivado; el código del proyecto continúa siendo la autoridad.

## Herramientas

| Herramienta | Uso |
|---|---|
| `graph_projects` | Lista proyectos locales autorizados |
| `graph_search` | Busca nodos por nombre, ruta o tipo |
| `graph_trace` | Recorre dependencias aguas arriba y abajo |
| `graph_impact` | Calcula el radio de impacto de un cambio |
| `graph_bridge` | Inspecciona callbacks Ruby/JavaScript si existen |
| `graph_node` | Devuelve metadatos y conexiones de un nodo |
| `graph_read` | Lee líneas de código limitadas al proyecto |
| `lsp_definition` | Definición mediante Solargraph opcional |
| `lsp_references` | Referencias mediante Solargraph opcional |

Todas las consultas de trabajo deben indicar `projectId`, excepto `graph_projects`.
