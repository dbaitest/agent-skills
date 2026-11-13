// Pure rules that turn file contents into evidence about a repository's database: which engine
// the application talks to, and which SQL dialect a script folder is written in. discover.mjs
// walks the repository and feeds files through these; they never touch the file system, so each
// rule is unit-tested on its own.
//
// Evidence names the rule that matched, never the matched text: configuration files hold
// passwords, and the agent shows the evidence to the user.

/** Engines DbAiTest supports, and engines it does not (reported so the agent can say so). */
export const SUPPORTED_ENGINES = ['mssql', 'postgres', 'mysql'];

/** NuGet packages that pin an application to one engine. */
const PACKAGE_RULES = [
  [/^(Microsoft\.Data\.SqlClient|System\.Data\.SqlClient|Microsoft\.EntityFrameworkCore\.SqlServer(\..+)?|Microsoft\.SqlServer\.DacFx|Aspire\.Hosting\.SqlServer|Aspire\.Microsoft\.(Data\.SqlClient|EntityFrameworkCore\.SqlServer)|Testcontainers\.MsSql|dbup-sqlserver|FluentMigrator\.Runner\.SqlServer(\d+)?|DbAiTest\.MsSql(\..+)?)$/i, 'mssql'],
  [/^(Npgsql(\..+)?|Aspire\.Hosting\.PostgreSQL|Aspire\.Npgsql(\..+)?|Testcontainers\.PostgreSql|dbup-postgresql|FluentMigrator\.Runner\.Postgres|DbAiTest\.PostgreSql)$/i, 'postgres'],
  [/^(MySqlConnector|MySql\.Data|MySql\.EntityFrameworkCore|Pomelo\.EntityFrameworkCore\.MySql|Aspire\.Hosting\.MySql|Aspire\.MySqlConnector|Aspire\.Pomelo\.EntityFrameworkCore\.MySql|Testcontainers\.(MySql|MariaDb)|dbup-mysql|FluentMigrator\.Runner\.MySql|DbAiTest\.MySql)$/i, 'mysql'],
  [/^(Microsoft\.Data\.Sqlite(\..+)?|Microsoft\.EntityFrameworkCore\.Sqlite(\..+)?|System\.Data\.SQLite(\..+)?|sqlite-net-pcl)$/i, 'sqlite'],
  [/^(Oracle\.ManagedDataAccess(\.Core)?|Oracle\.EntityFrameworkCore)$/i, 'oracle'],
];

/**
 * Connection-string keys and container images only one engine uses, each with the name reported
 * as evidence. Keys several drivers share (Data Source, Server, User Id, TrustServerCertificate)
 * are deliberately absent.
 */
