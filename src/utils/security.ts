/**
 * Security utilities for input validation and XSS prevention
 */

/**
 * Maximum allowed file sizes by type (in bytes)
 */
export const FILE_SIZE_LIMITS = {
  image: 10 * 1024 * 1024,       // 10MB for images
  document: 25 * 1024 * 1024,   // 25MB for documents
  attachment: 50 * 1024 * 1024, // 50MB for general attachments
  avatar: 2 * 1024 * 1024,      // 2MB for avatars
} as const;

/**
 * Allowed MIME types for file uploads
 */
export const ALLOWED_MIME_TYPES = {
  image: ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml'],
  document: [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain',
    'text/markdown',
    'text/csv',
  ],
  code: [
    'text/javascript',
    'application/javascript',
    'text/typescript',
    'application/json',
    'text/html',
    'text/css',
    'text/x-python',
    'text/x-java-source',
  ],
} as const;

/**
 * HTML entities for XSS prevention
 */
const HTML_ENTITIES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#x27;',
  '/': '&#x2F;',
  '`': '&#x60;',
  '=': '&#x3D;',
};

/**
 * Escape HTML special characters to prevent XSS attacks
 * Use this for any user-generated content that will be rendered as HTML
 */
export function escapeHtml(input: string): string {
  return input.replace(/[&<>"'`=/]/g, (char) => HTML_ENTITIES[char] || char);
}

/**
 * Sanitize a string by removing potentially dangerous characters
 * Use for things like filenames, labels, etc.
 */
export function sanitizeString(input: string, options?: {
  maxLength?: number;
  allowNewlines?: boolean;
  allowHtml?: boolean;
}): string {
  let result = input;

  // Remove null bytes
  result = result.replace(/\0/g, '');

  // Remove control characters (except newlines if allowed)
  if (options?.allowNewlines) {
    result = result.replace(/[\x00-\x09\x0B\x0C\x0E-\x1F\x7F]/g, '');
  } else {
    result = result.replace(/[\x00-\x1F\x7F]/g, '');
  }

  // Escape HTML unless explicitly allowed
  if (!options?.allowHtml) {
    result = escapeHtml(result);
  }

  // Truncate to max length
  if (options?.maxLength && result.length > options.maxLength) {
    result = result.slice(0, options.maxLength);
  }

  return result.trim();
}

/**
 * Dangerous shell metacharacters and injection patterns
 */
const SHELL_INJECTION_PATTERNS = [
  /[;&|`$(){}[\]<>\\]/,      // Shell metacharacters
  /\$\(/,                     // Command substitution
  /`/,                        // Backtick substitution
  /\|\|/,                     // OR operator
  /&&/,                       // AND operator
  /[><]/,                     // Redirects
  /\n|\r/,                    // Newlines (command separators)
  /\0/,                       // Null byte
];

/**
 * Allowlist of safe commands for scheduled jobs
 * Extend this list based on your application needs
 */
export const ALLOWED_SCRIPT_COMMANDS = new Set([
  // Node/npm commands
  'node',
  'npm',
  'npx',
  'pnpm',
  'yarn',
  // System utilities
  'curl',
  'wget',
  'echo',
  'date',
  // Database utilities
  'sqlite3',
  // Git
  'git',
]);

/**
 * Validate a command to prevent command injection
 * Returns validation result with detailed error messages
 */
export function validateCommand(command: string, args?: string[]): {
  valid: boolean;
  error?: string;
  sanitizedCommand?: string;
  sanitizedArgs?: string[];
} {
  // Check the command itself
  if (!command || typeof command !== 'string') {
    return { valid: false, error: 'Command is required' };
  }

  // Extract base command (remove path)
  const baseCommand = command.includes('/') 
    ? command.split('/').pop() || command
    : command;

  // Check if command is in allowlist
  if (!ALLOWED_SCRIPT_COMMANDS.has(baseCommand)) {
    return { 
      valid: false, 
      error: `Command '${baseCommand}' is not in the allowlist. Allowed commands: ${[...ALLOWED_SCRIPT_COMMANDS].join(', ')}` 
    };
  }

  // Check command for injection patterns
  for (const pattern of SHELL_INJECTION_PATTERNS) {
    if (pattern.test(command)) {
      return { valid: false, error: 'Command contains potentially dangerous characters' };
    }
  }

  // Validate and sanitize arguments
  const sanitizedArgs: string[] = [];
  if (args) {
    for (const arg of args) {
      if (typeof arg !== 'string') {
        return { valid: false, error: 'Arguments must be strings' };
      }
      
      // Check each argument for injection
      for (const pattern of SHELL_INJECTION_PATTERNS) {
        if (pattern.test(arg)) {
          return { 
            valid: false, 
            error: `Argument '${arg.slice(0, 20)}...' contains potentially dangerous characters` 
          };
        }
      }
      
      // Sanitize: escape single quotes and wrap in quotes if has spaces
      let sanitized = arg;
      if (arg.includes(' ') || arg.includes("'") || arg.includes('"')) {
        // Use single quotes and escape internal single quotes
        sanitized = "'" + arg.replace(/'/g, "'\\''") + "'";
      }
      sanitizedArgs.push(sanitized);
    }
  }

  return {
    valid: true,
    sanitizedCommand: command,
    sanitizedArgs,
  };
}

/**
 * Sanitize a filename to prevent path traversal and other attacks
 */
export function sanitizeFilename(filename: string): string {
  // Remove path separators
  let result = filename.replace(/[/\\]/g, '');
  
  // Remove leading dots (hidden files / directory traversal)
  result = result.replace(/^\.+/, '');
  
  // Remove control characters
  result = result.replace(/[\x00-\x1F\x7F]/g, '');
  
  // Remove potentially dangerous characters
  result = result.replace(/[<>:"|?*]/g, '');
  
  // Limit length
  if (result.length > 255) {
    const ext = result.slice(result.lastIndexOf('.'));
    const name = result.slice(0, result.lastIndexOf('.'));
    result = name.slice(0, 255 - ext.length) + ext;
  }
  
  // If nothing left, use default
  return result || 'unnamed_file';
}

/**
 * Validate file upload metadata
 */
export function validateFileUpload(file: {
  fileName: string;
  fileType?: string;
  fileSize?: number;
}, options?: {
  maxSize?: number;
  allowedTypes?: string[];
  category?: keyof typeof FILE_SIZE_LIMITS;
}): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  // Check file size
  const maxSize = options?.maxSize ?? 
    (options?.category ? FILE_SIZE_LIMITS[options.category] : FILE_SIZE_LIMITS.attachment);
  
  if (file.fileSize && file.fileSize > maxSize) {
    const maxMB = (maxSize / (1024 * 1024)).toFixed(1);
    const actualMB = (file.fileSize / (1024 * 1024)).toFixed(1);
    errors.push(`File size ${actualMB}MB exceeds maximum allowed ${maxMB}MB`);
  }

  // Check file type if restrictions specified
  if (options?.allowedTypes && file.fileType) {
    if (!options.allowedTypes.includes(file.fileType)) {
      errors.push(`File type '${file.fileType}' is not allowed`);
    }
  }

  // Validate filename
  const sanitizedName = sanitizeFilename(file.fileName);
  if (sanitizedName !== file.fileName) {
    // Name was modified, could indicate attack attempt
    errors.push('Filename contains invalid characters');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validate URL to prevent SSRF and unsafe redirects
 */
export function validateUrl(url: string, options?: {
  allowedProtocols?: string[];
  allowedHosts?: string[];
  blockLocalhost?: boolean;
}): { valid: boolean; error?: string } {
  try {
    const parsed = new URL(url);
    
    // Check protocol
    const allowedProtocols = options?.allowedProtocols ?? ['https:', 'http:'];
    if (!allowedProtocols.includes(parsed.protocol)) {
      return { valid: false, error: `Protocol ${parsed.protocol} not allowed` };
    }

    // Block localhost/internal IPs if specified
    if (options?.blockLocalhost !== false) {
      const host = parsed.hostname.toLowerCase();
      const localPatterns = [
        'localhost',
        '127.0.0.1',
        '0.0.0.0',
        '::1',
        /^10\./,
        /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
        /^192\.168\./,
        /^169\.254\./,
      ];
      
      for (const pattern of localPatterns) {
        if (typeof pattern === 'string') {
          if (host === pattern || host.endsWith('.' + pattern)) {
            return { valid: false, error: 'Internal URLs not allowed' };
          }
        } else if (pattern.test(host)) {
          return { valid: false, error: 'Internal URLs not allowed' };
        }
      }
    }

    // Check allowed hosts if specified
    if (options?.allowedHosts && options.allowedHosts.length > 0) {
      if (!options.allowedHosts.includes(parsed.hostname)) {
        return { valid: false, error: `Host ${parsed.hostname} not in allowed list` };
      }
    }

    return { valid: true };
  } catch {
    return { valid: false, error: 'Invalid URL format' };
  }
}

/**
 * Check if a redirect URL is safe (same-origin or relative path)
 * Use this to prevent open redirect vulnerabilities
 */
export function isSafeRedirectUrl(redirectUrl: string, requestUrl: string): boolean {
  try {
    // Relative paths starting with / are safe (but not //)
    if (redirectUrl.startsWith('/') && !redirectUrl.startsWith('//')) {
      return true;
    }
    
    // Parse URLs and compare origins
    const request = new URL(requestUrl);
    const target = new URL(redirectUrl, request.origin);
    
    return target.origin === request.origin;
  } catch {
    return false;
  }
}

/**
 * Redact sensitive values from objects before logging
 * Returns a deep copy with sensitive fields replaced
 */
export function redactSensitive<T>(obj: T, additionalKeys?: string[]): T {
  // All keys here should be lowercase since we compare against key.toLowerCase()
  const sensitiveKeys = new Set([
    'password',
    'token',
    'secret',
    'apikey',
    'api_key',
    'accesstoken',
    'access_token',
    'refreshtoken',
    'refresh_token',
    'sessiontoken',
    'session_token',
    'authorization',
    'cookie',
    'credentials',
    'privatekey',
    'private_key',
    ...(additionalKeys?.map(k => k.toLowerCase()) ?? []),
  ]);

  function redact(value: unknown, key?: string): unknown {
    if (value === null || value === undefined) {
      return value;
    }

    // Check if this key should be redacted
    if (key && sensitiveKeys.has(key.toLowerCase())) {
      return '[REDACTED]';
    }

    if (typeof value === 'string') {
      // Redact values that look like secrets
      if (value.length > 20 && /^[a-zA-Z0-9+/=_-]+$/.test(value)) {
        // Looks like a base64 or JWT token
        return value.slice(0, 8) + '...[REDACTED]';
      }
      return value;
    }

    if (Array.isArray(value)) {
      return value.map((item) => redact(item));
    }

    if (typeof value === 'object') {
      const result: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value)) {
        result[k] = redact(v, k);
      }
      return result;
    }

    return value;
  }

  return redact(obj) as T;
}
