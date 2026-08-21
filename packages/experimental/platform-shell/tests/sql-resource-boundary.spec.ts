import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const PACKAGE_ROOT = fileURLToPath(new URL('../', import.meta.url))
const SQL_LITERAL = /^\s*(?:ALTER|ATTACH|BEGIN|COMMIT|CREATE|DELETE|DETACH|DROP|INSERT|PRAGMA|REINDEX|RELEASE|ROLLBACK|SAVEPOINT|SELECT|UPDATE|VACUUM|WITH)\s/iu // eslint-disable-line @stylistic/max-len

async function filesUnder(path: string): Promise<string[]> {
  const entries = await readdir(path, { withFileTypes: true })
  return (await Promise.all(entries.map(async entry => entry.isDirectory()
    ? filesUnder(`${path}/${entry.name}`)
    : [`${path}/${entry.name}`]))).flat()
}

function sqlLiteralText(node: ts.Node): string | undefined {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text
  if (node.kind === ts.SyntaxKind.TemplateHead) {
    return (node as ts.Node & { readonly text: string }).text
  }
  return undefined
}

/** Whether one query argument is a package-owned sql()/testSql() resource call. */
function isOwnedSqlSource(node: ts.Expression | undefined): boolean {
  if (node === undefined || !ts.isCallExpression(node)) return false
  if (ts.isIdentifier(node.expression)
    && (node.expression.text === 'sql' || node.expression.text === 'testSql')) return true
  return false
}

describe('Platform shell SQL resource boundary', () => {
  it('keeps statements and query assembly out of TypeScript files', async () => {
    const files = (await Promise.all([
      filesUnder(`${PACKAGE_ROOT}/src`),
      filesUnder(`${PACKAGE_ROOT}/tests`),
    ])).flat().filter(path => path.endsWith('.ts'))
    const violations: string[] = []
    for (const path of files) {
      const source = ts.createSourceFile(path, await readFile(path, 'utf8'), ts.ScriptTarget.Latest, true)
      const usesNodeSqlite = source.statements.some(statement => ts.isImportDeclaration(statement)
        && ts.isStringLiteral(statement.moduleSpecifier)
        && statement.moduleSpecifier.text === 'node:sqlite')
      const visit = (node: ts.Node): void => {
        const literal = sqlLiteralText(node)
        if (literal !== undefined && SQL_LITERAL.test(literal)) {
          violations.push(`${path}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}: SQL literal`)
        }
        // DatabaseSync.prepare() and exec() must receive a package-owned resource.
        if (usesNodeSqlite
          && ts.isCallExpression(node)
          && ts.isPropertyAccessExpression(node.expression)
          && (node.expression.name.text === 'exec' || node.expression.name.text === 'prepare')) {
          const argument = node.arguments[0]
          if (!isOwnedSqlSource(argument)) {
            violations.push(`${path}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}: unowned query source`)
          }
        }
        ts.forEachChild(node, visit)
      }
      visit(source)
    }
    expect(violations).toEqual([])
  })

  it('keeps resource text static instead of interpolated', async () => {
    const files = (await Promise.all([
      filesUnder(`${PACKAGE_ROOT}/resources/sql`),
      filesUnder(`${PACKAGE_ROOT}/tests/resources/sql`),
    ])).flat()
    for (const path of files) {
      expect(path.endsWith('.sql')).toBe(true)
      expect(await readFile(path, 'utf8')).not.toContain('${')
    }
  })
})
