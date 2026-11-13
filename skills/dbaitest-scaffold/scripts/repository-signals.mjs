// Pure rules that turn file contents into evidence about a repository's database: which engine
// the application talks to, and which SQL dialect a script folder is written in. discover.mjs
// walks the repository and feeds files through these; they never touch the file system, so each
// rule is unit-tested on its own.

/** NuGet packages that pin an application to one engine. */
const PACKAGE_RULES = [
  [/^(Microsoft\.Data\.SqlClient|System\.Data\.SqlClient|Microsoft\.EntityFrameworkCore\.SqlServer|Microsoft\.SqlServer\.DacFx|DbAiTest\.MsSql(\..+)?)$/i, 'mssql'],
  [/^(Npgsql(\..+)?|DbAiTest\.PostgreSql)$/i, 'postgres'],
  [/^(MySqlConnector|MySql\.Data|MySql\.EntityFrameworkCore|Pomelo\.EntityFrameworkCore\.MySql|DbAiTest\.MySql)$/i, 'mysql'],
];

/** Connection-string and container-image fragments that only one engine uses. */
const TEXT_RULES = [
  [/\b(Data Source|Initial Catalog|Integrated Security|Trusted_Connection|TrustServerCertificate|MultipleActiveResultSets)\s*=|\(localdb\)|Server\s*=\s*tcp:|mcr\.microsoft\.com\/(mssql|azure-sql-edge)|\bsqlserver:\/\//i, 'mssql'],
  [/\bpostgres(ql)?:\/\/|\bHost\s*=[^;"']+;[^"']*\b(Database|Username)\s*=|image:\s*["']?(docker\.io\/)?(library\/)?postgres\b|\bPort\s*=\s*5432\b/i, 'postgres'],
  [/\bmysql:\/\/|image:\s*["']?(docker\.io\/)?(library\/)?(mysql|mariadb)\b|\bPort\s*=\s*3306\b|\bSslMode\s*=\s*(None|Preferred|Required)\b[^"']*\bUid\s*=/i, 'mysql'],
];

/** The engines a project file's package references point to, with the package that said so. */
export function enginesFromProjectFile(text) {
  const found = [];
  for (const [, id] of text.matchAll(/<PackageReference\b[^>]*\bInclude\s*=\s*"([^"]+)"/gi)) {
    const rule = PACKAGE_RULES.find(([pattern]) => pattern.test(id));
    if (rule) {
      found.push({ engine: rule[1], signal: `package ${id}` });
    }
  }
  return found;
}

/** The engines a configuration file (appsettings, .config, .env, compose file) points to. */
export function enginesFromConfigText(text) {
  return TEXT_RULES.filter(([pattern]) => pattern.test(text)).map(([pattern, engine]) => ({
    engine,
    signal: `config "${pattern.exec(text)[0].trim().slice(0, 60)}"`,
  }));
}

/** True when a project file is a test project (its folder holds tests, not application code). */
export function isTestProject(text) {
  return /<IsTestProject>\s*true\s*</i.test(text)
    || /<PackageReference\b[^>]*\bInclude\s*=\s*"(Microsoft\.NET\.Test\.Sdk|MSTest(\.\w+)*|xunit(\.\w+)*|NUnit)"/i.test(text);
}

/** Markers that only one dialect uses. Each match adds one point. */
const DIALECT_MARKERS = {
  mssql: [/^\s*GO\s*(\d+\s*)?$/gim, /\bIDENTITY\s*\(\s*\d+\s*,\s*\d+\s*\)/gi, /\bN?VARCHAR\s*\(\s*MAX\s*\)/gi, /\bNVARCHAR\b/gi, /\bdbo\.\w/gi, /\[\w+\]\.\[\w+\]/g, /\bSYSUTCDATETIME\s*\(/gi],
  postgres: [/\$\$/g, /\bBIG?SERIAL\b/gi, /\bplpgsql\b/gi, /\bGENERATED\s+(ALWAYS|BY\s+DEFAULT)\s+AS\s+IDENTITY\b/gi, /\bTIMESTAMPTZ\b|\bJSONB\b/gi, /\bRETURNS\s+(TABLE|SETOF|TRIGGER)\b/gi, /::\s*(int|text|numeric|uuid)\b/gi],
  mysql: [/^\s*DELIMITER\b/gim, /\bAUTO_INCREMENT\b/gi, /\bENGINE\s*=\s*\w+/gi, /`\w+`/g, /\bUNSIGNED\b/gi, /\bDEFAULT\s+CHARSET\b/gi],
};

/** Points per dialect for a piece of SQL. */
export function dialectScores(sql) {
  return Object.fromEntries(Object.entries(DIALECT_MARKERS).map(([dialect, markers]) => [
    dialect,
    markers.reduce((sum, marker) => sum + (sql.match(marker)?.length ?? 0), 0),
  ]));
}

/**
 * The dialect a body of SQL is written in, or null when there is no marker at all or the top two
 * are too close to call (less than twice apart).
 */
export function dialectOf(scores) {
  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const [[first, top], [, second]] = ranked;
  return top > 0 && top >= 2 * second ? first : null;
}

/** Subfolders of a script folder that usually hold data or one-off scripts rather than schema. */
export const NON_SCHEMA_FOLDER = /^(seeds?|data|test-?data|sample-?data|fixtures?|maintenance|ad-?hoc|one-?off|rollbacks?|backups?|examples?|samples?|reports?|deploy(ment)?-?scripts?|post-?deploy(ment)?|pre-?deploy(ment)?)$/i;

/** A folder name that marks the root of a schema folder (db/, database/, Shop.Database/, sql/ …). */
export const SCHEMA_ROOT_FOLDER = /^(db|dbs|database|databases|sql|schema|schemas|ddl|db-?scripts|database-?scripts|[\w.-]+\.(database|db))$/i;
