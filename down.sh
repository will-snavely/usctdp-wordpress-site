docker compose  --env-file .env -f sage_dev/compose.yaml -f sage_dev/compose.$1.yaml down -v
