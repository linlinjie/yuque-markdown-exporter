function canonicalValue(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalValue);
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalValue(value[key])])
    );
  }
  return value;
}

function recordFingerprint(record) {
  return JSON.stringify(canonicalValue(record.values));
}

export class TableCaptureError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'TableCaptureError';
    this.code = code;
  }
}

export function createCaptureState(columns) {
  return {
    columns: [...columns],
    recordsByKey: new Map(),
    conflicts: []
  };
}

export function mergeRecordBatch(state, records) {
  let added = 0;
  let conflicts = 0;

  for (const record of records) {
    const existing = state.recordsByKey.get(record.key);
    if (existing === undefined) {
      state.recordsByKey.set(record.key, record);
      added += 1;
      continue;
    }
    if (recordFingerprint(existing) === recordFingerprint(record)) {
      continue;
    }
    state.conflicts.push({ key: record.key, existing, incoming: record });
    conflicts += 1;
  }

  return { added, conflicts };
}

export function captureCanFinish({ atBottom, stablePasses, conflicts }) {
  return atBottom && stablePasses >= 3 && conflicts === 0;
}

export async function collectVirtualRecords({
  columns,
  sample,
  advance,
  isAtBottom,
  sleep,
  now = Date.now,
  deadlineMs = 120_000,
  onProgress = () => {}
}) {
  const state = createCaptureState(columns);
  const startedAt = now();
  let stablePasses = 0;

  while (true) {
    if (now() - startedAt >= deadlineMs) {
      throw new TableCaptureError(
        'CAPTURE_TIMEOUT',
        '表格采集超时，未生成残缺文件'
      );
    }

    const result = mergeRecordBatch(state, sample());
    if (result.conflicts > 0) {
      throw new TableCaptureError(
        'RECORD_CONFLICT',
        '同一记录在采集期间发生变化，请重试'
      );
    }

    stablePasses = result.added === 0 ? stablePasses + 1 : 0;
    onProgress(state.recordsByKey.size);

    const atBottom = isAtBottom();
    if (
      captureCanFinish({
        atBottom,
        stablePasses,
        conflicts: state.conflicts.length
      })
    ) {
      return [...state.recordsByKey.values()];
    }

    if (!atBottom) {
      await advance();
    }
    await sleep();
  }
}
