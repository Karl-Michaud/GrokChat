/**
 * The compiler-API scan behind "no vendor types in port signatures" (plan §6): every type a port
 * file names must be declared in src/entities/, src/use_cases/ports/ or TypeScript's own lib.
 */
import { dirname, relative, sep } from "node:path";
import ts from "typescript";

export interface PortViolation {
  readonly file: string;
  readonly type: string;
  readonly declaredIn: string;
}

function program(tsconfigPath: string): ts.Program {
  const config = ts.readConfigFile(tsconfigPath, (path) => ts.sys.readFile(path));
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, dirname(tsconfigPath));
  return ts.createProgram(parsed.fileNames, parsed.options);
}

function allowed(prog: ts.Program, root: string, declaration: ts.Declaration): boolean {
  const file = declaration.getSourceFile();
  if (prog.isSourceFileDefaultLibrary(file) || ts.isTypeParameterDeclaration(declaration)) {
    return true;
  }
  const path = relative(root, file.fileName).split(sep).join("/");
  return path.startsWith("src/entities/") || path.startsWith("src/use_cases/ports/");
}

export function scanPorts(tsconfigPath: string, root: string): readonly PortViolation[] {
  const prog = program(tsconfigPath);
  const checker = prog.getTypeChecker();
  const violations: PortViolation[] = [];
  const ports = prog
    .getSourceFiles()
    .filter((file) =>
      relative(root, file.fileName).split(sep).join("/").startsWith("src/use_cases/ports/"),
    );
  for (const file of ports) {
    const visit = (node: ts.Node): void => {
      if (ts.isTypeReferenceNode(node)) {
        const found = checker.getSymbolAtLocation(node.typeName);
        const symbol =
          found !== undefined && found.flags & ts.SymbolFlags.Alias
            ? checker.getAliasedSymbol(found)
            : found;
        for (const declaration of symbol?.declarations ?? []) {
          if (!allowed(prog, root, declaration)) {
            violations.push({
              file: relative(root, file.fileName),
              type: node.typeName.getText(file),
              declaredIn: relative(root, declaration.getSourceFile().fileName),
            });
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
  }
  return violations;
}
