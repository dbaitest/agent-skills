// Pure rules that read a DbAiTest test project and say what is inside it: the abstract test
// class the tests belong in, the class per engine that runs them, where the schema comes from
// and which tests are already there. locate-tests.mjs walks the repository and feeds files
// through these; they never touch the file system, so each rule is unit-tested on its own.
//
// The shapes come from the scaffolder (skills/dbaitest-scaffold) and from a project a user
// wrote by hand: a class deriving from DbAiTestBase, and one class per engine deriving from it.

/** The package that marks a project as a DbAiTest *test* project. */
export const TEST_PACKAGE = 'DbAiTest.MSTest';

/** Every DbAiTest package; the ones but the test package are libraries a project may use. */
export const DBAITEST_PACKAGES = [
  TEST_PACKAGE,
  'DbAiTest.Core',
  'DbAiTest.MsSql',
  'DbAiTest.MsSql.Dacpac',
  'DbAiTest.PostgreSql',
  'DbAiTest.MySql',
];

/** The engine classes DbAiTest ships, and the engine each one is. */
export const ENGINE_CLASSES = {
  MsSqlEngine: 'mssql',
  PostgreSqlEngine: 'postgres',
  MySqlEngine: 'mysql',
};

/** The base class every DbAiTest test class derives from. */
const BASE_CLASS = 'DbAiTestBase';

const packageReference = /<PackageReference\s+[^>]*Include="([^"]+)"[^>]*>/gi;
const projectReference = /<ProjectReference\s+[^>]*Include="([^"]+)"[^>]*>/gi;
const noneItem = /<None\s+[^>]*Include="([^"]+)"[^>]*>/gi;
const linkBase = /LinkBase="([^"]+)"/i;

/** The DbAiTest packages the project references. */
export function dbaitestPackages(text) {
  const found = [];
  for (const match of text.matchAll(packageReference)) {
    const name = match[1].trim();
    if (DBAITEST_PACKAGES.includes(name)) {
      found.push(name);
    }
  }
  return [...new Set(found)];
}

/**
 * True when the project references the DbAiTest test package: it is a DbAiTest test project.
 * A project that only references the DbAiTest libraries is not one.
 */
export function isDbAiTestProject(text) {
  return dbaitestPackages(text).includes(TEST_PACKAGE);
}

/**
 * What the project file says about the project itself.
 * @param {string} text the .csproj
 * @param {string} fileName the file name, used when the project names nothing
 */
export function projectInfo(text, fileName) {
  const name = /<Name>([^<]+)<\/Name>/.exec(text)?.[1]?.trim() ?? fileName.replace(/\.[^.]+$/, '');
  const rootNamespace = /<RootNamespace>([^<]+)<\/RootNamespace>/.exec(text)?.[1]?.trim() ?? name;
  const single = /<TargetFramework[^>]*>([^<]+)<\/TargetFramework>/.exec(text)?.[1]?.trim();
  const many = /<TargetFrameworks[^>]*>([^<]+)<\/TargetFrameworks>/.exec(text)?.[1] ?? '';
  const frameworks = [...new Set([single, ...many.split(';')].filter((f) => f && f.trim()).map((f) => f.trim()))];
  return { name, rootNamespace, frameworks, packages: dbaitestPackages(text) };
}

/** The patterns of one include: MSBuild separates them with a semicolon. */
const patternsOf = (include) => include.split(';').map((p) => p.trim()).filter(Boolean);

/** A pattern that points at SQL scripts, or at a folder that holds them (`Schema\**\*`). */
const isSchemaPattern = (pattern) => /\.sql$/i.test(pattern) || /\.psql$/i.test(pattern)
  || (/\*\*[\\/]\*$/.test(pattern) && pattern.split(/[\\/]/).some((part) => /^schema$/i.test(part)));

/**
 * Where the schema of the test project comes from: a database project (a .dacpac), a folder of
 * scripts linked into the project, or nothing yet.
 */
export function schemaSourceOf(text) {
  const dacpacs = [];
  for (const match of text.matchAll(projectReference)) {
    const include = match[1].trim();
    if (/\.(sqlproj|dacpac)$/i.test(include)) {
      dacpacs.push(include.split(/[\\/]/).pop());
    }
  }
  for (const match of text.matchAll(noneItem)) {
    const include = match[1].trim();
    if (/\.dacpac$/i.test(include)) {
      dacpacs.push(include.split(/[\\/]/).pop());
    }
  }

  // A linked script folder keeps its layout under the link base: Schema/postgres holds the
  // postgres scripts the harness applies. A project that links scripts without a link base
  // still has a schema; the roots stay empty and the includes say where they come from.
  const roots = [];
  const includes = [];
  for (const item of text.matchAll(noneItem)) {
    const patterns = patternsOf(item[1]);
    const schemas = patterns.filter(isSchemaPattern);
    if (schemas.length === 0) {
      continue;
    }
    includes.push(...schemas);
    const base = linkBase.exec(item[0])?.[1];
    // The link base is a Windows path in the project file; the harness reads it as a path.
    const normalized = base ? base.split(/[\\/]/).join('/') : null;
    if (normalized && !roots.includes(normalized)) {
      roots.push(normalized);
    }
  }

  const kind = dacpacs.length > 0 ? 'dacpac' : includes.length > 0 ? 'scripts' : 'none';
  return { kind, roots, dacpacs, includes };
}

