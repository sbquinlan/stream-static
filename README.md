# stream-static

This is a rewrite of the npm module [`serve-static`](https://www.npmjs.com/package/serve-static) and [`compression`](https://www.npmjs.com/package/compression) for Node v16+. This module offers a composable solution with components offer specific, minimal functionality and limited dependences by emphasizing the Stream APIs provided by Node.js from the filesystem, compression and HTTP.

## Why use this instead?

[`serve-static`](https://www.npmjs.com/package/serve-static) and [`compression`](https://www.npmjs.com/package/compression) are difficult to work with if you want to customize their functionality beyond what is provided. This module is written so that it's easy to quickly customize the implementation to suit your needs.

That said, in the author's opinion, nobody should use either [`serve-static`](https://www.npmjs.com/package/serve-static) or this module in production because neither are as performant nor as robust as many CDN offerings that serve static content.

## Why use [`serve-static`](https://www.npmjs.com/package/serve-static) and [`compression`](https://www.npmjs.com/package/compression) instead?

[`serve-static`](https://www.npmjs.com/package/serve-static) and [`compression`](https://www.npmjs.com/package/compression) support Node before v16. 

[`serve-static`](https://www.npmjs.com/package/serve-static) provides some features as configuration options that the author of this module felt were "scope creep" or trivial for consumers to implement themselves. For example, [`serve-static`](https://www.npmjs.com/package/serve-static) offers a `fallthrough` option that will replace the 404 response on non existant files with a "fallthrough" to the next handler in the routing middleware. This feature is fairly easy implemented.

For a full comparison of features differences, diff the [tests](../main/tests/) in this module with the tests in [`serve-static`](https://www.npmjs.com/package/serve-static) and [`compression`](https://www.npmjs.com/package/compression).

## Install

```sh
$ npm install stream-static
```

or

```sh
$ yarn add stream-static
```

### Dependencies:

```sh
> yarn list --prod
yarn list v1.22.15
├─ etag@1.8.1
├─ mime@3.0.0
├─ range-parser@1.2.1
├─ statuses@2.0.1
└─ vary@1.1.2
✨  Done in 0.05s.
```

## API

```js
import { 
  streamStatic,
  normalize_path,
  send,
  basicheaders,
  byterange,
  conditionals,
  compression,
} from 'stream-static'
```

The provided streamStatic function is a composition itself of the other functions

```js
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
  return stream.pipe(byterange(req, res));
}
```

Or implement your own custom handler serving static files:

```js
async function static_compression(root: string, converter: Transform = null): Promise<void> {
  return async (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.statusCode = 405;
      res.setHeader('Allow', 'GET, HEAD')
      res.setHeader('Content-Length', 0)
      res.end();
      return;
    }
    let stream;
    try {
      stream = await streamStatic(resolve(root), req, res);
      if (req.method === 'HEAD') {
        stream.destroy();
        return;
      }
      await pipeline(
        stream,
        byterange(req, res),
        converter ? converter(req, res) : new PassThrough(),
        compression(req, res),
        res,
      );
      res.end();
    } catch (err) {
      console.error(err);
      res.statusCode = isHttpError(err) ? err.statusCode : 500
      if (!res.headersSent) {
        res.setHeader('Content-Length', 0);
      }
      res.end();
      stream?.destroy();
    }
  };
}
```

## Documentation

### [async function streamStatic(root: string, req: IncomingMessage, res: ServerResponse, maxage: number = 0): Promise<Readable>](../main/src/index.ts)

This replicates the functionality of [`serve-static`](https://www.npmjs.com/package/serve-static) if you are looking for a replacement (be mindful of some feature differences described above). This function will return a stream of the requested file in `root` + `req.url`. If no file exists it will throw a 404. It also supports byte-ranging requests, cache-control, and conditional header requests. 

### [async function normalize_path(root: string, path: string): string](../main/src/send.ts)

This validate the path through some simple rules and then resolve it to an absolute path. 

### [async function send(root: string, path: string): Promise<{ path: string, stat: Stats, stream: Readable }>](../main/src/send.ts)

This replicates the [`send`](https://www.npmjs.com/package/send) module that [`serve-static`](https://www.npmjs.com/package/serve-static) uses to validate the file path and open a file. It will validate the path from the URI (using `normalize_path`), the file exists and is not a directory before returning a Readable stream.

### [function basicheaders(res: ServerResponse, path: string, stat: Stats, maxage: number = 0): void](../main/src/basicheaders.ts)

This function will add basic headers to the response based on the file described in `stats`. This populates headers: `Content-Type`, `Content-Length`, `Cache-Control`, `Etag` and `Last-Modified`

### [function byterange(req: IncomingMessage, res: ServerResponse): Duplex](../main/src/byterange.ts)

This function implements the byte range request logic to support Partial Responses based on the `Range` header, returning a `Duplex` stream that should be used as a `Transform`. 

### [function conditionals(req: IncomingMessage, res: ServerResponse): void](../main/src/conditionals.ts)

This function implements the handling of conditional headers: `if-match`, `if-none-match`, `if-unmodified-since`, and `if-modified-since`. This includes support for etags.

### [function compression(req: IncomingMessage, res: ServerResponse, threshhold: number = 1024): Transform](../main/src/compression.ts)

This is the replacement for [`compression`](https://www.npmjs.com/package/compression). It will respect the requested encoding and return a `Transform` stream (or `PassThrough`) to either do the compression or not based on what the client requested. 

## License

[MIT](LICENSE)