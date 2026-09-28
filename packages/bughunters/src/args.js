/**
 * The bugpatrol arguments for a bughunters command line. Every command is the
 * same under both names. Only `bughunters` alone differs: it shows the help, as
 * it did before the rename, where `bugpatrol` alone starts the patrol.
 *
 * @param {string[]} args
 * @returns {string[]}
 */
export function bugpatrolArgs(args) {
  return args.length ? args : ['--help'];
}
