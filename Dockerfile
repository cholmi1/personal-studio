FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4318 \
    DATA_DIR=/data \
    STUDIO_ALLOW_REMOTE=1
# No dependency install: HTTP, SQLite and crypto use Node built-ins.
COPY package.json ./
COPY src ./src
COPY public ./public
COPY scripts/preflight.mjs ./scripts/preflight.mjs
RUN mkdir -p /data && chmod 700 /data \
    && node -e "const [a,b]=process.versions.node.split('.').map(Number); if(a!==24||b<15) process.exit(1); require('node:sqlite')"
EXPOSE 4318
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["sh", "-c", "node scripts/preflight.mjs && exec node src/server.mjs"]
