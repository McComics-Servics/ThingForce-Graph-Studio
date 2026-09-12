"""AST enricher for Python projects consumed by ThingForce Graph Studio."""

from __future__ import annotations

import ast
import json
import os
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any


def _node_id(relative_path: str, qualified_name: str) -> str:
    return f"fn:{relative_path}::{qualified_name}"


def _function_params(node: ast.FunctionDef | ast.AsyncFunctionDef) -> list[str]:
    args = [*node.args.posonlyargs, *node.args.args, *node.args.kwonlyargs]
    values = [arg.arg for arg in args]
    if node.args.vararg:
        values.append(f"*{node.args.vararg.arg}")
    if node.args.kwarg:
        values.append(f"**{node.args.kwarg.arg}")
    return values


def _call_reference(node: ast.Call) -> str | None:
    if isinstance(node.func, ast.Name):
        return node.func.id
    if isinstance(node.func, ast.Attribute):
        # Attribute names alone are unsafe: ``unicodedata.normalize`` must not
        # be linked to an unrelated local method also named ``normalize``.
        # Preserve only receivers that can be resolved deterministically.
        if isinstance(node.func.value, ast.Name):
            receiver = node.func.value.id
            if receiver in {"self", "cls"}:
                return f"@member:{node.func.attr}"
            return f"@qualified:{receiver}:{node.func.attr}"
    return None


class FunctionCollector(ast.NodeVisitor):
    def __init__(self) -> None:
        self.scope: list[str] = []
        self.functions: list[dict[str, Any]] = []

    def visit_ClassDef(self, node: ast.ClassDef) -> None:  # noqa: N802
        self.scope.append(node.name)
        self.generic_visit(node)
        self.scope.pop()

    def visit_FunctionDef(self, node: ast.FunctionDef) -> None:  # noqa: N802
        self._visit_function(node)

    def visit_AsyncFunctionDef(self, node: ast.AsyncFunctionDef) -> None:  # noqa: N802
        self._visit_function(node)

    def _visit_function(self, node: ast.FunctionDef | ast.AsyncFunctionDef) -> None:
        qualified_name = ".".join([*self.scope, node.name])
        calls = sorted(
            {
                name
                for child in ast.walk(node)
                if isinstance(child, ast.Call)
                for name in [_call_reference(child)]
                if name
            }
        )
        self.functions.append(
            {
                "name": node.name,
                "qualified_name": qualified_name,
                "line": node.lineno,
                "end_line": getattr(node, "end_lineno", node.lineno),
                "params": _function_params(node),
                "calls": calls,
                "async": isinstance(node, ast.AsyncFunctionDef),
            }
        )
        self.scope.append(node.name)
        self.generic_visit(node)
        self.scope.pop()


def _resolve_import(
    current: Path,
    module: str | None,
    level: int,
    root: Path,
    known_files: set[str],
) -> str | None:
    base = current.parent
    for _ in range(max(0, level - 1)):
        base = base.parent
    module_parts = (module or "").split(".") if module else []
    candidates: list[Path] = []
    if level:
        relative_base = base.joinpath(*module_parts)
        candidates.extend([relative_base.with_suffix(".py"), relative_base / "__init__.py"])
    else:
        absolute_base = root.joinpath(*module_parts)
        candidates.extend([absolute_base.with_suffix(".py"), absolute_base / "__init__.py"])
    for candidate in candidates:
        try:
            relative_path = candidate.resolve().relative_to(root).as_posix()
        except (OSError, ValueError):
            continue
        if relative_path in known_files:
            return relative_path
    return None


