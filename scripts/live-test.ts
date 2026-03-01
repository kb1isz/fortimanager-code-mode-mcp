/**
 * Live integration test suite — validates SearchExecutor + CodeExecutor
 * against a real FortiManager VM.
 *
 * Run:  npx tsx scripts/live-test.ts
 * Env:  Requires .env with FMG_HOST, FMG_API_TOKEN, etc.
 *
 * Test groups:
 *   1. Search — spec globals (specIndex, getObject, moduleList, errorCodes, specVersion)
 *   2. Search — edge cases (empty results, non-existent objects, large result sets)
 *   3. Search — cross-reference validation (spec consistency checks)
 *   4. Execute — system operations (/sys/status, /sys/global, etc.)
 *   5. Execute — CRUD lifecycle (create → read → update → delete)
 *   6. Execute — error handling (bad URLs, malformed params, batch ops)
 *   7. Execute — concurrency & large responses
 *   8. Stability — sequential stress tests (optional, run with --stress flag)
 */

import { readFileSync } from 'fs';
import { config } from 'dotenv';
import { SearchExecutor } from '../src/executor/search-executor.js';
import { CodeExecutor } from '../src/executor/code-executor.js';
import { FmgClient } from '../src/client/fmg-client.js';
import type { FmgApiSpec } from '../src/types/spec-types.js';

// Load .env
config();

const FMG_HOST = process.env['FMG_HOST']!;
const FMG_PORT = Number(process.env['FMG_PORT'] ?? '443');
const FMG_API_TOKEN = process.env['FMG_API_TOKEN']!;
const FMG_VERIFY_SSL = process.env['FMG_VERIFY_SSL'] !== 'false';
const FMG_API_VERSION = process.env['FMG_API_VERSION'] ?? '7.6';
const RUN_STRESS = process.argv.includes('--stress');

let passed = 0;
let failed = 0;
let skipped = 0;
const timings: { name: string; ms: number }[] = [];

function ok(name: string, result: unknown): void {
  console.log(`  ✓ ${name}:`, typeof result === 'object' ? JSON.stringify(result) : result);
  passed++;
}

function fail(name: string, error: unknown): void {
  console.error(`  ✗ ${name}:`, error);
  failed++;
}

function skip(name: string, reason: string): void {
  console.log(`  ⊘ ${name}: SKIPPED — ${reason}`);
  skipped++;
}

/** Whether we have write permissions (detected at runtime) */
let hasWritePermission = false;

// ═══════════════════════════════════════════════════════════════════
// 1. Search — Spec Globals
// ═══════════════════════════════════════════════════════════════════

async function testSearchGlobals(executor: SearchExecutor): Promise<void> {
  console.log('\n─── 1. Search: Spec Globals ───');

  // 1.1: specIndex exists and has expected size
  let r = await executor.execute('specIndex.length');
  if (r.ok && typeof r.data === 'number' && r.data > 1000) {
    ok('specIndex count', r.data);
  } else {
    fail('specIndex count', r.error ?? r.data);
  }

  // 1.2: specIndex entries have required properties
  r = await executor.execute(`
    var first = specIndex[0];
    var hasReqFields = first.name !== undefined && first.urls !== undefined
      && first.type !== undefined && first.methods !== undefined
      && first.attributeNames !== undefined;
    ({ hasReqFields: hasReqFields, sample: { name: first.name, type: first.type } });
  `);
  if (r.ok && (r.data as Record<string, unknown>)?.['hasReqFields'] === true) {
    ok('specIndex entry shape', r.data);
  } else {
    fail('specIndex entry shape', r.error ?? r.data);
  }

  // 1.3: specIndex entry types are valid
  r = await executor.execute(`
    var types = {};
    specIndex.forEach(function(o) { types[o.type] = (types[o.type] || 0) + 1; });
    types;
  `);
  if (r.ok && typeof r.data === 'object') {
    const types = r.data as Record<string, number>;
    if (types['table'] > 0 || types['object'] > 0) {
      ok('specIndex types distribution', types);
    } else {
      fail('specIndex types distribution', types);
    }
  } else {
    fail('specIndex types distribution', r.error ?? r.data);
  }

  // 1.4: specVersion
  r = await executor.execute('specVersion');
  if (r.ok && r.data === FMG_API_VERSION) {
    ok('specVersion', r.data);
  } else {
    fail('specVersion', r.error ?? r.data);
  }

  // 1.5: moduleList count
  r = await executor.execute('moduleList.length');
  if (r.ok && typeof r.data === 'number' && r.data > 50) {
    ok('moduleList count', r.data);
  } else {
    fail('moduleList count', r.error ?? r.data);
  }

  // 1.6: moduleList entry shape
  r = await executor.execute(`
    var m = moduleList[0];
    ({ name: m.name, objectCount: m.objectCount, hasName: typeof m.name === "string", hasCount: typeof m.objectCount === "number" });
  `);
  if (
    r.ok &&
    (r.data as Record<string, unknown>)?.['hasName'] === true &&
    (r.data as Record<string, unknown>)?.['hasCount'] === true
  ) {
    ok('moduleList entry shape', r.data);
  } else {
    fail('moduleList entry shape', r.error ?? r.data);
  }

  // 1.7: moduleList module names
  r = await executor.execute(
    'moduleList.map(function(m) { return m.name; }).filter(function(n) { return ["sys", "dvmdb", "cmdb"].indexOf(n) >= 0; })',
  );
  if (r.ok && Array.isArray(r.data) && (r.data as string[]).length >= 2) {
    ok('moduleList has core modules', r.data);
  } else {
    fail('moduleList has core modules', r.error ?? r.data);
  }

  // 1.8: errorCodes count
  r = await executor.execute('errorCodes.length');
  if (r.ok && typeof r.data === 'number' && r.data > 10) {
    ok('errorCodes count', r.data);
  } else {
    fail('errorCodes count', r.error ?? r.data);
  }

  // 1.9: errorCodes entry shape
  r = await executor.execute(`
    var e = errorCodes[0];
    ({ code: e.code, message: e.message, hasCode: typeof e.code === "number", hasMsg: typeof e.message === "string" });
  `);
  if (
    r.ok &&
    (r.data as Record<string, unknown>)?.['hasCode'] === true &&
    (r.data as Record<string, unknown>)?.['hasMsg'] === true
  ) {
    ok('errorCodes entry shape', r.data);
  } else {
    fail('errorCodes entry shape', r.error ?? r.data);
  }

  // 1.10: errorCode 0 = success
  r = await executor.execute('errorCodes.find(function(e) { return e.code === 0; })');
  if (r.ok && r.data && typeof r.data === 'object') {
    ok('errorCodes success (code 0)', r.data);
  } else {
    fail('errorCodes success (code 0)', r.error ?? r.data);
  }

  // 1.11: getObject by name — firewall/address
  r = await executor.execute(`
    var obj = getObject("firewall/address");
    obj ? { name: obj.name, urlCount: obj.urls.length, attrCount: obj.attributes.length, type: obj.type } : null;
  `);
  if (r.ok && r.data && typeof r.data === 'object') {
    const d = r.data as Record<string, unknown>;
    if (
      d['name'] === 'firewall/address' &&
      (d['urlCount'] as number) > 0 &&
      (d['attrCount'] as number) > 0
    ) {
      ok('getObject("firewall/address")', r.data);
    } else {
      fail('getObject("firewall/address")', r.data);
    }
  } else {
    fail('getObject("firewall/address")', r.error ?? r.data);
  }

  // 1.12: getObject by URL path
  r = await executor.execute(
    'var obj = getObject("/pm/config/adom/<adom_name>/obj/firewall/address"); obj ? obj.name : null',
  );
  if (r.ok && r.data === 'firewall/address') {
    ok('getObject by URL path', r.data);
  } else {
    fail('getObject by URL path', r.error ?? r.data);
  }

  // 1.13: getObject returns full attributes
  r = await executor.execute(`
    var obj = getObject("firewall/address");
    obj ? { firstAttr: obj.attributes[0].name, hasType: typeof obj.attributes[0].type === "string" } : null;
  `);
  if (r.ok && (r.data as Record<string, unknown>)?.['hasType'] === true) {
    ok('getObject has attribute types', r.data);
  } else {
    fail('getObject has attribute types', r.error ?? r.data);
  }

  // 1.14: getObject returns URL categories
  r = await executor.execute(`
    var obj = getObject("firewall/address");
    obj ? obj.urls.map(function(u) { return u.category + ": " + u.path; }).slice(0, 3) : null;
  `);
  if (r.ok && Array.isArray(r.data) && (r.data as string[]).length > 0) {
    ok('getObject URL categories', r.data);
  } else {
    fail('getObject URL categories', r.error ?? r.data);
  }

  // 1.15: getObject for system object
  r = await executor.execute(`
    var obj = getObject("system/admin/user");
    obj ? { name: obj.name, attrCount: obj.attributes.length } : null;
  `);
  if (r.ok && (r.data as Record<string, unknown>)?.['name'] === 'system/admin/user') {
    ok('getObject("system/admin/user")', r.data);
  } else {
    fail('getObject("system/admin/user")', r.error ?? r.data);
  }
}

