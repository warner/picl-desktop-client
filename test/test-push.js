
const client = require("versions");
const VersionStore = require("versions").VersionStore;
const server = require("server-versions");
const L = require("logger");
const pcrypto = require("picl-crypto");
const LoopbackTransport = require("transport-loopback").LoopbackTransport;


exports["test basics"] = function(assert, done) {
    // server
    var s = server.Server();
    var transport = LoopbackTransport(server);

    client.push(v2, v1, transport)
        .then();
};

require("sdk/test").run(exports);
