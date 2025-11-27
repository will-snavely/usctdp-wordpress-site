import subprocess
import argparse
import getpass
from collections import OrderedDict

class EnvConfig:
    def __init__(self):
        self.env_vars = {}

    @classmethod
    def from_env_file(cls, path):
        with open(path, 'r') as f:
            lines = [line.strip() for line in f.readlines()]
            lines = [line for line in lines if line and not line.startswith('#')]
        result = cls()
        result.env_vars = dict([line.split('=', 1) for line in lines])
        return result

    def get(self, key):
        return self.env_vars.get(key)

def read_hosts_file():
    hosts_mappings = OrderedDict()
    try:
        with open('/etc/hosts', 'r') as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith('#'):
                    continue
                parts = line.split()
                if len(parts) >= 2:
                    ip_address = parts[0]
                    hostnames = parts[1:]
                    hosts_mappings[ip_address] = hostnames
    except FileNotFoundError:
        print(f"Error: hosts file not found at /etc/hosts")
    except Exception as e:
        print(f"Error parsing hosts file: {e}")
    
    return hosts_mappings

def init(config):
    dev_group_id = config.get('DEV_GROUP_ID')
    dev_group_name = config.get('LOCAL_DEV_GROUP_NAME')
    site_url = config.get('SITE_URL')

    commands = [
        ['sudo', 'groupadd', '-fg', dev_group_id, dev_group_name],
        ['sudo', 'usermod', '-a', '-G', dev_group_name, getpass.getuser()],
        ['sudo', 'chgrp', '-R', dev_group_name, 'projects'],
        ['sudo', 'chmod', '-R', 'g+rw', 'projects']
    ]

    for cmd in commands:
        print(f"[config.py] {' '.join(cmd)}")
        subprocess.run(cmd, check=True)

    """
    hosts_mappings = read_hosts_file()
    local_ip = '127.0.0.1'
    mapped_hostname = site_url.split('://')[1]
    if local_ip not in hosts_mappings:
        print(f"[config.py] Adding {local_ip} {mapped_hostname} to /etc/hosts")
        subprocess.run(['sudo', 'echo', f'{local_ip} {mapped_hostname}', '>>', '/etc/hosts'], check=True)
    else:
        if mapped_hostname not in hosts_mappings[local_ip]:
            print(f"[config.py] Updating {local_ip} in /etc/hosts")
            subprocess.run(['sudo', 'sed', '-i', f'/{local_ip}/s/$/ {mapped_hostname}/', '/etc/hosts'], check=True)
        else:
            print(f"[config.py] {local_ip} {mapped_hostname} already exists in /etc/hosts")
    """
if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('env_file', type=str, help='Path to the .env file') 
    args = parser.parse_args()
    config = EnvConfig.from_env_file(args.env_file)
    init(config)
