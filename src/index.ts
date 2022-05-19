import { IncomingMessage, ServerResponse } from 'http'
import { Readable } from 'stream'

import { normalize_path, send } from './send'
import basicheaders from './basicheaders'
import byterange from './byterange'
import conditionals from './conditionals'
import compression from './compression'
import error from './error'

// this just adds the experimental iterator method
interface ReadableWithIterator extends Readable {
  iterator(): AsyncIterableIterator<any>;
}

async function streamStatic(
  root: string, 
  req: IncomingMessage, 
  res: ServerResponse,
  maxage: number = 0,
): Promise<Readable> {
  if (!root) throw new Error('root path required');
  if (req.method === 'POST') {
    throw error(404)
  }
  if (req.method !== 'HEAD' && req.method !== 'GET') {
    res.setHeader('Allow', 'GET, HEAD')
    throw error(405)
  }
  let { path, stat, stream } = await send(root, req.url!);
  try {
    basicheaders(res, path, stat, maxage)
    conditionals(req, res)
  } catch(err) {
    stream.destroy();
    throw err;
  }
  const ranger = byterange(req, res);
  return stream.pipe(ranger, { end: true });
}

export default {
  streamStatic,
  normalize_path,
  send,
  basicheaders,
  byterange,
  conditionals,
  compression,
}