import subprocess
import argparse
import getpass
from collections import OrderedDict
from pathlib import Path
from usctdp_env import UsctdpConfig

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('env', type=str, help='Path to the env file')
    parser.add_argument('template', type=str, help='Path to the nginx conf template file')
    parser.add_argument('out', type=str, help='The output ')

    args = parser.parse_args()
    config = UsctdpConfig.from_env_file(args.env)

    with open(args.template, 'r') as file:
        content = file.read()
    updated_content = content
    updated_content = updated_content.replace('WEB_HOSTNAME', config.get("WEB_HOSTNAME"))
    updated_content = updated_content.replace('PROXY_PORT_HTTP', config.get('PROXY_PORT_HTTP'))
    updated_content = updated_content.replace('PROXY_PORT_HTTPS', config.get('PROXY_PORT_HTTPS'))

    with open(args.out, 'w') as file:
        file.write(updated_content)
