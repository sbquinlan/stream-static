import { Stats } from 'fs'
import { stat, open } from 'fs/promises'
import { join, normalize, resolve, sep } from 'path'
import { Readable } from 'stream'

import error from './error'

const BAD_PATH_REGEX = /^[\.]{1,2}$/
export function normalize_path(root: string, path: string): string {
  try {
    path = decodeURIComponent(path)
    if (~path.indexOf('\0')) 
      throw error(400)
  } catch (e) {
    throw error(400)
  }
  
  if (!path.split(sep).every(p => !BAD_PATH_REGEX.test(p))) 
    throw error(403)
  return resolve(join(root, path ? '.' + sep + path : path))
}

interface ReadStreamAndStat {
  path: string,
  stat: Stats,
  stream: Readable
}

export async function send(root: string, path: string): Promise<ReadStreamAndStat> {
  path = normalize_path(root, path)
  let info = await stat(path).catch(() => { throw error(404) })
  if (info.isDirectory()) {
    path = join(path, 'index.html');
    info = await stat(path).catch(() => { throw error(404) })
  }

  const handle = await open(path, 'r').catch(() => { throw error(404) })
  return { path, stat: info, stream: handle.createReadStream() }
}