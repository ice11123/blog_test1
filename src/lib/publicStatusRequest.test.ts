import test from 'node:test';
import assert from 'node:assert/strict';
import { requestStatusJson } from './publicStatusRequest.ts';

test('短暂网络失败会重试并恢复成功', async () => {
  let calls = 0;
  const result = await requestStatusJson('https://worker.test/health', {
    attempts: 3,
    timeoutMs: 50,
    retryDelaysMs: [0, 0],
    fetchImpl: async () => {
      calls += 1;
      if (calls < 3) throw new TypeError('Failed to fetch');
      return Response.json({ ok: true });
    },
  });

  assert.equal(result.kind, 'ok');
  assert.equal(result.attempts, 3);
  assert.equal(calls, 3);
});

test('网络超时与 HTTP 服务错误使用不同结果', async () => {
  const network = await requestStatusJson('https://worker.test/health', {
    attempts: 2,
    timeoutMs: 50,
    retryDelaysMs: [0],
    fetchImpl: async () => { throw new TypeError('Failed to fetch'); },
  });
  assert.equal(network.kind, 'network-error');
  assert.equal(network.attempts, 2);

  const timeout = await requestStatusJson('https://worker.test/health', {
    attempts: 1,
    timeoutMs: 50,
    fetchImpl: async () => { throw new DOMException('The operation timed out', 'TimeoutError'); },
  });
  assert.deepEqual(timeout, { kind: 'network-error', reason: 'timeout', attempts: 1 });

  let calls = 0;
  const http = await requestStatusJson('https://worker.test/health', {
    attempts: 3,
    timeoutMs: 50,
    retryDelaysMs: [0, 0],
    fetchImpl: async () => {
      calls += 1;
      return Response.json({ ok: false }, { status: 403 });
    },
  });
  assert.equal(http.kind, 'http-error');
  assert.equal(http.status, 403);
  assert.equal(calls, 1);
});

test('服务端 503 会重试，最终仍失败时保留 HTTP 状态', async () => {
  let calls = 0;
  const result = await requestStatusJson('https://worker.test/api/public-status', {
    attempts: 2,
    timeoutMs: 50,
    retryDelaysMs: [0],
    fetchImpl: async () => {
      calls += 1;
      return Response.json({ ok: false }, { status: 503 });
    },
  });

  assert.equal(result.kind, 'http-error');
  assert.equal(result.status, 503);
  assert.equal(result.attempts, 2);
  assert.equal(calls, 2);
});
