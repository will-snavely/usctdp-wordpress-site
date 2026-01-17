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


def init(config):
    dev_group_id = config.get('DEV_GROUP_ID')
    dev_group_name = config.get('LOCAL_DEV_GROUP_NAME')

    commands = [
        ['sudo', 'groupadd', '-fg', dev_group_id, dev_group_name],
        ['sudo', 'usermod', '-a', '-G', dev_group_name, getpass.getuser()],
        ['sudo', 'chgrp', '-R', dev_group_name, 'projects'],
        ['sudo', 'chmod', '-R', 'g+rw', 'projects']
    ]

    for cmd in commands:
        print(f"[config.py] {' '.join(cmd)}")
        subprocess.run(cmd, check=True)

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('env_file', type=str, help='Path to the .env file') 
    args = parser.parse_args()
    config = EnvConfig.from_env_file(args.env_file)
    init(config)
