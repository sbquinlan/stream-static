/**
 * Copied from expressjs/compression
 * https://github.com/expressjs/compression/blob/3fea81d0eaed1eb872bf3e0405f20d9e175ab2cf/test/compression.js
 */

const after = require('after')
const assert = require('assert')
const Buffer = require('safe-buffer').Buffer
const bytes = require('bytes')
const crypto = require('crypto')
const http = require('http')
const { pipeline, PassThrough } = require('stream')
const request = require('supertest')
const zlib = require('zlib')

const compression = require('../dist/compression').default

describe('compression()', function () {
  it('should skip HEAD', function (done) {
    var server = createServer({ threshold: 0 }, function (req, res) {
      res.setHeader('Content-Type', 'text/plain')
      res.setHeader('Content-Length', 12)
      res.end('hello, world')
    })

    request(server)
      .head('/')
      .set('Accept-Encoding', 'gzip')
      .expect(shouldNotHaveHeader('Content-Encoding'))
      .expect(200, done)
  })

  it('should skip unknown accept-encoding', function (done) {
    var server = createServer({ threshold: 0 }, function (req, res) {
      res.setHeader('Content-Type', 'text/plain')
      res.setHeader('Content-Length', 12)
      res.end('hello, world')
    })

    request(server)
      .get('/')
      .set('Accept-Encoding', 'bogus')
      .expect(shouldNotHaveHeader('Content-Encoding'))
      .expect(200, done)
  })

  it('should skip if content-encoding already set', function (done) {
    var server = createServer({ threshold: 0 }, function (req, res) {
      res.setHeader('Content-Type', 'text/plain')
      res.setHeader('Content-Length', 12)
      res.setHeader('Content-Encoding', 'x-custom')
      res.end('hello, world')
    })

    request(server)
      .get('/')
      .set('Accept-Encoding', 'gzip')
      .expect('Content-Encoding', 'x-custom')
      .expect(200, 'hello, world', done)
  })

  it('should set Vary', function (done) {
    var server = createServer({ threshold: 0 }, function (req, res) {
      res.setHeader('Content-Type', 'text/plain')
      res.setHeader('Content-Length', 12)
      res.end('hello, world')
    })

    request(server)
      .get('/')
      .set('Accept-Encoding', 'gzip')
      .expect('Content-Encoding', 'gzip')
      .expect('Vary', 'Accept-Encoding', done)
  })

  it('should set Vary even if Accept-Encoding is not set', function (done) {
    var server = createServer({ threshold: 1000 }, function (req, res) {
      res.setHeader('Content-Type', 'text/plain')
      res.end('hello, world')
    })

    request(server)
      .get('/')
      // seems to be a default setting here.
      .set('Accept-Encoding', '') 
      .expect('Vary', 'Accept-Encoding')
      .expect(shouldNotHaveHeader('Content-Encoding'))
      .expect(200, done)
  })

  // This module doesn't filter
  // 
  // it('should not set Vary if Content-Type does not pass filter', function (done) {
  //   var server = createServer(null, function (req, res) {
  //     res.setHeader('Content-Type', 'image/jpeg')
  //     res.end()
  //   })

  //   request(server)
  //     .get('/')
  //     .expect(shouldNotHaveHeader('Vary'))
  //     .expect(200, done)
  // })

  it('should set Vary for HEAD request', function (done) {
    var server = createServer({ threshold: 0 }, function (req, res) {
      res.setHeader('Content-Type', 'text/plain')
      res.end('hello, world')
    })

    request(server)
      .head('/')
      .set('Accept-Encoding', 'gzip')
      .expect('Vary', 'Accept-Encoding', done)
  })

  it('should transfer chunked', function (done) {
    var server = createServer({ threshold: 0 }, function (req, res) {
      res.setHeader('Content-Type', 'text/plain')
      res.setHeader('Content-Length', 12)
      res.end('hello, world')
    })

    request(server)
      .get('/')
      .set('Accept-Encoding', 'gzip')
      .expect('Transfer-Encoding', 'chunked', done)
  })

  it('should remove Content-Length for chunked', function (done) {
    var server = createServer({ threshold: 0 }, function (req, res) {
      res.setHeader('Content-Type', 'text/plain')
      res.setHeader('Content-Length', 12)
      res.end('hello, world')
    })

    request(server)
      .get('/')
      .expect('Content-Encoding', 'gzip')
      .expect(shouldNotHaveHeader('Content-Length'))
      .expect(200, done)
  })

  it('should work with encoding arguments', function (done) {
    var server = createServer({ threshold: 0 }, function (req, res) {
      res.setHeader('Content-Type', 'text/plain')
      res.write('hello, ', 'utf8')
      res.end('world', 'utf8')
    })

    request(server)
      .get('/')
      .set('Accept-Encoding', 'gzip')
      .expect('Transfer-Encoding', 'chunked')
      .expect(200, 'hello, world', done)
  })

  it('should allow writing after close', function (done) {
    // UGH
    var server = createServer({ threshold: 0 }, function (req, res) {
      res.setHeader('Content-Type', 'text/plain')
      res.once('close', function () {
        res.write('hello, ')
        res.end('world')
        done()
      })
      res.destroy()
    })

    request(server)
      .get('/')
      .end(function () {})
  })

  it('should back-pressure when compressed', function (done) {
    var buf
    var cb = after(2, done)
    var client
    var drained = false
    var resp
    var server = createServer({ threshold: 0 }, function (req, res) {
      resp = res

      res.on('drain', function () {
        drained = true
      })

      res.setHeader('Content-Type', 'text/plain')
      res.setHeader('Content-Length', String(1024 * 128 + 5))
      res.write('start')
      pressure()
    })

    crypto.randomBytes(1024 * 128, function (err, chunk) {
      if (err) return done(err)
      buf = chunk
      pressure()
    })

    function pressure () {
      if (!buf || !resp || !client) return

      assert.ok(!drained)

      while (resp.write(buf) !== false) {
        resp.flush()
      }

      resp.on('drain', function () {
        assert.ok(resp.write('end'))
        resp.end()
      })

      resp.on('finish', cb)
      client.resume()
    }

    request(server)
      .get('/')
      .request()
      .on('response', function (res) {
        client = res
        assert.strictEqual(res.headers['content-encoding'], 'gzip')
        res.pause()
        res.on('end', function () {
          server.close(cb)
        })
        pressure()
      })
      .end()
  })

  it('should back-pressure when uncompressed', function (done) {
    var buf
    var cb = after(2, done)
    var client
    var drained = false
    var resp
    var server = createServer({ filter: function () { return false } }, function (req, res) {
      resp = res

      res.on('drain', function () {
        drained = true
      })

      res.setHeader('Content-Type', 'text/plain')
      res.setHeader('Content-Length', String(1024 * 128 + 5))
      res.write('start')
      pressure()
    })

    crypto.randomBytes(1024 * 128, function (err, chunk) {
      if (err) return done(err)
      buf = chunk
      pressure()
    })

    function pressure () {
      if (!buf || !resp || !client) return

      while (resp.write(buf) !== false) {
        resp.flush()
      }

      resp.on('drain', function () {
        assert.ok(drained)
        assert.ok(resp.write('end'))
        resp.end()
      })
      resp.on('finish', cb)
      client.resume()
    }

    request(server)
      .get('/')
      // seems to be a default setting here.
      .set('Accept-Encoding', '') 
      .request()
      .on('response', function (res) {
        client = res
        shouldNotHaveHeader('Content-Encoding')(res)
        res.pause()
        res.on('end', function () {
          server.close(cb)
        })
        pressure()
      })
      .end()
  })

  it('should transfer large bodies', function (done) {
    var len = bytes('1mb')
    var buf = Buffer.alloc(len, '.')
    var server = createServer({ threshold: 0 }, function (req, res) {
      res.setHeader('Content-Type', 'text/plain')
      res.setHeader('Content-Length', String(1024 * 1024))
      res.end(buf)
    })

    request(server)
      .get('/')
      .set('Accept-Encoding', 'gzip')
      .expect('Transfer-Encoding', 'chunked')
      .expect('Content-Encoding', 'gzip')
      .expect(shouldHaveBodyLength(len))
      .expect(200, buf.toString(), done)
  })

  it('should transfer large bodies with multiple writes', function (done) {
    var len = bytes('40kb')
    var buf = Buffer.alloc(len, '.')
    var server = createServer({ threshold: 0 }, function (req, res) {
      res.setHeader('Content-Type', 'text/plain')
      res.setHeader('Content-Length', String(len * 4))
      res.write(buf)
      res.write(buf)
      res.write(buf)
      res.end(buf)
    })

    request(server)
      .get('/')
      .set('Accept-Encoding', 'gzip')
      .expect('Transfer-Encoding', 'chunked')
      .expect('Content-Encoding', 'gzip')
      .expect(shouldHaveBodyLength(len * 4))
      .expect(200, done)
  })

  describe('threshold', function () {
    it('should not compress responses below the threshold size', function (done) {
      var server = createServer({ threshold: 1024 }, function (req, res) {
        res.setHeader('Content-Type', 'text/plain')
        res.setHeader('Content-Length', '12')
        res.end('hello, world')
      })

      request(server)
        .get('/')
        .set('Accept-Encoding', 'gzip')
        .expect(shouldNotHaveHeader('Content-Encoding'))
        .expect(200, done)
    })

    it('should compress responses above the threshold size', function (done) {
      var server = createServer({ threshold: 1024 }, function (req, res) {
        res.setHeader('Content-Type', 'text/plain')
        res.setHeader('Content-Length', '2048')
        res.end(Buffer.alloc(2048))
      })

      request(server)
        .get('/')
        .set('Accept-Encoding', 'gzip')
        .expect('Content-Encoding', 'gzip', done)
    })

    // unsupported to inspect the stream and do thresholding based on that
    // it('should compress when streaming without a content-length', function (done) {
    //   var server = createServer({ threshold: 1024 }, function (req, res) {
    //     res.setHeader('Content-Type', 'text/plain')
    //     res.write('hello, ')
    //     setTimeout(function () {
    //       res.end('world')
    //     }, 10)
    //   })

    //   request(server)
    //     .get('/')
    //     .set('Accept-Encoding', 'gzip')
    //     .expect('Content-Encoding', 'gzip', done)
    // })

    it('should not compress when streaming and content-length is lower than threshold', function (done) {
      var server = createServer({ threshold: 1024 }, function (req, res) {
        res.setHeader('Content-Type', 'text/plain')
        res.setHeader('Content-Length', '12')
        res.write('hello, ')
        setTimeout(function () {
          res.end('world')
        }, 10)
      })

      request(server)
        .get('/')
        .set('Accept-Encoding', 'gzip')
        .expect(shouldNotHaveHeader('Content-Encoding'))
        .expect(200, done)
    })

    it('should compress when streaming and content-length is larger than threshold', function (done) {
      var server = createServer({ threshold: 1024 }, function (req, res) {
        res.setHeader('Content-Type', 'text/plain')
        res.setHeader('Content-Length', '2048')
        res.write(Buffer.alloc(1024))
        setTimeout(function () {
          res.end(Buffer.alloc(1024))
        }, 10)
      })

      request(server)
        .get('/')
        .set('Accept-Encoding', 'gzip')
        .expect('Content-Encoding', 'gzip', done)
    })

    it('should handle writing hex data', function (done) {
      var server = createServer({ threshold: 6 }, function (req, res) {
        res.setHeader('Content-Type', 'text/plain')
        res.setHeader('Content-Length', 4)
        res.end('2e2e2e2e', 'hex')
      })

      request(server)
        .get('/')
        .set('Accept-Encoding', 'gzip')
        .expect(shouldNotHaveHeader('Content-Encoding'))
        .expect(200, '....', done)
    })

    it('should consider res.end() as 0 length', function (done) {
      var server = createServer({ threshold: 1 }, function (req, res) {
        res.setHeader('Content-Type', 'text/plain')
        res.end()
      })

      request(server)
        .get('/')
        .set('Accept-Encoding', 'gzip')
        .expect(shouldNotHaveHeader('Content-Encoding'))
        .expect(200, '', done)
    })

    it('should work with res.end(null)', function (done) {
      var server = createServer({ threshold: 1000 }, function (req, res) {
        res.setHeader('Content-Type', 'text/plain')
        res.end(null)
      })

      request(server)
        .get('/')
        .set('Accept-Encoding', 'gzip')
        .expect(shouldNotHaveHeader('Content-Encoding'))
        .expect(200, '', done)
    })
  })

  describe('when "Accept-Encoding: gzip"', function () {
    it('should respond with gzip', function (done) {
      var server = createServer({ threshold: 0 }, function (req, res) {
        res.setHeader('Content-Type', 'text/plain')
        res.setHeader('Content-Length', 12)
        res.end('hello, world')
      })

      request(server)
        .get('/')
        .set('Accept-Encoding', 'gzip')
        .expect('Content-Encoding', 'gzip', done)
    })

    // Deleted this, it's specific to the wrapped - response implementation
    // it('should return false writing after end', function (done) {
    //   var server = createServer({ threshold: 0 }, function (req, res) {
    //     res.setHeader('Content-Type', 'text/plain')
    //     res.end('hello, world')
    //     assert.ok(res.write() === false)
    //     assert.ok(res.end() === false)
    //   })

    //   request(server)
    //     .get('/')
    //     .set('Accept-Encoding', 'gzip')
    //     .expect('Content-Encoding', 'gzip', done)
    // })
  })

  describe('when "Accept-Encoding: deflate"', function () {
    it('should respond with deflate', function (done) {
      var server = createServer({ threshold: 0 }, function (req, res) {
        res.setHeader('Content-Type', 'text/plain')
        res.setHeader('Content-Length', 12)
        res.end('hello, world')
      })

      request(server)
        .get('/')
        .set('Accept-Encoding', 'deflate')
        .expect('Content-Encoding', 'deflate', done)
    })
  })

  describe('when "Accept-Encoding: gzip, deflate"', function () {
    it('should respond with gzip', function (done) {
      var server = createServer({ threshold: 0 }, function (req, res) {
        res.setHeader('Content-Type', 'text/plain')
        res.setHeader('Content-Length', 12)
        res.end('hello, world')
      })

      request(server)
        .get('/')
        .set('Accept-Encoding', 'gzip, deflate')
        .expect('Content-Encoding', 'gzip', done)
    })
  })

  describe('when "Accept-Encoding: deflate, gzip"', function () {
    it('should respond with gzip', function (done) {
      var server = createServer({ threshold: 0 }, function (req, res) {
        res.setHeader('Content-Type', 'text/plain')
        res.setHeader('Content-Length', 12)
        res.end('hello, world')
      })

      request(server)
        .get('/')
        .set('Accept-Encoding', 'deflate, gzip')
        .expect('Content-Encoding', 'gzip', done)
    })
  })

  describe('when "Cache-Control: no-transform" response header', function () {
    it('should not compress response', function (done) {
      var server = createServer({ threshold: 0 }, function (req, res) {
        res.setHeader('Cache-Control', 'no-transform')
        res.setHeader('Content-Type', 'text/plain')
        res.setHeader('Content-Length', 12)
        res.end('hello, world')
      })

      request(server)
        .get('/')
        .set('Accept-Encoding', 'gzip')
        .expect('Cache-Control', 'no-transform')
        .expect(shouldNotHaveHeader('Content-Encoding'))
        .expect(200, 'hello, world', done)
    })

    it('should not set Vary header', function (done) {
      var server = createServer({ threshold: 0 }, function (req, res) {
        res.setHeader('Cache-Control', 'no-transform')
        res.setHeader('Content-Type', 'text/plain')
        res.setHeader('Content-Length', 12)
        res.end('hello, world')
      })

      request(server)
        .get('/')
        .set('Accept-Encoding', 'gzip')
        .expect('Cache-Control', 'no-transform')
        .expect(shouldNotHaveHeader('Vary'))
        .expect(200, done)
    })
  })

  // Deleted all the compression.filter() stuff, that can be done separately

  // Deleted all the flush stuff, that's specific to the old implementation
})

