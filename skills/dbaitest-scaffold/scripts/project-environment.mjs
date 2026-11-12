// What the scaffolder needs to know about the repository it writes into: which target framework
// the SDK in effect can build, whether NuGet versions are managed centrally, what kind of
// database project it is given, and how to put a path into a .csproj safely.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

/** Nearest directory that exists, starting at dir and walking up. */
export function nearestExistingDirectory(dir) {
  let current = dir;
  while (!existsSync(current) && path.dirname(current) !== current) {
    current = path.dirname(current);
  }
  return current;
}

/**
 * Newest of the supported target frameworks that the SDK in effect at projectDir can build.
 * `dotnet --version` run there honours global.json; `--list-sdks` would not. Falls back to the
 * oldest supported framework when dotnet cannot be run (the agent's preflight reports that).
 */
export function detectFramework(projectDir, targetFrameworks, run = execFileSync) {
  try {
    const version = run('dotnet', ['--version'], {
      cwd: nearestExistingDirectory(projectDir),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const major = Number.parseInt(version, 10);
    const supported = targetFrameworks.filter((tfm) => Number.parseInt(tfm.slice(3), 10) <= major);
    if (supported.length > 0) {
      return supported.at(-1);
    }
  } catch {
    // dotnet missing or global.json pins an SDK that is not installed: use the floor.
  }
  return targetFrameworks[0];
}

const withoutComments = (xml) => xml.replace(/<!--[\s\S]*?-->/g, '');
const CPM_ON = /<ManagePackageVersionsCentrally(?:\s[^>]*)?>\s*true\s*</i;

/** Nearest file with this name at dir or above, or null. MSBuild imports only the nearest one. */
function nearestFile(dir, fileName) {
  for (let current = dir; ; current = path.dirname(current)) {
    const candidate = path.join(current, fileName);
    if (existsSync(candidate)) {
      return candidate;
    }
    if (path.dirname(current) === current) {
      return null;
    }
  }
}

/**
 * True when central package management is on for a project at projectDir: the nearest
 * Directory.Packages.props or Directory.Build.props sets ManagePackageVersionsCentrally to true.
 */
export function usesCentralPackages(projectDir) {
  return ['Directory.Packages.props', 'Directory.Build.props']
    .map((name) => nearestFile(projectDir, name))
    .some((file) => file !== null && CPM_ON.test(withoutComments(readFileSync(file, 'utf8'))));
}

/**
 * Whether a .sqlproj builds with the dotnet CLI: SDK-style projects (Microsoft.Build.Sql or
 * MSBuild.Sdk.SqlProj) do; a classic Visual Studio SSDT project imports targets that only
 * Visual Studio / full MSBuild has.
 */
export function isSdkStyleSqlproj(text) {
  const xml = withoutComments(text);
  return /<Project\b[^>]*\bSdk\s*=\s*"(?:Microsoft\.Build\.Sql|MSBuild\.Sdk\.SqlProj)\b/i.test(xml)
    || /<Sdk\b[^>]*\bName\s*=\s*"(?:Microsoft\.Build\.Sql|MSBuild\.Sdk\.SqlProj)"/i.test(xml);
}

/**
 * A path written into a .csproj item: relative to the project when possible, backslashes,
 * MSBuild special characters escaped (%XX) and then XML-escaped for an attribute value.
 */
export function csprojPath(fromDir, target) {
  const relative = path.relative(fromDir, target);
  const chosen = path.isAbsolute(relative) ? target : relative || '.';
  const msbuild = chosen
    .split(path.sep).join('\\')
    .replace(/[%;$@']/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`);
  return msbuild
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
