FROM python:3.13-slim

WORKDIR /app

COPY requirements/base.txt requirements/base.txt
RUN --mount=type=cache,target=/root/.cache/pip pip install -r requirements/base.txt

COPY app/ app/

RUN useradd --create-home --uid 10001 app && mkdir -p /app/data && chown app /app/data
USER app

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD python3 -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/healthz', timeout=3)"

CMD ["uvicorn", "app.web:app", "--host", "0.0.0.0", "--port", "8000"]
