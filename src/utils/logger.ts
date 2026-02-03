const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m',
};

const getTimestamp = () => new Date().toISOString();

export const logger = {
  info: (message: string, ...args: any[]) => {
    console.log(
      `${colors.blue}[INFO]${colors.reset} ${colors.dim}${getTimestamp()}${colors.reset} - ${message}`,
      ...args
    );
  },

  success: (message: string, ...args: any[]) => {
    console.log(
      `${colors.green}[SUCCESS]${colors.reset} ${colors.dim}${getTimestamp()}${colors.reset} - ${message}`,
      ...args
    );
  },

  error: (message: string, error?: any) => {
    console.error(
      `${colors.red}[ERROR]${colors.reset} ${colors.dim}${getTimestamp()}${colors.reset} - ${message}`,
      error
    );
  },

  warn: (message: string, ...args: any[]) => {
    console.warn(
      `${colors.yellow}[WARN]${colors.reset} ${colors.dim}${getTimestamp()}${colors.reset} - ${message}`,
      ...args
    );
  },
};