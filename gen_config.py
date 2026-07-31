import subprocess
import argparse
import getpass
from collections import OrderedDict
from pathlib import Path
from usctdp_env import UsctdpConfig

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
    env.set("BACKUP_S3_KEY_FILE", str(current_dir / '.secret_s3_key_file_prod'))
    env.set("BACKUP_S3_SECRET_FILE", str(current_dir / '.secret_s3_secret_file_prod'))
    env.set("SMTP_PASSWORD_FILE", str(current_dir / '.secret_smtp_password_prod'))

def apply_test_config(env):
    current_dir = Path.cwd()
    env.set("DB_WORDPRESS_PASSWORD_FILE", str(current_dir / '.secret_db_password_test'))
    env.set("DB_ROOT_PASSWORD_FILE", str(current_dir / '.secret_db_root_password_test'))
    env.set("WP_ADMIN_PASSWORD_FILE", str(current_dir / '.secret_admin_password_test'))
    env.set("PROJECTS_DIR", str(current_dir / 'projects_test'))

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('template', type=str, help='Path to the .env template file')
    parser.add_argument('mode', type=str, help='The current mode (dev/prod/test)')
    args = parser.parse_args()
    config = UsctdpConfig.from_env_file(args.template)
    if args.mode == "dev":
        apply_dev_config(config)
        with open(".env.dev", "w") as f:
            config.write(f)
    if args.mode == "prod":
        apply_prod_config(config)
        with open(".env.prod", "w") as f:
            config.write(f)
    if args.mode == "test":
        apply_test_config(config)
        with open(".env.test", "w") as f:
            config.write(f)
