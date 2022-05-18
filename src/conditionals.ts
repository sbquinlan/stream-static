import { IncomingMessage, ServerResponse } from 'http'
import error from './error'
import { as_nullable_string } from './utils'

function if_modified_since(header: string | undefined, mtime: any): boolean {
  if (!header) return true
  const header_date = Date.parse(header)
  return isNaN(mtime) || header_date < mtime
}
function if_unmodified_since(header: string | undefined, mtime: any): boolean {
  if (!header) return true
  const header_date = Date.parse(header)
  return isNaN(mtime) || header_date >= mtime
}

function if_match(header: string | undefined, etag: string | undefined): boolean {
  return !header || etag_matches(header, etag)
}
function if_none_match(header: string | undefined, etag: string | undefined): boolean {
  return !header || !etag_matches(header, etag)
}
function etag_matches(header: string, etag: string | undefined): boolean {
  return etag !== undefined && (Boolean(~header.indexOf(etag)) || header.trim() === '*')
}

export default function conditionals(
  req: IncomingMessage, 
  res: ServerResponse,
): void {
  const etag = as_nullable_string(res.getHeader('Etag'))
  const mtime = Date.parse(as_nullable_string(res.getHeader('Last-Modified')) ?? '')
  if (!if_match(req.headers['if-match'], etag)) 
    throw error(req.headers['range'] ? 416 : 412)
  if (!if_unmodified_since(req.headers['if-unmodified-since'], mtime)) 
    throw error(412)
  if (
    !if_none_match(req.headers['if-none-match'], etag) ||
    !if_modified_since(req.headers['if-modified-since'], mtime)
  )
    throw error(304)
};