import { PassThrough, Readable, Transform } from 'stream'
import { IncomingMessage, ServerResponse } from 'http'

import parseRange, * as RangeParser from 'range-parser'
import error from './error'
import { as_nullable_string } from './utils'

function content_range({start, end}: RangeParser.Range): string {
  return `bytes ${start}-${end}/*`
}

function boundary(sep: string, content_type: string, range: RangeParser.Range): Buffer {
  return Buffer.from(`\n\r--${sep}\n\rContent-type: ${content_type}\n\rContent-range: ${content_range(range)}\n\r\n\r`)
}

function closing_boundary(sep: string): Buffer {
  return Buffer.from(`\n\r--${sep}--`)
}

function if_range(header: string | undefined, etag: string | undefined, mtime: any): boolean {
  if (!header) return true
  if (etag && ~header.indexOf(etag)) return true
  const header_date = Date.parse(header);
  return isNaN(mtime) || header_date >= mtime
}

function slicer(
  ranges: RangeParser.Range[], 
  seperator?: string, 
  content_type?: string
): Transform {
  async function* transform(source: Readable, signal: { abort: AbortSignal }) {
    let pos = 0;
    // @ts-ignore Typescript doesn't understand the type interop between *gens and Transform
    let { value: buffer, done } = await source.next();
    if (signal.abort) return
    if (done) throw new Error('Empty stream to slice')    
    for (const {start, end} of ranges) {
      if (ranges.length > 1) {
        // need to do multi part encoding
        yield boundary(seperator!, content_type!, {start, end})
      }
      // fast forward to the window start
      while ((pos + buffer.length) < start) {
        pos += buffer.length;
        // @ts-ignore Typescript doesn't understand the type interop between *gens and Transform
        ({ value: buffer, done } = await source.next())
        if (signal.abort) return;
        if (done) throw new Error('Ran out of data')
      }

      // return the window 
      if (signal.abort) return;
      yield buffer.slice(
        Math.max(0, start - pos),
        Math.min(buffer.length, end - pos),
      );

      // keep going until we get the buffer with the end byte
      while ((pos + buffer.length) < end) {
        pos += buffer.length
        // @ts-ignore Typescript doesn't understand the type interop between *gens and Transform
        ({ value: buffer, done } = await source.next())
        if (signal.abort) return;
        if (done) throw new Error('Ran out of data')

        yield buffer.slice(
          Math.max(0, start - pos), // should always be 0 in this case
          Math.min(buffer.length, end - pos),
        );
      }
    }
    if (ranges.length > 1) {
      yield closing_boundary(seperator!)
    }
  }
  // @ts-ignore Typescript doesn't understand the type interop between *gens and Transform
  return transform
}

function ranges_invalid(result: RangeParser.Result | RangeParser.Ranges): result is RangeParser.Result {
  return typeof result == 'number';
}

export default function byterange(
  req: IncomingMessage, 
  res: ServerResponse
): Transform {
  res.setHeader('Accept-Ranges', 'bytes');

  const etag = as_nullable_string(res.getHeader('Etag'));
  const mtime = Date.parse(as_nullable_string(res.getHeader('Last-Modified')) ?? '');
  const length = Number(res.getHeader('Content-Length'));
  const range_header = req.headers['range'];
  if (!if_range(as_nullable_string(req.headers['if-range']), etag, mtime) || !range_header) {
    return new PassThrough();
  }

  const ranges = parseRange(length, range_header, { combine: true });
  if (ranges_invalid(ranges)) {
    res.setHeader('Content-Range', `bytes */${length}`)
    throw error(416)
  }

  if (ranges.length === 1) {  
    res.setHeader('Content-Range', `bytes ${ranges[0].start}-${ranges[0].end}/${length}`)
    res.setHeader('Content-Length', ranges[0].end - ranges[0].start)
    return slicer(ranges)
  }

  // multipart
  const sep = '';
  const type = as_nullable_string(res.getHeader('Content-Type'));
  res.setHeader('Content-Type', `multipart/byteranges; boundary=${sep}`)
  // this is hard it's like the sum of all the ranges plus the separators
  res.setHeader('Content-Length', '')
  return slicer(ranges, sep, type)
}