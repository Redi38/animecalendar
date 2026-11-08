"""Настройки безопасности страниц: политика CSP и проверка ID клиента Google."""

from __future__ import annotations

import re

GOOGLE_CLIENT_ID_RE = re.compile(r"^[0-9A-Za-z._-]+\.apps\.googleusercontent\.com$")


def google_client_id(raw: str) -> str:
    """ID OAuth-клиента Google отдаём фронтенду только в правильном виде; иначе синхронизация выключена."""
    value = (raw or "").strip()
    return value if GOOGLE_CLIENT_ID_RE.match(value) else ""


def build_csp(google: bool) -> str:
    """Политика безопасности страниц. Адреса Google открываются, только если настроена синхронизация."""
    script, connect, style, frame = "'self'", "'self'", "'self' 'unsafe-inline'", ""
    if google:
        script += " https://accounts.google.com/gsi/client"
        connect += " https://www.googleapis.com https://accounts.google.com/gsi/"
        style += " https://accounts.google.com/gsi/style"
        frame = " frame-src https://accounts.google.com/gsi/;"
    return (
        "default-src 'self'; img-src 'self' data: https://s4.anilist.co https://*.anilist.co; "
        f"style-src {style}; script-src {script}; connect-src {connect};{frame} "
        "font-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
    )