const classDeclaration = /(^|\n)\s*(?:\[[^\]]*\]\s*)*(?:public|internal|private|protected)?\s*(?:(?:abstract|sealed|static|partial|unsafe)\s+)*class\s+(\w+)\s*(?:<[^>{]*>)?\s*(?::\s*([^{]+?))?\s*(?:where[^{]*)?\{/g;
// The window between the attribute and the signature holds comments and other attributes; it
// can be long, so it is generous rather than exact.
const testMethod = /\[TestMethod\][\s\S]{0,2000}?public\s+(?:async\s+)?(?:Task(?:<[^>]*>)?|void)\s+(\w+)\s*\(/g;
const initializeMethod = /\[TestInitialize\][\s\S]{0,2000}?public\s+(?:async\s+)?(?:Task(?:<[^>]*>)?|void)\s+(\w+)\s*\(/g;
const cleanupMethod = /\[TestCleanup\][\s\S]{0,2000}?public\s+(?:async\s+)?(?:Task(?:<[^>]*>)?|void)\s+(\w+)\s*\(/g;

/**
 * The classes of one C# file: the abstract test class, the class per engine that runs it, and
 * the test methods that are already there.
 */
export function parseTestClasses(text) {
  const classes = [];
  const matches = [...text.matchAll(classDeclaration)];
  for (const [index, match] of matches.entries()) {
    const body = text.slice(match.index + match[0].length, matches[index + 1]?.index ?? text.length);
    const bases = (match[3] ?? '').split(',').map((b) => b.trim().split(/\s+/)[0]).filter(Boolean);
    const engine = /CreateEngine\s*\(\s*\)\s*=>\s*new\s+(\w+)\s*\(/.exec(body)?.[1];
    classes.push({
      name: match[2],
      isAbstract: /abstract/.test(match[0]),
      baseClass: bases[0] ?? null,
      bases,
      engine: engine && ENGINE_CLASSES[engine] ? ENGINE_CLASSES[engine] : null,
      schemaRoot: /SchemaRoot\s*=>\s*"([^"]*)"/.exec(body)?.[1] ?? null,
      schemaSource: /SchemaSource\s*=>\s*new\s+(\w+)/.exec(body)?.[1] ?? null,
      excludedDirectories: stringList(body, 'ExcludedDirectories'),
      excludedFileNamePatterns: stringList(body, 'ExcludedFileNamePatterns'),
      orderedDirectories: stringList(body, 'OrderedDirectories'),
      testMethods: [...body.matchAll(testMethod)].map((m) => m[1]),
      initializeMethods: [...body.matchAll(initializeMethod)].map((m) => m[1]),
      cleanupMethods: [...body.matchAll(cleanupMethod)].map((m) => m[1]),
    });
  }
  return classes;
}

/** The strings of a list-valued property, e.g. `ExcludedDirectories = ["seed", "maintenance"]`. */
function stringList(body, property) {
  const match = new RegExp(`${property}\\s*=\\s*\\[([^\\]]*)\\]`).exec(body);
  return match ? [...match[1].matchAll(/"([^"]*)"/g)].map((m) => m[1]) : [];
}

/**
 * The DbAiTest layout of one project: the abstract test class, the engine classes that run it,
 * and the tests already there.
 */
export function testLayout(classes) {
  // A project has one abstract test class and a class per engine, or one concrete class that
  // creates the engine itself (a dacpac project). Both derive from DbAiTestBase. A project may
  // hold more than one such suite; every one of them is reported.
  const suites = classes.filter((c) => c.bases.includes(BASE_CLASS));
  const base = suites.find((c) => c.isAbstract) ?? suites[0] ?? null;
  const suiteNames = new Set(suites.map((c) => c.name));
  const engineClasses = classes.filter((c) => !suiteNames.has(c.name) && c.bases.some((b) => suiteNames.has(b)));
  const loadOptions = (c) => ({
    excludedDirectories: c.excludedDirectories,
    excludedFileNamePatterns: c.excludedFileNamePatterns,
    orderedDirectories: c.orderedDirectories,
  });
  return {
    baseTestClass: base
      ? {
        name: base.name,
        isAbstract: base.isAbstract,
        engine: base.engine,
        schemaSource: base.schemaSource,
        initializeMethods: base.initializeMethods,
        cleanupMethods: base.cleanupMethods,
        ...loadOptions(base),
      }
      : null,
    engineClasses: engineClasses.map((c) => ({
      name: c.name,
      engine: c.engine,
      schemaRoot: c.schemaRoot,
      suite: c.bases.find((b) => suiteNames.has(b)) ?? null,
      ...loadOptions(c),
    })),
    // Every class that derives from DbAiTestBase, so a project with two suites is reported whole.
    testClasses: suites.map((c) => ({ name: c.name, isAbstract: c.isAbstract, engine: c.engine })),
    // The tests of the DbAiTest suites; a plain unit-test class in the same project is not one.
    testMethods: suites.flatMap((c) => c.testMethods.map((name) => ({ name, class: c.name }))),
  };
}
