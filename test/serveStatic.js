
var assert = require('assert')
var Buffer = require('safe-buffer').Buffer
var http = require('http')
var path = require('path')
var request = require('supertest')
var { streamStatic } = require('../dist')
var fixtures = path.join(__dirname, '/fixtures')
var relative = path.relative(process.cwd(), fixtures)

var skipRelative = ~relative.indexOf('..') || path.resolve(relative) === relative
describe('serveStatic()', function () {
  var server
  before(function () {
    server = createServer()
  })

  describe('basic operations', function () {
    it('should serve static files', function (done) {
      request(server)
        .get('/todo.txt')
        .expect(200, '- groceries', done)
    })

    it('should support nesting', function (done) {
      request(server)
        .get('/users/tobi.txt')
        .expect(200, 'ferret', done)
    })

    it('should set Content-Type', function (done) {
      request(server)
        .get('/todo.txt')
        .expect('Content-Type', 'text/plain')
        .expect(200, done)
    })

    it('should set Last-Modified', function (done) {
      request(server)
        .get('/todo.txt')
        .expect('Last-Modified', /\d{2} \w{3} \d{4}/)
        .expect(200, done)
    })

    it('should default max-age=0', function (done) {
      request(server)
        .get('/todo.txt')
        .expect('Cache-Control', 'public, max-age=0')
        .expect(200, done)
    })

    it('should support urlencoded pathnames', function (done) {
      request(server)
        .get('/foo%20bar')
        .expect(200)
        .expect(shouldHaveBody(Buffer.from('baz')))
        .end(done)
    })

    it('should not choke on auth-looking URL', function (done) {
      request(server)
        .get('//todo@txt')
        .expect(404, done)
    })

    it('should not support ../', function (done) {
      request(server)
        .get('/users/../todo.txt')
        .expect(403)
        .end(done)
    })

    it('should support HEAD', function (done) {
      request(server)
        .head('/todo.txt')
        .expect(200)
        .expect(shouldNotHaveBody())
        .end(done)
    })

    it('should skip POST requests', function (done) {
      request(server)
        .post('/todo.txt')
        .expect(404)
        .end(done)
    })

    it('should support conditional requests', function (done) {
      request(server)
        .get('/todo.txt')
        .end(function (err, res) {
          if (err) throw err
          request(server)
            .get('/todo.txt')
            .set('If-None-Match', res.headers.etag)
            .expect(304, done)
        })
    })

    it('should support precondition checks', function (done) {
      request(server)
        .get('/todo.txt')
        .set('If-Match', '"foo"')
        .expect(412, done)
    })

    it('should serve zero-length files', function (done) {
      request(server)
        .get('/empty.txt')
        .expect(200, '', done)
    })
  });

  describe('cacheControl', function () {
    it('should include Cache-Control', function (done) {
      request(server)
        .get('/nums.txt')
        .expect('Cache-Control', 'public, max-age=0')
        .expect(200, '123456789', done)
    })
  })

  describe('fallthrough', function () {
    it('should 405 when OPTIONS request', function (done) {
      request(server)
        .options('/todo.txt')
        .expect('Allow', 'GET, HEAD')
        .expect(405, done)
    })

    it('should 400 when URL malformed', function (done) {
      request(server)
        .get('/%')
        .expect(400, /Bad Request/, done)
    })

    it('should 403 when traversing past root', function (done) {
      request(server)
        .get('/users/../../todo.txt')
        .expect(403, /Forbidden/, done)
    })
  })

  describe('lastModified', function () {
    it('should include Last-Modifed', function (done) {
      request(server)
        .get('/nums.txt')
        .expect('Last-Modified', /^\w{3}, \d+ \w+ \d+ \d+:\d+:\d+ \w+$/)
        .expect(200, '123456789', done)
    })
  })

  describe('maxAge', function () {
    it('should accept string', function (done) {
      request(createServer(fixtures, 60 * 60 * 24 * 30))
        .get('/todo.txt')
        .expect('cache-control', 'public, max-age=' + (60 * 60 * 24 * 30))
        .expect(200, done)
    })

    it('should be reasonable when infinite', function (done) {
      request(createServer(fixtures, Infinity))
        .get('/todo.txt')
        .expect('cache-control', 'public, max-age=' + (60 * 60 * 24 * 365))
        .expect(200, done)
    })
  })

  describe('when non-existent root path', function () {
    it('should 404 for any file', function (done) {
      request(createServer(fixtures + '/does_not_exist'))
        .get('/todo.txt')
        .expect(404, done)
    })

    it('should not allow traversal', function (done) {
      request(createServer(fixtures + '/does_not_exist'))
        .get('/../todo.txt')
        .expect(403, done)
    })
  })

  describe('when traversing past root', function () {
    it('should catch urlencoded ../', function (done) {
      request(server)
        .get('/users/%2e%2e/%2e%2e/todo.txt')
        .expect(403, done)
    })

    it('should not allow root path disclosure', function (done) {
      request(server)
        .get('/users/../../fixtures/todo.txt')
        .expect(403, done)
    })
  })
})

function createServer (dir, maxage, fn) {
  dir = dir || fixtures
  maxage = maxage || 0
  return http.createServer(function (req, res) {
    fn && fn(req, res)
    streamStatic(dir, req, res, maxage)
      .then(static => static.pipe(res))
      .catch((err) => {
        res.statusCode = err ? (err.status || 500) : 404
        res.end(err ? err.stack : 'sorry!')
      });
  })
}

function shouldHaveBody (buf) {
  return function (res) {
    var body = !Buffer.isBuffer(res.body)
      ? Buffer.from(res.text)
      : res.body
    assert.ok(body, 'response has body')
    assert.strictEqual(body.toString('hex'), buf.toString('hex'))
  }
}

function shouldNotHaveBody () {
  return function (res) {
    assert.ok(res.text === '' || res.text === undefined)
  }
}

function shouldNotHaveHeader (header) {
  return function (res) {
    assert.ok(!(header.toLowerCase() in res.headers), 'should not have header ' + header)
  }
}
