# Сборка веб-клиента и раздача статики через общий том.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM alpine:3.21
COPY --from=build /app/dist /srv
