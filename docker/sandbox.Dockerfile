# syntax=docker/dockerfile:1.7
#
# The image project containers run in (ZELYQ_RUNTIME=container).
#
# It is `node:22-bookworm-slim` plus the handful of things a *project* needs
# that the slim image does not carry. git is the reason this file exists:
# without it every `git init`, every per-turn commit and every push failed
# inside the container with "git: command not found", while the server-side
# code that issues them was working perfectly.
#
# ca-certificates matters just as much and is easier to miss — the slim image
# has no /etc/ssl/certs at all, so an HTTPS clone or push would fail on
# certificate verification even once git itself is present.
#
# The runtime builds this on demand the first time it needs the image, so
# there is normally nothing to do by hand. To build it yourself:
#
#   docker build -t zelyq/sandbox:node22 -f docker/sandbox.Dockerfile .
#
# To use a different image entirely, set ZELYQ_CONTAINER_IMAGE — it is then
# used exactly as given and none of this applies. Whatever you point it at
# must contain git, or per-turn commits and pushes will not work.
FROM node:22-bookworm-slim

RUN apt-get update \
    && apt-get install --no-install-recommends -y \
        git \
        ca-certificates \
        openssh-client \
    && rm -rf /var/lib/apt/lists/*
