import argparse
from pathlib import Path
from usctdp_env import UsctdpConfig

APACHE_CONFIG = """
<VirtualHost *:{web_port}>
    ServerName {web_service_name}
    DocumentRoot {wp_root}
    <Directory {wp_root}>
        Options FollowSymLinks
        AllowOverride All
        DirectoryIndex index.php
        Require all granted
    </Directory>
</VirtualHost>
"""

if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Generate the apache vhost config on the host so it can "
        "be bind-mounted into the web container, instead of being "
        "regenerated inside the container on every deploy."
    )
    parser.add_argument("env_file", type=str, help="Path to the .env.prod file")
    parser.add_argument("out", type=str, help="Path to write the vhost config to")
    parser.add_argument("--project", type=str, default="usctdp-bedrock")
    args = parser.parse_args()

    env = UsctdpConfig.from_env_file(args.env_file)
    web_root = f"/www/srv/{args.project}/web/"
    web_port = env.get("WEB_PORT_HTTP")

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(APACHE_CONFIG.format(
        wp_root=web_root, web_service_name="web", web_port=web_port))
