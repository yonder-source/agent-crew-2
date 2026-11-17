FROM ghcr.io/openclaw/openclaw:2026.11.3@sha256:e73f689d663567f0fe3c5a85c54beb3e102dc21f0814bf375e9039ee2d2df51b AS base
USER root
RUN npm install --prefix /opt/agent-crew-lobster --omit=dev --ignore-scripts @openclaw/lobster@2026.11.3
USER node

FROM base AS build
USER root
RUN npm install --global typescript@5.9.3
# The runtime image omits declarations; restore them from the matching release.
RUN cd /tmp && npm pack openclaw@2026.11.3 --ignore-scripts --silent \
    && tar -xzf openclaw-2026.11.3.tgz -C /app --strip-components=1 \
       --wildcards 'package/dist/*.d.ts' \
    && rm openclaw-2026.11.3.tgz
RUN ln -s /app /app/node_modules/openclaw \
    && mkdir -p /app/extensions/agent-crew \
    && chown node:node /app/extensions/agent-crew
WORKDIR /app/extensions/agent-crew
COPY --chown=node:node package.json openclaw.plugin.json tsconfig.json ./
COPY --chown=node:node src ./src
USER node
RUN tsc --noEmit false

FROM build AS checks
COPY --chown=node:node openclaw.json ./
COPY --chown=node:node scripts/check-config.mjs scripts/check-dispatcher-boundaries.mjs ./scripts/
CMD ["sh", "-lc", "tsc --noEmit && node scripts/check-config.mjs && node scripts/check-dispatcher-boundaries.mjs"]

FROM base AS runtime
USER root
RUN mkdir -p /app/extensions/agent-crew && chown node:node /app/extensions/agent-crew
WORKDIR /app/extensions/agent-crew
COPY --from=build --chown=node:node /app/extensions/agent-crew/dist ./dist
COPY --chown=node:node package.json openclaw.plugin.json openclaw.json ./
COPY --chown=node:node infra/local-dev/openclaw/workflows ./workflows
COPY --chown=node:node scripts/check-gateway.mjs scripts/session-roundtrip.mjs ./scripts/
USER node
CMD ["openclaw", "gateway", "--allow-unconfigured"]
