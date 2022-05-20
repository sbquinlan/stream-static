import { IncomingMessage, ServerResponse } from 'http'

import parseRange, * as RangeParser from 'range-parser'
import { Duplex, PassThrough, Transform } from 'stream'
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
): Duplex {
  async function* transform(source: AsyncIterator<Buffer>): AsyncIterator<Buffer> {
    let pos = 0;
    let { value: buffer, done } = await source.next();
    if (done) throw new Error('Empty stream to slice')

    for (const {start, end} of ranges) {
      if (ranges.length > 1) {
        // need to do multi part encoding
        yield boundary(seperator!, content_type!, {start, end})
      }
      // fast forward to the window start
      while ((pos + buffer.length) < start) {
        pos += buffer.length;
        ({ value: buffer, done } = await source.next())
        if (done) throw new Error('Ran out of data')
      }

      // return the window 
      yield buffer.slice(
        Math.max(0, start - pos),
        Math.min(buffer.length, end + 1 - pos),
      );

      // keep going until we get the buffer with the end byte
      while ((pos + buffer.length) <= end) {
        pos += buffer.length
        ({ value: buffer, done } = await source.next())
        if (done) throw new Error('Ran out of data')

        yield buffer.slice(
          Math.max(0, start - pos), // should always be 0 in this case
          Math.min(buffer.length, end + 1 - pos),
        );
      }
    }
    if (ranges.length > 1) {
      yield closing_boundary(seperator!)
    }
  }
  return Duplex.from(transform)
}

function ranges_invalid(result: RangeParser.Result | RangeParser.Ranges): result is RangeParser.ResultInvalid {
  return result === -2;
}

function ranges_unsatifiable(result: RangeParser.Result | RangeParser.Ranges): result is RangeParser.ResultUnsatisfiable {
  return result === -1;
}

export default function byterange(
  req: IncomingMessage, 
  res: ServerResponse
): Duplex {
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
    return new PassThrough();
  }

  if (ranges_unsatifiable(ranges)) {
    res.setHeader('Content-Range', `bytes */${length}`)
    throw error(416)
  }

  res.statusCode = 206;
  if (ranges.length === 1) {
    res.setHeader('Content-Range', `bytes ${ranges[0].start}-${ranges[0].end}/${length}`)
    res.setHeader('Content-Length', ranges[0].end - ranges[0].start + 1)
    return slicer(ranges)
  }

  const sep = 'idontknowwhattomakethis';
  const type = as_nullable_string(res.getHeader('Content-Type')) ?? 'application/octet-stream';
  res.setHeader('Content-Type', `multipart/byteranges; boundary=${sep}`)
  // duplicate boundary strings here, but whatever, makes it easier to calculate
  const content_length = closing_boundary(sep).length + ranges.reduce(
    (sum, r) => sum + r.end - r.start + boundary(sep, type, r).length,
    0
  );
  res.setHeader('Content-Length', String(content_length))
  return slicer(ranges, sep, type)
}