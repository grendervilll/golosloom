# Сборка веб-клиента и раздача статики через общий том.
# При каждом старте dist синхронизируется в том — обновления применяются
# без ручного пересоздания тома (том копируется из образа только один раз).
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM alpine:3.21
COPY --from=build /app/dist /app/dist
CMD ["sh", "-c", "cp -rf /app/dist/. /srv/ && sleep infinity"]