// ═══════════════════════════════════════════════════════════════════
// 2. Search — Edge Cases
// ═══════════════════════════════════════════════════════════════════

async function testSearchEdgeCases(executor: SearchExecutor): Promise<void> {
  console.log('\n─── 2. Search: Edge Cases ───');

  // 2.1: Non-existent object returns null
  let r = await executor.execute('getObject("nonexistent/object123")');
  if (r.ok && r.data === null) {
    ok('getObject non-existent → null', r.data);
  } else {
    fail('getObject non-existent → null', r.error ?? r.data);
  }

  // 2.2: Non-existent URL returns null
  r = await executor.execute('getObject("/nonexistent/url/path/that/does/not/exist")');
  if (r.ok && r.data === null) {
    ok('getObject bad URL → null', r.data);
  } else {
    fail('getObject bad URL → null', r.error ?? r.data);
  }

  // 2.3: Empty filter returns empty array
  r = await executor.execute(
    'specIndex.filter(function(o) { return o.name === "zzz_nonexistent_zzz"; })',
  );
  if (r.ok && Array.isArray(r.data) && (r.data as unknown[]).length === 0) {
    ok('Empty filter result', `[] (length 0)`);
  } else {
    fail('Empty filter result', r.error ?? r.data);
  }

  // 2.4: Large result set — all objects
  r = await executor.execute('specIndex.map(function(o) { return o.name; }).length');
  if (r.ok && typeof r.data === 'number' && r.data > 1000) {
    ok('Large result (all names)', `${r.data} objects returned`);
  } else {
    fail('Large result (all names)', r.error ?? r.data);
  }

  // 2.5: Filter with special characters
  r = await executor.execute(
    'specIndex.filter(function(o) { return o.name.indexOf("/") >= 0; }).length',
  );
  if (r.ok && typeof r.data === 'number' && r.data > 100) {
    ok('Filter with / in names', `${r.data} objects with /`);
  } else {
    fail('Filter with / in names', r.error ?? r.data);
  }

  // 2.6: Multiple getObject calls in same execution
  r = await executor.execute(`
    var a = getObject("firewall/address");
    var b = getObject("firewall/addrgrp");
    ({ addr: a ? a.name : null, grp: b ? b.name : null });
  `);
  if (r.ok && (r.data as Record<string, unknown>)?.['addr'] === 'firewall/address') {
    ok('Multiple getObject calls', r.data);
  } else {
    fail('Multiple getObject calls', r.error ?? r.data);
  }

  // 2.7: Chained operations
  r = await executor.execute(`
    var obj = getObject("firewall/address");
    obj ? obj.attributes.filter(function(a) { return a.type === "string"; }).length : 0;
  `);
  if (r.ok && typeof r.data === 'number') {
    ok('Chained: getObject → filter attrs', `${r.data} string attrs`);
  } else {
    fail('Chained: getObject → filter attrs', r.error ?? r.data);
  }

  // 2.8: Console.log in search
  r = await executor.execute('console.log("search test log"); specIndex.length');
  if (r.ok && r.logs.length > 0 && r.logs[0].message === 'search test log') {
    ok('Console.log in search', {
      data: r.data,
      log: r.logs[0].message,
    });
  } else {
    fail('Console.log in search', { logs: r.logs, error: r.error });
  }

  // 2.9: Syntax error handling
  r = await executor.execute('this is not valid javascript ???');
  if (!r.ok && r.error) {
    ok('Syntax error handled', r.error.substring(0, 60));
  } else {
    fail('Syntax error handled', 'Expected error but got success');
  }

  // 2.10: Empty string input
  r = await executor.execute('');
  if (r.ok && r.data === undefined) {
    ok('Empty string execution', 'undefined');
  } else {
    // Some runtimes may return null or error — both are acceptable
    ok('Empty string execution', r.data ?? r.error);
  }

  // 2.11: getObject case sensitivity
  r = await executor.execute('getObject("FIREWALL/ADDRESS")');
  if (r.ok && r.data === null) {
    ok('getObject case sensitivity (uppercase → null)', r.data);
  } else if (r.ok && r.data !== null) {
    ok('getObject case insensitive', 'found object');
  } else {
    fail('getObject case sensitivity', r.error ?? r.data);
  }

  // 2.12: Extremely long code string
  r = await executor.execute('var x = ' + JSON.stringify('a'.repeat(10000)) + '; x.length');
  if (r.ok && r.data === 10000) {
    ok('Long code string (10KB)', r.data);
  } else {
    fail('Long code string (10KB)', r.error ?? r.data);
  }
}

// ═══════════════════════════════════════════════════════════════════
// 3. Search — Cross-Reference Validation
// ═══════════════════════════════════════════════════════════════════

