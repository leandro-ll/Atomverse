"""Snapshot approved FastAPI and DOM compatibility surfaces without importing application code."""

from __future__ import annotations

import argparse
import ast
from html.parser import HTMLParser
from pathlib import Path
from typing import Any

from _inventory_common import emit_json, read_json, relative_posix, sha256_file


_HTTP_DECORATORS = {"get", "post", "put", "patch", "delete", "options", "head"}


def _expression_text(node: ast.AST | None) -> str | None:
    return ast.unparse(node) if node is not None else None


def inspect_python_api(path: Path, root: Path) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    source = path.read_text(encoding="utf-8")
    tree = ast.parse(source, filename=str(path))
    routes: list[dict[str, Any]] = []
    models: dict[str, Any] = {}
    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            for decorator in node.decorator_list:
                if not isinstance(decorator, ast.Call) or not isinstance(decorator.func, ast.Attribute):
                    continue
                method = decorator.func.attr.lower()
                if method not in _HTTP_DECORATORS or not decorator.args:
                    continue
                route_path = decorator.args[0]
                if not isinstance(route_path, ast.Constant) or not isinstance(route_path.value, str):
                    continue
                response_model = next(
                    (_expression_text(keyword.value) for keyword in decorator.keywords if keyword.arg == "response_model"),
                    None,
                )
                routes.append(
                    {
                        "method": method.upper(),
                        "path": route_path.value,
                        "handler": node.name,
                        "requestAnnotations": [
                            _expression_text(argument.annotation)
                            for argument in node.args.args
                            if argument.annotation is not None
                        ],
                        "responseModel": response_model,
                        "source": relative_posix(path, root),
                    }
                )
        if isinstance(node, ast.ClassDef) and any(
            isinstance(base, ast.Name) and base.id == "BaseModel" for base in node.bases
        ):
            fields = []
            for statement in node.body:
                if isinstance(statement, ast.AnnAssign) and isinstance(statement.target, ast.Name):
                    fields.append(
                        {
                            "name": statement.target.id,
                            "annotation": _expression_text(statement.annotation),
                            "declaration": _expression_text(statement.value),
                        }
                    )
            models[node.name] = {
                "source": relative_posix(path, root),
                "fields": fields,
            }
    return routes, models


class _DomSnapshotParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.elements: dict[str, dict[str, Any]] = {}
        self.module_tabs: list[dict[str, str]] = []
        self.scripts: list[str] = []
        self.inline_handlers: list[dict[str, str]] = []
        self._open_tab: int | None = None

    def handle_starttag(self, tag: str, attributes: list[tuple[str, str | None]]) -> None:
        attrs = {key: value or "" for key, value in attributes}
        element_id = attrs.get("id")
        if element_id:
            self.elements[element_id] = {
                "tag": tag,
                "role": attrs.get("role") or None,
                "ariaControls": attrs.get("aria-controls") or None,
                "ariaSelected": attrs.get("aria-selected") or None,
                "hiddenByClass": "hidden" in attrs.get("class", "").split(),
            }
        if tag == "script" and attrs.get("src", "").startswith("js/"):
            self.scripts.append(attrs["src"])
        if attrs.get("role") == "tab" and "data-tab" in attrs:
            self.module_tabs.append(
                {
                    "dataTab": attrs["data-tab"],
                    "controls": attrs.get("aria-controls", ""),
                    "label": "",
                }
            )
            self._open_tab = len(self.module_tabs) - 1
        for name in sorted(attrs):
            if name.lower().startswith("on"):
                self.inline_handlers.append(
                    {"elementId": element_id or "", "attribute": name, "tag": tag}
                )

    def handle_data(self, data: str) -> None:
        if self._open_tab is not None:
            current = self.module_tabs[self._open_tab]
            current["label"] = " ".join(filter(None, [current["label"], data.strip()])).strip()

    def handle_endtag(self, tag: str) -> None:
        if tag == "button" and self._open_tab is not None:
            self._open_tab = None


def inspect_dom(path: Path) -> dict[str, Any]:
    parser = _DomSnapshotParser()
    parser.feed(path.read_text(encoding="utf-8"))
    return {
        "source": path.name,
        "sourceSha256": sha256_file(path),
        "elementsById": dict(sorted(parser.elements.items())),
        "moduleTabs": parser.module_tabs,
        "scriptOrder": parser.scripts,
        "inlineHandlers": parser.inline_handlers,
    }


def _compare_contract(contract: dict[str, Any], routes: list[dict[str, Any]], models: dict[str, Any], dom: dict[str, Any]) -> dict[str, Any]:
    problems: list[str] = []
    observed_routes = {(item["method"], item["path"]) for item in routes}
    approved_routes = {(item["method"], item["path"]) for item in contract["api"]["routes"]}
    for method, path in sorted(approved_routes - observed_routes):
        problems.append(f"Rute API wajib tidak ditemukan: {method} {path}")
    for model_name, approved_fields in sorted(contract["api"]["models"].items()):
        observed_fields = [field["name"] for field in models.get(model_name, {}).get("fields", [])]
        if observed_fields != approved_fields:
            problems.append(
                f"Bidang DTO {model_name} berubah: diharapkan {approved_fields}, ditemukan {observed_fields}"
            )
    approved_dom = contract["dom"]
    missing_ids = sorted(set(approved_dom["requiredElementIds"]) - set(dom["elementsById"]))
    if missing_ids:
        problems.append(f"ID DOM wajib tidak ditemukan: {missing_ids}")
    if dom["moduleTabs"] != approved_dom["moduleTabs"]:
        problems.append("Kontrak tiga tab modul berubah")
    if dom["scriptOrder"] != approved_dom["scriptOrder"]:
        problems.append("Urutan skrip aplikasi berubah")
    return {"compatible": not problems, "problems": problems}


def inventory_compatibility(root: Path, contract_path: Path | None = None) -> dict[str, Any]:
    root = root.resolve()
    contract_path = contract_path or Path(__file__).with_name("compatibility_contract.json")
    contract = read_json(contract_path)
    routes: list[dict[str, Any]] = []
    models: dict[str, Any] = {}
    for source in (root / "backend" / "main.py", root / "backend" / "inverse_engine.py"):
        source_routes, source_models = inspect_python_api(source, root)
        routes.extend(source_routes)
        models.update(source_models)
    routes.sort(key=lambda item: (item["path"], item["method"], item["source"]))
    models = dict(sorted(models.items()))
    dom = inspect_dom(root / "index.html")
    return {
        "inventoryVersion": 1,
        "kind": "api-dom-compatibility",
        "root": root.as_posix(),
        "contractVersion": contract["contractVersion"],
        "contractSource": relative_posix(contract_path, root),
        "api": {"routes": routes, "models": models},
        "dom": dom,
        "validation": _compare_contract(contract, routes, models, dom),
        "safety": {"applicationModulesImported": False, "sourceFilesWritten": False},
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path.cwd())
    parser.add_argument("--contract", type=Path)
    parser.add_argument("--pretty", action="store_true")
    arguments = parser.parse_args()
    payload = inventory_compatibility(arguments.root, arguments.contract)
    emit_json(payload, pretty=arguments.pretty)
    return 0 if payload["validation"]["compatible"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
