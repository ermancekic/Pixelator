import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

/** Source texts passed to t(), msg() and translate() in the editor, with the files that use them. */
export function translationKeys(directory: string): Map<string, string[]> {
  const keys = new Map<string, string[]>();
  for (const file of readdirSync(directory).filter(name => /\.tsx?$/.test(name) && name !== 'translations.ts')) {
    const source = ts.createSourceFile(file, readFileSync(join(directory, file), 'utf8'), ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const collect = (node: ts.Expression | undefined): void => {
      if (!node) return;
      if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) keys.set(node.text, [...new Set([...(keys.get(node.text) ?? []), file])]);
      else if (ts.isParenthesizedExpression(node)) collect(node.expression);
      else if (ts.isConditionalExpression(node)) { collect(node.whenTrue); collect(node.whenFalse); }
    };
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
        const name = node.expression.text;
        if (name === 't' || name === 'msg') collect(node.arguments[0]);
        if (name === 'translate') collect(node.arguments[1]);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return keys;
}
