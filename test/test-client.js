
const client = require("client");
const server = require("server");
const serverVersions = require("server-versions");
const L = require("logger");
const pcrypto = require("picl-crypto");
const LoopbackTransport = require("transport-loopback").LoopbackTransport;
const resolve = require("sdk/core/promise").resolve;

function merge(base, mine, theirs) {
    // gets three Version objects. Is expected to return a Promise for a new
    // closed Version object, derived from 'theirs', with a meaningful
    // combination of both 'mine' and 'theirs'. It's also ok to just return
    // 'theirs'.

    return resolve(theirs);
}

exports["test client"] = function(assert, done) {
    // server
    var s = new server.Server();
    var transport = new LoopbackTransport(s);
    var s_vs = new serverVersions.VersionStore("db"); // dummy

    var enckey = pcrypto.hashKey("enc");
    var signkey = pcrypto.hashKey("sign");

    var local = {
        calls: new Array(),
        onChange: function(cb) {this.onChangeCB=cb;},
        setAnyways: function(data, after) {this.calls.push([data,after]);},
        setIfStill: function(oldVersion, newVersion, data, after) {
            throw new Error("not implemented yet");
        }
    };
    var broadcast = {
        calls: new Array(),
        onChange: function(cb) {this.onChangeCB=cb;},
        set: function(data) {this.calls.push(data);}
    };

    var client_A = {name: "A",
                    local: local,
                    broadcast: broadcast,
                    transport: transport,
                    merge: merge};
    client.setup(client_A, enckey, signkey);
    L.log(local.calls);
    assert.equal(local.calls.length, 0);
    local.onChangeCB({key: "value"});
    L.log(local.calls);
    L.log(broadcast.calls);

    assert.ok("ok");
    done();
};


require("sdk/test").run(exports);
