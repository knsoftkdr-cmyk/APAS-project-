// tools/feature-docs/routes.mjs
// Maps each route in src/App.tsx to the page component file that renders it and the roles allowed to open it
// (the real <RoleGuard allowedRoles={[...]}>). Also resolves local imports so the extractor can follow components.
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const WRAPPERS = new Set(["ProtectedRoute", "RoleGuard", "Suspense", "AppLayout", "PermissionGuard", "ModuleGuard", "FeatureGuard"]);

const EXTS = [".tsx", ".ts", "/index.tsx", "/index.ts"];

/** Resolve an import specifier ("@/pages/X", "./pages/X", "../x") to a real file under the project, or null. */
export function resolveImport(spec, fromFile, root) {
  let base;
  if (spec.startsWith("@/")) base = path.join(root, "src", spec.slice(2));
  else if (spec.startsWith(".")) base = path.resolve(path.dirname(fromFile), spec);
  else return null;
  for (const e of ["", ...EXTS]) {
    const f = base + e;
    if (e !== "" || /\.(tsx|ts)$/.test(base)) {
      if (fs.existsSync(f) && fs.statSync(f).isFile()) return f;
    }
  }
  return null;
}

/** lazy(() => import("./pages/X"))  and  import X from "./pages/X" */
function importMap(sf, appFile, root) {
  const map = new Map();
  const visit = (n) => {
    if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier)) {
      const c = n.importClause;
      const f = resolveImport(n.moduleSpecifier.text, appFile, root);
      if (c?.name && f) map.set(c.name.text, f);
      if (c?.namedBindings && ts.isNamedImports(c.namedBindings) && f) c.namedBindings.elements.forEach((e) => map.set(e.name.text, f));
    }
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer?.getText().includes("import(")) {
      const m = n.initializer.getText().match(/import\(\s*["']([^"']+)["']\s*\)/);
      const f = m && resolveImport(m[1], appFile, root);
      if (f) map.set(n.name.text, f);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return map;
}

/**
 * @returns {Map<string, {component:string|null, file:string|null, allowedRoles:string[]|null}>} keyed by route path
 */
export function parseRoutes(appSource, appFile, root) {
  const sf = ts.createSourceFile(appFile, appSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const imports = importMap(sf, appFile, root);
  const routes = new Map();

  const visit = (n) => {
    if (ts.isJsxSelfClosingElement(n) && n.tagName.getText() === "Route") {
      let routePath, element;
      for (const a of n.attributes.properties) {
        if (!ts.isJsxAttribute(a) || !a.initializer) continue;
        const name = a.name.getText();
        if (name === "path" && ts.isStringLiteral(a.initializer)) routePath = a.initializer.text;
        if (name === "element" && ts.isJsxExpression(a.initializer)) element = a.initializer.expression;
      }
      if (routePath && element) {
        let component = null;
        let allowedRoles = null;
        const inner = (e) => {
          if (ts.isJsxSelfClosingElement(e) || ts.isJsxOpeningElement(e)) {
            const tag = e.tagName.getText();
            if (tag === "RoleGuard") {
              for (const a of e.attributes.properties) {
                if (ts.isJsxAttribute(a) && a.name.getText() === "allowedRoles" && a.initializer && ts.isJsxExpression(a.initializer)) {
                  const arr = a.initializer.expression;
                  if (arr && ts.isArrayLiteralExpression(arr)) allowedRoles = arr.elements.filter(ts.isStringLiteral).map((x) => x.text);
                }
              }
            } else if (!WRAPPERS.has(tag) && /^[A-Z]/.test(tag)) component = tag; // innermost page component wins
          }
          ts.forEachChild(e, inner);
        };
        inner(element);
        routes.set(routePath, { component, file: component ? imports.get(component) ?? null : null, allowedRoles });
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return routes;
}
