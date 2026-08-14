# Pinned to a specific hcdwp build (commit-sha-run_number, per
# hcdwp/.github/workflows/build-and-push.yml) rather than :latest, so builds
# here are reproducible and a bad/different bedrock rebuild can't silently
# change what gets deployed. Bump deliberately: check
# https://hub.docker.com/r/horsecatdog/bedrock/tags for the tag to move to,
# or override with --build-arg BEDROCK_TAG=... for a one-off build.
#
# Must be declared before the FIRST FROM in the file (not just before the
# FROM that uses it) - an ARG used inside a FROM only has "global" scope
# if it's declared ahead of every stage, otherwise it's scoped to whichever
# stage it textually falls inside and is invisible to later stages' FROM
# lines (silently resolves to empty, producing an invalid image reference).
ARG BEDROCK_TAG=69cff594f79232e9089d46d2083128cd2225a91b-30

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
# The advanced-cache.php/object-cache.php symlinks below were briefly
# removed (2026-08-14) after Acorn's own View::makeLoader() macro - which
# silently trusted an unchecked file_put_contents() when generating a
# WooCommerce Blade template loader - caused an uncaught fatal on
# /my-account/ during a burst of concurrent requests racing to compile the
# same view against a cold, just-wiped web/app/cache/acorn right after a
# deploy. Re-enabled now that ThemeServiceProvider::fixMakeLoaderMacro()
# overrides Acorn's macro with an atomic-write version that can't produce
# that half-written state. web/app/cache/acorn stays ephemeral, wiped on
# every container recreate same as before - deliberately not persisted in
# a volume, since Blade's mtime-based staleness check can't be trusted to
# reliably invalidate a persisted cache against a fresh git checkout (every
# file's mtime resets to checkout time regardless of whether its content
# changed), and a stale compiled view surviving past the deploy that
# changed it is worse than a cold cache. Instead, `wp-deploy` (see
# Taskfile.prod.yml) now warms the cache explicitly and sequentially as
# part of the deploy itself - `wp acorn view:cache` for ordinary Blade
# views, plus real requests to the WooCommerce-Blade-bridged pages - so
# the first real compile of each view happens once, deliberately, before
# traffic can race on it, rather than statefully carrying compiled output
# between deploys.
RUN mkdir -p web/app/uploads \
             web/app/cache/acorn/framework/cache \
             web/app/cache/acorn/framework/views \
             web/app/settings/cache-enabler && \
    touch /www/srv/usctdp-bedrock/web/app/debug.log && \
    chown www-data:www-data /www/srv/usctdp-bedrock/web/app/debug.log && \
    chown -R www-data:www-data web/app/uploads web/app/cache web/app/settings /var/run/apache2 /var/log/apache2 /var/lock/apache2 && \
    chmod -R 775 web/app/uploads web/app/cache web/app/settings && \
    chmod 664 /www/srv/usctdp-bedrock/web/app/debug.log && \
    composer install --no-interaction --no-scripts --no-ansi --optimize-autoloader --no-dev && \
    ln -sf plugins/cache-enabler/advanced-cache.php web/app/advanced-cache.php && \
    ln -sf plugins/redis-cache/includes/object-cache.php web/app/object-cache.php

WORKDIR $THEME_ROOT
RUN composer install --no-interaction --no-scripts --no-ansi --optimize-autoloader --no-dev

USER www-data
ENTRYPOINT ["apache2ctl", "-D", "FOREGROUND"]
