/** Split a SQL script into executable statements (handles quotes and dollar-quoting). */
export function splitSqlStatements(source: string): string[] {
  const statements: string[] = [];
  let current = '';
  let i = 0;

  let inSingleQuote = false;
  let inDoubleQuote = false;
  let dollarDelimiter: string | null = null;

  while (i < source.length) {
    const char = source[i];

    if (dollarDelimiter) {
      if (source.startsWith(dollarDelimiter, i)) {
        current += dollarDelimiter;
        i += dollarDelimiter.length;
        dollarDelimiter = null;
        continue;
      }

      current += char;
      i++;
      continue;
    }

    if (!inSingleQuote && !inDoubleQuote && char === '-' && source[i + 1] === '-') {
      while (i < source.length && source[i] !== '\n') {
        i++;
      }
      continue;
    }

    if (!inSingleQuote && !inDoubleQuote && char === '/' && source[i + 1] === '*') {
      i += 2;
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) {
        i++;
      }
      i += 2;
      continue;
    }

    if (!inDoubleQuote && char === "'") {
      if (inSingleQuote && source[i + 1] === "'") {
        current += "''";
        i += 2;
        continue;
      }

      inSingleQuote = !inSingleQuote;
      current += char;
      i++;
      continue;
    }

    if (!inSingleQuote && char === '"') {
      if (inDoubleQuote && source[i + 1] === '"') {
        current += '""';
        i += 2;
        continue;
      }

      inDoubleQuote = !inDoubleQuote;
      current += char;
      i++;
      continue;
    }

    if (!inSingleQuote && !inDoubleQuote && char === '$') {
      const match = source.slice(i).match(/^\$[A-Za-z0-9_]*\$/);
      if (match) {
        dollarDelimiter = match[0];
        current += dollarDelimiter;
        i += dollarDelimiter.length;
        continue;
      }
    }

    if (!inSingleQuote && !inDoubleQuote && char === ';') {
      const statement = current.trim();
      if (statement.length > 0) {
        statements.push(statement);
      }
      current = '';
      i++;
      continue;
    }

    current += char;
    i++;
  }

  const tail = current.trim();
  if (tail.length > 0) {
    statements.push(tail);
  }

  return statements;
}

export function containsCopyFromStdin(sql: string): boolean {
  return /\bCOPY\b[\s\S]*?\bFROM\s+stdin\b/i.test(sql);
}
