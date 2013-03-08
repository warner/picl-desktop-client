
const resolve = require("sdk/core/promise").resolve;
const L = require("logger");

function LoopbackTransport(server) {
    this._server = server;
}

LoopbackTransport.prototype.send = function(msg) {
    L.log("send", msg);
    return resolve(msg)
        .then(this._server.messageReceived)
        .then(function(resp) {
            L.log(" response", resp);
            return resp;
        }, function(err) {L.log(" resp error", err); throw err;});
};

exports.LoopbackTransport = LoopbackTransport;
