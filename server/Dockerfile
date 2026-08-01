# Сборка Go-сервера.
FROM golang:1.26-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -ldflags="-s -w" -o /golosloom-server ./cmd/server

# Финальный образ.
FROM alpine:3.21
RUN apk add --no-cache ca-certificates tzdata
WORKDIR /app
COPY --from=build /golosloom-server /app/golosloom-server
EXPOSE 8080
VOLUME ["/data"]
ENTRYPOINT ["/app/golosloom-server"]
