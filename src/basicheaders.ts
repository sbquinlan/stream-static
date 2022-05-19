import mime from 'mime'
import etag from 'etag'
import { ServerResponse } from 'http'
import { Stats } from 'fs'

const YEAR = 60 * 60 * 24 * 365;
export default function basicheaders(
  res: ServerResponse, 
  path: string, 
  stat: Stats,
  maxage: number = 0,
): void {
  res.setHeader('Cache-Control', `public, max-age=${Math.min(maxage, YEAR)}`)
  res.setHeader('Content-Length', stat.size)
  res.setHeader('Content-Type', mime.getType(path) ?? 'application/octet-stream')
  res.setHeader('Etag', etag(stat))
  res.setHeader('Last-Modified', stat.mtime.toUTCString())
  res.statusCode = 200;
}