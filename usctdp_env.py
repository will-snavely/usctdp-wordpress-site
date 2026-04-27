class UsctdpConfig:
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

