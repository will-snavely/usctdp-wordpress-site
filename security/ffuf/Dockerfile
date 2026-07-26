# Builds a minimal ffuf image from the official GitHub release binary,
# verified against its published sha256 checksum - not an unofficial
# third-party image (ffuf doesn't publish one) and not built from source
# (upstream ships no Dockerfile). Bump FFUF_VERSION and rebuild to upgrade.

FROM alpine:3.20 AS fetch
ARG FFUF_VERSION=2.2.1
ARG FFUF_ASSET=ffuf_${FFUF_VERSION}_linux_amd64.tar.gz
RUN apk add --no-cache curl
WORKDIR /tmp/ffuf
RUN curl -sSLO https://github.com/ffuf/ffuf/releases/download/v${FFUF_VERSION}/${FFUF_ASSET} && \
    curl -sSLO https://github.com/ffuf/ffuf/releases/download/v${FFUF_VERSION}/ffuf_${FFUF_VERSION}_checksums.txt && \
    grep " ${FFUF_ASSET}\$" ffuf_${FFUF_VERSION}_checksums.txt | sha256sum -c - && \
    tar -xzf ${FFUF_ASSET} ffuf

FROM alpine:3.20
RUN apk add --no-cache ca-certificates
COPY --from=fetch /tmp/ffuf/ffuf /usr/local/bin/ffuf
WORKDIR /data
ENTRYPOINT ["ffuf"]
