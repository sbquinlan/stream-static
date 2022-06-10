
var http = require('http')
var path = require('path')
var request = require('supertest')
var { streamStatic } = require('../dist')
var fixtures = path.join(__dirname, '/fixtures')

describe('byterange()', function () {

  describe('acceptRanges', function () {
    it('should include Accept-Ranges', function (done) {
      request(createServer(fixtures, { acceptRanges: true }))
        .get('/nums.txt')
        .expect('Accept-Ranges', 'bytes')
        .expect(200, '123456789', done)
    })
  })

  describe('when request has "Range" header', function () {
    var server
    before(function () {
      server = createServer()
    })

    it('should support byte ranges', function (done) {
      request(server)
        .get('/nums.txt')
        .set('Range', 'bytes=0-4')
        .expect('12345', done)
    })

    it('should be inclusive', function (done) {
      request(server)
        .get('/nums.txt')
        .set('Range', 'bytes=0-0')
        .expect('1', done)
    })

    it('should set Content-Range', function (done) {
      request(server)
        .get('/nums.txt')
        .set('Range', 'bytes=2-5')
        .expect('Content-Range', 'bytes 2-5/9', done)
    })

    it('should support -n', function (done) {
      request(server)
        .get('/nums.txt')
        .set('Range', 'bytes=-3')
        .expect('789', done)
    })

    it('should support n-', function (done) {
      request(server)
        .get('/nums.txt')
        .set('Range', 'bytes=3-')
        .expect('456789', done)
    })

    it('should respond with 206 "Partial Content"', function (done) {
      request(server)
        .get('/nums.txt')
        .set('Range', 'bytes=0-4')
        .expect(206, done)
    })

    it('should set Content-Length to the # of octets transferred', function (done) {
      request(server)
        .get('/nums.txt')
        .set('Range', 'bytes=2-3')
        .expect('Content-Length', '2')
        .expect(206, '34', done)
    })

    describe('when last-byte-pos of the range is greater than current length', function () {
      it('is taken to be equal to one less than the current length', function (done) {
        request(server)
          .get('/nums.txt')
          .set('Range', 'bytes=2-50')
          .expect('Content-Range', 'bytes 2-8/9', done)
      })

      it('should adapt the Content-Length accordingly', function (done) {
        request(server)
          .get('/nums.txt')
          .set('Range', 'bytes=2-50')
          .expect('Content-Length', '7')
          .expect(206, done)
      })
    })

    describe('when the first- byte-pos of the range is greater than the current length', function () {
      it('should respond with 416', function (done) {
        request(server)
          .get('/nums.txt')
          .set('Range', 'bytes=9-50')
          .expect(416, done)
      })

      it('should include a Content-Range header of complete length', function (done) {
        request(server)
          .get('/nums.txt')
          .set('Range', 'bytes=9-50')
          .expect('Content-Range', 'bytes */9')
          .expect(416, done)
      })
    })

    describe('when syntactically invalid', function () {
      it('should respond with 200 and the entire contents', function (done) {
        request(server)
          .get('/nums.txt')
          .set('Range', 'asdf')
          .expect('123456789', done)
      })
    })
  })
})

function createServer() {
  return http.createServer(function (req, res) {
    streamStatic(fixtures, req, res)
      .then(static => static.pipe(res))
      .catch((err) => {
        res.statusCode = err ? (err.status || 500) : 404
        res.end(err ? err.stack : 'sorry!')
      });
  })
}
