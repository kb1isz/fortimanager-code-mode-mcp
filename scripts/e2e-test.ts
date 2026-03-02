/**
 * End-to-end scenario tests — validates full MCP workflows against a real
 * FortiManager VM. Tests simulate real agent patterns: search → understand → execute.
 *
 * Run:  npx tsx scripts/e2e-test.ts
 * Env:  Requires .env with FMG_HOST, FMG_API_TOKEN, etc.
 *
 * Scenarios:
 *   1. "Show me all firewall address objects in the root ADOM"
 *   2. "What API methods support the exec action?"
 *   3. "Get the system status of the FortiManager"
 *   4. "List all managed FortiGates and their firmware versions"
 *   5. "Find all objects that have an 'srcaddr' attribute"
 *   6. "Compare the number of objects between modules"
 *   7. "Search for ADOM information, then list ADOMs via API"
 *   8. "Find device-related URLs and query the device database"
 *   9. "Discover error codes and handle an API error gracefully"
 *  10. "Multi-step: find object, get details, try to read it live"
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

let passed = 0;
let failed = 0;
const scenarios: { name: string; ms: number; steps: number; result: string }[] = [];

function scenarioOk(name: string, steps: number, ms: number): void {
  console.log(`  ✓ PASS: ${name} (${steps} steps, ${ms}ms)`);
  passed++;
  scenarios.push({ name, ms, steps, result: 'pass' });
}

function scenarioFail(name: string, steps: number, ms: number, error: string): void {
  console.error(`  ✗ FAIL: ${name} — ${error}`);
  failed++;
  scenarios.push({ name, ms, steps, result: 'fail' });
}

// ═══════════════════════════════════════════════════════════════════
// Scenario 1: "Show me all firewall address objects in the root ADOM"
// Agent workflow: search spec → find URLs → execute API call
// ═══════════════════════════════════════════════════════════════════

async function scenario1(search: SearchExecutor, execute: CodeExecutor): Promise<void> {
  const start = Date.now();
  let steps = 0;

  try {
    // Step 1: Search for firewall address objects in spec
    steps++;
    const s1 = await search.execute(`
      specIndex.filter(function(o) { return o.name === 'firewall/address'; })
        .map(function(o) { return { name: o.name, urls: o.urls, methods: o.methods }; });
    `);
    if (!s1.ok || !Array.isArray(s1.data) || (s1.data as unknown[]).length === 0) {
      throw new Error('Could not find firewall/address in spec');
    }
    const urls = (s1.data as { urls: string[] }[])[0]!.urls;
    if (!urls.some((u: string) => u.includes('/adom/'))) {
      throw new Error('No ADOM-scoped URL found for firewall/address');
    }

    // Step 2: Get full object details
    steps++;
    const s2 = await search.execute(`
      var obj = getObject('firewall/address');
      obj ? { attrCount: obj.attributes.length, methods: obj.methods, urlCount: obj.urls.length } : null;
    `);
    if (!s2.ok || s2.data === null) {
      throw new Error('getObject returned null for firewall/address');
    }
    const details = s2.data as { attrCount: number; methods: string[]; urlCount: number };
    if (details.attrCount < 10) {
      throw new Error(`Expected > 10 attributes, got ${String(details.attrCount)}`);
    }

    // Step 3: Execute live API call to list firewall addresses
    steps++;
    const s3 = await execute.execute(`
      var resp = fortimanager.request('get', [{
        url: '/pm/config/adom/root/obj/firewall/address',
        option: 'count'
      }]);
      ({ status: resp.result[0].status, count: resp.result[0].data });
    `);
    if (!s3.ok) {
      throw new Error(`API call failed: ${s3.error}`);
    }
    const apiResult = s3.data as { status: { code: number }; count: unknown };
    // Code 0 = OK, code -11 = no permission (both acceptable)
    if (apiResult.status.code !== 0 && apiResult.status.code !== -11) {
      throw new Error(`Unexpected status code: ${String(apiResult.status.code)}`);
    }

    scenarioOk('Show firewall address objects', steps, Date.now() - start);
  } catch (e) {
    scenarioFail('Show firewall address objects', steps, Date.now() - start, String(e));
  }
}

// ═══════════════════════════════════════════════════════════════════
// Scenario 2: "What API methods support the exec action?"
// Agent workflow: search specIndex for exec methods
// ═══════════════════════════════════════════════════════════════════

async function scenario2(search: SearchExecutor): Promise<void> {
  const start = Date.now();
  let steps = 0;

  try {
    // Step 1: Find all objects with exec method
    steps++;
    const s1 = await search.execute(`
      var execObjs = specIndex.filter(function(o) { return o.methods.indexOf('exec') >= 0; });
      ({ count: execObjs.length, sample: execObjs.slice(0, 5).map(function(o) { return o.name; }) });
    `);
    if (!s1.ok) throw new Error(`Search failed: ${s1.error}`);
    const data = s1.data as { count: number; sample: string[] };
    if (data.count < 10) throw new Error(`Expected > 10 exec objects, got ${String(data.count)}`);

    // Step 2: Get details of one exec object
    steps++;
    const s2 = await search.execute(`
      var execObj = specIndex.filter(function(o) { return o.methods.indexOf('exec') >= 0; })[0];
      getObject(execObj.name);
    `);
    if (!s2.ok || s2.data === null) throw new Error('Could not get exec object details');

    scenarioOk('Find exec-capable objects', steps, Date.now() - start);
  } catch (e) {
    scenarioFail('Find exec-capable objects', steps, Date.now() - start, String(e));
  }
}

// ═══════════════════════════════════════════════════════════════════
// Scenario 3: "Get the system status of the FortiManager"
// Agent workflow: search for sys/status → execute API call
// ═══════════════════════════════════════════════════════════════════

async function scenario3(search: SearchExecutor, execute: CodeExecutor): Promise<void> {
  const start = Date.now();
  let steps = 0;

  try {
    // Step 1: Search spec for system status
    steps++;
    const s1 = await search.execute(`
      specIndex.filter(function(o) {
        return o.name.indexOf('sys') >= 0 && o.name.indexOf('status') >= 0;
      }).map(function(o) { return { name: o.name, urls: o.urls }; });
    `);
    if (!s1.ok) throw new Error(`Search failed: ${s1.error}`);

    // Step 2: Execute /sys/status to get real data
    steps++;
    const s2 = await execute.execute(`
      var resp = fortimanager.request('get', [{ url: '/sys/status' }]);
      var d = resp.result[0].data;
      ({ hostname: d.Hostname, version: d.Version, platform: d['Platform Type'], serial: d['Serial Number'] });
    `);
    if (!s2.ok) throw new Error(`API call failed: ${s2.error}`);
    const status = s2.data as { hostname: string; version: string };
    if (!status.hostname || !status.version) {
      throw new Error(`Missing hostname or version in response: ${JSON.stringify(status)}`);
    }

    // Step 3: Verify the data makes sense
    steps++;
    if (!status.version.includes('7.')) {
      throw new Error(`Unexpected version format: ${status.version}`);
    }

    scenarioOk('Get system status', steps, Date.now() - start);
  } catch (e) {
    scenarioFail('Get system status', steps, Date.now() - start, String(e));
  }
}

// ═══════════════════════════════════════════════════════════════════
// Scenario 4: "List all managed FortiGates and their firmware versions"
// Agent workflow: search for device URLs → execute API call
// ═══════════════════════════════════════════════════════════════════

async function scenario4(search: SearchExecutor, execute: CodeExecutor): Promise<void> {
  const start = Date.now();
  let steps = 0;

  try {
    // Step 1: Search spec for device-related objects (dvmdb module)
    steps++;
    const s1 = await search.execute(`
      specIndex.filter(function(o) { return o.module === 'dvmdb' && o.name.indexOf('device') >= 0; })
        .map(function(o) { return { name: o.name, urls: o.urls, module: o.module }; });
    `);
    if (!s1.ok) throw new Error(`Search failed: ${s1.error}`);
    const devices = s1.data as { name: string; urls: string[] }[];
    if (devices.length === 0) throw new Error('No device objects found in spec');

    // Step 2: Get device object attributes
    steps++;
    const s2 = await search.execute(`
      var obj = getObject('dvmdb/device');
      obj ? obj.attributes.map(function(a) { return a.name; }).slice(0, 20) : null;
    `);
    if (!s2.ok) throw new Error(`Object details failed: ${s2.error}`);

    // Step 3: Query device list from FMG
    steps++;
    const s3 = await execute.execute(`
      var resp = fortimanager.request('get', [{
        url: '/dvmdb/device',
        fields: ['name', 'ip', 'sn', 'os_ver', 'conn_status', 'platform_str']
      }]);
      var status = resp.result[0].status;
      var data = resp.result[0].data || [];
      ({ statusCode: status.code, deviceCount: data.length, devices: data.slice(0, 5) });
    `);
    if (!s3.ok) throw new Error(`API call failed: ${s3.error}`);
    const result = s3.data as { statusCode: number; deviceCount: number };
    if (result.statusCode !== 0 && result.statusCode !== -11) {
      throw new Error(`Unexpected status: ${String(result.statusCode)}`);
    }

    scenarioOk('List managed FortiGates', steps, Date.now() - start);
  } catch (e) {
    scenarioFail('List managed FortiGates', steps, Date.now() - start, String(e));
  }
}

// ═══════════════════════════════════════════════════════════════════
// Scenario 5: "Find all objects that have an 'srcaddr' attribute"
// Agent workflow: search by attribute name
// ═══════════════════════════════════════════════════════════════════

async function scenario5(search: SearchExecutor): Promise<void> {
  const start = Date.now();
  let steps = 0;

  try {
    // Step 1: Filter by attribute name
    steps++;
    const s1 = await search.execute(`
      var matches = specIndex.filter(function(o) {
        return o.attributeNames.indexOf('srcaddr') >= 0;
      });
      ({ count: matches.length, objects: matches.map(function(o) { return o.name; }) });
    `);
    if (!s1.ok) throw new Error(`Search failed: ${s1.error}`);
    const data = s1.data as { count: number; objects: string[] };
    if (data.count === 0) throw new Error('No objects found with srcaddr attribute');

    // Step 2: Get one object's full details to see the attribute definition
    steps++;
    const objName = data.objects[0]!;
    const s2 = await search.execute(`
      var obj = getObject('${objName}');
      var attr = obj ? obj.attributes.filter(function(a) { return a.name === 'srcaddr'; })[0] : null;
      attr ? { name: attr.name, type: attr.type, description: attr.description } : null;
    `);
    if (!s2.ok) throw new Error(`Object details failed: ${s2.error}`);
    if (s2.data === null) throw new Error('srcaddr attribute not found in object details');

    scenarioOk('Find objects with srcaddr', steps, Date.now() - start);
  } catch (e) {
    scenarioFail('Find objects with srcaddr', steps, Date.now() - start, String(e));
  }
}

// ═══════════════════════════════════════════════════════════════════
// Scenario 6: "Compare the number of objects between modules"
// Agent workflow: analyze module distribution
// ═══════════════════════════════════════════════════════════════════

async function scenario6(search: SearchExecutor): Promise<void> {
  const start = Date.now();
  let steps = 0;

  try {
    // Step 1: Get modules sorted by object count
    steps++;
    const s1 = await search.execute(`
      moduleList
        .slice()
        .sort(function(a, b) { return b.objectCount - a.objectCount; })
        .map(function(m) { return { name: m.name, objects: m.objectCount }; });
    `);
    if (!s1.ok) throw new Error(`Search failed: ${s1.error}`);
    const modules = s1.data as { name: string; objects: number }[];
    if (modules.length < 10) throw new Error(`Expected > 10 modules, got ${String(modules.length)}`);

    // Step 2: Top 5 modules should account for a meaningful portion of objects
    steps++;
    const totalObjects = modules.reduce((sum, m) => sum + m.objects, 0);
    const top5Objects = modules.slice(0, 5).reduce((sum, m) => sum + m.objects, 0);
    if (top5Objects / totalObjects < 0.15) {
      throw new Error(`Top 5 modules only cover ${String(Math.round((top5Objects / totalObjects) * 100))}%`);
    }

    // Step 3: Verify total object count matches specIndex
    steps++;
    const s3 = await search.execute('specIndex.length');
    if (!s3.ok) throw new Error(`specIndex.length failed: ${s3.error}`);
    if (totalObjects !== s3.data) {
      throw new Error(`Module total ${String(totalObjects)} != specIndex ${String(s3.data)}`);
    }

    scenarioOk('Compare module object counts', steps, Date.now() - start);
  } catch (e) {
    scenarioFail('Compare module object counts', steps, Date.now() - start, String(e));
  }
}

// ═══════════════════════════════════════════════════════════════════
// Scenario 7: "Search for ADOM information, then list ADOMs via API"
// Agent workflow: spec search → live API
// ═══════════════════════════════════════════════════════════════════

async function scenario7(search: SearchExecutor, execute: CodeExecutor): Promise<void> {
  const start = Date.now();
  let steps = 0;

  try {
    // Step 1: Search for ADOM-related objects
    steps++;
    const s1 = await search.execute(`
      specIndex.filter(function(o) { return o.name.indexOf('adom') >= 0; })
        .map(function(o) { return { name: o.name, urls: o.urls.slice(0, 2) }; });
    `);
    if (!s1.ok) throw new Error(`Search failed: ${s1.error}`);
    const adomObjs = s1.data as { name: string }[];
    if (adomObjs.length === 0) throw new Error('No ADOM objects found');

    // Step 2: Get ADOM object attributes
    steps++;
    const s2 = await search.execute(`
      var obj = getObject('dvmdb/adom');
      obj ? { attrCount: obj.attributes.length, attrNames: obj.attributes.map(function(a) { return a.name; }).slice(0, 15) } : null;
    `);
    if (!s2.ok) throw new Error(`ADOM details failed: ${s2.error}`);

    // Step 3: List ADOMs from live FMG
    steps++;
    const s3 = await execute.execute(`
      var resp = fortimanager.request('get', [{ url: '/dvmdb/adom', fields: ['name', 'desc', 'os_ver'] }]);
      var status = resp.result[0].status;
      var data = resp.result[0].data || [];
      ({ statusCode: status.code, adomCount: data.length, adoms: data.map(function(a) { return a.name; }) });
    `);
    if (!s3.ok) throw new Error(`ADOM list failed: ${s3.error}`);
    const result = s3.data as { statusCode: number; adomCount: number; adoms: string[] };
    // -11 = no permission is acceptable
    if (result.statusCode !== 0 && result.statusCode !== -11) {
      throw new Error(`Unexpected status: ${String(result.statusCode)}`);
    }

    scenarioOk('Search and list ADOMs', steps, Date.now() - start);
  } catch (e) {
    scenarioFail('Search and list ADOMs', steps, Date.now() - start, String(e));
  }
}

// ═══════════════════════════════════════════════════════════════════
// Scenario 8: "Find device-related URLs and query device database"
// Agent workflow: discover URL patterns → query live database
// ═══════════════════════════════════════════════════════════════════

async function scenario8(search: SearchExecutor, execute: CodeExecutor): Promise<void> {
  const start = Date.now();
  let steps = 0;

  try {
    // Step 1: Find dvmdb URL patterns
    steps++;
    const s1 = await search.execute(`
      specIndex.filter(function(o) { return o.urls.some(function(u) { return u.indexOf('/dvmdb/') >= 0; }); })
        .map(function(o) { return o.name; });
    `);
    if (!s1.ok) throw new Error(`Search failed: ${s1.error}`);
    const dvmdbObjects = s1.data as string[];
    if (dvmdbObjects.length < 5) throw new Error(`Expected > 5 dvmdb objects, got ${String(dvmdbObjects.length)}`);

    // Step 2: Query /dvmdb/device to get real device data
    steps++;
    const s2 = await execute.execute(`
      var resp = fortimanager.request('get', [{ url: '/dvmdb/device' }]);
      var status = resp.result[0].status;
      ({ code: status.code, message: status.message, hasData: resp.result[0].data !== undefined });
    `);
    if (!s2.ok) throw new Error(`Device query failed: ${s2.error}`);

    // Step 3: Query /dvmdb/group to check device groups
    steps++;
    const s3 = await execute.execute(`
      var resp = fortimanager.request('get', [{ url: '/dvmdb/group' }]);
      var status = resp.result[0].status;
      ({ code: status.code, message: status.message });
    `);
    if (!s3.ok) throw new Error(`Group query failed: ${s3.error}`);

    scenarioOk('Query device database', steps, Date.now() - start);
  } catch (e) {
    scenarioFail('Query device database', steps, Date.now() - start, String(e));
  }
}

// ═══════════════════════════════════════════════════════════════════
// Scenario 9: "Discover error codes and handle an API error gracefully"
// Agent workflow: look up error codes → trigger and handle error
// ═══════════════════════════════════════════════════════════════════

async function scenario9(search: SearchExecutor, execute: CodeExecutor): Promise<void> {
  const start = Date.now();
  let steps = 0;

  try {
    // Step 1: Look up error codes in spec (codes are positive integers)
    steps++;
    const s1 = await search.execute(`
      ({ total: errorCodes.length, sample: errorCodes.slice(0, 10).map(function(e) { return { code: e.code, msg: e.message }; }) });
    `);
    if (!s1.ok) throw new Error(`Error code lookup failed: ${s1.error}`);
    const codeData = s1.data as { total: number; sample: { code: number; msg: string }[] };
    if (codeData.total < 1) throw new Error(`Expected error codes, got ${String(codeData.total)}`);

    // Step 2: Intentionally trigger an error (invalid URL)
    steps++;
    const s2 = await execute.execute(`
      var resp = fortimanager.request('get', [{ url: '/this/does/not/exist' }]);
      var status = resp.result[0].status;
      ({ code: status.code, message: status.message, isError: status.code !== 0 });
    `);
    if (!s2.ok) throw new Error(`Error trigger failed: ${s2.error}`);
    const errorResult = s2.data as { code: number; isError: boolean };
    if (!errorResult.isError) throw new Error('Expected an error from invalid URL');

    // Step 3: Use try/catch in sandbox to handle error
    steps++;
    const s3 = await execute.execute(`
      var result;
      try {
        var resp = fortimanager.request('get', [{ url: '/this/invalid/url' }]);
        var code = resp.result[0].status.code;
        if (code !== 0) {
          result = { handled: true, errorCode: code, message: resp.result[0].status.message };
        } else {
          result = { handled: false, data: resp.result[0].data };
        }
      } catch (e) {
        result = { handled: true, exception: String(e) };
      }
      result;
    `);
    if (!s3.ok) throw new Error(`Error handling failed: ${s3.error}`);
    const handled = s3.data as { handled: boolean };
    if (!handled.handled) throw new Error('Error was not properly handled');

    scenarioOk('Error code discovery and handling', steps, Date.now() - start);
  } catch (e) {
    scenarioFail('Error code discovery and handling', steps, Date.now() - start, String(e));
  }
}

// ═══════════════════════════════════════════════════════════════════
// Scenario 10: "Multi-step: find object, get details, read it live"
// Agent workflow: search → details → execute → transform
// ═══════════════════════════════════════════════════════════════════

async function scenario10(search: SearchExecutor, execute: CodeExecutor): Promise<void> {
  const start = Date.now();
  let steps = 0;

  try {
    // Step 1: Search for system-related objects that support get-obj
    steps++;
    const s1 = await search.execute(`
      specIndex.filter(function(o) {
        return o.module === 'sys' && o.methods.some(function(m) { return m.indexOf('get') >= 0; });
      }).map(function(o) { return { name: o.name, urls: o.urls, methods: o.methods }; }).slice(0, 10);
    `);
    if (!s1.ok) throw new Error(`Search failed: ${s1.error}`);
    const sysObjects = s1.data as { name: string; urls: string[]; methods: string[] }[];
    if (sysObjects.length === 0) throw new Error('No sys module objects with get found');

    // Step 2: Get full details of the first readable object
    steps++;
    const firstObj = sysObjects[0]!;
    const s2 = await search.execute(`
      var obj = getObject('${firstObj.name}');
      obj ? {
        name: obj.name,
        attrCount: obj.attributes.length,
        urls: obj.urls,
        topAttrs: obj.attributes.slice(0, 5).map(function(a) { return a.name; })
      } : null;
    `);
    if (!s2.ok) throw new Error(`Details failed: ${s2.error}`);

    // Step 3: Read /sys/status from live FMG (always works)
    steps++;
    const s3 = await execute.execute(`
      var resp = fortimanager.request('get', [{ url: '/sys/status' }]);
      var status = resp.result[0].status;
      ({ url: '/sys/status', code: status.code, message: status.message, hasData: resp.result[0].data !== undefined });
    `);
    if (!s3.ok) throw new Error(`Live read failed: ${s3.error}`);

    // Step 4: Transform and summarize the data
    steps++;
    const s4 = await execute.execute(`
      var resp = fortimanager.request('get', [{ url: '/sys/status' }]);
      var data = resp.result[0].data;
      var keys = Object.keys(data);
      console.log('Status has ' + keys.length + ' fields');
      ({ fieldCount: keys.length, hostname: data.Hostname, fields: keys.slice(0, 10) });
    `);
    if (!s4.ok) throw new Error(`Transform failed: ${s4.error}`);
    const summary = s4.data as { fieldCount: number; hostname: string };
    if (summary.fieldCount < 5) throw new Error('Too few fields in status');

    scenarioOk('Multi-step object discovery', steps, Date.now() - start);
  } catch (e) {
    scenarioFail('Multi-step object discovery', steps, Date.now() - start, String(e));
  }
}

// ═══════════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════════

async function main(): Promise<void> {
  console.log('╔═══════════════════════════════════════════════════════════════╗');
  console.log('║      FortiManager MCP — End-to-End Scenario Tests           ║');
  console.log('╚═══════════════════════════════════════════════════════════════╝');
  console.log(`\n  FMG: ${FMG_HOST}:${FMG_PORT} (API ${FMG_API_VERSION})`);

  // Load API spec
  const specPath = `src/spec/fmg-api-spec-${FMG_API_VERSION}.json`;
  console.log(`  Spec: ${specPath}`);
  const spec: FmgApiSpec = JSON.parse(readFileSync(specPath, 'utf-8'));

  // Create client
  const client = new FmgClient({
    host: FMG_HOST,
    port: FMG_PORT,
    apiToken: FMG_API_TOKEN,
    verifySsl: FMG_VERIFY_SSL,
  });

  // Health check
  const health = await client.checkHealth();
  console.log(`  FMG:  ${health.hostname} ${health.version}`);

  // Create executors
  const searchExecutor = new SearchExecutor(spec);
  const codeExecutor = new CodeExecutor(client);

  // Run scenarios
  console.log('\n─── End-to-End Scenarios ───');
  const start = Date.now();

  await scenario1(searchExecutor, codeExecutor);
  await scenario2(searchExecutor);
  await scenario3(searchExecutor, codeExecutor);
  await scenario4(searchExecutor, codeExecutor);
  await scenario5(searchExecutor);
  await scenario6(searchExecutor);
  await scenario7(searchExecutor, codeExecutor);
  await scenario8(searchExecutor, codeExecutor);
  await scenario9(searchExecutor, codeExecutor);
  await scenario10(searchExecutor, codeExecutor);

  const totalMs = Date.now() - start;

  // Summary
  console.log('\n─── Scenario Summary ───');
  console.log(`\n  Total: ${String(passed + failed)} scenarios`);
  console.log(`  ✓ Passed: ${String(passed)}`);
  console.log(`  ✗ Failed: ${String(failed)}`);
  console.log(`  Duration: ${String(totalMs)}ms`);

  console.log('\n  Scenario Breakdown:');
  for (const s of scenarios) {
    const icon = s.result === 'pass' ? '✓' : '✗';
    console.log(`    ${icon} ${s.name} — ${String(s.steps)} steps, ${String(s.ms)}ms`);
  }

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err: unknown) => {
  console.error('Fatal:', err);
  process.exit(2);
});