function createServer({ threshold }, fn) {
  return http.createServer(function (req, res) {
    const sink = new PassThrough();
    sink['setHeader'] = (... args) => res.setHeader(... args)
    fn(req, sink)
    pipeline(
      sink,
      compression(req, res, threshold),
      res,
      (err) => {
        if (err) {
          res.statusCode = err.status || 500
          res.end(err.message)
        }
      }
    )
  })
}

function shouldHaveBodyLength (length) {
  return function (res) {
    assert.strictEqual(res.text.length, length, 'should have body length of ' + length)
  }
}

function shouldNotHaveHeader (header) {
  return function (res) {
    assert.ok(!(header.toLowerCase() in res.headers), 'should not have header ' + header)
  }
}

function writeAndFlush (stream, count, buf) {
  var writes = 0

  return function () {
    if (writes++ >= count) return
    if (writes === count) return stream.end(buf)
    stream.write(buf)
    stream.flush()
  }
}

function unchunk (encoding, onchunk, onend) {
  return function (res) {
    var stream

    assert.strictEqual(res.headers['content-encoding'], encoding)

    switch (encoding) {
      case 'deflate':
        stream = res.pipe(zlib.createInflate())
        break
      case 'gzip':
        stream = res.pipe(zlib.createGunzip())
        break
    }

    stream.on('data', onchunk)
    stream.on('end', onend)
  }
}