from __future__ import annotations

import json
from typing import Any


def dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def loads_list(raw: str | None) -> list[str]:
    if not raw:
        return []
    try:
        value = json.loads(raw)
    except ValueError:
        return []
    return [v for v in value if isinstance(v, str)] if isinstance(value, list) else []


def loads_studios(raw: str | None) -> list[dict[str, Any]]:
    """Студии тайтла: [{"id": 11, "name": "MAPPA"}].

    В старых записях студии лежали списком названий: такие получают id=None, пока тайтл не обновится.
    """
    if not raw:
        return []
    try:
        value = json.loads(raw)
    except ValueError:
        return []
    out: list[dict[str, Any]] = []
    for v in value if isinstance(value, list) else []:
        if isinstance(v, str) and v:
            out.append({"id": None, "name": v})
        elif isinstance(v, dict) and isinstance(v.get("name"), str) and v["name"]:
            sid = v.get("id")
            out.append({"id": sid if isinstance(sid, int) else None, "name": v["name"]})
    return out
