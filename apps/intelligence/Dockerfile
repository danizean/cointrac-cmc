FROM python:3.12-slim AS builder

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /build

RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

COPY apps/intelligence/pyproject.toml apps/intelligence/requirements.lock.txt ./
COPY apps/intelligence/app ./app
RUN pip install --upgrade pip==26.3 \
    && pip install -r requirements.lock.txt \
    && pip install --no-deps .


FROM python:3.12-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH="/opt/venv/bin:$PATH"

WORKDIR /app

RUN groupadd --gid 10001 cointrac \
    && useradd --uid 10001 --gid 10001 --create-home --shell /usr/sbin/nologin cointrac

COPY --from=builder /opt/venv /opt/venv
COPY --chown=cointrac:cointrac apps/intelligence/app ./app
COPY --chown=cointrac:cointrac docs/CMC_CAPABILITY_MATRIX.json /app/docs/CMC_CAPABILITY_MATRIX.json

USER cointrac

EXPOSE 8000

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=3)"

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
