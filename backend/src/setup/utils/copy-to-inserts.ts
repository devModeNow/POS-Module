const COPY_START = /\bCOPY\b/gi;
const FROM_STDIN = /\s+FROM\s+stdin\b/i;
const INSERT_BATCH_SIZE = 50;

export function convertCopyFromStdinToInserts(
  sql: string,
): { ok: true; sql: string } | { ok: false; error: string } {
  const chunks: string[] = [];
  let cursor = 0;

  while (cursor < sql.length) {
    COPY_START.lastIndex = cursor;
    const match = COPY_START.exec(sql);
    if (!match) {
      chunks.push(sql.slice(cursor));
      break;
    }

    const copyStart = match.index;
    const rest = sql.slice(copyStart);
    if (!FROM_STDIN.test(rest.slice(0, 4000))) {
      chunks.push(sql.slice(cursor, copyStart + 4));
      cursor = copyStart + 4;
      continue;
    }

    chunks.push(sql.slice(cursor, copyStart));

    const parsed = parseCopyBlock(sql, copyStart);
    if (!parsed.ok) {
      return parsed;
    }

    chunks.push(parsed.insertSql);
    cursor = parsed.endIndex;
  }

  return { ok: true, sql: chunks.join('') };
}

function parseCopyBlock(
  sql: string,
  copyStart: number,
): { ok: true; insertSql: string; endIndex: number } | { ok: false; error: string } {
  const fromStdin = sql.slice(copyStart).match(/FROM\s+stdin\b/i);
  if (!fromStdin || fromStdin.index === undefined) {
    return { ok: false, error: 'Invalid COPY ... FROM stdin block.' };
  }

  const stdinTokenEnd = copyStart + fromStdin.index + fromStdin[0].length;
  const afterStdin = sql.slice(stdinTokenEnd);
  const withMatch = afterStdin.match(/^\s+WITH\s*\(([\s\S]*?)\)/i);
  const withClause = withMatch?.[1] ?? '';

  if (/\bbinary\b/i.test(withClause) || /\bFORMAT\s+binary\b/i.test(withClause)) {
    return {
      ok: false,
      error: 'Binary COPY dumps cannot be imported in the browser setup. Use a plain SQL dump (pg_dump -Fp).',
    };
  }

  if (/\bcsv\b/i.test(withClause) || /\bFORMAT\s+csv\b/i.test(withClause)) {
    return {
      ok: false,
      error: 'CSV COPY dumps are not supported in setup import. Re-export with pg_dump default text format or --inserts.',
    };
  }

  const afterOptions = withMatch ? afterStdin.slice(withMatch[0].length) : afterStdin;
  const semi = afterOptions.indexOf(';');
  if (semi === -1) {
    return { ok: false, error: 'COPY ... FROM stdin is missing a terminating semicolon.' };
  }

  const header = sql.slice(copyStart, stdinTokenEnd).trim();
  const targetMatch = header.match(/^COPY\s+([\s\S]+?)\s+FROM\s+stdin$/i);
  if (!targetMatch) {
    return { ok: false, error: 'Could not parse COPY target table.' };
  }

  const target = targetMatch[1].trim();
  let dataStart = stdinTokenEnd + (withMatch ? withMatch[0].length : 0) + semi + 1;
  if (sql[dataStart] === '\r') dataStart++;
  if (sql[dataStart] === '\n') dataStart++;

  const terminator = findCopyTerminator(sql, dataStart);
  if (terminator === -1) {
    return { ok: false, error: 'COPY ... FROM stdin is missing the terminating \\. line.' };
  }

  const data = sql.slice(dataStart, terminator.index);
  const insertSql = buildInserts(target, data);

  return { ok: true, insertSql, endIndex: terminator.endIndex };
}

function findCopyTerminator(
  sql: string,
  from: number,
): { index: number; endIndex: number } | -1 {
  let i = from;
  while (i < sql.length) {
    const lineStart = i;
    while (i < sql.length && sql[i] !== '\n') {
      i++;
    }
    const line = sql.slice(lineStart, i).replace(/\r$/, '');
    if (line === '\\.') {
      let endIndex = i;
      if (sql[endIndex] === '\n') endIndex++;
      return { index: lineStart, endIndex };
    }
    if (i < sql.length && sql[i] === '\n') {
      i++;
    }
  }
  return -1;
}

function buildInserts(target: string, data: string): string {
  const rows = data.split(/\r?\n/).filter((line) => line.length > 0);
  if (rows.length === 0) {
    return '';
  }

  const batches: string[] = [];
  for (let i = 0; i < rows.length; i += INSERT_BATCH_SIZE) {
    const slice = rows.slice(i, i + INSERT_BATCH_SIZE);
    const values = slice
      .map((row) => `(${splitCopyRow(row).map(sqlLiteral).join(', ')})`)
      .join(',\n');
    batches.push(`INSERT INTO ${target} VALUES\n${values};`);
  }

  return `${batches.join('\n')}\n`;
}

function splitCopyRow(line: string): Array<string | null> {
  const fields: string[] = [];
  let current = '';

  for (let i = 0; i < line.length; i++) {
    if (line[i] === '\\' && i + 1 < line.length) {
      current += line[i] + line[i + 1];
      i++;
      continue;
    }
    if (line[i] === '\t') {
      fields.push(current);
      current = '';
      continue;
    }
    current += line[i];
  }
  fields.push(current);

  return fields.map(unescapeCopyField);
}

function unescapeCopyField(field: string): string | null {
  if (field === '\\N') {
    return null;
  }

  let out = '';
  for (let i = 0; i < field.length; i++) {
    if (field[i] !== '\\' || i + 1 >= field.length) {
      out += field[i];
      continue;
    }

    const next = field[i + 1];
    const simple: Record<string, string> = {
      b: '\b',
      f: '\f',
      n: '\n',
      r: '\r',
      t: '\t',
      v: '\v',
      '\\': '\\',
    };

    if (next in simple) {
      out += simple[next];
      i++;
      continue;
    }

    if (next >= '0' && next <= '7') {
      let oct = next;
      let consumed = 1;
      if (i + 2 < field.length && field[i + 2] >= '0' && field[i + 2] <= '7') {
        oct += field[i + 2];
        consumed++;
        if (i + 3 < field.length && field[i + 3] >= '0' && field[i + 3] <= '7') {
          oct += field[i + 3];
          consumed++;
        }
      }
      out += String.fromCharCode(parseInt(oct, 8));
      i += consumed;
      continue;
    }

    out += next;
    i++;
  }

  return out;
}

function sqlLiteral(value: string | null): string {
  if (value === null) {
    return 'NULL';
  }
  return `'${value.replace(/'/g, "''")}'`;
}
