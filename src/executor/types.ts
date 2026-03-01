/**
 * Executor Types — Result interfaces for sandbox execution
 */

/** Result from executing code in the QuickJS sandbox */
export interface ExecuteResult {
  /** Whether execution succeeded */
  ok: boolean;
  /** The result data returned by the executed code */
  data?: unknown;
  /** Error message if execution failed */
  error?: string;
  /** Console log output captured during execution */
  logs: LogEntry[];
  /** Execution duration in milliseconds */
  durationMs: number;
}

/** A captured console log entry */
export interface LogEntry {
  /** Log level */
  level: 'log' | 'info' | 'warn' | 'error';
  /** Log message */
  message: string;
  /** Timestamp */
  timestamp: number;
}

/** Options for sandbox execution */
export interface ExecutorOptions {
  /** Maximum execution time in milliseconds (default: 30000) */
  timeoutMs?: number;
  /** Maximum memory in bytes (default: 64MB) */
  maxMemoryBytes?: number;
}

/** Default executor options */
export const DEFAULT_EXECUTOR_OPTIONS: Required<ExecutorOptions> = {
  timeoutMs: 30_000,
  maxMemoryBytes: 64 * 1024 * 1024,
};
