# --- Stage 1: Build Assets ---
FROM node:18-alpine AS theme-builder
ARG PROJECT
ARG THEME
WORKDIR /build
COPY projects/$PROJECT/web/app/themes/$THEME ./
RUN npm install && npm run build

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
COPY --from=theme-builder --chown=root:root /build/public ./web/app/themes/$THEME/public
RUN composer install --no-interaction --no-ansi --optimize-autoloader --no-dev

RUN mkdir -p web/app/uploads web/app/cache && \
    chown -R www-data:www-data web/app/uploads web/app/cache
RUN chmod -R 755 web/app/uploads web/app/cache
ENTRYPOINT ["apache2ctl", "-D", "FOREGROUND"]