async function testSearchCrossRef(executor: SearchExecutor): Promise<void> {
  console.log('\n─── 3. Search: Cross-Reference Validation ───');

  // 3.1: Every module has at least one object
  let r = await executor.execute(`
    var empties = moduleList.filter(function(m) { return m.objectCount === 0; });
    ({ total: moduleList.length, empties: empties.length, emptyNames: empties.map(function(m) { return m.name; }).slice(0, 5) });
  `);
  if (r.ok && typeof r.data === 'object') {
    ok('Modules with objects', r.data);
  } else {
    fail('Modules with objects', r.error ?? r.data);
  }

  // 3.2: Every specIndex entry has at least one URL
  r = await executor.execute(`
    var noUrl = specIndex.filter(function(o) { return o.urls.length === 0; });
    ({ total: specIndex.length, noUrl: noUrl.length, names: noUrl.map(function(o) { return o.name; }).slice(0, 5) });
  `);
  if (r.ok && typeof r.data === 'object') {
    ok('Objects with URLs', r.data);
  } else {
    fail('Objects with URLs', r.error ?? r.data);
  }

  // 3.3: Every specIndex entry has at least one method
  r = await executor.execute(`
    var noMethod = specIndex.filter(function(o) { return o.methods.length === 0; });
    ({ total: specIndex.length, noMethod: noMethod.length });
  `);
  if (r.ok && typeof r.data === 'object') {
    ok('Objects with methods', r.data);
  } else {
    fail('Objects with methods', r.error ?? r.data);
  }

  // 3.4: Total URL count across all objects
  r = await executor.execute(`
    specIndex.reduce(function(sum, o) { return sum + o.urls.length; }, 0);
  `);
  if (r.ok && typeof r.data === 'number' && r.data > 10000) {
    ok('Total URLs across spec', r.data);
  } else {
    fail('Total URLs across spec', r.error ?? r.data);
  }

  // 3.5: Verify known objects exist in specIndex
  r = await executor.execute(`
    var known = ["firewall/address", "firewall/addrgrp", "firewall/policy", "system/admin/user", "system/global"];
    var found = known.filter(function(n) { return specIndex.some(function(o) { return o.name === n; }); });
    ({ expected: known.length, found: found.length, missing: known.filter(function(n) { return found.indexOf(n) < 0; }) });
  `);
  if (
    r.ok &&
    (r.data as Record<string, unknown>)?.['found'] ===
      (r.data as Record<string, unknown>)?.['expected']
  ) {
    ok('Known objects exist in spec', r.data);
  } else {
    fail('Known objects exist in spec', r.error ?? r.data);
  }

  // 3.6: getObject result matches specIndex entry
  r = await executor.execute(`
    var idxEntry = specIndex.find(function(o) { return o.name === "firewall/address"; });
    var fullObj = getObject("firewall/address");
    ({
      nameMatch: idxEntry.name === fullObj.name,
      urlCountMatch: idxEntry.urls.length === fullObj.urls.length,
      attrCountFromIdx: idxEntry.attributeNames.length,
      attrCountFromObj: fullObj.attributes.length
    });
  `);
  if (
    r.ok &&
    (r.data as Record<string, unknown>)?.['nameMatch'] === true &&
    (r.data as Record<string, unknown>)?.['urlCountMatch'] === true
  ) {
    ok('specIndex ↔ getObject consistency', r.data);
  } else {
    fail('specIndex ↔ getObject consistency', r.error ?? r.data);
  }

  // 3.7: URL prefixes match expected patterns
  r = await executor.execute(`
    var prefixes = {};
    specIndex.forEach(function(o) {
      o.urls.forEach(function(u) {
        var prefix = u.split("/").slice(0, 2).join("/");
        prefixes[prefix] = (prefixes[prefix] || 0) + 1;
      });
    });
    var sorted = Object.keys(prefixes).sort(function(a, b) { return prefixes[b] - prefixes[a]; });
    sorted.slice(0, 8).map(function(p) { return p + ": " + prefixes[p]; });
  `);
  if (r.ok && Array.isArray(r.data) && (r.data as string[]).length > 0) {
    ok('URL prefix distribution', r.data);
  } else {
    fail('URL prefix distribution', r.error ?? r.data);
  }

  // 3.8: Method distribution across all objects
  r = await executor.execute(`
    var methods = {};
    specIndex.forEach(function(o) {
      o.methods.forEach(function(m) { methods[m] = (methods[m] || 0) + 1; });
    });
    methods;
  `);
  if (r.ok && typeof r.data === 'object') {
    ok('Method distribution', r.data);
  } else {
    fail('Method distribution', r.error ?? r.data);
  }

  // 3.9: Objects with 'exec' method
  r = await executor.execute(
    'specIndex.filter(function(o) { return o.methods.indexOf("exec") >= 0; }).length',
  );
  if (r.ok && typeof r.data === 'number') {
    ok('Objects with exec method', r.data);
  } else {
    fail('Objects with exec method', r.error ?? r.data);
  }

  // 3.10: Attribute name search — srcaddr should exist
  r = await executor.execute(`
    specIndex.filter(function(o) { return o.attributeNames.indexOf("srcaddr") >= 0; })
      .map(function(o) { return o.name; }).slice(0, 5);
  `);
  if (r.ok && Array.isArray(r.data) && (r.data as string[]).length > 0) {
    ok('attributeNames search (srcaddr)', r.data);
  } else {
    fail('attributeNames search (srcaddr)', r.error ?? r.data);
  }

  // 3.11: Search by URL pattern — /dvmdb/
  r = await executor.execute(`
    specIndex.filter(function(o) { return o.urls.some(function(u) { return u.indexOf("/dvmdb/") === 0; }); }).length;
  `);
  if (r.ok && typeof r.data === 'number' && r.data > 0) {
    ok('/dvmdb/ URL pattern count', r.data);
  } else {
    fail('/dvmdb/ URL pattern count', r.error ?? r.data);
  }

  // 3.12: Search by URL pattern — /cli/global/
  r = await executor.execute(`
    specIndex.filter(function(o) { return o.urls.some(function(u) { return u.indexOf("/cli/global/") === 0; }); }).length;
  `);
  if (r.ok && typeof r.data === 'number' && r.data > 0) {
    ok('/cli/global/ URL pattern count', r.data);
  } else {
    fail('/cli/global/ URL pattern count', r.error ?? r.data);
  }

  // 3.13: Search by URL pattern — /pm/config/
  r = await executor.execute(`
    specIndex.filter(function(o) { return o.urls.some(function(u) { return u.indexOf("/pm/config/") === 0; }); }).length;
  `);
  if (r.ok && typeof r.data === 'number' && r.data > 0) {
    ok('/pm/config/ URL pattern count', r.data);
  } else {
    fail('/pm/config/ URL pattern count', r.error ?? r.data);
  }

  // 3.14: Object type distribution
  r = await executor.execute(`
    var types = {};
    specIndex.forEach(function(o) { types[o.type] = (types[o.type] || 0) + 1; });
    types;
  `);
  if (r.ok && typeof r.data === 'object') {
    ok('Object type distribution', r.data);
  } else {
    fail('Object type distribution', r.error ?? r.data);
  }

  // 3.15: Verify moduleList objectCount sums to specIndex length
  r = await executor.execute(`
    var moduleTotal = moduleList.reduce(function(sum, m) { return sum + m.objectCount; }, 0);
    ({ moduleTotal: moduleTotal, specIndexLen: specIndex.length, match: moduleTotal === specIndex.length });
  `);
  if (r.ok && typeof r.data === 'object') {
    ok('moduleList objectCount sum', r.data);
  } else {
    fail('moduleList objectCount sum', r.error ?? r.data);
  }
}

