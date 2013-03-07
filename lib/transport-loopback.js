
function LoopbackTransport(server) {
    this._server = server;
}

LoopbackTransport.prototype.send = function(msg) {
    this._server.messageReceived(msg);
};

exports.LoopbackTransport = LoopbackTransport;
