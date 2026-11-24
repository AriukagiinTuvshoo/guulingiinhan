"""Check field-name coverage for selected OpenAPI schemas and TypeScript types.

This does not validate field types, nullability, endpoints, or the full API contract.
"""

from __future__ import annotations

import re
import sys
import warnings
from pathlib import Path
from typing import Any

BACKEND_DIR = Path(__file__).resolve().parent.parent
REPO_ROOT = BACKEND_DIR.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.main import app

# Only schemas present in this application; extend when porting new domains.
CONTRACT_PAIRS: list[tuple[str, str]] = [
    ("UserOutput", "User"),
    ("FamilyOut", "Family"),
    ("PersonOut", "Person"),
    ("TreeOut", "TreeData"),
]


_TYPE_DECL_RE = re.compile(r"export\s+type\s+([A-Za-z0-9_]+)\s*=")
_FIELD_RE = re.compile(r"^([A-Za-z_][A-Za-z0-9_]*)(\?)?\s*:")


def _split_top_level_statements(source: str) -> dict[str, str]:
    """Extract raw RHS bodies of `export type X = ...;` declarations from lib/api.ts."""
    decls: dict[str, str] = {}
    for match in _TYPE_DECL_RE.finditer(source):
        name = match.group(1)
        pos = match.end()
        brace_depth = 0
        angle_depth = 0
        paren_depth = 0
        in_single = False
        in_double = False
        end = pos
        while end < len(source):
            ch = source[end]
            prev = source[end - 1] if end > 0 else ""
            if ch == "'" and not in_double and prev != "\\":
                in_single = not in_single
            elif ch == '"' and not in_single and prev != "\\":
                in_double = not in_double
            elif not in_single and not in_double:
                if ch == "{":
                    brace_depth += 1
                elif ch == "}":
                    brace_depth = max(0, brace_depth - 1)
                elif ch == "<":
                    angle_depth += 1
                elif ch == ">":
                    # Avoid decrementing on `=>`
                    if prev != "=":
                        angle_depth = max(0, angle_depth - 1)
                elif ch == "(":
                    paren_depth += 1
                elif ch == ")":
                    paren_depth = max(0, paren_depth - 1)
                elif ch == ";" and brace_depth == 0 and angle_depth == 0 and paren_depth == 0:
                    break
            end += 1
        decls[name] = source[pos:end].strip()
    return decls


def _extract_object_fields(block: str) -> dict[str, bool]:
    """Parse top-level fields (`name -> is_required`) inside `{ ... }`."""
    fields: dict[str, bool] = {}
    body = block.strip()
    if body.startswith("{") and body.endswith("}"):
        body = body[1:-1]
    depth = 0
    buf: list[str] = []
    tokens: list[str] = []
    for ch in body:
        if ch in "{[(":
            depth += 1
            buf.append(ch)
        elif ch in "}])":
            depth = max(0, depth - 1)
            buf.append(ch)
        elif ch in ";\n" and depth == 0:
            item = "".join(buf).strip()
            if item:
                tokens.append(item)
            buf.clear()
        else:
            buf.append(ch)
    tail = "".join(buf).strip()
    if tail:
        tokens.append(tail)
    for token in tokens:
        if token.startswith("//"):
            continue
        match = _FIELD_RE.match(token)
        if match:
            fields[match.group(1)] = match.group(2) != "?"
    return fields


def _split_intersections(expr: str) -> list[str]:
    parts: list[str] = []
    brace_depth = 0
    angle_depth = 0
    start = 0
    for idx, ch in enumerate(expr):
        prev = expr[idx - 1] if idx > 0 else ""
        if ch == "{":
            brace_depth += 1
        elif ch == "}":
            brace_depth = max(0, brace_depth - 1)
        elif ch == "<":
            angle_depth += 1
        elif ch == ">" and prev != "=":
            angle_depth = max(0, angle_depth - 1)
        elif ch == "&" and brace_depth == 0 and angle_depth == 0:
            parts.append(expr[start:idx].strip())
            start = idx + 1
    parts.append(expr[start:].strip())
    return [part for part in parts if part]


def _resolve_ts_fields(
    name: str,
    decls: dict[str, str],
    seen: set[str] | None = None,
) -> dict[str, bool]:
    """Resolve `name -> {field_name: is_required}` across intersections and `Pick<>`."""
    if name not in decls:
        raise KeyError(f"TypeScript type `{name}` not found in lib/api.ts")
    visited = set(seen or ())
    if name in visited:
        return {}
    visited.add(name)

    fields: dict[str, bool] = {}
    for term in _split_intersections(decls[name]):
        if term.startswith("{"):
            fields.update(_extract_object_fields(term))
        elif term.startswith("Pick<") and term.endswith(">"):
            inner = term[5:-1]
            base_name, keys_expr = inner.split(",", 1)
            base_fields = _resolve_ts_fields(base_name.strip(), decls, visited)
            for key in re.findall(r"['\"]([A-Za-z_][A-Za-z0-9_]*)['\"]", keys_expr):
                fields[key] = base_fields.get(key, True)
        elif re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", term) and term in decls:
            fields.update(_resolve_ts_fields(term, decls, visited))
    return fields


def _resolve_openapi_schema(
    name: str,
    schemas: dict[str, dict[str, Any]],
) -> tuple[set[str], set[str]]:
    """Return (all_properties, required_properties) for an OpenAPI component schema."""
    if name not in schemas:
        raise KeyError(f"OpenAPI schema `{name}` not found in app.openapi()")
    node = schemas[name]
    props: set[str] = set()
    req: set[str] = set()

    if "allOf" in node:
        for branch in node["allOf"]:
            if "$ref" in branch:
                ref_name = branch["$ref"].rsplit("/", 1)[-1]
                b_props, b_req = _resolve_openapi_schema(ref_name, schemas)
                props |= b_props
                req |= b_req
            else:
                props |= set(branch.get("properties", {}).keys())
                req |= set(branch.get("required", []))
    props |= set(node.get("properties", {}).keys())
    req |= set(node.get("required", []))
    return props, req


def main() -> int:
    api_ts_path = REPO_ROOT / "lib" / "api.ts"
    source = api_ts_path.read_text(encoding="utf-8")
    decls = _split_top_level_statements(source)

    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        spec = app.openapi()
    if caught:
        for item in caught:
            print(f"[FAIL] OpenAPI warning: {item.message}")
        return 1

    schemas: dict[str, dict[str, Any]] = spec.get("components", {}).get("schemas", {})
    errors: list[str] = []

    for openapi_name, ts_name in CONTRACT_PAIRS:
        try:
            oa_props, oa_required = _resolve_openapi_schema(openapi_name, schemas)
            ts_fields = _resolve_ts_fields(ts_name, decls)
        except KeyError as exc:
            errors.append(str(exc))
            continue

        # 1. Every required TS field must exist on OpenAPI schema
        for field_name, is_required in sorted(ts_fields.items()):
            if is_required and field_name not in oa_props:
                errors.append(
                    f"{ts_name}.{field_name} (required in TS) missing from OpenAPI `{openapi_name}`"
                )

        # 2. Every required OpenAPI property must exist in TS type
        for prop_name in sorted(oa_required):
            if prop_name not in ts_fields:
                errors.append(
                    f"{openapi_name}.{prop_name} (required in OpenAPI) missing from TS `{ts_name}`"
                )

    if errors:
        print(f"[FAIL] API contract drift detected ({len(errors)} issue(s)):")
        for err in errors:
            print(f"  - {err}")
        return 1

    print(f"Field-name coverage OK for {len(CONTRACT_PAIRS)} selected schemas (types not checked)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
