# --- build stage: compile the Aver toolchain ---------------------------------
FROM rust:bookworm AS toolchain

ARG AVER_VERSION=0.29.0

RUN cargo install aver-lang --version ${AVER_VERSION} --root /out

# --- dev stage: the toolchain alone, for check/verify against a mounted tree --
FROM debian:bookworm-slim AS dev

RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends ca-certificates; \
    rm -rf /var/lib/apt/lists/*

COPY --from=toolchain /out/bin/aver /usr/local/bin/aver

WORKDIR /app
ENTRYPOINT ["aver"]

# --- runtime stage: the toolchain plus this program ---------------------------
FROM dev AS runtime

COPY aver.toml ./aver.toml
COPY main.av ./main.av
COPY go ./go
COPY web ./web

EXPOSE 8080

ENTRYPOINT []
CMD ["aver", "run", "main.av", "--module-root", "."]
