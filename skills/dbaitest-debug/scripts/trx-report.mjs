// Pure rules that turn a VSTest result file (TRX) into the report the agent reads: which test
// failed, in which engine class, with which message, and what the container logged while it ran.
// diagnose.mjs runs the tests and feeds the file through these; they never touch the file system,
// so each rule is unit-tested on its own.
//
// The TRX shape is the one VSTest writes: <Results> holds one <UnitTestResult> per test,
// <TestDefinitions> maps the test to its class, and <ResultSummary> holds the counters.

const ENTITIES = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

/** The XML entities a TRX uses, decoded. */
export function decodeXml(text) {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&(lt|gt|amp|quot|apos);/g, (_, name) => ENTITIES[name]);
}

const attribute = (tag, name) => new RegExp(`${name}="([^"]*)"`).exec(tag)?.[1] ?? null;

/** The counters of the run: how many tests ran, passed, failed. */
export function countersOf(xml) {
  const counters = /<Counters\b[^>]*\/>/.exec(xml)?.[0] ?? '';
  const number = (name) => Number(attribute(counters, name) ?? 0);
  const total = number('total');
  const failed = number('failed') + number('error') + number('timeout') + number('aborted');
  return {
    total,
    executed: number('executed'),
    passed: number('passed'),
    failed,
    error: number('error'),
    timeout: number('timeout'),
    aborted: number('aborted'),
    // Everything that neither passed nor failed: not run, inconclusive, not runnable.
    skipped: Math.max(0, total - number('passed') - failed),
  };
}

/** The class of every test, by test id: the engine class a failure belongs to. */
export function classesOf(xml) {
  const classes = new Map();
  // Both forms again: a definition without a method would otherwise swallow the next one.
  for (const match of xml.matchAll(/<UnitTest\b([^>]*?)(?:\/>|>([\s\S]*?)<\/UnitTest>)/g)) {
    const className = /<TestMethod\b[^>]*className="([^"]+)"/.exec(match[2] ?? '')?.[1] ?? null;
    const id = attribute(match[1], 'id');
    if (className && id) {
      classes.set(id, className);
    }
  }
  return classes;
}

/** One test result: what it was, how it ended, and what it said. */
export function resultsOf(xml) {
  const classes = classesOf(xml);
  const results = [];
  // A result without output is written as a self-closing element; a result with output has
  // children. Both forms have to match, or a passing test swallows the next one's message.
  for (const match of xml.matchAll(/<UnitTestResult\b([^>]*?)(?:\/>|>([\s\S]*?)<\/UnitTestResult>)/g)) {
    const tag = match[1];
    const body = match[2] ?? '';
    const message = /<Message>([\s\S]*?)<\/Message>/.exec(body)?.[1] ?? null;
    const stackTrace = /<StackTrace>([\s\S]*?)<\/StackTrace>/.exec(body)?.[1] ?? null;
    const output = /<StdOut>([\s\S]*?)<\/StdOut>/.exec(body)?.[1] ?? null;
    const testId = attribute(tag, 'testId');
    results.push({
      test: decodeXml(attribute(tag, 'testName') ?? ''),
      class: classes.get(testId) ?? null,
      outcome: attribute(tag, 'outcome'),
      duration: attribute(tag, 'duration'),
      message: message === null ? null : decodeXml(message).trim(),
      stackTrace: stackTrace === null ? null : decodeXml(stackTrace).trim(),
      output: output === null ? null : decodeXml(output).trim(),
    });
  }
  return results;
}

/**
 * The report of a run: the totals, the failures, and the first failure — the one that usually
 * explains the others.
 */
export function parseTrx(xml) {
  const results = resultsOf(xml);
  const failures = results.filter((r) => r.outcome !== 'Passed' && r.outcome !== 'NotExecuted');
  const totals = countersOf(xml);
  return {
    outcome: /<ResultSummary\b[^>]*outcome="([^"]+)"/.exec(xml)?.[1] ?? null,
    totals,
    failures,
    firstFailure: failures[0] ?? null,
    // The counter is authoritative: a result file may hold fewer elements than the run had
    // tests, and the report must not claim fewer tests ran.
    tests: totals.total || results.length,
  };
}
