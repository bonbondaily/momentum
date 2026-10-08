// 일봉 RSI 계산 / 신호 판단 / 백테스트
(function (root) {
    // Wilder 방식 RSI. 앞쪽 period개 값은 null
    function calcRSI(closes, period) {
        period = period || 14;
        var out = new Array(closes.length).fill(null);
        if (closes.length <= period) return out;

        var gain = 0, loss = 0;
        for (var i = 1; i <= period; i++) {
            var d = closes[i] - closes[i - 1];
            if (d >= 0) gain += d; else loss -= d;
        }
        var avgGain = gain / period, avgLoss = loss / period;
        out[period] = toRSI(avgGain, avgLoss);

        for (var j = period + 1; j < closes.length; j++) {
            var diff = closes[j] - closes[j - 1];
            avgGain = (avgGain * (period - 1) + Math.max(diff, 0)) / period;
            avgLoss = (avgLoss * (period - 1) + Math.max(-diff, 0)) / period;
            out[j] = toRSI(avgGain, avgLoss);
        }
        return out;
    }

    function toRSI(avgGain, avgLoss) {
        if (avgLoss === 0) return avgGain === 0 ? 50 : 100;
        return 100 - 100 / (1 + avgGain / avgLoss);
    }

    // 현재 RSI 와 직전 RSI 로 매수/매도/관망 판단
    function judge(rsi, prevRsi, buyLevel, sellLevel) {
        if (rsi == null) return { action: 'NONE', label: '데이터 부족', detail: 'RSI를 계산하기에 일봉 데이터가 부족합니다.' };

        if (prevRsi != null && prevRsi < buyLevel && rsi >= buyLevel) {
            return { action: 'BUY', label: '매수', strong: true, detail: 'RSI가 과매도 구간(' + buyLevel + ')을 상향 돌파했습니다. 반등 시작 신호입니다.' };
        }
        if (rsi < buyLevel) {
            return { action: 'BUY', label: '매수 관심', detail: 'RSI ' + buyLevel + ' 미만 과매도 구간입니다. 분할 매수를 고려할 수 있습니다.' };
        }
        if (prevRsi != null && prevRsi > sellLevel && rsi <= sellLevel) {
            return { action: 'SELL', label: '매도', strong: true, detail: 'RSI가 과매수 구간(' + sellLevel + ')을 하향 이탈했습니다. 하락 전환 신호입니다.' };
        }
        if (rsi > sellLevel) {
            return { action: 'SELL', label: '매도 관심', detail: 'RSI ' + sellLevel + ' 초과 과매수 구간입니다. 분할 매도(차익 실현)를 고려할 수 있습니다.' };
        }
        return { action: 'HOLD', label: '관망', detail: 'RSI가 ' + buyLevel + '~' + sellLevel + ' 중립 구간에 있습니다.' };
    }

    // 백테스트: RSI가 매수 기준을 상향 돌파하면 종가 매수, 매도 기준을 하향 이탈하면 종가 매도 (판단 규칙과 동일)
    // feePct 는 왕복 수수료·세금 합계(%)
    function backtest(candles, rsi, buyLevel, sellLevel, feePct) {
        var fee = (feePct || 0) / 100;
        var trades = [], signals = [];
        var position = null, equity = 1;

        for (var i = 1; i < candles.length; i++) {
            if (rsi[i] == null || rsi[i - 1] == null) continue;
            var c = candles[i];
            if (!position && rsi[i - 1] < buyLevel && rsi[i] >= buyLevel) {
                position = { entryIndex: i, entryDate: c.date, entryPrice: c.close };
                signals.push({ index: i, type: 'BUY' });
            } else if (position && rsi[i - 1] > sellLevel && rsi[i] <= sellLevel) {
                var ret = (c.close / position.entryPrice) * (1 - fee) - 1;
                equity *= 1 + ret;
                trades.push({
                    entryDate: position.entryDate, entryPrice: position.entryPrice,
                    exitDate: c.date, exitPrice: c.close,
                    days: i - position.entryIndex, ret: ret, open: false
                });
                signals.push({ index: i, type: 'SELL' });
                position = null;
            }
        }

        var last = candles[candles.length - 1];
        var openTrade = null;
        if (position) {
            var openRet = (last.close / position.entryPrice) * (1 - fee) - 1;
            openTrade = {
                entryDate: position.entryDate, entryPrice: position.entryPrice,
                exitDate: last.date, exitPrice: last.close,
                days: candles.length - 1 - position.entryIndex, ret: openRet, open: true
            };
        }

        var wins = trades.filter(function (t) { return t.ret > 0; }).length;
        var firstIdx = rsi.findIndex(function (v) { return v != null; });
        var buyHold = firstIdx >= 0 ? last.close / candles[firstIdx].close - 1 : 0;

        return {
            trades: trades,
            openTrade: openTrade,
            signals: signals,
            totalReturn: equity * (openTrade ? 1 + openTrade.ret : 1) - 1,
            closedReturn: equity - 1,
            winRate: trades.length ? wins / trades.length : null,
            buyHold: buyHold
        };
    }

    var api = { calcRSI: calcRSI, judge: judge, backtest: backtest };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.RSI = api;
})(this);
