import subprocess
import argparse
import getpass
from collections import OrderedDict
from usctdp_env import Usctdp_Config


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
    parser.add_argument('mode', type=str, help='The current mode') 
    args = parser.parse_args()
    config = Usctdp_Config.from_env_file(args.env_file)
    if(args.mode == "dev"):
        init(config)
