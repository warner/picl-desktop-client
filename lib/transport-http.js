
const {defer, resolve} = require("sdk/core/promise");
const L = require("logger");
const url = require("url");
const Request = require("sdk/request").Request;

function HTTPTransport(url) {
    this._url = url;
}

HTTPTransport.prototype.send = function(msg) {
    L.log("    send", msg);
    var d = defer();
    function handleResponse(res) {
        if (res.status !== 200) {
            d.reject(res);
        } else {
            d.resolve(res.json);
        }
        // ugh, error-handling
    }
    var req = Request({
        url: this._url,
        contentType: "application/json",
        content: JSON.stringify(msg),
        onComplete: handleResponse
    }).post();
    return d.promise;
};

exports.HTTPTransport = HTTPTransport;
