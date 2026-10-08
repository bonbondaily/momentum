// Yahoo Finance 일봉 조회 / 종목 검색 (서버 전용: 브라우저에서는 CORS 때문에 직접 호출 불가)
var STOCKS = require('./stocks');

var BASE = process.env.YAHOO_BASE || 'https://query1.finance.yahoo.com';
var SEARCH_BASE = process.env.YAHOO_SEARCH_BASE || 'https://query2.finance.yahoo.com';
var HEADERS = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36' };
var CACHE_MS = 5 * 60 * 1000;
var cache = new Map();

var BY_SYMBOL = {};
STOCKS.forEach(function (s) { BY_SYMBOL[s.symbol] = s; });

function httpError(status, message) {
    var e = new Error(message);
    e.status = status;
    return e;
}

async function fetchChart(symbol) {
    var url = BASE + '/v8/finance/chart/' + encodeURIComponent(symbol) + '?range=2y&interval=1d&includePrePost=false';
    var res = await fetch(url, { headers: HEADERS });
    if (res.status === 404) return null;
    if (!res.ok) throw httpError(502, '시세 서버 응답 오류 (' + res.status + ')');
    var json = await res.json();
    var r = json.chart && json.chart.result && json.chart.result[0];
    if (!r || !r.timestamp) return null;

    var q = r.indicators.quote[0];
    var offset = (r.meta.gmtoffset || 0) * 1000;
    var candles = [];
    for (var i = 0; i < r.timestamp.length; i++) {
        if (q.close[i] == null) continue; // 거래정지 등 빈 봉
        candles.push({
            date: new Date(r.timestamp[i] * 1000 + offset).toISOString().slice(0, 10),
            open: q.open[i], high: q.high[i], low: q.low[i], close: q.close[i], volume: q.volume[i] || 0
        });
    }
    if (!candles.length) return null;

    var known = BY_SYMBOL[r.meta.symbol];
    return {
        symbol: r.meta.symbol,
        name: known ? known.name : (r.meta.shortName || r.meta.longName || r.meta.symbol),
        market: known ? known.market : (r.meta.fullExchangeName || r.meta.exchangeName || ''),
        currency: r.meta.currency,
        // 장중이면 마지막 봉은 아직 확정되지 않은 봉
        lastClosed: !(r.meta.currentTradingPeriod && r.meta.currentTradingPeriod.regular &&
            Date.now() / 1000 < r.meta.currentTradingPeriod.regular.end &&
            Date.now() / 1000 >= r.meta.currentTradingPeriod.regular.start),
        candles: candles
    };
}

// 6자리 숫자 코드는 코스피(.KS) → 코스닥(.KQ) 순으로 시도
async function getChart(input) {
    var symbol = String(input || '').trim().toUpperCase();
    if (!/^[A-Z0-9.\-^=]{1,20}$/.test(symbol)) throw httpError(400, '종목 코드 형식이 올바르지 않습니다.');

    var hit = cache.get(symbol);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.data;

    var tries = /^\d{6}$/.test(symbol) ? [symbol + '.KS', symbol + '.KQ'] : [symbol];
    var data = null;
    for (var i = 0; i < tries.length && !data; i++) data = await fetchChart(tries[i]);
    if (!data) throw httpError(404, '종목을 찾을 수 없습니다: ' + symbol);

    cache.set(symbol, { at: Date.now(), data: data });
    return data;
}

async function search(q) {
    q = String(q || '').trim();
    if (!q) return [];
    var lower = q.toLowerCase();
    var local = STOCKS.filter(function (s) {
        return s.name.toLowerCase().indexOf(lower) >= 0 || s.symbol.toLowerCase().indexOf(lower) === 0;
    });

    var remote = [];
    // 한글 검색은 Yahoo 가 지원하지 않으므로 로컬 목록만 사용
    if (!/[가-힣]/.test(q)) {
        try {
            var res = await fetch(SEARCH_BASE + '/v1/finance/search?q=' + encodeURIComponent(q) + '&quotesCount=8&newsCount=0&listsCount=0', { headers: HEADERS });
            if (res.ok) {
                var json = await res.json();
                remote = (json.quotes || []).filter(function (x) {
                    return x.symbol && (x.quoteType === 'EQUITY' || x.quoteType === 'ETF');
                }).map(function (x) {
                    var known = BY_SYMBOL[x.symbol];
                    return { symbol: x.symbol, name: known ? known.name : (x.shortname || x.longname || x.symbol), market: known ? known.market : (x.exchDisp || '') };
                });
            }
        } catch (e) { /* 검색 실패 시 로컬 결과만 */ }
    }

    var seen = {};
    return local.concat(remote).filter(function (s) {
        if (seen[s.symbol]) return false;
        return (seen[s.symbol] = true);
    }).slice(0, 10);
}

module.exports = { getChart: getChart, search: search };
