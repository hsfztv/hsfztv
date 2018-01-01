FROM nginx:latest

ADD nginx.conf key.pem cert.pem /etc/nginx/

CMD \
    mkdir -p /data/cache && \
    mkdir -p /data/tmp && \
    sed -i "s/edge/${EDGE}/g" /etc/nginx/nginx.conf && \
    nginx

VOLUME ["/data"]

