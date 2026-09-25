FROM node:20-alpine
RUN apk add --no-cache openssl
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server.mjs entrypoint.sh ./
# Windows checkouts can add CRLF, which breaks sh.
RUN sed -i 's/\r$//' entrypoint.sh
ENV TLS_KEY_FILE=/app/tls/key.pem \
    TLS_CERT_FILE=/app/tls/cert.pem
EXPOSE 21 30000-30009
ENTRYPOINT ["sh", "/app/entrypoint.sh"]
