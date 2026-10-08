// Vercel 서버리스 함수: GET /api/chart?symbol=005930
var yahoo = require('../lib/yahoo');

module.exports = async function (req, res) {
    var url = new URL(req.url, 'http://localhost');
    try {
        var data = await yahoo.getChart(url.searchParams.get('symbol'));
        res.setHeader('Cache-Control', 's-maxage=300');
        send(res, 200, data);
    } catch (e) {
        send(res, e.status || 500, { error: e.status ? e.message : '시세를 가져오지 못했습니다.' });
    }
};

function send(res, status, body) {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(body));
}
