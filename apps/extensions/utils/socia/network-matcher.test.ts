import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  Milestone,
  StudentNetworkEvent,
  WorkflowData,
} from '@socia/eval';
import {
  checkMilestones,
  getMilestoneSignatures,
  matchesMilestoneSignature,
  matchesSignature,
} from '../../../packages/socia-runtime/src/network-matcher';


const event: StudentNetworkEvent = {
  timestamp: 10,
  method: 'POST',
  url: 'https://thehive.test/api/v1/query',
  host: 'thehive.test',
  pathname: '/api/v1/query',
  status: 200,
  contentType: 'application/json',
  requestBody: '{"query":"getAlert","source":"10.0.0.8"}',
  responseBody: '{"title":"SSH alert","victim":"10.0.0.9"}',
};

const milestone = (id: string, dependsOn?: string[]): Milestone => ({
  id,
  label: id,
  depends_on: dependsOn,
  network_signature: {
    method: 'POST',
    url_contains: ['/not-used', '/api/v1/query'],
    host_contains: '{{thehive_host}}',
    response_status: [200],
    request_body_contains: ['getAlert', '{{attacker_ip}}'],
    response_body_contains: ['SSH alert', '{{victim_ip}}'],
  },
});

const workflow = (milestones: Milestone[]): WorkflowData => ({
  case: { id: 'test', title: 'Test', description: 'Test' },
  variables: {
    thehive_host: 'thehive.test',
    attacker_ip: '10.0.0.8',
    victim_ip: '10.0.0.9',
  },
  context: { tools: {}, pedagogy: { test: 'Test' }, notes: '' },
  phases: [
    {
      id: 'test',
      title: 'Test',
      description: 'Test',
      order: 1,
      tool_hosts: ['{{thehive_host}}'],
      milestones,
    },
  ],
});


test('matches URL alternatives as OR and body arrays as AND', () => {
  const current = milestone('view-alert');
  const [signature] = getMilestoneSignatures(current);
  assert.ok(signature);
  assert.equal(
    matchesSignature(event, signature, workflow([current]).variables),
    true,
  );

  const wrongBody = {
    ...signature,
    request_body_contains: ['getAlert', 'missing'],
  };
  assert.equal(matchesSignature(event, wrongBody, workflow([current]).variables), false);
});

test('supports any_of_body without changing URL array semantics', () => {
  const current = milestone('view-alert');
  current.match_mode = 'any_of_body';
  const [signature] = getMilestoneSignatures(current);
  assert.ok(signature);
  signature.request_body_contains = ['missing', '{{attacker_ip}}'];
  signature.response_body_contains = ['missing', '{{victim_ip}}'];

  assert.equal(
    matchesSignature(
      event,
      signature,
      workflow([current]).variables,
      current.match_mode,
    ),
    true,
  );
});

test('lets one event complete later milestones after their dependencies', () => {
  const first = milestone('first');
  const second = milestone('second', ['first']);

  assert.deepEqual(checkMilestones(workflow([first, second]), event, []), [
    'first',
    'second',
  ]);
});

test('does not complete a milestone before its dependency', () => {
  const current = milestone('second', ['first']);
  assert.deepEqual(checkMilestones(workflow([current]), event, []), []);
});

test('matches any complete alternative without mixing their fields', () => {
  const current = milestone('authenticated');
  delete current.network_signature;
  current.network_signatures = [
    {
      method: 'POST',
      url_contains: '/login',
      host_contains: '{{thehive_host}}',
      response_status: [200],
    },
    {
      method: 'GET',
      url_contains: '/current-user',
      host_contains: '{{thehive_host}}',
      response_status: [200],
      response_body_contains: 'analyst',
    },
    {
      method: 'POST',
      url_contains: '/api/v1/query',
      host_contains: '{{thehive_host}}',
      response_status: [200],
      request_body_contains: ['getAlert', '{{attacker_ip}}'],
    },
  ];

  assert.equal(matchesMilestoneSignature(event, current, workflow([current]).variables), true);

  const loginEvent = {
    ...event,
    url: 'https://thehive.test/login',
    requestBody: null,
  };
  assert.equal(
    matchesMilestoneSignature(loginEvent, current, workflow([current]).variables),
    true,
  );

  const restoredSessionEvent = {
    ...event,
    method: 'GET',
    url: 'https://thehive.test/current-user',
    requestBody: null,
    responseBody: '{"name":"analyst"}',
  };
  assert.equal(
    matchesMilestoneSignature(restoredSessionEvent, current, workflow([current]).variables),
    true,
  );

  const mixedEvent = { ...event, method: 'GET', url: 'https://thehive.test/login' };
  assert.equal(
    matchesMilestoneSignature(mixedEvent, current, workflow([current]).variables),
    false,
  );
});
