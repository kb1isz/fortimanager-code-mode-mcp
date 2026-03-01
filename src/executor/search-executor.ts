/**
 * Search Executor — Run code against the API spec
 *
 * Injects the spec JSON as a `spec` global inside the sandbox.
 * No network access. Used by the `search` MCP tool.
 *
 * The spec is large, so we inject a lightweight index for fast querying
 * and lazy-load full object details on demand via a `getObject()` helper.
 */

import type { QuickJSContext, QuickJSRuntime } from 'quickjs-emscripten';
import type { FmgApiSpec, FmgModule, FmgObjectDef } from '../types/spec-types.js';
import { BaseExecutor } from './executor.js';
import type { ExecutorOptions } from './types.js';

// ─── Spec Index (lightweight) ───────────────────────────────────────

/** Lightweight index entry for fast searching */
interface SpecIndexEntry {
  /** Object path (e.g., "firewall/address") */
  name: string;
  /** Object type */
  type: 'table' | 'object' | 'command';
  /** Module name */
  module: string;
  /** Description (first 200 chars) */
  description: string;
  /** URL paths */
  urls: string[];
  /** Supported method IDs */
  methods: string[];
  /** Attribute names (for searching) */
  attributeNames: string[];
}

/** Build a lightweight index from the full spec */
function buildSpecIndex(spec: FmgApiSpec): SpecIndexEntry[] {
  const index: SpecIndexEntry[] = [];

  for (const mod of spec.modules) {
    for (const obj of mod.objects) {
      index.push({
        name: obj.name,
        type: obj.type,
        module: mod.name,
        description: obj.description.slice(0, 200),
        urls: obj.urls.map((u) => u.path),
        methods: obj.methods,
        attributeNames: obj.attributes.map((a) => a.name),
      });
    }
  }

  return index;
}

// ─── Search Executor ────────────────────────────────────────────────

export class SearchExecutor extends BaseExecutor {
  private readonly spec: FmgApiSpec;
  private readonly specIndex: SpecIndexEntry[];
  /** Pre-computed JSON string of the spec index — avoids re-serializing on every call */
  private readonly specIndexJson: string;
  /** Pre-built map for fast object lookup by name or URL */
  private readonly objectMap: Map<string, { module: FmgModule; object: FmgObjectDef }>;
  /** Pre-computed JSON strings of objects — avoids re-serializing on every getObject() call */
  private readonly objectJsonCache: Map<string, string>;

  constructor(spec: FmgApiSpec, options?: ExecutorOptions) {
    super({
      // Search shouldn't need as much memory or time
      timeoutMs: 10_000,
      maxMemoryBytes: 32 * 1024 * 1024,
      ...options,
    });

    this.spec = spec;
    this.specIndex = buildSpecIndex(spec);
    this.specIndexJson = JSON.stringify(this.specIndex);
    this.objectMap = new Map();
    this.objectJsonCache = new Map();

    for (const mod of spec.modules) {
      for (const obj of mod.objects) {
        this.objectMap.set(obj.name, { module: mod, object: obj });
        // Pre-compute JSON serialization (keyed by object name)
        if (!this.objectJsonCache.has(obj.name)) {
          this.objectJsonCache.set(obj.name, JSON.stringify(obj));
        }
        // Also index by URL paths
        for (const url of obj.urls) {
          this.objectMap.set(url.path, { module: mod, object: obj });
        }
      }
    }
  }

  protected setupContext(context: QuickJSContext, _runtime: QuickJSRuntime): void {
    // Inject the spec index using pre-computed JSON string (avoids re-serialization per call)
    const indexStr = context.newString(this.specIndexJson);
    const parseResult = context.evalCode('JSON.parse');

    if (parseResult.error) {
      parseResult.error.dispose();
      // Fallback: inject directly
      const evalResult = context.evalCode(`var specIndex = ${this.specIndexJson}; undefined;`);
      if (evalResult.error) {
        evalResult.error.dispose();
      } else {
        evalResult.value.dispose();
      }
      indexStr.dispose();
    } else {
      // Use JSON.parse for large data (more memory-efficient in QuickJS)
      const parseFn = parseResult.value;
      const parsed = context.callFunction(parseFn, context.undefined, indexStr);
      indexStr.dispose();
      parseFn.dispose();

      if (parsed.error) {
        parsed.error.dispose();
      } else {
        context.setProp(context.global, 'specIndex', parsed.value);
        parsed.value.dispose();
      }
    }

    // Inject the spec version info
    const versionStr = context.newString(this.spec.version);
    context.setProp(context.global, 'specVersion', versionStr);
    versionStr.dispose();

    // Inject getObject() — retrieves full object details by name or URL.
    // Uses pre-computed JSON cache for fast serialization.
    const getObjectFn = context.newFunction('getObject', (nameHandle) => {
      const name = context.getString(nameHandle);
      const entry = this.objectMap.get(name);

      if (!entry) {
        return context.null;
      }

      // Use pre-cached JSON or serialize on demand for URL-keyed lookups
      const objJson = this.objectJsonCache.get(entry.object.name) ?? JSON.stringify(entry.object);
      const objStr = context.newString(objJson);
      const parseExpr = context.evalCode('JSON.parse');

      if (parseExpr.error) {
        parseExpr.error.dispose();
        objStr.dispose();
        return context.null;
      }

      const result = context.callFunction(parseExpr.value, context.undefined, objStr);
      parseExpr.value.dispose();
      objStr.dispose();

      if (result.error) {
        result.error.dispose();
        return context.null;
      }

      return result.value;
    });
    context.setProp(context.global, 'getObject', getObjectFn);
    getObjectFn.dispose();

    // Inject getModuleList() — returns all module names and titles
    const moduleList = this.spec.modules.map((m) => ({
      name: m.name,
      title: m.title,
      objectCount: m.objects.length,
      methodCount: m.methods.length,
    }));
    const moduleListJson = JSON.stringify(moduleList);
    const moduleListResult = context.evalCode(`(${moduleListJson})`);
    if (moduleListResult.error) {
      moduleListResult.error.dispose();
    } else {
      context.setProp(context.global, 'moduleList', moduleListResult.value);
      moduleListResult.value.dispose();
    }

    // Inject getErrors() — returns all error codes
    const errorsJson = JSON.stringify(this.spec.errors);
    const errorsResult = context.evalCode(`(${errorsJson})`);
    if (errorsResult.error) {
      errorsResult.error.dispose();
    } else {
      context.setProp(context.global, 'errorCodes', errorsResult.value);
      errorsResult.value.dispose();
    }
  }
}
