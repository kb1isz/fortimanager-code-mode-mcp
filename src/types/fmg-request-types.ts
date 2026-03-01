/**
 * FortiManager Request Types — TypeScript declarations for the sandbox
 *
 * These type definitions are embedded in the `execute` tool description
 * so the LLM knows how to construct correct API calls inside the sandbox.
 */

/**
 * The `fortimanager` global available in the execute sandbox.
 *
 * @example
 * ```js
 * // List all ADOMs
 * const response = await fortimanager.request('get', [{ url: '/dvmdb/adom' }]);
 * response.result[0].data;
 *
 * // Get a specific firewall address
 * const response = await fortimanager.request('get', [{
 *   url: '/pm/config/adom/root/obj/firewall/address/my-address'
 * }]);
 *
 * // Create a new address object
 * const response = await fortimanager.request('add', [{
 *   url: '/pm/config/adom/root/obj/firewall/address',
 *   data: { name: 'test-addr', subnet: '10.0.0.0/24' }
 * }]);
 *
 * // Execute a device proxy call
 * const response = await fortimanager.request('exec', [{
 *   url: '/sys/proxy/json',
 *   data: {
 *     target: ['adom/root/device/my-fortigate'],
 *     action: 'get',
 *     resource: '/api/v2/monitor/system/interface'
 *   }
 * }]);
 * ```
 */
export interface FortiManagerProxy {
  /**
   * Send a JSON-RPC request to FortiManager.
   *
   * @param method - JSON-RPC method: 'get' | 'set' | 'add' | 'update' | 'delete' | 'exec' | 'clone' | 'move'
   * @param params - Array of parameter objects, each with at least a `url` field
   * @returns The full JSON-RPC response object
   */
  request(method: string, params: RequestParams[]): Promise<JsonRpcResponse>;
}

export interface RequestParams {
  /** The API URL path (e.g., '/dvmdb/adom') */
  url: string;
  /** Request data payload */
  data?: unknown;
  /** Request options */
  option?: string | string[];
  /** Filter expression */
  filter?: unknown;
  /** Fields to return */
  fields?: string[];
  /** Sort order */
  sortings?: Array<Record<string, 1 | -1>>;
  /** Range [start, count] for pagination */
  range?: [number, number];
  /** Load sub-tables (0 or 1) */
  loadsub?: 0 | 1;
}

export interface JsonRpcResponse {
  id: number;
  result: Array<{
    status: { code: number; message: string };
    url: string;
    data?: unknown;
  }>;
  session?: string;
}
