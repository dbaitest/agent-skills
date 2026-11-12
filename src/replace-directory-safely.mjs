// Replaces a skill directory so that an agent reading the skills folder never sees a partial
// copy or a stray second copy, whatever goes wrong:
//
//   1. copy the new skill into a staging folder NEXT TO the skills folder (same volume, so the
//      renames below cannot cross devices, but outside the folder agents scan);
//   2. move the installed copy (if any) into staging;
//   3. move the new copy into place; if that fails, move the old copy back.
//
// Windows refuses to rename a directory while a file in it is open (an editor, an antivirus
// scan), so renames are retried with a short backoff before giving up.

import { cpSync, existsSync, mkdirSync, renameSync, rmdirSync, rmSync } from 'node:fs';
import path from 'node:path';

const STAGING = '.dbaitest-skills-staging';
const RETRYABLE = new Set(['EPERM', 'EACCES', 'EBUSY']);

function pause(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function renameWithRetry(from, to) {
  for (let attempt = 0; ; attempt++) {
    try {
      renameSync(from, to);
      return;
    } catch (error) {
      if (!RETRYABLE.has(error.code) || attempt >= 6) {
        throw error;
      }
      pause(50 * 2 ** attempt);
    }
  }
}

/** The staging folder for a skills folder: a sibling of it, e.g. .claude/.dbaitest-skills-staging. */
export const stagingFor = (skillsDir) => path.join(path.dirname(skillsDir), STAGING);

/** Removes staging left behind by an earlier run that was killed. */
export function sweepStaging(skillsDir) {
  rmSync(stagingFor(skillsDir), { recursive: true, force: true, maxRetries: 3 });
}

/**
 * Makes dest an exact copy of source. On failure dest is left as it was (or absent, if it was)
 * and the error is rethrown.
 */
export function replaceDirectory(source, dest) {
  const staging = path.join(stagingFor(path.dirname(dest)), `${path.basename(dest)}-${process.pid}`);
  const incoming = path.join(staging, 'new');
  const outgoing = path.join(staging, 'old');
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(staging, { recursive: true });

  try {
    cpSync(source, incoming, { recursive: true });
    const hadOld = existsSync(dest);
    if (hadOld) {
      renameWithRetry(dest, outgoing);
    } else {
      mkdirSync(path.dirname(dest), { recursive: true });
    }
    try {
      renameWithRetry(incoming, dest);
    } catch (error) {
      if (hadOld) {
        renameWithRetry(outgoing, dest);
      }
      throw error;
    }
  } finally {
    // The old copy may still be locked on Windows; it is outside the skills folder, so a failed
    // delete is harmless and the next run sweeps it.
    try {
      rmSync(staging, { recursive: true, force: true, maxRetries: 3 });
      rmdirSync(path.dirname(staging)); // the staging root, unless another run is using it
    } catch {
      // swept next time
    }
  }
}

/** Deletes a skill directory; it is renamed into staging first so it vanishes at once. */
export function removeDirectory(dest) {
  const staging = path.join(stagingFor(path.dirname(dest)), `${path.basename(dest)}-${process.pid}-removed`);
  mkdirSync(path.dirname(staging), { recursive: true });
  renameWithRetry(dest, staging);
  try {
    rmSync(path.dirname(staging), { recursive: true, force: true, maxRetries: 3 });
  } catch {
    // swept next time
  }
}
