import { open } from 'fs/promises'
import { join, normalize, resolve, sep } from 'path'

import error from './error'
import { ReadStream, Stats } from 'fs'

const BAD_PATH_REGEX = /^[\.]{1,2}$/gm
export function normalize_path(root: string, path: string): string {
  path = decodeURIComponent(path)
  if (~path.indexOf('\0')) 
    throw error(400)

  path = join(root, path ? '.' + sep + path : path)
  if (!normalize(path).split(sep).every(p => !BAD_PATH_REGEX.exec(p))) 
    throw error(404)
  return resolve(path)
}

interface ReadStreamAndStat {
  path: string,
  stat: Stats,
  stream: ReadStream
}

export async function send(root: string, path: string): Promise<ReadStreamAndStat> {
  path = normalize_path(root, path)
  const handle = await open(path, 'r').catch(() => { throw error(404) })
  const stat = await handle.stat().catch(() => { throw error(500) })
  return { path, stat, stream: handle.createReadStream() }
}