const TEXT_RULES = [
  ['mssql', 'Initial Catalog= in a connection string', /\bInitial Catalog\s*=/i],
  ['mssql', 'Integrated Security= / Trusted_Connection= in a connection string', /\b(Integrated Security|Trusted_Connection)\s*=/i],
  ['mssql', 'MultipleActiveResultSets= in a connection string', /\bMultipleActiveResultSets\s*=/i],
  ['mssql', '(localdb) or tcp: server in a connection string', /\(localdb\)|Server\s*=\s*tcp:/i],
  ['mssql', 'SQL Server container image', /mcr\.microsoft\.com\/(mssql|azure-sql-edge)/i],
  ['postgres', 'postgres:// URL', /\bpostgres(ql)?:\/\//i],
  ['postgres', 'Host=…;Database= connection string', /\bHost\s*=\s*[^;"'\s]+;[^"'\n]*?\b(Database|Username)\s*=/i],
  ['postgres', 'PostgreSQL container image', /image:\s*["']?(docker\.io\/)?((library|bitnami)\/)?(postgres(ql)?|postgis\/postgis|pgvector\/pgvector|timescale\/timescaledb)\b/i],
  ['postgres', 'Port=5432 in a connection string', /\bPort\s*=\s*5432\b/i],
  ['mysql', 'mysql:// URL', /\bmysql:\/\//i],
  ['mysql', 'MySQL/MariaDB container image', /image:\s*["']?(docker\.io\/)?((library|bitnami)\/)?(mysql|mariadb)\b/i],
  ['mysql', 'Port=3306 in a connection string', /\bPort\s*=\s*3306\b/i],
  ['sqlite', 'SQLite file in a connection string', /\bData Source\s*=\s*[^;"']*\.(db|sqlite3?)\b/i],
];

/** The engines a project file's package references point to, with the package that said so. */
export function enginesFromProjectFile(text) {
  const found = [];
  for (const [, id] of text.matchAll(/<PackageReference\b[^>]*\bInclude\s*=\s*"([^"]+)"/gi)) {
    const rule = PACKAGE_RULES.find(([pattern]) => pattern.test(id));
    if (rule) {
      found.push({ engine: rule[1], signal: `package ${id}`, strength: 'strong' });
    }
  }
  return found;
}

/** The engines a configuration file (appsettings, .config, .env, compose file) points to. */
export function enginesFromConfigText(text) {
  return TEXT_RULES.filter(([, , pattern]) => pattern.test(text))
    .map(([engine, name]) => ({ engine, signal: name, strength: 'weak' }));
}

/** True when a project file is a test project (its folder holds tests, not application code). */
export function isTestProject(text) {
  return /<IsTestProject>\s*true\s*</i.test(text)
    || /<Project\b[^>]*\bSdk\s*=\s*"(MSTest\.Sdk|TUnit\.Sdk)\b/i.test(text)
    || /<PackageReference\b[^>]*\bInclude\s*=\s*"(Microsoft\.NET\.Test\.Sdk|MSTest(\.\w+)*|xunit(\.v3)?(\.\w+)*|NUnit|TUnit(\.\w+)*)"/i.test(text);
}

/** Markers that only one dialect uses. Each match adds one point. */
const DIALECT_MARKERS = {
  mssql: [/^\s*GO\s*(\d+\s*)?$/gim, /\bIDENTITY\s*\(\s*\d+\s*,\s*\d+\s*\)/gi, /\bN?VARCHAR\s*\(\s*MAX\s*\)/gi, /\bNVARCHAR\b/gi, /\bdbo\.\w/gi, /\[\w+\]\.\[\w+\]/g, /\bSYSUTCDATETIME\s*\(/gi],
  postgres: [/\$\$/g, /\b(BIG|SMALL)?SERIAL\b/gi, /\bplpgsql\b/gi, /\bGENERATED\s+(ALWAYS|BY\s+DEFAULT)\s+AS\s+IDENTITY\b/gi, /\bTIMESTAMPTZ\b|\bJSONB\b/gi, /\bRETURNS\s+(TABLE|SETOF|TRIGGER)\b/gi, /::\s*(int|text|numeric|uuid)\b/gi],
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
export const NON_SCHEMA_FOLDER = /^(seeds?|seed-?data|data|test-?data|sample-?data|fixtures?|maintenance|ad-?hoc|one-?off|rollbacks?|backups?|examples?|samples?|reports?|deploy(ment)?-?scripts?|post-?deploy(ment)?|pre-?deploy(ment)?)$/i;

/** Subfolders that hold migrations: schema history, not schema, when a schema folder sits beside them. */
export const MIGRATIONS_FOLDER = /^(migrations?|changes?|changelog|upgrades?|patches)$/i;

/** Subfolders named after an engine: one database per engine, never one group. */
export const ENGINE_FOLDER = { mssql: /^(mssql|sqlserver|sql-?server|tsql)$/i, postgres: /^(postgres(ql)?|pg|pgsql)$/i, mysql: /^(mysql|mariadb)$/i };

/** Subfolders that hold one kind of object; several of them make up one database. */
export const OBJECT_TYPE_FOLDER = /^(tables?|views?|procedures?|stored-?procedures?|procs?|functions?|triggers?|types?|indexes|sequences?|schemas?|security|synonyms?|constraints?|keys?|dbo|public|routines?|packages?|ddl|scripts?|\d+[\w.-]*)$/i;

/** A folder name that marks the root of a schema folder (db/, database/, Shop.Database/, sql/ …). */
export const SCHEMA_ROOT_FOLDER = /^(db|dbs|database|databases|sql|schema|schemas|ddl|db-?scripts|database-?scripts|[\w.-]+\.(database|db))$/i;

/** Migration tools that order files by a version number (V10 after V9), which DbAiTest does not. */
export const VERSIONED_MIGRATION_FILE = /^(V\d+(_\d+)*__|R__|U\d+__|\d{8,14}_)/;
