from __future__ import annotations

import importlib.util
import json
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "enrich_python_graph.py"
SPEC = importlib.util.spec_from_file_location("enrich_python_graph", SCRIPT)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class PythonGraphEnricherTests(unittest.TestCase):
    @staticmethod
    def _graph_for(root: Path, *names: str) -> Path:
        graph_path = root / "graph.json"
        graph_path.write_text(
            json.dumps(
                {
                    "root": str(root),
                    "summary": {},
                    "nodes": [
                        {
                            "id": f"file:{name}",
                            "type": "file",
                            "relative_path": name,
                            "classification": {"language": "python"},
                        }
                        for name in names
                    ],
                    "edges": [],
                }
            ),
            encoding="utf-8",
        )
        return graph_path

    def test_ast_functions_calls_and_local_imports_are_connected(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "a.py").write_text(
                "from b import helper\n\ndef run(value):\n    return helper(value)\n",
                encoding="utf-8",
            )
            (root / "b.py").write_text(
                "def helper(value):\n    return value * 2\n",
                encoding="utf-8",
            )
            graph_path = root / "graph.json"
            graph_path.write_text(
                json.dumps(
                    {
                        "root": str(root),
                        "summary": {},
                        "nodes": [
                            {
                                "id": f"file:{name}",
                                "type": "file",
                                "relative_path": name,
                                "classification": {"language": "python"},
                            }
                            for name in ("a.py", "b.py")
                        ],
                        "edges": [],
                    }
                ),
                encoding="utf-8",
            )

            MODULE.enrich(root, graph_path)
            graph = json.loads(graph_path.read_text(encoding="utf-8"))
            ids = {node["id"] for node in graph["nodes"]}
            edges = {(edge["from"], edge["to"], edge["type"]) for edge in graph["edges"]}
            self.assertIn("fn:a.py::run", ids)
            self.assertIn("fn:b.py::helper", ids)
            self.assertIn(("file:a.py", "file:b.py", "imports"), edges)
            self.assertIn(("fn:a.py::run", "fn:b.py::helper", "calls_function"), edges)
            self.assertEqual(len(ids), len(graph["nodes"]))

    def test_qualified_external_call_does_not_link_by_name_only(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "external_user.py").write_text(
                "import unicodedata\n\ndef key(value):\n    return unicodedata.normalize('NFKD', value)\n",
                encoding="utf-8",
            )
            (root / "local.py").write_text(
                "class Local:\n    def normalize(self, value):\n        return value\n",
                encoding="utf-8",
            )
            graph_path = self._graph_for(root, "external_user.py", "local.py")

            MODULE.enrich(root, graph_path)
            graph = json.loads(graph_path.read_text(encoding="utf-8"))
            edges = {(edge["from"], edge["to"], edge["type"]) for edge in graph["edges"]}
            self.assertNotIn(
                (
                    "fn:external_user.py::key",
                    "fn:local.py::Local.normalize",
                    "calls_function",
                ),
                edges,
            )

    def test_self_method_and_local_module_alias_are_resolved(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "a.py").write_text(
                "import b as helpers\n\n"
                "class Runner:\n"
                "    def finish(self, value):\n        return value\n\n"
                "    def run(self, value):\n        return self.finish(helpers.helper(value))\n",
                encoding="utf-8",
            )
            (root / "b.py").write_text(
                "def helper(value):\n    return value * 2\n",
                encoding="utf-8",
            )
            graph_path = self._graph_for(root, "a.py", "b.py")

            MODULE.enrich(root, graph_path)
            graph = json.loads(graph_path.read_text(encoding="utf-8"))
            edges = {(edge["from"], edge["to"], edge["type"]) for edge in graph["edges"]}
            self.assertIn(
                ("fn:a.py::Runner.run", "fn:a.py::Runner.finish", "calls_function"),
                edges,
            )
            self.assertIn(
                ("fn:a.py::Runner.run", "fn:b.py::helper", "calls_function"),
                edges,
            )


if __name__ == "__main__":
    unittest.main()
