/**
 * FortiManager Authentication Providers
 *
 * Token-based (stateless) and session-based (login/logout) auth strategies.
 */

import type { FmgClientConfig } from './types.js';

// ─── Auth Provider Interface ────────────────────────────────────────

/** Authentication provider that produces headers/session for requests */
export interface AuthProvider {
  /** Get authentication headers for an HTTP request */
  getAuthHeaders(): Record<string, string>;

  /** Get session ID for inclusion in JSON-RPC body (null for token auth) */
  getSession(): string | null;

  /** Initialize the auth provider (e.g., login for session-based) */
  initialize?(): Promise<void>;

  /** Clean up the auth provider (e.g., logout for session-based) */
  dispose?(): Promise<void>;
}

// ─── Token Auth Provider ────────────────────────────────────────────

/**
 * Stateless token-based authentication.
 * Uses the `Authorization: Bearer <token>` header.
 * No login/logout lifecycle needed.
 */
export class TokenAuthProvider implements AuthProvider {
  private readonly token: string;

  constructor(config: FmgClientConfig) {
    this.token = config.apiToken;
  }

  getAuthHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.token}`,
    };
  }

  getSession(): string | null {
    return null;
  }
}

// ─── Session Auth Provider ──────────────────────────────────────────

/**
 * Session-based authentication.
 * Performs login to obtain a session ID, includes it in every request,
 * and logs out when disposed.
 */
export class SessionAuthProvider implements AuthProvider {
  private session: string | null = null;
  private readonly config: FmgClientConfig;
  private readonly endpoint: string;

  constructor(config: FmgClientConfig) {
    this.config = config;
    this.endpoint = `${config.host}:${config.port}/jsonrpc`;
  }

  getAuthHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
    };
  }

  getSession(): string | null {
    return this.session;
  }

  initialize(): Promise<void> {
    // Session auth requires a login call — this would need
    // username/password rather than a token. For now, this provider
    // exists as a placeholder; the primary path uses TokenAuthProvider.
    return Promise.reject(
      new Error(
        'SessionAuthProvider.initialize() requires username/password credentials. ' +
          'Use TokenAuthProvider with FMG_API_TOKEN for token-based authentication.',
      ),
    );
  }

  async dispose(): Promise<void> {
    if (!this.session) return;

    try {
      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 1,
          method: 'exec',
          params: [{ url: 'sys/logout' }],
          session: this.session,
        }),
      });

      if (!response.ok) {
        console.error(`Logout failed with HTTP ${response.status}`);
      }
    } catch (err: unknown) {
      console.error('Error during logout:', err);
    } finally {
      this.session = null;
    }
  }
}

// ─── Factory ────────────────────────────────────────────────────────

/**
 * Create the appropriate auth provider based on config.
 * Currently always returns TokenAuthProvider since API tokens
 * are the recommended approach (FMG 7.2.2+).
 */
export function createAuthProvider(config: FmgClientConfig): AuthProvider {
  return new TokenAuthProvider(config);
}
