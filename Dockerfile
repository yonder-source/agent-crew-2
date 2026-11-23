FROM docker:29.9.2-cli@sha256:5e6baf67325a79f64ed3bed6863954d5e05d0f3d4e57cbdb14809346814bbfdb AS docker-cli

FROM ghcr.io/openclaw/openclaw:2026.11.3@sha256:e73f689d663567f0fe3c5a85c54beb3e102dc21f0814bf375e9039ee2d2df51b AS openclaw-upstream

FROM openclaw-upstream AS sandbox

FROM openclaw-upstream AS base
USER root
RUN npm install --prefix /opt/agent-crew-lobster --omit=dev --ignore-scripts @openclaw/lobster@2026.11.3
COPY scripts/patch-openclaw-startup.mjs /opt/agent-crew-patches/patch-openclaw-startup.mjs
RUN node /opt/agent-crew-patches/patch-openclaw-startup.mjs
COPY scripts/patch-openclaw-usage.mjs /opt/agent-crew-patches/patch-openclaw-usage.mjs
RUN node /opt/agent-crew-patches/patch-openclaw-usage.mjs
COPY scripts/patch-openclaw-stop.mjs /opt/agent-crew-patches/patch-openclaw-stop.mjs
RUN node /opt/agent-crew-patches/patch-openclaw-stop.mjs
COPY scripts/patch-openclaw-timeout.mjs /opt/agent-crew-patches/patch-openclaw-timeout.mjs
RUN node /opt/agent-crew-patches/patch-openclaw-timeout.mjs
RUN npm install --prefix /opt/agent-crew-slack --omit=dev --legacy-peer-deps --ignore-scripts --no-audit --no-fund @openclaw/slack@2026.11.3 \
    && ln -s /app /opt/agent-crew-slack/node_modules/openclaw
USER node

FROM base AS build
USER root
# The runtime image omits declarations; restore them from the matching release.
RUN cd /tmp && npm pack openclaw@2026.11.3 --ignore-scripts --silent \
    && tar -xzf openclaw-2026.11.3.tgz -C /app --strip-components=1 \
       --wildcards 'package/dist/*.d.ts' \
    && rm openclaw-2026.11.3.tgz
RUN ln -s /app /app/node_modules/openclaw \
    && mkdir -p /app/extensions/agent-crew \
    && chown node:node /app/extensions/agent-crew
WORKDIR /app/extensions/agent-crew
COPY --chown=node:node package.json package-lock.json ./
USER node
RUN npm ci --include=dev --legacy-peer-deps --ignore-scripts --no-audit --no-fund
COPY --chown=node:node openclaw.plugin.json tsconfig.json ./
COPY --chown=node:node src ./src
RUN npm run build
COPY --chown=node:node ui ./dist/control-ui/agent-crew

FROM build AS checks
COPY --chown=node:node . ./
CMD ["sh", "-c", "npm run lint && npm run check:lint && npm run typecheck && sh -n scripts/check-all.sh && node scripts/check-config.mjs && node scripts/check-dispatcher-boundaries.mjs && node scripts/check-coding-boundaries.mjs && node scripts/check-coding-result.mjs && node scripts/check-native-usage.mjs && node scripts/check-native-stop.mjs && node scripts/check-native-timeout.mjs && node scripts/check-coding-workflow.mjs && node scripts/check-wbs3.mjs && node scripts/check-repository-connection.mjs && node scripts/check-slack-credentials.mjs && node scripts/check-slack-settings.mjs && node scripts/check-slack-task-thread.mjs && node scripts/check-slack-task-reply.mjs"]

FROM base AS runtime
USER root
COPY --from=docker-cli /usr/local/bin/docker /usr/local/bin/docker
RUN mkdir -p /app/extensions/agent-crew && chown node:node /app/extensions/agent-crew
WORKDIR /app/extensions/agent-crew
COPY --from=build --chown=node:node /app/extensions/agent-crew/dist ./dist
COPY --from=build --chown=node:node /app/extensions/agent-crew/node_modules ./node_modules
COPY --chown=node:node package.json openclaw.plugin.json openclaw.json ./
COPY --chown=node:node infra/local-dev/openclaw/workflows ./workflows
COPY --chown=node:node scripts/check-gateway.mjs scripts/session-roundtrip.mjs scripts/check-setup-draft.mjs ./scripts/
USER node
CMD ["openclaw", "gateway", "--allow-unconfigured"]
