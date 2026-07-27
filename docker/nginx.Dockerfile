FROM alpine:3.22 AS tls-init

RUN apk add --no-cache openssl
COPY docker/nginx/tls-init.sh /usr/local/bin/ad-wiki-tls-init
RUN sed -i 's/\r$//' /usr/local/bin/ad-wiki-tls-init \
    && chmod +x /usr/local/bin/ad-wiki-tls-init
ENTRYPOINT ["/usr/local/bin/ad-wiki-tls-init"]

FROM nginx:1.28-alpine AS runtime

COPY docker/nginx/conf.d /etc/nginx/conf.d
COPY docker/nginx/snippets /etc/nginx/snippets
