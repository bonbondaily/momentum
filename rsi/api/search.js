// Vercel 서버리스 함수: GET /api/search?q=삼성
var yahoo = require('../lib/yahoo');

module.exports = async function (req, res) {
    var url = new URL(req.url, 'http://localhost');
    var results = await yahoo.search(url.searchParams.get('q')).catch(function () { return []; });
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(results));
};
