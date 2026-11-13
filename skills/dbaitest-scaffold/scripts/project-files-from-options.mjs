// Pure part of the scaffolder: turns validated options plus the template texts into the list
// of files to write. No file system access here, so the output can be unit-tested and CI can
// compare it with what the skill documents.

/** Engines the skill knows, keyed by the name DbAiTest's EngineRegistry uses. */
export const ENGINES = {
  mssql: { package: 'DbAiTest.MsSql', namespace: 'DbAiTest.MsSql', template: 'engines/mssql.cs.tmpl' },
  postgres: { package: 'DbAiTest.PostgreSql', namespace: 'DbAiTest.PostgreSql', template: 'engines/postgres.cs.tmpl' },
  mysql: { package: 'DbAiTest.MySql', namespace: 'DbAiTest.MySql', template: 'engines/mysql.cs.tmpl' },
};

/** Replaces every {{Key}} with values[Key]; an unknown placeholder is a bug, so it throws. */
export function fill(template, values) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    if (!(key in values)) {
      throw new Error(`Template placeholder {{${key}}} has no value.`);
    }
    return values[key];
  });
}

function packageReference(id, version, centralPackages) {
  return centralPackages
    ? `    <PackageReference Include="${id}" />`
    : `    <PackageReference Include="${id}" Version="${version}" />`;
}

/** The ItemGroups/targets that bring the schema next to the test binaries. */
function projectItems(options) {
  if (options.schema === 'scripts' && options.schemaDirPath) {
    const [engine] = options.engines;
    const dir = options.schemaDirPath;
    return `
  <!--
    The repository's own schema scripts, linked rather than copied so there is one source of
    truth, and copied next to the test binaries under Schema/${engine} (subfolders kept), where
    SchemaRoot finds them.
  -->
  <ItemGroup>
    <None Include="${dir}\\**\\*.sql;${dir}\\**\\*.psql"
          LinkBase="Schema\\${engine}"
          CopyToOutputDirectory="PreserveNewest" />
  </ItemGroup>
`;
  }

  if (options.schema === 'scripts') {
    return `
  <!-- The schema files, copied next to the test binaries so SchemaRoot can be a relative path. -->
  <ItemGroup>
    <None Include="Schema\\**\\*" CopyToOutputDirectory="PreserveNewest" />
  </ItemGroup>
`;
  }

  if (options.dacpacPath) {
    return `
  <!-- The prebuilt .dacpac and every .dacpac beside it (the dacpacs it references, such as
       master.dacpac, are resolved from the folder it is deployed from). -->
  <ItemGroup>
    <None Include="${options.dacpacPath.directory}\\*.dacpac" Link="%(Filename)%(Extension)" CopyToOutputDirectory="PreserveNewest" />
  </ItemGroup>
`;
  }

  return `
  <!--
    The database project. Referencing it makes dotnet build / dotnet test build the .dacpac
    first; it is not an assembly, so nothing is referenced or copied by the reference itself.
  -->
  <ItemGroup>
    <ProjectReference Include="${options.sqlprojPath}"
                      ReferenceOutputAssembly="false"
                      SkipGetTargetFrameworkProperties="true"
                      Private="false" />
  </ItemGroup>

  <!--
    Copy each referenced database project's .dacpac next to the test binaries, together with
    every .dacpac beside it: the dacpacs it references (master.dacpac, another project's) are
    resolved from the folder it is deployed from.
  -->
  <Target Name="CopyDacpacs" AfterTargets="Build">
    <MSBuild Projects="@(ProjectReference)"
             Condition="'%(Extension)' == '.sqlproj'"
             Targets="GetTargetPath"
             BuildInParallel="false">
      <Output TaskParameter="TargetOutputs" ItemName="_DatabaseProjectDacpac" />
    </MSBuild>
    <ItemGroup>
      <_DacpacToCopy Include="%(_DatabaseProjectDacpac.RootDir)%(_DatabaseProjectDacpac.Directory)*.dacpac" />
    </ItemGroup>
    <Copy SourceFiles="@(_DacpacToCopy)" DestinationFolder="$(OutDir)" SkipUnchangedFiles="true" />
  </Target>
`;
}

