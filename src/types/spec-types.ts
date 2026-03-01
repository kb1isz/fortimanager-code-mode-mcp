/**
 * API Spec Types — Shape of the generated JSON spec
 *
 * These types define the structure that the spec generator produces
 * and that the search executor queries against.
 */

// ─── Top-Level Spec ─────────────────────────────────────────────────

/** Complete API specification for one FMG version */
export interface FmgApiSpec {
  /** FMG version this spec was generated from (e.g., "7.6.5") */
  version: string;
  /** Build number from the HTML docs (e.g., "3653") */
  build: string;
  /** Generation timestamp */
  generatedAt: string;
  /** All modules in the spec */
  modules: FmgModule[];
  /** Global error codes from *-errors.htm files */
  errors: FmgErrorCode[];
}

// ─── Module ─────────────────────────────────────────────────────────

/** A module groups related objects/methods (e.g., "sys", "dvmdb", "pkg") */
export interface FmgModule {
  /** Module name (e.g., "sys", "dvmdb", "pkg76-3645") */
  name: string;
  /** Human-readable title from h1 */
  title: string;
  /** Available methods in this module */
  methods: FmgMethodDef[];
  /** Objects/tables in this module */
  objects: FmgObjectDef[];
}

// ─── Method Definition ──────────────────────────────────────────────

/** A method available for a module (e.g., "get", "set", "add") */
export interface FmgMethodDef {
  /** Method ID (e.g., "get-table", "add", "exec") */
  id: string;
  /** Display name from h2 */
  name: string;
  /** Description text */
  description: string;
  /** JSON request template (raw string from <pre>) */
  requestTemplate?: string;
  /** JSON response template (raw string from <pre>) */
  responseTemplate?: string;
  /** Parameter descriptions */
  params: FmgParamDef[];
}

// ─── Object Definition ──────────────────────────────────────────────

/** An API object/table definition (e.g., "firewall/address") */
export interface FmgObjectDef {
  /** Object path (e.g., "firewall/address", "login/user") */
  name: string;
  /** Object type: table, object, or command */
  type: 'table' | 'object' | 'command';
  /** Description text */
  description: string;
  /** Supported method IDs (e.g., ["get-table", "add", "set", "delete"]) */
  methods: string[];
  /** Full URL path(s) for API requests */
  urls: FmgObjectUrl[];
  /** Attribute definitions */
  attributes: FmgAttributeDef[];
  /** Response-specific data fields (from second param_table) */
  responseData?: FmgAttributeDef[];
}

/** URL entry for an object */
export interface FmgObjectUrl {
  /** URL category (e.g., "Table", "Object", "Command object") */
  category: string;
  /** URL path (e.g., "/dvmdb/adom") */
  path: string;
}

// ─── Attribute/Parameter Definition ─────────────────────────────────

/** An attribute/field on an object or parameter on a method */
export interface FmgAttributeDef {
  /** Attribute name */
  name: string;
  /** Data type (e.g., "string", "int32", "option", "table") */
  type: string;
  /** Size in bytes (if specified) */
  size?: number;
  /** Whether this is a read-only attribute */
  readOnly?: boolean;
  /** Whether this is the master key / primary key */
  masterKey?: boolean;
  /** Description text */
  description?: string;
  /** Default value */
  defaultValue?: string;
  /** Enum options (for "option" or "flags" types) */
  options?: FmgOptionValue[];
  /** Reference target (for "datasource" types) */
  datasourceRef?: string;
  /** Child attributes (for inline "table" types) */
  children?: FmgAttributeDef[];
}

/** Parameter definition (alias for attribute, used in method context) */
export type FmgParamDef = FmgAttributeDef;

/** An enum option value */
export interface FmgOptionValue {
  /** The option value (e.g., "enable", "disable") */
  value: string;
  /** Description of the option */
  description?: string;
  /** Whether this is the default value */
  isDefault?: boolean;
}

// ─── Error Codes ────────────────────────────────────────────────────

/** Error code definition from *-errors.htm */
export interface FmgErrorCode {
  /** Numeric error code */
  code: number;
  /** Error description */
  message: string;
}
