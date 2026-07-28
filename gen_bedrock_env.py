import argparse
import secrets
from pathlib import Path
from usctdp_env import UsctdpConfig

# Regenerating these on every deploy would silently invalidate every logged-in
# session and nonce (cookies signed with the old keys stop validating) - so
# this script preserves whatever is already in the output file and only
# generates fresh keys the first time it's run for a given output path.
AUTH_KEYS = [
    "AUTH_KEY",
    "SECURE_AUTH_KEY",
    "LOGGED_IN_KEY",
    "NONCE_KEY",
    "AUTH_SALT",
    "SECURE_AUTH_SALT",
    "LOGGED_IN_SALT",
    "NONCE_SALT",
]


def load_existing_auth_keys(out_path):
    keys = {}
    if not out_path.exists():
        return keys
    for line in out_path.read_text().splitlines():
        if "=" not in line:
            continue
        key, _, value = line.partition("=")
        if key in AUTH_KEYS:
            keys[key] = value.strip().strip('"')
    return keys


def build_config(env, out_path, project):
    config = {}
    config["DB_NAME"] = env.get("WORDPRESS_DB")
    config["DB_USER"] = env.get("WORDPRESS_DB_USER")
    with open(env.get("DB_WORDPRESS_PASSWORD_FILE")) as f:
        config["DB_PASSWORD"] = f.read().strip()
    config["DB_HOST"] = "db:3306"

    config["WP_ENV"] = env.get("WP_ENV")
    config["WP_DEBUG"] = env.get("WP_DEBUG")
    config["WP_DEBUG_DISPLAY"] = env.get("WP_DEBUG_DISPLAY")
    wp_home = f"{env.get('WEB_PROTOCOL')}://{env.get('WEB_HOSTNAME')}"
    config["WP_HOME"] = wp_home
    config["WP_SITEURL"] = f"{wp_home}/wp"
    config["WP_DEBUG_LOG"] = f"/www/srv/{project}/web/app/debug.log"

    smtp_host = env.get("WORDPRESS_SMTP_HOST")
    if smtp_host:
        config["SMTP_HOST"] = smtp_host
        for out_key, env_key in [
            ("SMTP_PORT", "WORDPRESS_SMTP_PORT"),
            ("SMTP_ENCRYPTION", "WORDPRESS_SMTP_ENCRYPTION"),
            ("SMTP_USER", "WORDPRESS_SMTP_USER"),
            ("SMTP_FROM_EMAIL", "WORDPRESS_SMTP_FROM_EMAIL"),
            ("SMTP_FROM_NAME", "WORDPRESS_SMTP_FROM_NAME"),
        ]:
            value = env.get(env_key)
            if value:
                config[out_key] = value
        smtp_pass_file = env.get("SMTP_PASSWORD_FILE")
        if smtp_pass_file:
            with open(smtp_pass_file) as f:
                config["SMTP_PASS"] = f.read().strip()

    existing_keys = load_existing_auth_keys(out_path)
    for key in AUTH_KEYS:
        config[key] = existing_keys.get(key) or secrets.token_urlsafe(64)

    return config


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Generate the bedrock .env file on the host so it can be "
        "bind-mounted into the web container, instead of being regenerated "
        "inside the container on every deploy."
    )
    parser.add_argument("env_file", type=str, help="Path to the .env.prod file")
    parser.add_argument("out", type=str, help="Path to write the bedrock .env to")
    parser.add_argument(
        "--extra", type=str, default=None,
        help="Optional .env.extra file whose contents are appended verbatim",
    )
    parser.add_argument("--project", type=str, default="usctdp-bedrock")
    args = parser.parse_args()

    env = UsctdpConfig.from_env_file(args.env_file)
    out_path = Path(args.out)
    config = build_config(env, out_path, args.project)

    extra_config = ""
    if args.extra and Path(args.extra).exists():
        extra_config = Path(args.extra).read_text()

    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w") as f:
        for k, v in config.items():
            if str(v).lower() in ("true", "false"):
                f.write(f'{k}={str(v).lower()}\n')
            else:
                f.write(f'{k}="{v}"\n')
        f.write(extra_config)
