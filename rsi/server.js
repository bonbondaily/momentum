// 로컬 실행: node server.js → http://localhost:3000
var http = require('http');
var fs = require('fs');
var path = require('path');

var ROUTES = { '/api/chart': require('./api/chart'), '/api/search': require('./api/search') };
var PUBLIC = path.join(__dirname, 'public');
var TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };
var PORT = process.env.PORT || 3000;

http.createServer(function (req, res) {
    var pathname = new URL(req.url, 'http://localhost').pathname;
    if (ROUTES[pathname]) return ROUTES[pathname](req, res);

    var file = path.join(PUBLIC, pathname === '/' ? 'index.html' : path.normalize(pathname));
    if (!file.startsWith(PUBLIC)) { res.statusCode = 403; return res.end(); }
    fs.readFile(file, function (err, buf) {
        if (err) { res.statusCode = 404; return res.end('Not found'); }
        res.setHeader('Content-Type', TYPES[path.extname(file)] || 'application/octet-stream');
        res.end(buf);
    });
}).listen(PORT, function () {
    console.log('RSI 시그널 → http://localhost:' + PORT);
});
