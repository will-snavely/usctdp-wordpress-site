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
FROM horsecatdog/bedrock:latest

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
RUN composer install --no-interaction --no-scripts --no-ansi --optimize-autoloader --no-dev

WORKDIR $THEME_ROOT
RUN composer install --no-interaction --no-scripts --no-ansi --optimize-autoloader --no-dev

RUN mkdir -p web/app/uploads \
             web/app/cache/acorn/framework/cache \
             web/app/cache/acorn/framework/views && \
    chown -R www-data:www-data web/app/uploads web/app/cache /var/run/apache2 /var/log/apache2 /var/lock/apache2 && \
    chmod -R 775 web/app/uploads web/app/cache

USER www-data
ENTRYPOINT ["apache2ctl", "-D", "FOREGROUND"]
