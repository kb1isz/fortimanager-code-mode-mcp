# Usage Guide

This guide shows how to use the FortiManager Code Mode MCP Server with AI agents like VS Code Copilot, Claude Desktop, or any MCP-compatible client.

---

## Quick Start

### 1. Configure VS Code Copilot (Recommended)

Create `.vscode/mcp.json` in your workspace:

```json
{
  "servers": {
    "fortimanager": {
      "type": "stdio",
      "command": "node",
      "args": ["dist/index.js"],
      "env": {
        "FMG_HOST": "https://your-fmg.example.com",
        "FMG_API_TOKEN": "your-api-token",
        "FMG_VERIFY_SSL": "false",
        "FMG_API_VERSION": "7.6"
      }
    }
  }
}
```

### 2. Configure Docker (HTTP Transport)

```yaml
# docker-compose.yml
services:
  fmg-mcp:
    image: ghcr.io/jmpijll/fortimanager-code-mode-mcp:latest
    ports:
      - "8000:8000"
    environment:
      FMG_HOST: https://your-fmg.example.com
      FMG_API_TOKEN: your-api-token
      FMG_VERIFY_SSL: "false"
      FMG_API_VERSION: "7.6"
      MCP_TRANSPORT: http
      MCP_HTTP_PORT: "8000"
```

---

## The Two Tools

The server exposes exactly two tools:

### `search` — Explore the API Specification

Use this tool to discover API endpoints, look up object attributes, find methods, and understand the FortiManager API structure — all without making live API calls.

### `execute` — Run Live API Calls

Use this tool to interact with FortiManager: read configuration, create objects, modify settings, run diagnostic commands, and more.

---

## Search Tool Workflows

### Discover Available Modules

```javascript
// List all modules with their object counts
moduleList.map(function(m) {
  return m.name + ": " + m.objectCount + " objects";
})
```

### Find Objects by Keyword

```javascript
// Search for firewall-related objects
specIndex.filter(function(o) {
  return o.name.indexOf("firewall") !== -1;
}).map(function(o) {
  return { name: o.name, module: o.module, methods: o.methods };
})
```

### Look Up Object Details

```javascript
// Get all attributes for a specific object
var obj = getObject("firewall policy");
obj ? obj.attributes.map(function(a) {
  return { name: a.name, type: a.type, description: a.description };
}) : "Not found"
```

### Find Objects by URL Path

```javascript
// Look up an object by its API URL
var obj = getObject("/pm/config/adom/{adom}/pkg/{pkg}/firewall/policy");
obj ? { name: obj.name, methods: obj.methods, attrCount: obj.attributes.length } : "Not found"
```

### List Error Codes

```javascript
// Find specific error codes
errorCodes.filter(function(e) {
  return e.message.toLowerCase().indexOf("permission") !== -1;
})
```

### Filter by Module

```javascript
// List all objects in the dvmdb module
specIndex.filter(function(o) {
  return o.module === "dvmdb";
}).map(function(o) {
  return { name: o.name, methods: o.methods };
})
```

### Find Objects Supporting a Specific Method

```javascript
// Which objects support the 'exec' method?
specIndex.filter(function(o) {
  return o.methods.indexOf("exec") !== -1;
}).slice(0, 20).map(function(o) {
  return { name: o.name, url: o.urls[0] };
})
```

---

## Execute Tool Workflows

### Get System Status

```javascript
var resp = fortimanager.request("exec", [{
  url: "/sys/status"
}]);
resp
```

### List All ADOMs

```javascript
var resp = fortimanager.request("get", [{
  url: "/dvmdb/adom",
  option: ["no scope member"]
}]);
resp.result[0].data.map(function(a) {
  return { name: a.name, os_ver: a.os_ver, mr: a.mr };
})
```

### List Managed Devices

```javascript
var resp = fortimanager.request("get", [{
  url: "/dvmdb/device",
  option: ["no scope member"]
}]);
resp.result[0].data.map(function(d) {
  return { name: d.name, ip: d.ip, platform_str: d.platform_str, conn_status: d.conn_status };
})
```

### Get Firewall Policies

```javascript
var resp = fortimanager.request("get", [{
  url: "/pm/config/adom/root/pkg/default/firewall/policy"
}]);
resp.result[0].data
```

### Create a Firewall Address Object

```javascript
var resp = fortimanager.request("add", [{
  url: "/pm/config/adom/root/obj/firewall/address",
  data: {
    name: "test-server-01",
    type: 0,
    subnet: ["10.0.1.100", "255.255.255.255"],
    comment: "Created via MCP"
  }
}]);
resp.result[0].status
```

### Get a Specific Object by Name

