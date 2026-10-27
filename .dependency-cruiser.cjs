// The dependency rule and the vendor bans (plan §3, §5; Agents/CLAUDE.md §7.1).
// tests/architecture/dependency_rules.test.ts proves every rule below fires on a fixture.

const INNER = "^src/(entities|use_cases|interface_adapters)/";
/** A folder or module named utils, helpers, common or misc, at any depth under src/. */
const GRAB_BAG = "^src/(utils|helpers|common|misc)[/.]|^src/.*/(utils|helpers|common|misc)[/.]";

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "entities-import-only-entities",
      comment: "Entities are the centre: they import nothing from any other layer or from main.",
      severity: "error",
      from: { path: "^src/entities/" },
      to: { path: "^src/(use_cases|interface_adapters|frameworks|main\\.ts)" },
    },
    {
      name: "use-cases-point-inward",
      severity: "error",
      from: { path: "^src/use_cases/" },
      to: { path: "^src/(interface_adapters|frameworks|main\\.ts)" },
    },
    {
      name: "ports-import-only-entities",
      comment: "Port signatures use entity types only (plan §3.2).",
      severity: "error",
      from: { path: "^src/use_cases/ports/" },
      to: { path: "^src/", pathNot: "^src/(entities|use_cases/ports)/" },
    },
    {
      name: "interface-adapters-point-inward",
      severity: "error",
      from: { path: "^src/interface_adapters/" },
      to: { path: "^src/(frameworks|main\\.ts)" },
    },
    {
      name: "nothing-imports-main",
      comment: "main.ts is the composition root; nothing depends on it.",
      severity: "error",
      from: { path: "^src/", pathNot: "^src/main\\.ts$" },
      to: { path: "^src/main\\.ts$" },
    },
    {
      name: "vendors-only-in-frameworks",
      comment: "The MCP SDK, Hono and the Workers runtime are reached only from frameworks/.",
      severity: "error",
      from: { path: "^src/", pathNot: "^src/frameworks/" },
      to: {
        path: "(^|/)node_modules/(@modelcontextprotocol/sdk|hono)/|^cloudflare:",
      },
    },
    {
      name: "zod-only-at-boundaries",
      comment: "zod lives in interface_adapters/schemas and frameworks only.",
      severity: "error",
      from: { path: "^src/", pathNot: "^src/(frameworks|interface_adapters/schemas)/" },
      to: { path: "(^|/)node_modules/zod/" },
    },
    {
      name: "inner-layers-no-npm-packages",
      comment:
        "The inner layers import no npm package, except zod in interface_adapters/schemas and twitter-text in entities (docs/decisions/2026-10-27-dependency-twitter-text.md).",
      severity: "error",
      from: { path: INNER, pathNot: "^src/interface_adapters/schemas/" },
      to: {
        dependencyTypes: [
          "npm",
          "npm-dev",
          "npm-optional",
          "npm-peer",
          "npm-no-pkg",
          "npm-unknown",
        ],
        pathNot: "(^|/)node_modules/(zod|twitter-text)/",
      },
    },
    {
      name: "twitter-text-only-in-entities",
      severity: "error",
      from: { path: "^src/", pathNot: "^src/(entities|frameworks)/" },
      to: { path: "(^|/)node_modules/twitter-text/" },
    },
    {
      name: "inner-layers-no-runtime-builtins",
      comment: "No Node built-ins (I/O) in the pure layers.",
      severity: "error",
      from: { path: INNER },
      to: { dependencyTypes: ["core"] },
    },
    {
      name: "no-grab-bag-modules",
      comment:
        "No utils, helpers, common or misc modules: code lives where its responsibility lives.",
      severity: "error",
      from: { path: GRAB_BAG },
      to: {},
    },
    {
      name: "no-imports-of-grab-bag-modules",
      severity: "error",
      from: {},
      to: { path: GRAB_BAG },
    },
    {
      name: "no-circular",
      comment:
        "No runtime cycles. A type-only cycle is allowed (Env names the Durable Object class, which takes Env).",
      severity: "error",
      from: {},
      to: { circular: true, viaOnly: { dependencyTypesNot: ["type-only"] } },
    },
    {
      name: "no-unresolvable",
      comment: "Every import resolves (cloudflare: modules are provided by workerd).",
      severity: "error",
      from: {},
      to: { couldNotResolve: true, pathNot: "^cloudflare:" },
    },
    {
      name: "no-orphans",
      severity: "error",
      from: { orphan: true, pathNot: "\\.d\\.ts$" },
      to: {},
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    exclude: { path: "^(coverage|reports|\\.stryker-tmp|\\.wrangler)/" },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.json" },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default", "types"],
      mainFields: ["module", "main", "types", "typings"],
    },
  },
};
