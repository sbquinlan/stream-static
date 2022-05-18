import { IncomingMessage, ServerResponse } from 'http'
import { ReadStream } from 'fs'

import { normalize_path, send } from './send'
import basicheaders from './basicheaders'
import byterange from './byterange'
import conditionals from './conditionals'
import compression from './compression.js'

async function streamStatic(
  root: string, 
  req: IncomingMessage, 
  res: ServerResponse,
): Promise<ReadStream> {
  let { path, stat, stream } = await send(root, req.url!);
  basicheaders(res, path, stat)
  try {
    conditionals(req, res)
  } catch(err) {
    stream.destroy();
    throw err;
  }
  return stream
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