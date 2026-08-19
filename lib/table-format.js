function isLink(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    typeof value.href === 'string'
  );
}

function plainCellText(value, separator) {
  if (value === undefined || value === null) {
    return '';
  }
  if (Array.isArray(value)) {
    return value.map((item) => plainCellText(item, separator)).join(separator);
  }
  if (isLink(value)) {
    return value.text?.trim() || value.href;
  }
  return String(value);
}

function escapeMarkdownText(value) {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .replace(/\r\n?|\n/g, '<br>');
}

function markdownCell(value) {
  if (isLink(value)) {
    const href = value.href.trim();
    const text = value.text?.trim();
    if (!text || text === href) {
      return escapeMarkdownText(href);
    }
    return `[${escapeMarkdownText(text)}](${href})`;
  }
  return escapeMarkdownText(plainCellText(value, '、'));
}

function csvCellText(value) {
  if (value === undefined || value === null) {
    return '';
  }
  if (Array.isArray(value)) {
    return value.map(csvCellText).join('；');
  }
  if (isLink(value)) {
    const href = value.href.trim();
    const text = value.text?.trim();
    return text && text !== href ? `${text} <${href}>` : href;
  }
  return String(value);
}

function escapeCsvCell(value) {
  const text = csvCellText(value);
  if (!/[",\r\n]/.test(text)) {
    return text;
  }
  return `"${text.replace(/"/g, '""')}"`;
}

export function tableToMarkdown(table) {
  const headers = table.columns.map(({ name }) => markdownCell(name));
  const lines = [
    `# ${escapeMarkdownText(table.title)}`,
    '',
    `> 来源：${table.sourceUrl}`,
    '> 导出范围：当前表格视图（保留筛选、分组和排序）',
    '',
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`
  ];

  for (const record of table.records) {
    const cells = table.columns.map(({ id }) => markdownCell(record.values[id]));
    lines.push(`| ${cells.join(' | ')} |`);
  }

  lines.push('');
  return lines.join('\n');
}

export function tableToCsv(table) {
  const rows = [
    table.columns.map(({ name }) => escapeCsvCell(name)).join(',')
  ];

  for (const record of table.records) {
    rows.push(
      table.columns
        .map(({ id }) => escapeCsvCell(record.values[id]))
        .join(',')
    );
  }

  return `\uFEFF${rows.join('\r\n')}\r\n`;
}