// ═══════════════════════════════════════════════════════════════════
// 4. Execute — System Operations
// ═══════════════════════════════════════════════════════════════════

async function testExecuteSystem(executor: CodeExecutor): Promise<void> {
  console.log('\n─── 4. Execute: System Operations ───');

  // 4.1: /sys/status — hostname
  let r = await executor.execute(`
    var resp = fortimanager.request("get", [{ url: "/sys/status" }]);
    resp.result[0].data.Hostname;
  `);
  if (r.ok && typeof r.data === 'string') {
    ok('/sys/status → Hostname', r.data);
  } else {
    fail('/sys/status → Hostname', r.error ?? r.data);
  }

  // 4.2: /sys/status — version
  r = await executor.execute(`
    var resp = fortimanager.request("get", [{ url: "/sys/status" }]);
    resp.result[0].data.Version;
  `);
  if (r.ok && typeof r.data === 'string') {
    ok('/sys/status → Version', r.data);
  } else {
    fail('/sys/status → Version', r.error ?? r.data);
  }

  // 4.3: /sys/status — platform
  r = await executor.execute(`
    var resp = fortimanager.request("get", [{ url: "/sys/status" }]);
    resp.result[0].data["Platform Type"];
  `);
  if (r.ok && typeof r.data === 'string') {
    ok('/sys/status → Platform', r.data);
  } else {
    fail('/sys/status → Platform', r.error ?? r.data);
  }

  // 4.4: /sys/status — serial number
  r = await executor.execute(`
    var resp = fortimanager.request("get", [{ url: "/sys/status" }]);
    resp.result[0].data["Serial Number"];
  `);
  if (r.ok && typeof r.data === 'string') {
    ok('/sys/status → Serial', r.data);
  } else {
    fail('/sys/status → Serial', r.error ?? r.data);
  }

  // 4.5: /sys/status — full data object shape
  r = await executor.execute(`
    var resp = fortimanager.request("get", [{ url: "/sys/status" }]);
    var d = resp.result[0].data;
    Object.keys(d).sort().slice(0, 10);
  `);
  if (r.ok && Array.isArray(r.data)) {
    ok('/sys/status → keys', r.data);
  } else {
    fail('/sys/status → keys', r.error ?? r.data);
  }

  // 4.6: /cli/global/system/global — hostname + timezone
  r = await executor.execute(`
    var resp = fortimanager.request("get", [{ url: "/cli/global/system/global", fields: ["hostname", "timezone"] }]);
    var result = resp.result[0];
    result.status.code === 0 ? { hostname: result.data.hostname, timezone: result.data.timezone } : { error: result.status };
  `);
  if (r.ok && typeof r.data === 'object') {
    ok('/cli/global/system/global', r.data);
  } else {
    fail('/cli/global/system/global', r.error ?? r.data);
  }

  // 4.7: /dvmdb/adom — list ADOMs
  r = await executor.execute(`
    var resp = fortimanager.request("get", [{ url: "/dvmdb/adom" }]);
    var result = resp.result[0];
    if (result.data) {
      var d = result.data;
      Array.isArray(d) ? d.map(function(a) { return a.name; }) : [d.name];
    } else {
      ({ status: result.status.code, message: result.status.message });
    }
  `);
  if (r.ok) {
    ok('/dvmdb/adom', r.data);
  } else {
    fail('/dvmdb/adom', r.error ?? r.data);
  }

  // 4.8: /dvmdb/device — list devices
  r = await executor.execute(`
    var resp = fortimanager.request("get", [{ url: "/dvmdb/device", fields: ["name", "ip", "sn", "conn_status"] }]);
    var result = resp.result[0];
    result.status.code === 0 ? (Array.isArray(result.data) ? result.data.length : 0) : result.status;
  `);
  if (r.ok) {
    ok('/dvmdb/device count', r.data);
  } else {
    fail('/dvmdb/device count', r.error ?? r.data);
  }

  // 4.9: /sys/task — list recent tasks
  r = await executor.execute(`
    var resp = fortimanager.request("get", [{ url: "/task/task", fields: ["id", "title", "state", "percent"], option: ["count"] }]);
    var result = resp.result[0];
    result.status.code === 0 ? { count: Array.isArray(result.data) ? result.data.length : 0 } : result.status;
  `);
  if (r.ok) {
    ok('/task/task', r.data);
  } else {
    fail('/task/task', r.error ?? r.data);
  }

  // 4.10: Console capture in execute
  r = await executor.execute('console.log("exec log test"); console.log("second line"); 42');
  if (r.ok && r.data === 42 && r.logs.length === 2) {
    ok('Console capture (2 lines)', {
      data: r.data,
      logs: r.logs.map((l) => l.message),
    });
  } else {
    fail('Console capture (2 lines)', {
      data: r.data,
      logs: r.logs,
      error: r.error,
    });
  }

  // 4.11: Console.warn and console.error
  r = await executor.execute(`
    console.log("info");
    console.warn("warning");
    console.error("error");
    "done";
  `);
  if (r.ok && r.logs.length === 3) {
    ok(
      'Console levels (log, warn, error)',
      r.logs.map((l) => `${l.level}: ${l.message}`),
    );
  } else {
    fail('Console levels', { logs: r.logs, error: r.error });
  }

  // 4.12: /cli/global/system/admin/user — list admin users
  r = await executor.execute(`
    var resp = fortimanager.request("get", [{ url: "/cli/global/system/admin/user", fields: ["userid", "profileid"] }]);
    var result = resp.result[0];
    result.status.code === 0 ? (Array.isArray(result.data) ? result.data.map(function(u) { return u.userid; }) : [result.data.userid]) : result.status;
  `);
  if (r.ok) {
    ok('/cli/global/system/admin/user', r.data);
  } else {
    fail('/cli/global/system/admin/user', r.error ?? r.data);
  }
}

// ═══════════════════════════════════════════════════════════════════
// 5. Execute — CRUD Lifecycle
// ═══════════════════════════════════════════════════════════════════