/** The packages the generated project references, in the order they are written. */
export function packagesFor(options, versions) {
  const packages = [
    ['Microsoft.NET.Test.Sdk', versions.packages['Microsoft.NET.Test.Sdk']],
    ['MSTest', versions.packages.MSTest],
    ['DbAiTest.MSTest', versions.dbaitest],
  ];
  if (options.schema === 'dacpac') {
    packages.push(['DbAiTest.MsSql.Dacpac', versions.dbaitest]);
  } else {
    for (const engine of options.engines) {
      packages.push([ENGINES[engine].package, versions.dbaitest]);
    }
  }
  return packages;
}

/**
 * Computes the files to write.
 * @param {object} options validated options: name, engines, schema, framework, centralPackages,
 *   for an existing script folder schemaDirPath (and excludeDirs), and for dacpac dacpacFileName
 *   plus either sqlprojPath or dacpacPath {directory}. Paths are already in .csproj form (see
 *   csprojPath in project-environment.mjs).
 * @param {object} versions the skill's versions.json.
 * @param {(relativePath: string) => string} readTemplate reads a file under templates/.
 * @returns {{path: string, content: string}[]} paths relative to the project directory, '/'-separated.
 */
export function projectFiles(options, versions, readTemplate) {
  const values = {
    Namespace: options.name,
    TargetFramework: options.framework,
    DbaitestVersion: versions.dbaitest,
  };

  const packageReferences = packagesFor(options, versions)
    .map(([id, version]) => packageReference(id, version, options.centralPackages))
    .join('\n');

  const files = [
    {
      path: `${options.name}.csproj`,
      content: fill(readTemplate('Project.csproj.tmpl'), {
        ...values,
        PackageReferences: packageReferences,
        ProjectItems: projectItems(options),
      }),
    },
    { path: 'AssemblyInfo.cs', content: fill(readTemplate('AssemblyInfo.cs.tmpl'), values) },
  ];

  if (options.schema === 'dacpac') {
    files.push({
      path: 'DatabaseTests.cs',
      content: fill(readTemplate('DatabaseTests.Dacpac.cs.tmpl'), {
        ...values,
        DacpacFileName: options.dacpacFileName.replace(/["\\]/g, '\\$&'), // inside a C# string literal
      }),
    });
    return files;
  }

  // An existing schema gets a smoke-test suite to grow; no schema gets the starter suite and
  // starter schema files.
  const existing = Boolean(options.schemaDirPath);
  const suite = existing ? 'DatabaseTests' : 'CustomerTests';
  const excluded = options.excludeDirs ?? [];
  const schemaLoadOptions = excluded.length === 0
    ? ''
    : `
    // Folders under the schema directory that hold data or one-off scripts, not schema.
    protected override SchemaLoadOptions? SchemaLoadOptions => new()
    {
        ExcludedDirectories = [${excluded.map((d) => `"${d.replace(/["\\]/g, '\\$&')}"`).join(', ')}],
    };
`;

  // DbAiTest.Core.Engine and DbAiTest.MSTest are global usings in the .csproj.
  const usings = [
    ...(excluded.length > 0 ? ['DbAiTest.Core.Schema'] : []),
    ...options.engines.map((e) => ENGINES[e].namespace),
  ]
    .sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }))
    .map((ns) => `using ${ns};`)
    .join('\n');
  const engineClasses = options.engines
    .map((e) => fill(readTemplate(ENGINES[e].template), { Suite: suite, SchemaLoadOptions: schemaLoadOptions }))
    .join('\n');

  files.push(
    { path: `${suite}.cs`, content: fill(readTemplate(`${suite}.cs.tmpl`), values) },
    {
      path: `${suite}.Engines.cs`,
      content: fill(readTemplate('Engines.cs.tmpl'), {
        ...values,
        Suite: suite,
        Usings: `${usings}\n`,
        EngineClasses: engineClasses.trimEnd(),
      }),
    },
  );
  if (!existing) {
    for (const engine of options.engines) {
      files.push({
        path: `Schema/${engine}/001_tables.sql`,
        content: readTemplate(`schema/${engine}/001_tables.sql`),
      });
    }
  }
  return files;
}
