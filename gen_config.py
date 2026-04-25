import subprocess
import argparse
import getpass
from collections import OrderedDict
from pathlib import Path

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

    def set(self, key, value):
        self.env_vars[key] = value
    
    def write(self, f):
        for key in self.env_vars:
            value = self.env_vars[key]
            f.write(f"{key}={value}\n")

def apply_dev_config(env):
    current_dir = Path.cwd()
    env.set("DB_WORDPRESS_PASSWORD_FILE", str(current_dir / '.secret_db_password_dev')) 
    env.set("DB_ROOT_PASSWORD_FILE", str(current_dir / '.secret_db_root_password_dev')) 
    env.set("WP_ADMIN_PASSWORD_FILE", str(current_dir / '.secret_admin_password_dev')) 
    env.set("PROJECTS_DIR", str(current_dir / 'projects'))

def apply_prod_config(env):
    current_dir = Path.cwd()
    env.set("DB_WORDPRESS_PASSWORD_FILE", str(current_dir / '.secret_db_password_prod')) 
    env.set("DB_ROOT_PASSWORD_FILE", str(current_dir / '.secret_db_root_password_prod')) 
    env.set("WP_ADMIN_PASSWORD_FILE", str(current_dir / '.secret_admin_password_prod')) 

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('template', type=str, help='Path to the .env template file')
    parser.add_argument('mode', type=str, help='The current mode (dev/prod)')
    args = parser.parse_args()
    config = EnvConfig.from_env_file(args.template)
    if args.mode == "dev":
        apply_dev_config(config)
        with open(".env.dev", "w") as f:
            config.write(f)
    if args.mode == "prod":
        apply_prod_config(config)
        with open(".env.prod", "w") as f:
            config.write(f)
