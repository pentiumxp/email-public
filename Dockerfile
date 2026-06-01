FROM node:22-bookworm-slim

WORKDIR /app

ENV NODE_ENV=production
ENV EMAIL_PLUGIN_RUNTIME_DIR=/data
ENV EMAIL_SERVICE_HOST=0.0.0.0
ENV EMAIL_SERVICE_PORT=5175
ENV EMAIL_SERVICE_STATIC_ROOT=/app/dist/web

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm install --no-save tsx

COPY . ./

EXPOSE 5175

CMD ["node", "./node_modules/tsx/dist/cli.mjs", "scripts/email-service.ts"]