```javascript
var resp = fortimanager.request("get", [{
  url: "/pm/config/adom/root/obj/firewall/address/test-server-01"
}]);
resp.result[0].data
```

### Update an Object

```javascript
var resp = fortimanager.request("update", [{
  url: "/pm/config/adom/root/obj/firewall/address/test-server-01",
  data: {
    comment: "Updated via MCP"
  }
}]);
resp.result[0].status
```

### Delete an Object

```javascript
var resp = fortimanager.request("delete", [{
  url: "/pm/config/adom/root/obj/firewall/address/test-server-01"
}]);
resp.result[0].status
```

### Batch Multiple Requests

```javascript
// Get devices and ADOMs in a single call
var resp = fortimanager.request("get", [
  { url: "/dvmdb/device", option: ["no scope member"] },
  { url: "/dvmdb/adom", option: ["no scope member"] }
]);
({
  devices: resp.result[0].data.length,
  adoms: resp.result[1].data.length
})
```

### Filter Results

```javascript
// Get only connected devices
var resp = fortimanager.request("get", [{
  url: "/dvmdb/device",
  filter: [["conn_status", "==", 1]],
  option: ["no scope member"]
}]);
resp.result[0].data.map(function(d) {
  return d.name + " (" + d.ip + ")";
})
```

### Pagination (Limit and Offset)

```javascript
// Get first 5 firewall addresses
var resp = fortimanager.request("get", [{
  url: "/pm/config/adom/root/obj/firewall/address",
  range: [0, 5]
}]);
resp.result[0].data.map(function(a) { return a.name; })
```

---

## Error Handling

### Check Response Status

```javascript
var resp = fortimanager.request("get", [{
  url: "/pm/config/adom/root/obj/firewall/address"
}]);
var status = resp.result[0].status;
if (status.code !== 0) {
  "Error: " + status.message + " (code " + status.code + ")";
} else {
  "Got " + resp.result[0].data.length + " addresses";
}
```

### Common Status Codes

| Code | Meaning            |
| ---- | ------------------ |
| 0    | OK / Success       |
| -2   | Object already exists |
| -3   | Object not found   |
| -6   | Invalid URL        |
| -10  | Object dependency prevents action |
| -11  | No permission      |
| -13  | Session expired    |

---

## Agent Workflow Patterns

### Discovery → Action Pattern

The typical agent workflow is:

1. **Search** to find the right API endpoint and understand its attributes
2. **Execute** to perform the actual operation

Example conversation:

> **User**: "List all FortiGate devices and show their firmware versions"
>
> **Agent** (search call):
> ```javascript
> specIndex.filter(function(o) {
>   return o.name === "device" && o.module === "dvmdb";
> }).map(function(o) {
>   return { urls: o.urls, attributeNames: o.attributeNames };
> })
> ```
>
> **Agent** (execute call):
> ```javascript
> var resp = fortimanager.request("get", [{
>   url: "/dvmdb/device",
>   fields: ["name", "ip", "os_ver", "mr", "patch", "platform_str"],
>   option: ["no scope member"]
> }]);
> resp.result[0].data
> ```

### Multi-Step Configuration

For complex tasks, chain multiple execute calls:

```javascript
// Step 1: Create address
var r1 = fortimanager.request("add", [{
  url: "/pm/config/adom/root/obj/firewall/address",
  data: { name: "web-server", type: 0, subnet: ["10.0.1.10", "255.255.255.255"] }
}]);

// Step 2: Create address group referencing the address
var r2 = fortimanager.request("add", [{
  url: "/pm/config/adom/root/obj/firewall/addrgrp",
  data: { name: "web-servers", member: ["web-server"] }
}]);

({ address: r1.result[0].status, group: r2.result[0].status })
```

---

## Tips and Best Practices

### Sandbox Limitations

- **Use `var` instead of `const`/`let`**: QuickJS runs in global mode; `const`/`let` at top-level can cause issues with result capture.
- **No `await`**: `fortimanager.request()` is synchronous in the sandbox. Do NOT use `async`/`await`.
- **Use `function()` syntax**: Arrow functions work but `function()` is more reliable across QuickJS versions.
- **Return the result as the last expression**: The tool returns the value of the last expression in your code.

### Performance

- Use `fields` parameter to request only the attributes you need
- Use `filter` to reduce result sets server-side
- Use `range` for pagination on large collections
- Batch related requests into a single `fortimanager.request()` call
- Use `option: ["no scope member"]` to skip scope member resolution (faster)

### Security

- Never hardcode credentials in tool calls — they're configured via environment variables
- Use read-only operations (`get`) for discovery before modifying anything
- Test changes in a non-production ADOM first
- The sandbox limits you to 50 API calls per execution to prevent runaway operations
