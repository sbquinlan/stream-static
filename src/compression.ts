import { IncomingMessage, ServerResponse } from 'http';
import { PassThrough, Transform } from 'stream'
import zlib from 'zlib'
import vary from 'vary'
import { as_nullable_string } from './utils';

const GZIP = 'gzip';
const DEFLATE = 'deflate';
const IDENTITY = 'identity';

export default function compression(
  req: IncomingMessage, 
  res: ServerResponse,
  threshhold: number = 1024
): Transform {
  const cache_control = as_nullable_string(res.getHeader('Cache-Control'));
  if (cache_control && ~cache_control.indexOf('no-transform')) {
    return new PassThrough();
  }
  
  vary(res, 'Accept-Encoding')
  if (req.method !== 'GET') {
    return new PassThrough();
  }

  const content_length = Number(res.getHeader('Content-Length'))
  if (isNaN(content_length) || content_length < threshhold) {
    return new PassThrough();
  }

  const accepts = req.headers['accept-encoding']
  if (!accepts) {
    return new PassThrough();
  }

  const encoding = as_nullable_string(res.getHeader('Content-Encoding')) ?? IDENTITY;
  if (encoding !== IDENTITY || ~accepts.indexOf(IDENTITY)) {
    return new PassThrough();
  }

  if (~accepts.indexOf(GZIP)) {
    res.removeHeader('Content-Length')
    res.setHeader('Content-Encoding', GZIP)
    return zlib.createGzip();
  } 
  if (~accepts.indexOf(DEFLATE)) {
    res.removeHeader('Content-Length')
    res.setHeader('Content-Encoding', DEFLATE)
    return zlib.createDeflate();
  }
  return new PassThrough();
}