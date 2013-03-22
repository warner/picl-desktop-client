
const {defer, resolve} = require("sdk/core/promise");
const L = require("logger");
const url = require("url");
const http = require("http");

function HTTPTransport(url) {
    this._url = url;
}

HTTPTransport.prototype.send = function(msg) {
    L.log("send", msg);
    var d = defer();
    var p = url.parse(this._url);
    function handleResponse(res) {
        if (res.statusCode !== 200) {
            d.reject(res);
        }
        var body = "";
        res.on("data", function(chunk) { body += chunk;});
        res.on("end", function() {
            d.resolve(JSON.parse(body));
        });
        // ugh, error-handling
    }
    var req = http.request({
        method: "POST",
        host: p.host,
        port: p.port,
        path: p.path,
        agent: false
    }, handleResponse);
    req.write(JSON.stringify(msg));
    req.end();
    return d.promise;
};

exports.HTTPTransport = HTTPTransport;