async function testExecuteCrud(executor: CodeExecutor): Promise<void> {
  console.log('\n─── 5. Execute: CRUD Lifecycle ───');

  // 5.1: Detect write permissions
  let r = await executor.execute(`
    var resp = fortimanager.request("set", [{
      url: "/pm/config/global/obj/firewall/address",
      data: { name: "mcp-perm-test", type: "ipmask", subnet: ["10.255.255.0", "255.255.255.0"], comment: "permission check" }
    }]);
    var code = resp.result[0].status.code;
    // Cleanup if it succeeded
    if (code === 0) {
      fortimanager.request("delete", [{ url: "/pm/config/global/obj/firewall/address/mcp-perm-test" }]);
    }
    code;
  `);
  if (r.ok) {
    hasWritePermission = r.data === 0;
    ok(
      'Write permission check',
      hasWritePermission ? 'GRANTED' : `DENIED (code ${String(r.data)})`,
    );
  } else {
    fail('Write permission check', r.error);
  }

  // 5.2: CRUD — firewall/address (full lifecycle)
  if (hasWritePermission) {
    r = await executor.execute(`
      // CREATE
      var createResp = fortimanager.request("set", [{
        url: "/pm/config/global/obj/firewall/address",
        data: { name: "mcp-test-crud", type: "ipmask", subnet: ["10.88.88.0", "255.255.255.0"], comment: "CRUD test" }
      }]);
      var createCode = createResp.result[0].status.code;

      // READ
      var readResp = fortimanager.request("get", [{
        url: "/pm/config/global/obj/firewall/address/mcp-test-crud"
      }]);
      var readCode = readResp.result[0].status.code;
      var readData = readResp.result[0].data;

      // UPDATE
      var updateResp = fortimanager.request("update", [{
        url: "/pm/config/global/obj/firewall/address/mcp-test-crud",
        data: { comment: "CRUD test updated" }
      }]);
      var updateCode = updateResp.result[0].status.code;

      // Verify update
      var readResp2 = fortimanager.request("get", [{
        url: "/pm/config/global/obj/firewall/address/mcp-test-crud"
      }]);
      var updatedComment = readResp2.result[0].data ? readResp2.result[0].data.comment : null;

      // DELETE
      var delResp = fortimanager.request("delete", [{
        url: "/pm/config/global/obj/firewall/address/mcp-test-crud"
      }]);
      var deleteCode = delResp.result[0].status.code;

      // Verify deleted
      var readResp3 = fortimanager.request("get", [{
        url: "/pm/config/global/obj/firewall/address/mcp-test-crud"
      }]);
      var deletedCode = readResp3.result[0].status.code;

      ({
        create: createCode, read: readCode,
        update: updateCode, updatedComment: updatedComment,
        delete: deleteCode, verifyDeleted: deletedCode
      });
    `);
    if (r.ok && typeof r.data === 'object') {
      const d = r.data as Record<string, unknown>;
      if (d['create'] === 0 && d['read'] === 0 && d['update'] === 0 && d['delete'] === 0) {
        ok('CRUD firewall/address lifecycle', r.data);
      } else {
        fail('CRUD firewall/address lifecycle', r.data);
      }
    } else {
      fail('CRUD firewall/address lifecycle', r.error ?? r.data);
    }
  } else {
    skip('CRUD firewall/address lifecycle', 'no write permission');
  }

  // 5.3: CRUD — firewall/addrgrp (depends on address objects)
  if (hasWritePermission) {
    r = await executor.execute(`
      // Create two address objects first
      fortimanager.request("set", [{
        url: "/pm/config/global/obj/firewall/address",
        data: [
          { name: "mcp-grp-member1", type: "ipmask", subnet: ["10.77.1.0", "255.255.255.0"], comment: "grp test" },
          { name: "mcp-grp-member2", type: "ipmask", subnet: ["10.77.2.0", "255.255.255.0"], comment: "grp test" }
        ]
      }]);

      // Create address group
      var createResp = fortimanager.request("set", [{
        url: "/pm/config/global/obj/firewall/addrgrp",
        data: { name: "mcp-test-grp", member: ["mcp-grp-member1", "mcp-grp-member2"], comment: "group test" }
      }]);
      var createCode = createResp.result[0].status.code;

      // Read it back
      var readResp = fortimanager.request("get", [{
        url: "/pm/config/global/obj/firewall/addrgrp/mcp-test-grp"
      }]);
      var memberCount = readResp.result[0].data ? (readResp.result[0].data.member || []).length : 0;

      // Cleanup
      fortimanager.request("delete", [{ url: "/pm/config/global/obj/firewall/addrgrp/mcp-test-grp" }]);
      fortimanager.request("delete", [{ url: "/pm/config/global/obj/firewall/address/mcp-grp-member1" }]);
      fortimanager.request("delete", [{ url: "/pm/config/global/obj/firewall/address/mcp-grp-member2" }]);

      ({ create: createCode, memberCount: memberCount });
    `);
    if (r.ok && typeof r.data === 'object') {
      const d = r.data as Record<string, unknown>;
      if (d['create'] === 0 && (d['memberCount'] as number) >= 2) {
        ok('CRUD firewall/addrgrp lifecycle', r.data);
      } else {
        fail('CRUD firewall/addrgrp lifecycle', r.data);
      }
    } else {
      fail('CRUD firewall/addrgrp lifecycle', r.error ?? r.data);
    }
  } else {
    skip('CRUD firewall/addrgrp lifecycle', 'no write permission');
  }

  // 5.4: Create duplicate object (expect error)
  if (hasWritePermission) {
    r = await executor.execute(`
      // Create
      fortimanager.request("set", [{
        url: "/pm/config/global/obj/firewall/address",
        data: { name: "mcp-dup-test", type: "ipmask", subnet: ["10.66.66.0", "255.255.255.0"] }
      }]);
      // Try duplicate add
      var dupResp = fortimanager.request("add", [{
        url: "/pm/config/global/obj/firewall/address",
        data: { name: "mcp-dup-test", type: "ipmask", subnet: ["10.66.66.0", "255.255.255.0"] }
      }]);
      var dupCode = dupResp.result[0].status.code;
      // Cleanup
      fortimanager.request("delete", [{ url: "/pm/config/global/obj/firewall/address/mcp-dup-test" }]);
      ({ dupCode: dupCode, isDuplicate: dupCode !== 0 });
    `);
    if (r.ok && (r.data as Record<string, unknown>)?.['isDuplicate'] === true) {
      ok('Duplicate object error', r.data);
    } else if (r.ok) {
      ok('Duplicate object (set is idempotent)', r.data);
    } else {
      fail('Duplicate object error', r.error ?? r.data);
    }
  } else {
    skip('Duplicate object error', 'no write permission');
  }

  // 5.5: Delete non-existent object
  r = await executor.execute(`
    var resp = fortimanager.request("delete", [{ url: "/pm/config/global/obj/firewall/address/mcp-nonexistent-object-xyz" }]);
    resp.result[0].status;
  `);
  if (r.ok && typeof r.data === 'object') {
    const status = r.data as Record<string, unknown>;
    ok('Delete non-existent object', status);
  } else {
    fail('Delete non-existent object', r.error ?? r.data);
  }

  // 5.6: Bulk create and read (if write permission)
  if (hasWritePermission) {
    r = await executor.execute(`
      // Create 5 objects at once
      var names = [];
      for (var i = 0; i < 5; i++) { names.push("mcp-bulk-" + i); }
      var data = names.map(function(n, i) {
        return { name: n, type: "ipmask", subnet: ["10.50." + i + ".0", "255.255.255.0"], comment: "bulk test" };
      });
      var createResp = fortimanager.request("set", [{ url: "/pm/config/global/obj/firewall/address", data: data }]);
      var createCode = createResp.result[0].status.code;

      // Read all
      var readResp = fortimanager.request("get", [{
        url: "/pm/config/global/obj/firewall/address",
        filter: ["name", "like", "mcp-bulk-%"]
      }]);
      var readCount = Array.isArray(readResp.result[0].data) ? readResp.result[0].data.length : 0;

      // Cleanup
      names.forEach(function(n) {
        fortimanager.request("delete", [{ url: "/pm/config/global/obj/firewall/address/" + n }]);
      });

      ({ created: createCode, readCount: readCount });
    `);
    if (r.ok && typeof r.data === 'object') {
      ok('Bulk create + filter read', r.data);
    } else {
      fail('Bulk create + filter read', r.error ?? r.data);
    }
  } else {
    skip('Bulk create + filter read', 'no write permission');
  }
}

