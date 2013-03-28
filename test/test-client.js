
const client = require("client");
const server = require("server");
const serverVersions = require("server-versions");
const L = require("logger");
const pcrypto = require("picl-crypto");
const LoopbackTransport = require("transport-loopback").LoopbackTransport;
const resolve = require("sdk/core/promise").resolve;

function makeLocal() {
    return {
        calls: new Array(),
        onChange: function(cb) {this.onChangeCB=cb;},
        setAnyways: function(data, after) {this.calls.push([data,after]);},
        setIfStill: function(oldVersion, newVersion, data, after) {
            throw new Error("not implemented yet");
        }
    };
}

function makeBroadcast() {
    return {
        calls: new Array(),
        onChange: function(cb) {this.onChangeCB=cb;},
        set: function(data) {this.calls.push(data);}
    };
}

exports["test client"] = function(assert, done) {
    // server
    var s = new server.Server();
    var transport = new LoopbackTransport(s);
    var s_vs = new serverVersions.VersionStore("db"); // dummy

    var enckey = pcrypto.hashKey("enc");
    var signkey = pcrypto.hashKey("sign");

    var merges = [];
    function merge(base, mine, theirs) {
        merges.push({base: base, mine: mine, theirs: theirs});
        return resolve(theirs);
    }

    var broadcast_A = makeBroadcast();
    var local_A = makeLocal();

    var client_A = {name: "A",
                    local: local_A,
                    broadcast: broadcast_A,
                    transport: transport,
                    merge: merge};
    client.setup(client_A, enckey, signkey);
    assert.equal(local_A.calls.length, 0);
    assert.equal(broadcast_A.calls.length, 0);

    local_A.onChangeCB({key: "value"});
    assert.equal(local_A.calls.length, 0);
    assert.equal(broadcast_A.calls.length, 1);
    var v1 = broadcast_A.calls[0];

    local_A.onChangeCB({key: "value2"});
    assert.equal(local_A.calls.length, 0);
    assert.equal(broadcast_A.calls.length, 2);
    var v2 = broadcast_A.calls[1];


    L.log("----- starting B ---");
    var broadcast_B = makeBroadcast();
    var local_B = makeLocal();
    var client_B = {name: "B",
                    local: local_B,
                    broadcast: broadcast_B,
                    transport: transport,
                    merge: merge};
    client.setup(client_B, enckey, signkey);
    assert.equal(local_B.calls.length, 0);
    assert.equal(broadcast_B.calls.length, 0);

    // B encounters an existing server value, and our merge function clobbers
    // the old data
    local_B.onChangeCB({key: "valueB"});
    L.log(local_B.calls);
    L.log(broadcast_B.calls);
    assert.equal(broadcast_B.calls.length, 0);
    assert.equal(local_B.calls.length, 1);
    assert.deepEqual(local_B.calls[0][0], {key: "value2"});
    assert.equal(merges.length, 1);
    assert.equal(merges[0].theirs.getSignedVerhash(), v2);

    assert.ok("ok");
    done();
};


require("sdk/test").run(exports);
