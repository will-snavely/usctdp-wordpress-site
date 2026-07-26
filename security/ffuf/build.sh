#!/bin/sh
# Builds the local ffuf image from ./Dockerfile. Re-run after bumping
# FFUF_VERSION in the Dockerfile to upgrade.
set -eu
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
: "${IMAGE_TAG:=usctdp-ffuf:2.2.1}"

docker build -t "$IMAGE_TAG" "$SCRIPT_DIR"
echo "Built $IMAGE_TAG"
