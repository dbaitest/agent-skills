// The diagnose script: the TRX rules on their own, then the script over a temporary project.
// Running the tests needs the .NET SDK and Docker; the rules below do not.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { classesOf, countersOf, decodeXml, parseTrx, resultsOf } from '../skills/dbaitest-debug/scripts/trx-report.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.join(here, '..', 'skills', 'dbaitest-debug', 'scripts', 'diagnose.mjs');
const root = mkdtempSync(path.join(os.tmpdir(), 'dbaitest-diagnose-'));
after(() => rmSync(root, { recursive: true, force: true }));

// A result file as VSTest writes it: one result per test, the class behind the test id, and
// the counters of the run.
const TRX = `<?xml version="1.0" encoding="utf-8"?>
<TestRun id="run" xmlns="http://microsoft.com/schemas/VisualStudio/TeamTest/2010">
  <Results>
    <UnitTestResult executionId="e1" testId="t1" testName="Schema_Applies" duration="00:00:05.3803344" outcome="Passed">
      <Output>
        <StdOut>[testcontainers.org 00:00:00.20] Connected to Docker</StdOut>
      </Output>
    </UnitTestResult>
    <UnitTestResult executionId="e2" testId="t2" testName="PlaceOrder_Creates_The_Order" duration="00:00:00.0829525" outcome="Failed">
      <Output>
        <StdOut>[testcontainers.org 00:00:05.28] Delete Docker container 04cb</StdOut>
        <ErrorInfo>
          <Message>Assertion failed. Expected values to be equal.&#xD;
expected: 1&#xD;
actual:   0</Message>
          <StackTrace>   at Shop.Database.Tests.DatabaseTests.PlaceOrder_Creates_The_Order() in D:\\shop\\DatabaseTests.cs:line 36</StackTrace>
        </ErrorInfo>
      </Output>
    </UnitTestResult>
  </Results>
  <TestDefinitions>
    <UnitTest name="Schema_Applies" id="t1">
      <Execution id="e1" />
      <TestMethod className="Shop.Database.Tests.PostgreSqlDatabaseTests" name="Schema_Applies" />
    </UnitTest>
    <UnitTest name="PlaceOrder_Creates_The_Order" id="t2">
      <Execution id="e2" />
      <TestMethod className="Shop.Database.Tests.PostgreSqlDatabaseTests" name="PlaceOrder_Creates_The_Order" />
    </UnitTest>
  </TestDefinitions>
  <ResultSummary outcome="Failed">
    <Counters total="2" executed="2" passed="1" failed="1" error="0" timeout="0" aborted="0" inconclusive="0" notRunnable="0" notExecuted="0" />
  </ResultSummary>
</TestRun>`;

describe('trx report', () => {
  it('decodes the entities a result file uses', () => {
    assert.equal(decodeXml('a &#xD;&#xA;b &lt;c&gt; &amp; &quot;d&quot;'), 'a \r\nb <c> & "d"');
  });

  it('reads the counters of the run', () => {
    assert.deepEqual(countersOf(TRX), {
      total: 2,
      executed: 2,
      passed: 1,
      failed: 1,
      error: 0,
      timeout: 0,
      aborted: 0,
      skipped: 0,
    });
  });

  it('reads the class behind every test', () => {
    assert.deepEqual([...classesOf(TRX).values()], [
      'Shop.Database.Tests.PostgreSqlDatabaseTests',
      'Shop.Database.Tests.PostgreSqlDatabaseTests',
    ]);
  });

  it('reads every result with its message and stack', () => {
    const results = resultsOf(TRX);
    assert.equal(results.length, 2);
    assert.equal(results[0].outcome, 'Passed');
    assert.equal(results[0].message, null);
    assert.match(results[1].message, /Assertion failed/);
    assert.match(results[1].stackTrace, /DatabaseTests\.cs:line 36/);
  });

  it('reports the failures and the first one', () => {
    const report = parseTrx(TRX);
    assert.equal(report.outcome, 'Failed');
    assert.equal(report.tests, 2);
    assert.equal(report.failures.length, 1);
    assert.equal(report.firstFailure.test, 'PlaceOrder_Creates_The_Order');
    assert.equal(report.firstFailure.class, 'Shop.Database.Tests.PostgreSqlDatabaseTests');
  });

  it('reports a green run without failures', () => {
    const green = TRX.replace('outcome="Failed"', 'outcome="Passed"').replace('failed="1"', 'failed="0"');
    const report = parseTrx(green);
    assert.deepEqual(report.failures, []);
    assert.equal(report.firstFailure, null);
  });

  it('reads a result without output, which VSTest writes as an empty element', () => {
    // A test that produced no output is written as <UnitTestResult ... />: a parser that only
    // matches the closing tag reads the next result's message as this one's.
    const mixed = `<?xml version="1.0" encoding="utf-8"?>
<TestRun>
  <Results>
    <UnitTestResult executionId="e1" testId="t1" testName="Ok" outcome="Passed" />
    <UnitTestResult executionId="e2" testId="t2" testName="ThrowsNone" outcome="Failed">
      <Output>
        <ErrorInfo>
          <Message>Assertion failed. Expected exception of type InvalidOperationException (or derived) but no exception was thrown.</Message>
        </ErrorInfo>
      </Output>
    </UnitTestResult>
  </Results>
  <TestDefinitions>
    <UnitTest name="Ok" id="t1"><Execution id="e1" /><TestMethod className="Demo.Tests.PostgreSqlTests" name="Ok" /></UnitTest>
    <UnitTest name="ThrowsNone" id="t2"><Execution id="e2" /><TestMethod className="Demo.Tests.PostgreSqlTests" name="ThrowsNone" /></UnitTest>
  </TestDefinitions>
  <ResultSummary outcome="Failed">
    <Counters total="2" executed="2" passed="1" failed="1" error="0" timeout="0" aborted="0" inconclusive="0" notRunnable="0" notExecuted="0" />
  </ResultSummary>
</TestRun>`;
    const report = parseTrx(mixed);
    assert.equal(report.tests, 2);
    assert.equal(report.failures.length, 1);
    assert.equal(report.firstFailure.test, 'ThrowsNone');
    assert.equal(report.firstFailure.class, 'Demo.Tests.PostgreSqlTests');
    assert.match(report.firstFailure.message, /no exception was thrown/);
    // The passing result keeps its own (empty) message.
    assert.equal(report.failures[0].message.includes('Ok'), false);
  });
});

describe('diagnose as a command', () => {
  it('exits 2 without a project', () => {
    const result = spawnSync(process.execPath, [script], { encoding: 'utf8' });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /^error: /);
  });

  it('exits 2 for a folder that holds no project', () => {
    const empty = path.join(root, 'empty');
    mkdirSync(empty, { recursive: true });
    const result = spawnSync(process.execPath, [script, '--project', empty], { encoding: 'utf8' });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /^error: /);
  });

  it('exits 1 and explains when the run produced no result file', () => {
    const broken = path.join(root, 'broken');
    mkdirSync(broken, { recursive: true });
    writeFileSync(path.join(broken, 'Broken.csproj'), '<Project Sdk="Microsoft.NET.Sdk"></Project>', 'utf8');
    const result = spawnSync(process.execPath, [script, '--project', broken], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    const report = JSON.parse(result.stdout);
    assert.equal(report.ran, true);
    assert.equal(report.resultFile, null);
    assert.ok(report.error.length > 0);
  });

  it('says so when the project does not exist', () => {
    const result = spawnSync(process.execPath, [script, '--project', path.join(root, 'missing')], { encoding: 'utf8' });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /does not exist/);
  });
});