def enrich(project_root: Path, graph_path: Path) -> dict[str, int]:
    root = project_root.resolve()
    graph = json.loads(graph_path.read_text(encoding="utf-8"))
    nodes: list[dict[str, Any]] = graph.setdefault("nodes", [])
    edges: list[dict[str, Any]] = graph.setdefault("edges", [])
    file_nodes = {
        node.get("relative_path"): node
        for node in nodes
        if node.get("type") == "file" and node.get("relative_path")
    }
    python_paths = {
        path
        for path, node in file_nodes.items()
        if node.get("classification", {}).get("language") == "python"
    }
    existing_ids = {node.get("id") for node in nodes}
    edge_keys = {(edge.get("from"), edge.get("to"), edge.get("type")) for edge in edges}
    functions_by_file: dict[str, list[dict[str, Any]]] = defaultdict(list)
    parsed_trees: dict[str, ast.AST] = {}
    parse_errors: list[dict[str, str]] = []
    added_nodes = 0
    added_edges = 0

    for relative_path in sorted(python_paths):
        source_path = root / Path(relative_path)
        try:
            tree = ast.parse(source_path.read_text(encoding="utf-8-sig"), filename=relative_path)
        except (OSError, UnicodeError, SyntaxError) as error:
            parse_errors.append({"file": relative_path, "error": str(error)})
            continue
        parsed_trees[relative_path] = tree
        collector = FunctionCollector()
        collector.visit(tree)
        for function in collector.functions:
            function_id = _node_id(relative_path, function["qualified_name"])
            functions_by_file[relative_path].append({**function, "id": function_id})
            if function_id not in existing_ids:
                nodes.append(
                    {
                        "id": function_id,
                        "type": "function",
                        "name": function["name"],
                        "qualified_name": function["qualified_name"],
                        "parent_file": f"file:{relative_path}",
                        "relative_path": relative_path,
                        "line": function["line"],
                        "end_line": function["end_line"],
                        "params": function["params"],
                        "async": function["async"],
                        "classification": {
                            "language": "python",
                            "extension": ".py",
                            "layer": file_nodes[relative_path].get("classification", {}).get(
                                "layer", "supporting_surface"
                            ),
                            "module_name": file_nodes[relative_path].get("classification", {}).get(
                                "module_name"
                            ),
                            "labels": ["python_ast_function"],
                        },
                    }
                )
                existing_ids.add(function_id)
                added_nodes += 1
            edge = (f"file:{relative_path}", function_id, "defines_function")
            if edge not in edge_keys:
                edges.append({"from": edge[0], "to": edge[1], "type": edge[2]})
                edge_keys.add(edge)
                added_edges += 1

    imported_symbols: dict[str, dict[str, tuple[str, str]]] = defaultdict(dict)
    imported_modules: dict[str, dict[str, str]] = defaultdict(dict)
    for relative_path, tree in parsed_trees.items():
        current = root / Path(relative_path)
        for statement in ast.walk(tree):
            if isinstance(statement, ast.ImportFrom):
                imported = _resolve_import(
                    current, statement.module, statement.level, root, python_paths
                )
                if imported:
                    for alias in statement.names:
                        if alias.name != "*":
                            imported_symbols[relative_path][alias.asname or alias.name] = (
                                imported,
                                alias.name,
                            )
            elif isinstance(statement, ast.Import):
                for alias in statement.names:
                    imported = _resolve_import(current, alias.name, 0, root, python_paths)
                    if imported:
                        binding = alias.asname or alias.name.split(".")[0]
                        imported_modules[relative_path][binding] = imported

    def function_in_file(path: str, name: str, *, qualified: str | None = None) -> str | None:
        candidates = [
            function
            for function in functions_by_file.get(path, [])
            if function["name"] == name
            and (qualified is None or function["qualified_name"] == qualified)
        ]
        if qualified is None:
            top_level = [function for function in candidates if "." not in function["qualified_name"]]
            candidates = top_level or candidates
        return candidates[0]["id"] if len(candidates) == 1 else None

    for relative_path, functions in functions_by_file.items():
        for function in functions:
            for call_reference in function["calls"]:
                target: str | None = None
                if call_reference.startswith("@member:"):
                    member = call_reference.removeprefix("@member:")
                    owner = function["qualified_name"].rsplit(".", 1)[0]
                    if owner != function["qualified_name"]:
                        target = function_in_file(
                            relative_path,
                            member,
                            qualified=f"{owner}.{member}",
                        )
                elif call_reference.startswith("@qualified:"):
                    _, receiver, member = call_reference.split(":", 2)
                    imported = imported_modules[relative_path].get(receiver)
                    if imported:
                        target = function_in_file(imported, member)
                else:
                    target = function_in_file(relative_path, call_reference)
                    if not target:
                        imported = imported_symbols[relative_path].get(call_reference)
                        if imported:
                            imported_path, imported_name = imported
                            target = function_in_file(imported_path, imported_name)
                edge = (function["id"], target, "calls_function")
                if target and target != function["id"] and edge not in edge_keys:
                    edges.append({"from": edge[0], "to": edge[1], "type": edge[2]})
                    edge_keys.add(edge)
                    added_edges += 1

    for relative_path, tree in parsed_trees.items():
        current = root / Path(relative_path)
        for statement in ast.walk(tree):
            imported: str | None = None
            if isinstance(statement, ast.ImportFrom):
                imported = _resolve_import(
                    current, statement.module, statement.level, root, python_paths
                )
            elif isinstance(statement, ast.Import):
                for alias in statement.names:
                    imported = _resolve_import(current, alias.name, 0, root, python_paths)
                    if imported:
                        edge = (f"file:{relative_path}", f"file:{imported}", "imports")
                        if edge not in edge_keys:
                            edges.append({"from": edge[0], "to": edge[1], "type": edge[2]})
                            edge_keys.add(edge)
                            added_edges += 1
                continue
            if imported:
                edge = (f"file:{relative_path}", f"file:{imported}", "imports")
                if edge not in edge_keys:
                    edges.append({"from": edge[0], "to": edge[1], "type": edge[2]})
                    edge_keys.add(edge)
                    added_edges += 1

    graph.setdefault("summary", {})["python_enricher"] = {
        "files_parsed": len(parsed_trees),
        "functions": sum(len(items) for items in functions_by_file.values()),
        "parse_errors": parse_errors,
        "nodes_added": added_nodes,
        "edges_added": added_edges,
    }
    graph["summary"]["nodes_total"] = len(nodes)
    graph["summary"]["edges_total"] = len(edges)
    temp_path = graph_path.with_name(f"{graph_path.name}.tmp-{os.getpid()}")
    temp_path.write_text(json.dumps(graph, ensure_ascii=False), encoding="utf-8")
    os.replace(temp_path, graph_path)
    return {"nodes_added": added_nodes, "edges_added": added_edges}


def main() -> int:
    if len(sys.argv) != 3:
        print("Uso: python enrich_python_graph.py <project-root> <graph.json>", file=sys.stderr)
        return 2
    result = enrich(Path(sys.argv[1]), Path(sys.argv[2]))
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
