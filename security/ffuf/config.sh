# Shared defaults for the ffuf scripts in this directory. Sourced after the
# calling script sets SCRIPT_DIR.
#
# Override before running a script, e.g.:
#   BASE_URL=https://staging.example.com ./fuzz-admin-ajax.sh
#
# BASE_URL defaults to the local dev stack. Point it at anything else
# deliberately - fuzzing production generates real load, and the wp-login.php
# rate limiter (prod only, see check-login-rate-limit.sh) will start
# rejecting requests partway through a run.
: "${BASE_URL:=http://127.0.0.1}"
: "${THREADS:=20}"
: "${RATE:=50}"
: "${IMAGE_TAG:=usctdp-ffuf:2.2.1}"

if ! docker image inspect "$IMAGE_TAG" >/dev/null 2>&1; then
  echo "$IMAGE_TAG not found - run ./build.sh first." >&2
  exit 1
fi

# --network host requires a Linux Docker host (true for WSL2). On other
# setups, drop this flag and target host.docker.internal instead.
FFUF_DOCKER_RUN="docker run --rm --network host -v $SCRIPT_DIR/wordlists:/wordlists:ro -v $SCRIPT_DIR/results:/results $IMAGE_TAG"
