import test from 'node:test';
import assert from 'node:assert/strict';

import {
  captureCanFinish,
  collectVirtualRecords,
  createCaptureState,
  mergeRecordBatch,
  TableCaptureError
} from '../lib/table-capture.js';

test('新增记录按首次出现顺序保存并忽略相同重复项', () => {
  const state = createCaptureState([{ id: 'subject', name: '事项' }]);
  const record = { key: 'row-1', values: { subject: '事项 A' } };

  assert.deepEqual(mergeRecordBatch(state, [record]), {
    added: 1,
    conflicts: 0
  });
  assert.deepEqual(mergeRecordBatch(state, [record]), {
    added: 0,
    conflicts: 0
  });
  assert.deepEqual([...state.recordsByKey.values()], [record]);
});

test('对象字段顺序不同但内容相同不产生冲突', () => {
  const state = createCaptureState([{ id: 'subject', name: '事项' }]);
  mergeRecordBatch(state, [
    { key: 'row-1', values: { meta: { a: 'A', b: 'B' } } }
  ]);

  assert.deepEqual(
    mergeRecordBatch(state, [
      { key: 'row-1', values: { meta: { b: 'B', a: 'A' } } }
    ]),
    { added: 0, conflicts: 0 }
  );
});

test('同一记录字段冲突时标记冲突且不静默覆盖', () => {
  const state = createCaptureState([{ id: 'subject', name: '事项' }]);
  mergeRecordBatch(state, [
    { key: 'row-1', values: { subject: '原值' } }
  ]);
  const result = mergeRecordBatch(state, [
    { key: 'row-1', values: { subject: '新值' } }
  ]);

  assert.equal(result.conflicts, 1);
  assert.equal(state.recordsByKey.get('row-1').values.subject, '原值');
  assert.equal(state.conflicts.length, 1);
  assert.equal(
    captureCanFinish({ atBottom: true, stablePasses: 3, conflicts: 1 }),
    false
  );
});

test('只有到达底部且连续三轮稳定时才允许结束', () => {
  assert.equal(
    captureCanFinish({ atBottom: false, stablePasses: 3, conflicts: 0 }),
    false
  );
  assert.equal(
    captureCanFinish({ atBottom: true, stablePasses: 2, conflicts: 0 }),
    false
  );
  assert.equal(
    captureCanFinish({ atBottom: true, stablePasses: 3, conflicts: 0 }),
    true
  );
});

test('虚拟滚动逐批合并记录并在底部稳定后结束', async () => {
  const first = { key: '1:A', values: { subject: 'A' } };
  const second = { key: '2:B', values: { subject: 'B' } };
  const batches = [[first], [first, second], [second], [second], [second]];
  let sampleIndex = 0;
  let advances = 0;
  const progress = [];

  const records = await collectVirtualRecords({
    columns: [{ id: 'subject', name: '事项' }],
    sample: () => batches[Math.min(sampleIndex++, batches.length - 1)],
    advance: async () => {
      advances += 1;
    },
    isAtBottom: () => sampleIndex >= 2,
    sleep: async () => {},
    now: () => sampleIndex * 10,
    deadlineMs: 1000,
    onProgress: (count) => progress.push(count)
  });

  assert.deepEqual(records, [first, second]);
  assert.equal(advances, 1);
  assert.deepEqual(progress, [1, 2, 2, 2, 2]);
});

test('虚拟滚动遇到记录冲突时立即失败', async () => {
  let sampleIndex = 0;
  const batches = [
    [{ key: '1:A', values: { subject: '原值' } }],
    [{ key: '1:A', values: { subject: '新值' } }]
  ];

  await assert.rejects(
    collectVirtualRecords({
      columns: [{ id: 'subject', name: '事项' }],
      sample: () => batches[Math.min(sampleIndex++, 1)],
      advance: async () => {},
      isAtBottom: () => false,
      sleep: async () => {},
      now: () => sampleIndex * 10,
      deadlineMs: 1000
    }),
    (error) =>
      error instanceof TableCaptureError &&
      error.code === 'RECORD_CONFLICT'
  );
});

test('虚拟滚动超过截止时间时失败而不返回部分数据', async () => {
  let clock = 0;

  await assert.rejects(
    collectVirtualRecords({
      columns: [{ id: 'subject', name: '事项' }],
      sample: () => [{ key: '1:A', values: { subject: 'A' } }],
      advance: async () => {},
      isAtBottom: () => false,
      sleep: async () => {
        clock += 60;
      },
      now: () => clock,
      deadlineMs: 100
    }),
    (error) =>
      error instanceof TableCaptureError && error.code === 'CAPTURE_TIMEOUT'
  );
});
