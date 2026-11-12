// Tests for what the scaffolder reads from the repository it writes into: the SDK's framework,
// central package management, the kind of database project, and .csproj-safe paths.

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import {
  csprojPath,
  detectFramework,
  isSdkStyleSqlproj,
  usesCentralPackages,
} from '../skills/dbaitest-scaffold/scripts/project-environment.mjs';

const root = mkdtempSync(path.join(os.tmpdir(), 'dbaitest-env-'));
after(() => rmSync(root, { recursive: true, force: true }));

function tree(name, files) {
  const dir = path.join(root, name);
  for (const [relative, content] of Object.entries(files)) {
    const file = path.join(dir, relative);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, content);
  }
  return dir;
}

const CPM_TRUE = '<Project><PropertyGroup><ManagePackageVersionsCentrally>true</ManagePackageVersionsCentrally></PropertyGroup></Project>';

describe('detectFramework', () => {
  const tfms = ['net8.0', 'net10.0'];

  it('picks the newest framework the SDK in effect can build', () => {
    assert.equal(detectFramework(root, tfms, () => '10.0.100\n'), 'net10.0');
    assert.equal(detectFramework(root, tfms, () => '9.0.300\n'), 'net8.0');
  });

  it('runs dotnet where global.json applies: the nearest existing directory', () => {
    let cwd;
    detectFramework(path.join(root, 'not', 'yet', 'created'), tfms, (_cmd, _args, opts) => {
      cwd = opts.cwd;
      return '8.0.400';
    });
    assert.equal(cwd, root);
  });

  it('falls back to the oldest framework when dotnet cannot run', () => {
    assert.equal(detectFramework(root, tfms, () => { throw new Error('ENOENT'); }), 'net8.0');
  });
});

describe('usesCentralPackages', () => {
  it('is on when a parent Directory.Packages.props turns it on', () => {
    const dir = tree('cpm-parent', { 'Directory.Packages.props': CPM_TRUE });
    assert.equal(usesCentralPackages(path.join(dir, 'tests', 'X')), true);
  });

  it('ignores a commented-out element', () => {
    const dir = tree('cpm-comment', {
      'Directory.Packages.props': '<Project><!-- <ManagePackageVersionsCentrally>true</ManagePackageVersionsCentrally> --></Project>',
    });
    assert.equal(usesCentralPackages(dir), false);
  });

  it('accepts attributes on the element', () => {
    const dir = tree('cpm-condition', {
      'Directory.Packages.props': '<Project><PropertyGroup><ManagePackageVersionsCentrally Condition="\'$(X)\' == \'\'">true</ManagePackageVersionsCentrally></PropertyGroup></Project>',
    });
    assert.equal(usesCentralPackages(dir), true);
  });

  it('reads only the nearest Directory.Packages.props, as MSBuild does', () => {
    const dir = tree('cpm-nearest', {
      'Directory.Packages.props': CPM_TRUE,
      'inner/Directory.Packages.props': '<Project></Project>',
    });
    assert.equal(usesCentralPackages(path.join(dir, 'inner', 'X')), false);
  });

  it('is on when Directory.Build.props turns it on', () => {
    const dir = tree('cpm-build-props', { 'Directory.Build.props': CPM_TRUE });
    assert.equal(usesCentralPackages(dir), true);
  });
});

describe('isSdkStyleSqlproj', () => {
  it('accepts Microsoft.Build.Sql and MSBuild.Sdk.SqlProj, with or without a version', () => {
    assert.equal(isSdkStyleSqlproj('<Project Sdk="Microsoft.Build.Sql">'), true);
    assert.equal(isSdkStyleSqlproj('<Project Sdk="Microsoft.Build.Sql/2.3.0">'), true);
    assert.equal(isSdkStyleSqlproj('<Project Sdk="MSBuild.Sdk.SqlProj/3.0.0">'), true);
    assert.equal(isSdkStyleSqlproj('<Project><Sdk Name="Microsoft.Build.Sql" Version="2.3.0" />'), true);
  });

  it('refuses a classic SSDT project', () => {
    const classic = `<Project DefaultTargets="Build" ToolsVersion="4.0" xmlns="http://schemas.microsoft.com/developer/msbuild/2003">
  <Import Project="$(SQLDBExtensionsRefPath)\\Microsoft.Data.Tools.Schema.SqlTasks.targets" /></Project>`;
    assert.equal(isSdkStyleSqlproj(classic), false);
  });
});

describe('csprojPath', () => {
  it('is relative with backslashes', () => {
    const from = path.join(root, 'tests', 'X');
    assert.equal(csprojPath(from, path.join(root, 'db', 'Shop.sqlproj')), '..\\..\\db\\Shop.sqlproj');
    assert.equal(csprojPath(from, from), '.');
  });

  it('escapes MSBuild and XML special characters', () => {
    const from = path.join(root, 'tests');
    assert.equal(csprojPath(from, path.join(root, 'R&D;$(x)@%', 'a')), '..\\R&amp;D%3B%24(x)%40%25\\a');
  });
});