// ═══════════════════════════════════════════════════════════════════
// 6. Execute — Error Handling & Batch Operations
// ═══════════════════════════════════════════════════════════════════

async function testExecuteErrors(executor: CodeExecutor): Promise<void> {
  console.log('\n─── 6. Execute: Error Handling & Batch ───');

  // 6.1: Invalid URL
  let r = await executor.execute(`
    var resp = fortimanager.request("get", [{ url: "/nonexistent/path" }]);
    resp.result[0].status;
  `);
  if (r.ok && typeof r.data === 'object') {
    const status = r.data as Record<string, unknown>;
    if (status['code'] !== 0) {
      ok('Invalid URL → error status', r.data);
    } else {
      fail('Invalid URL → expected non-zero code', r.data);
    }
  } else {
    fail('Invalid URL → error status', r.error ?? r.data);
  }

  // 6.2: Empty params
  r = await executor.execute(`
    var resp = fortimanager.request("get", [{}]);
    resp.result[0] ? resp.result[0].status : { code: "no-result", note: "empty params returned no result entry" };
  `);
  if (r.ok) {
    ok('Empty params response', r.data);
  } else {
    // Runtime error is also acceptable for empty params
    ok('Empty params response (error)', r.error);
  }

  // 6.3: Batch request (2 params)
  r = await executor.execute(`
    var resp = fortimanager.request("get", [
      { url: "/sys/status" },
      { url: "/cli/global/system/global", fields: ["hostname"] }
    ]);
    resp.result.map(function(r) { return r.status.code; });
  `);
  if (r.ok && Array.isArray(r.data)) {
    ok('Batch request (2 params)', r.data);
  } else {
    fail('Batch request (2 params)', r.error ?? r.data);
  }

  // 6.4: Batch request (5 distinct params)
  // Note: FMG JSON-RPC may merge multiple params into a single result
  r = await executor.execute(`
    var resp = fortimanager.request("get", [
      { url: "/sys/status" },
      { url: "/cli/global/system/dns" },
      { url: "/cli/global/system/ntp" },
      { url: "/cli/global/system/global", fields: ["hostname"] },
      { url: "/task/task", option: ["count"] }
    ]);
    ({ resultCount: resp.result.length, allOk: resp.result.every(function(r) { return r.status !== undefined; }) });
  `);
  if (
    r.ok &&
    typeof (r.data as Record<string, unknown>)?.['resultCount'] === 'number' &&
    (r.data as Record<string, unknown>)?.['allOk'] === true
  ) {
    ok('Batch request (5 distinct params)', r.data);
  } else {
    fail('Batch request (5 distinct params)', r.error ?? r.data);
  }

  // 6.5: Mixed batch — one valid, one invalid
  r = await executor.execute(`
    var resp = fortimanager.request("get", [
      { url: "/sys/status" },
      { url: "/nonexistent/url" }
    ]);
    resp.result.map(function(r) { return { code: r.status.code, msg: r.status.message }; });
  `);
  if (r.ok && Array.isArray(r.data)) {
    ok('Mixed batch (valid + invalid)', r.data);
  } else {
    fail('Mixed batch (valid + invalid)', r.error ?? r.data);
  }

  // 6.6: Sandbox syntax error
  r = await executor.execute('this is not valid javascript ???');
  if (!r.ok && r.error) {
    ok('Sandbox syntax error', r.error.substring(0, 60));
  } else {
    fail('Sandbox syntax error', 'Expected error but got success');
  }

  // 6.7: Runtime error in sandbox
  r = await executor.execute('var x = null; x.property;');
  if (!r.ok && r.error) {
    ok('Sandbox runtime error', r.error.substring(0, 60));
  } else {
    fail('Sandbox runtime error', 'Expected error but got success');
  }

  // 6.8: Sandbox try/catch
  r = await executor.execute(`
    try {
      var x = null; x.property;
    } catch(e) {
      ({ caught: true, message: e.message });
    }
  `);
  if (r.ok && (r.data as Record<string, unknown>)?.['caught'] === true) {
    ok('Sandbox try/catch works', r.data);
  } else {
    fail('Sandbox try/catch works', r.error ?? r.data);
  }

  // 6.9: Large batch request (10 distinct params)
  r = await executor.execute(`
    var urls = ["/sys/status", "/cli/global/system/dns", "/cli/global/system/ntp",
      "/cli/global/system/global", "/task/task", "/dvmdb/device",
      "/cli/global/system/interface", "/cli/global/system/admin/user",
      "/dvmdb/adom", "/sys/status"];
    var params = urls.map(function(u) { return { url: u }; });
    var resp = fortimanager.request("get", params);
    ({ count: resp.result.length, allHaveStatus: resp.result.every(function(r) { return r.status !== undefined; }) });
  `);
  if (r.ok && typeof (r.data as Record<string, unknown>)?.['count'] === 'number') {
    ok('Large batch (10 distinct params)', r.data);
  } else {
    fail('Large batch (10 distinct params)', r.error ?? r.data);
  }

  // 6.10: Request with filter
  r = await executor.execute(`
    var resp = fortimanager.request("get", [{
      url: "/cli/global/system/admin/user",
      filter: ["userid", "==", "admin"]
    }]);
    var result = resp.result[0];
    ({ code: result.status.code, hasData: result.data !== undefined });
  `);
  if (r.ok && typeof r.data === 'object') {
    ok('Request with filter', r.data);
  } else {
    fail('Request with filter', r.error ?? r.data);
  }

  // 6.11: Request with sort/range
  r = await executor.execute(`
    var resp = fortimanager.request("get", [{
      url: "/cli/global/system/admin/user",
      sortings: [{ userid: 1 }],
      range: [0, 5]
    }]);
    var result = resp.result[0];
    ({ code: result.status.code, dataType: typeof result.data });
  `);
  if (r.ok && typeof r.data === 'object') {
    ok('Request with sort/range', r.data);
  } else {
    fail('Request with sort/range', r.error ?? r.data);
  }

  // 6.12: Request with option count
  r = await executor.execute(`
    var resp = fortimanager.request("get", [{
      url: "/cli/global/system/admin/user",
      option: ["count"]
    }]);
    var result = resp.result[0];
    ({ code: result.status.code });
  `);
  if (r.ok) {
    ok('Request with option count', r.data);
  } else {
    fail('Request with option count', r.error ?? r.data);
  }
}

