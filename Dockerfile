# syntax=docker/dockerfile:1.7
FROM node:24-alpine AS dependencies
WORKDIR /app
COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm npm ci

FROM dependencies AS build
ARG VITE_API_BASE_URL=""
ARG VITE_WEBRTC_ICE_SERVERS=""
ARG VITE_WEBRTC_ICE_USERNAME=""
ARG VITE_WEBRTC_ICE_CREDENTIAL=""
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
ENV VITE_WEBRTC_ICE_SERVERS=${VITE_WEBRTC_ICE_SERVERS}
ENV VITE_WEBRTC_ICE_USERNAME=${VITE_WEBRTC_ICE_USERNAME}
ENV VITE_WEBRTC_ICE_CREDENTIAL=${VITE_WEBRTC_ICE_CREDENTIAL}
COPY tsconfig*.json vite.config.ts index.html ./
COPY public ./public
COPY scripts ./scripts
COPY src ./src
RUN npm run build

FROM dependencies AS test
COPY tsconfig*.json vite.config.ts index.html ./
COPY public ./public
COPY scripts ./scripts
COPY src ./src
RUN npm run typecheck
RUN npm test

FROM nginxinc/nginx-unprivileged:1.29-alpine AS runtime
ENV BACKEND_UPSTREAM=host.docker.internal:8080
COPY docker/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY docker/security_headers.conf /etc/nginx/security_headers.conf
COPY --from=build --chown=101:101 /app/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
