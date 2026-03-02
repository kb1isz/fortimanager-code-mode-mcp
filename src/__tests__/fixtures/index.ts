/**
 * Test Fixtures — Sample data for unit and integration tests.
 */

import type { FmgApiSpec } from '../../types/spec-types.js';
import type { JsonRpcResponse } from '../../client/types.js';

// ─── Minimal API Spec ───────────────────────────────────────────────

/**
 * A small API spec with 2 modules, a few objects, and some error codes.
 * Used by SearchExecutor and MCP server integration tests.
 */
export const SAMPLE_SPEC: FmgApiSpec = {
  version: '7.6',
  build: '0001',
  generatedAt: '2026-01-01T00:00:00.000Z',
  modules: [
    {
      name: 'sys',
      title: 'System',
      methods: [
        { id: 'get', name: 'get', description: 'Retrieve objects', params: [] },
        { id: 'exec', name: 'exec', description: 'Execute commands', params: [] },
      ],
      objects: [
        {
          name: 'sys/status',
          type: 'object',
          description: 'System status information including version and hostname.',
          urls: [{ category: 'Object', path: '/sys/status' }],
          methods: ['get'],
          attributes: [
            {
              name: 'Version',
              type: 'string',
              description: 'FortiManager version',
            },
            {
              name: 'Hostname',
              type: 'string',
              description: 'FortiManager hostname',
            },
            {
              name: 'Serial Number',
              type: 'string',
              description: 'Unit serial number',
            },
          ],
        },
      ],
    },
    {
      name: 'firewall',
      title: 'Firewall Objects',
      methods: [
        { id: 'get', name: 'get', description: 'Retrieve objects', params: [] },
        { id: 'add', name: 'add', description: 'Create objects', params: [] },
        { id: 'set', name: 'set', description: 'Replace objects', params: [] },
        { id: 'update', name: 'update', description: 'Partially update objects', params: [] },
        { id: 'delete', name: 'delete', description: 'Delete objects', params: [] },
      ],
      objects: [
        {
          name: 'firewall/address',
          type: 'table',
          description: 'IPv4 address objects used in firewall policies.',
          urls: [
            {
              category: 'Table',
              path: '/pm/config/adom/{adom}/obj/firewall/address',
            },
            {
              category: 'Table',
              path: '/pm/config/global/obj/firewall/address',
            },
          ],
          methods: ['get', 'add', 'set', 'update', 'delete'],
          attributes: [
            { name: 'name', type: 'string', description: 'Address name' },
            { name: 'subnet', type: 'array', description: 'IP/Netmask pair' },
            { name: 'type', type: 'integer', description: 'Address type' },
            { name: 'comment', type: 'string', description: 'Comment' },
            {
              name: 'associated-interface',
              type: 'string',
              description: 'Associated interface',
            },
          ],
        },
        {
          name: 'firewall/addrgrp',
          type: 'table',
          description: 'Firewall address groups.',
          urls: [
            {
              category: 'Table',
              path: '/pm/config/adom/{adom}/obj/firewall/addrgrp',
            },
          ],
          methods: ['get', 'add', 'set', 'update', 'delete'],
          attributes: [
            { name: 'name', type: 'string', description: 'Group name' },
            { name: 'member', type: 'array', description: 'Member addresses' },
            { name: 'comment', type: 'string', description: 'Comment' },
          ],
        },
      ],
    },
  ],
  errors: [
    { code: 0, message: 'Success' },
    { code: -2, message: 'Invalid URL' },
    { code: -6, message: 'No permission' },
    { code: -10, message: 'Object not found' },
  ],
};

// ─── Sample JSON-RPC Responses ──────────────────────────────────────

export function makeSuccessResponse<T>(id: number, url: string, data: T): JsonRpcResponse<T> {
  return {
    id,
    result: [
      {
        status: { code: 0, message: 'OK' },
        url,
        data,
      },
    ],
  };
}

export function makeErrorResponse(
  id: number,
  url: string,
  code: number,
  message: string,
): JsonRpcResponse {
  return {
    id,
    result: [
      {
        status: { code, message },
        url,
      },
    ],
  };
}

// ─── Client Config ──────────────────────────────────────────────────

export const SAMPLE_CLIENT_CONFIG = {
  host: 'https://fmg.example.com',
  port: 443,
  apiToken: 'test-api-token-12345',
  verifySsl: true,
} as const;