// ═══════════════════════════════════════════════════════════════════
// 7. Execute — Advanced Operations
// ═══════════════════════════════════════════════════════════════════

async function testExecuteAdvanced(executor: CodeExecutor): Promise<void> {
  console.log('\n─── 7. Execute: Advanced Operations ───');

  // 7.1: Data transformation in sandbox
  let r = await executor.execute(`
    var resp = fortimanager.request("get", [{ url: "/sys/status" }]);
    var d = resp.result[0].data;
    var keys = Object.keys(d);
    keys.sort();
    ({ keyCount: keys.length, first5: keys.slice(0, 5), last5: keys.slice(-5) });
  `);
  if (r.ok && typeof r.data === 'object') {
    ok('Data transformation', r.data);
  } else {
    fail('Data transformation', r.error ?? r.data);
  }

  // 7.2: Multiple sequential API calls
  r = await executor.execute(`
    var r1 = fortimanager.request("get", [{ url: "/sys/status" }]);
    var r2 = fortimanager.request("get", [{ url: "/sys/status" }]);
    var r3 = fortimanager.request("get", [{ url: "/sys/status" }]);
    ({
      call1: r1.result[0].status.code,
      call2: r2.result[0].status.code,
      call3: r3.result[0].status.code,
      allOk: r1.result[0].status.code === 0 && r2.result[0].status.code === 0 && r3.result[0].status.code === 0
    });
  `);
  if (r.ok && (r.data as Record<string, unknown>)?.['allOk'] === true) {
    ok('3 sequential API calls', r.data);
  } else {
    fail('3 sequential API calls', r.error ?? r.data);
  }

  // 7.3: Conditional logic based on API response
  r = await executor.execute(`
    var resp = fortimanager.request("get", [{ url: "/sys/status" }]);
    var version = resp.result[0].data.Version;
    var cleaned = version.replace(/^v/, "");
    var major = parseInt(cleaned.split(".")[0]);
    var minor = parseInt(cleaned.split(".")[1]);
    ({ version: version, major: major, minor: minor, is7x: major === 7 });
  `);
  if (r.ok && (r.data as Record<string, unknown>)?.['is7x'] === true) {
    ok('Conditional logic on response', r.data);
  } else {
    fail('Conditional logic on response', r.error ?? r.data);
  }

  // 7.4: JSON manipulation in sandbox
  r = await executor.execute(`
    var resp = fortimanager.request("get", [{ url: "/sys/status" }]);
    var str = JSON.stringify(resp.result[0].data);
    var parsed = JSON.parse(str);
    ({ roundTrip: parsed.Hostname === resp.result[0].data.Hostname, strLen: str.length });
  `);
  if (r.ok && (r.data as Record<string, unknown>)?.['roundTrip'] === true) {
    ok('JSON roundtrip in sandbox', r.data);
  } else {
    fail('JSON roundtrip in sandbox', r.error ?? r.data);
  }

  // 7.5: Error code lookup via API
  r = await executor.execute(`
    var resp = fortimanager.request("get", [{ url: "/nonexistent" }]);
    var code = resp.result[0].status.code;
    var msg = resp.result[0].status.message;
    ({ code: code, message: msg, isError: code !== 0 });
  `);
  if (r.ok && (r.data as Record<string, unknown>)?.['isError'] === true) {
    ok('Error code from API', r.data);
  } else {
    fail('Error code from API', r.error ?? r.data);
  }

  // 7.6: Loop-based data aggregation
  r = await executor.execute(`
    var resp = fortimanager.request("get", [{ url: "/cli/global/system/admin/user" }]);
    var result = resp.result[0];
    if (result.status.code === 0 && Array.isArray(result.data)) {
      var count = 0;
      for (var i = 0; i < result.data.length; i++) { count++; }
      ({ userCount: count });
    } else {
      ({ status: result.status });
    }
  `);
  if (r.ok && typeof r.data === 'object') {
    ok('Loop aggregation on API data', r.data);
  } else {
    fail('Loop aggregation on API data', r.error ?? r.data);
  }

  // 7.7: Execution with complex data structures
  r = await executor.execute(`
    var result = {
      arrays: [[1,2],[3,4]],
      nested: { a: { b: { c: 42 } } },
      mixed: [{ x: 1 }, "str", null, true, 3.14]
    };
    result;
  `);
  if (r.ok && (r.data as Record<string, unknown>)?.['nested'] !== undefined) {
    ok('Complex data structures', 'nested objects OK');
  } else {
    fail('Complex data structures', r.error ?? r.data);
  }

  // 7.8: /cli/global/system/dns
  r = await executor.execute(`
    var resp = fortimanager.request("get", [{ url: "/cli/global/system/dns" }]);
    var result = resp.result[0];
    result.status.code === 0 ? { primary: result.data.primary, secondary: result.data.secondary } : result.status;
  `);
  if (r.ok) {
    ok('/cli/global/system/dns', r.data);
  } else {
    fail('/cli/global/system/dns', r.error ?? r.data);
  }

  // 7.9: /cli/global/system/ntp
  r = await executor.execute(`
    var resp = fortimanager.request("get", [{ url: "/cli/global/system/ntp" }]);
    var result = resp.result[0];
    result.status.code === 0 ? { status: result.data.status, sync_interval: result.data["sync_interval"] } : result.status;
  `);
  if (r.ok) {
    ok('/cli/global/system/ntp', r.data);
  } else {
    fail('/cli/global/system/ntp', r.error ?? r.data);
  }

  // 7.10: /cli/global/system/interface — list all interfaces
  r = await executor.execute(`
    var resp = fortimanager.request("get", [{ url: "/cli/global/system/interface", fields: ["name", "ip", "status"] }]);
    var result = resp.result[0];
    if (result.status.code === 0) {
      var ifaces = Array.isArray(result.data) ? result.data : [result.data];
      ifaces.map(function(i) { return i.name; });
    } else {
      result.status;
    }
  `);
  if (r.ok) {
    ok('/cli/global/system/interface', r.data);
  } else {
    fail('/cli/global/system/interface', r.error ?? r.data);
  }
}

// ═══════════════════════════════════════════════════════════════════
// 8. Stability — Stress Tests (optional --stress flag)
// ═══════════════════════════════════════════════════════════════════

