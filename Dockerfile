# --- Stage 1: Build Assets ---
FROM node:18-alpine AS node-builder
ARG PROJECT
ARG THEME
COPY --chown=root:root projects/$PROJECT /build/$PROJECT/
WORKDIR /build/$PROJECT/web/app/themes/$THEME
RUN npm install && npm run build
WORKDIR /build/$PROJECT/web/app/plugins/usctdp-mgmt
RUN npm install && npm run prod

# --- Stage 2: Final Production Image ---
# Pinned to a specific hcdwp build (commit-sha-run_number, per
# hcdwp/.github/workflows/build-and-push.yml) rather than :latest, so builds
# here are reproducible and a bad/different bedrock rebuild can't silently
# change what gets deployed. Bump deliberately: check
# https://hub.docker.com/r/horsecatdog/bedrock/tags for the tag to move to,
# or override with --build-arg BEDROCK_TAG=... for a one-off build.
ARG BEDROCK_TAG=518a0ce450e7ab8c9a7c36b442281292eadb6123-29
FROM horsecatdog/bedrock:${BEDROCK_TAG}

# horsecatdog/bedrock:latest is an external, unpinned base image and isn't
# necessarily rebuilt often - pull current Debian security patches at build
# time rather than inheriting however stale it happens to be. Deliberately
# left unpinned (unlike the rest of this project's dependencies): OS security
# patches are the one thing we always want the latest of on every rebuild.
RUN apt-get update && apt-get upgrade -y && rm -rf /var/lib/apt/lists/*

ARG PROJECT
ARG THEME
ENV PROJECT=$PROJECT
ENV THEME=$THEME
ENV BEDROCK_ROOT=/www/srv
ENV PROJECT_ROOT=/www/srv/$PROJECT
ENV THEME_ROOT=/www/srv/$PROJECT/web/app/themes/$THEME

WORKDIR /www/srv/$PROJECT
COPY --chown=root:root projects/$PROJECT ./
COPY --from=node-builder --chown=root:root /build/$PROJECT/web/app/themes/$THEME/public ./web/app/themes/$THEME/public
COPY --from=node-builder --chown=root:root /build/$PROJECT/web/app/plugins/usctdp-mgmt/dist ./web/app/plugins/usctdp-mgmt/dist 
RUN mkdir -p web/app/uploads \
             web/app/cache/acorn/framework/cache \
             web/app/cache/acorn/framework/views && \
    touch /www/srv/usctdp-bedrock/web/app/debug.log && \
    chown www-data:www-data /www/srv/usctdp-bedrock/web/app/debug.log && \
    chown -R www-data:www-data web/app/uploads web/app/cache /var/run/apache2 /var/log/apache2 /var/lock/apache2 && \
    chmod -R 775 web/app/uploads web/app/cache && \
    chmod 664 /www/srv/usctdp-bedrock/web/app/debug.log && \
    composer install --no-interaction --no-scripts --no-ansi --optimize-autoloader --no-dev

WORKDIR $THEME_ROOT
RUN composer install --no-interaction --no-scripts --no-ansi --optimize-autoloader --no-dev

USER www-data
ENTRYPOINT ["apache2ctl", "-D", "FOREGROUND"]