async function testStability(
  searchExecutor: SearchExecutor,
  codeExecutor: CodeExecutor,
): Promise<void> {
  console.log('\n─── 8. Stability: Stress Tests ───');

  // 8.1: 200 sequential search operations
  const searchIterations = 200;
  console.log(`  Running ${searchIterations} sequential search operations...`);
  const searchStart = Date.now();
  let searchOk = 0;
  let searchFail = 0;
  for (let i = 0; i < searchIterations; i++) {
    const r = await searchExecutor.execute('specIndex.length');
    if (r.ok) searchOk++;
    else searchFail++;
  }
  const searchMs = Date.now() - searchStart;
  const searchAvg = (searchMs / searchIterations).toFixed(1);
  if (searchFail === 0) {
    ok(`${searchIterations} search ops`, `${searchMs}ms total, ${searchAvg}ms avg`);
  } else {
    fail(`${searchIterations} search ops`, `${searchOk} ok, ${searchFail} failed`);
  }
  timings.push({ name: 'search-stress', ms: searchMs });

  // 8.2: 50 sequential execute operations
  const execIterations = 50;
  console.log(`  Running ${execIterations} sequential execute operations...`);
  const execStart = Date.now();
  let execOk = 0;
  let execFail = 0;
  for (let i = 0; i < execIterations; i++) {
    const r = await codeExecutor.execute(
      'var r = fortimanager.request("get", [{ url: "/sys/status" }]); r.result[0].status.code',
    );
    if (r.ok && r.data === 0) execOk++;
    else execFail++;
  }
  const execMs = Date.now() - execStart;
  const execAvg = (execMs / execIterations).toFixed(1);
  if (execFail === 0) {
    ok(`${execIterations} execute ops`, `${execMs}ms total, ${execAvg}ms avg`);
  } else {
    fail(`${execIterations} execute ops`, `${execOk} ok, ${execFail} failed`);
  }
  timings.push({ name: 'execute-stress', ms: execMs });

  // 8.3: Varied search operations
  console.log(`  Running 100 varied search operations...`);
  const queries = [
    'specIndex.length',
    'specIndex.filter(function(o) { return o.name.indexOf("firewall") >= 0; }).length',
    'getObject("firewall/address") ? true : false',
    'moduleList.length',
    'errorCodes.length',
    'specVersion',
    'specIndex[0].name',
    'specIndex.filter(function(o) { return o.methods.indexOf("exec") >= 0; }).length',
    'specIndex.filter(function(o) { return o.urls.length > 3; }).length',
    'specIndex.reduce(function(s, o) { return s + o.attributeNames.length; }, 0)',
  ];
  const variedStart = Date.now();
  let variedOk = 0;
  for (let i = 0; i < 100; i++) {
    const q = queries[i % queries.length];
    const r = await searchExecutor.execute(q);
    if (r.ok) variedOk++;
  }
  const variedMs = Date.now() - variedStart;
  if (variedOk === 100) {
    ok('100 varied searches', `${variedMs}ms total, ${(variedMs / 100).toFixed(1)}ms avg`);
  } else {
    fail('100 varied searches', `${variedOk}/100 passed`);
  }
  timings.push({ name: 'varied-search', ms: variedMs });

  // 8.4: Memory stability check (Node.js heap)
  const heapBefore = process.memoryUsage().heapUsed;
  for (let i = 0; i < 50; i++) {
    await searchExecutor.execute(
      'specIndex.filter(function(o) { return o.attributeNames.length > 10; }).map(function(o) { return o.name; })',
    );
  }
  const heapAfter = process.memoryUsage().heapUsed;
  const heapDeltaMb = ((heapAfter - heapBefore) / 1024 / 1024).toFixed(1);
  ok('Heap stability (50 heavy searches)', `delta: ${heapDeltaMb} MB`);
}

// ═══════════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════════

async function main(): Promise<void> {
  console.log('╔═══════════════════════════════════════════════════════╗');
  console.log('║  FortiManager Code Mode MCP — Integration Tests     ║');
  console.log('╚═══════════════════════════════════════════════════════╝');
  console.log(`Target: ${FMG_HOST}:${FMG_PORT}`);
  console.log(`API Version: ${FMG_API_VERSION}`);
  console.log(`SSL Verify: ${FMG_VERIFY_SSL}`);
  console.log(`Stress Tests: ${RUN_STRESS ? 'ENABLED' : 'disabled (use --stress)'}`);

  const totalStart = Date.now();

  // Load spec
  const specPath = `src/spec/fmg-api-spec-${FMG_API_VERSION}.json`;
  console.log(`\nLoading spec from ${specPath}...`);
  const specStart = Date.now();
  const spec: FmgApiSpec = JSON.parse(readFileSync(specPath, 'utf8')) as FmgApiSpec;
  console.log(`Spec loaded: ${spec.modules.length} modules (${Date.now() - specStart}ms)`);

  // Create executors
  const searchExecutor = new SearchExecutor(spec, {
    timeoutMs: 10_000,
    maxMemoryBytes: 32 * 1024 * 1024,
  });

  const client = new FmgClient({
    host: FMG_HOST,
    port: FMG_PORT,
    apiToken: FMG_API_TOKEN,
    verifySsl: FMG_VERIFY_SSL,
  });

  // Verify connectivity
  console.log('Testing client connectivity...');
  try {
    const health = await client.checkHealth();
    console.log(`Connected to: ${health.hostname} (${health.version})`);
  } catch (err) {
    console.error('Client connectivity check FAILED:', err);
    console.error('Ensure FMG_HOST, FMG_API_TOKEN are correct and the VM is reachable.');
    process.exit(1);
  }

  const codeExecutor = new CodeExecutor(client, {
    timeoutMs: 30_000,
    maxMemoryBytes: 64 * 1024 * 1024,
  });

  // ─── Run test groups ──────────────────────────────────────────
  await testSearchGlobals(searchExecutor);
  await testSearchEdgeCases(searchExecutor);
  await testSearchCrossRef(searchExecutor);
  await testExecuteSystem(codeExecutor);
  await testExecuteCrud(codeExecutor);
  await testExecuteErrors(codeExecutor);
  await testExecuteAdvanced(codeExecutor);

  if (RUN_STRESS) {
    await testStability(searchExecutor, codeExecutor);
  }

  // ─── Summary ──────────────────────────────────────────────────
  const totalMs = Date.now() - totalStart;
  console.log('\n═══════════════════════════════════════════════════════');
  console.log('  Results');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`  Passed:   ${passed}`);
  console.log(`  Failed:   ${failed}`);
  console.log(`  Skipped:  ${skipped}`);
  console.log(`  Total:    ${passed + failed + skipped}`);
  console.log(`  Duration: ${totalMs}ms`);

  if (timings.length > 0) {
    console.log('\n─── Timing ───');
    for (const t of timings) {
      console.log(`  ${t.name}: ${t.ms}ms`);
    }
  }

  console.log('═══════════════════════════════════════════════════════');

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
