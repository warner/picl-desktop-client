
const client = require("client");
const server = require("server");
const serverVersions = require("server-versions");
const L = require("logger");
const pcrypto = require("picl-crypto");
const LoopbackTransport = require("transport-loopback").LoopbackTransport;

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

function clear(arr) {
    arr.splice(0, arr.length);
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
        return theirs;
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

    // set the initial data
    const KV1 = {key: "value"};
    local_A.onChangeCB(KV1);
    assert.equal(local_A.calls.length, 0);
    assert.equal(broadcast_A.calls.length, 1);
    var v1 = broadcast_A.calls[0];
    clear(broadcast_A.calls);
    assert.equal(v1, client_A.myVersion_A.getSignedVerhash());
    assert.equal(pcrypto.extractVerhash(v1).seqnum, 1);

    // deliver that first broadcast. Nothing should change.
    broadcast_A.onChangeCB(v1);
    assert.equal(local_A.calls.length, 0);
    assert.equal(broadcast_A.calls.length, 0);

    const KV2 = {key: "value2"};
    local_A.onChangeCB(KV2);
    assert.equal(local_A.calls.length, 0);
    assert.equal(broadcast_A.calls.length, 1);
    var v2 = broadcast_A.calls[0];
    clear(broadcast_A.calls);
    assert.equal(v2, client_A.myVersion_A.getSignedVerhash());
    assert.equal(pcrypto.extractVerhash(v2).seqnum, 2);

    // deliver the second broadcast. Nothing should change.
    broadcast_A.onChangeCB(v2);
    assert.equal(local_A.calls.length, 0);
    assert.equal(broadcast_A.calls.length, 0);

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

    // TODO: a form in which B hears about the server version before it hears
    // about its ill-fated attempt to set the initial version. This form
    // makes (and fails) the initial set before it hears the broadcast of A.

    // B encounters an existing server value, and our merge function clobbers
    // the old data
    const KVB = {key: "valueB"};
    local_B.onChangeCB(KVB);
    assert.equal(broadcast_B.calls.length, 0);
    assert.equal(local_B.calls.length, 1);
    assert.deepEqual(local_B.calls[0][0], KV2);
    var cb = local_B.calls[0][1];
    clear(local_B.calls);
    assert.equal(merges.length, 1);
    assert.equal(merges[0].theirs.getSignedVerhash(), v2);
    clear(merges);

    // ack the local change, which updates B to match the "merged" (i.e.
    // clobbered) version.
    cb(null, "dummy");
    assert.equal(broadcast_B.calls.length, 0);
    assert.equal(local_B.calls.length, 0);

    // Now reflect back the local change. Because this matches the current
    // server version, this should not propagate any further.
    L.log("B accepts clobber");
    local_B.onChangeCB(KV2);
    assert.equal(local_B.calls.length, 0);
    assert.equal(broadcast_B.calls.length, 0);

    // now B hears about the broadcast of A's v2. Nothing should change.
    broadcast_B.onChangeCB(v2);
    assert.equal(local_B.calls.length, 0);
    assert.equal(broadcast_B.calls.length, 0);

    // both A and B are at KV2. Move A to KV3 and make sure B catches up
    const KV3 = {key: "value3", key2: "value4"};
    local_A.onChangeCB(KV3);
    assert.equal(local_A.calls.length, 0);
    assert.equal(broadcast_A.calls.length, 1);
    var v3 = broadcast_A.calls[0];
    clear(broadcast_A.calls);
    assert.equal(pcrypto.extractVerhash(v3).seqnum, 3);
    // A hears back its own broadcast, nothing changes
    broadcast_A.onChangeCB(v3);
    assert.equal(local_A.calls.length, 0);
    assert.equal(broadcast_A.calls.length, 0);
    // B hears about the broadcast
    broadcast_B.onChangeCB(v3);
    L.log("A", local_A.calls);
    L.log(broadcast_A.calls);
    L.log("B", local_B.calls);
    L.log(broadcast_B.calls);
    assert.equal(local_B.calls.length, 1);
    assert.equal(broadcast_B.calls.length, 0);
    assert.deepEqual(local_B.calls[0][0], KV3);
    cb = local_B.calls[0][1];
    clear(local_B.calls);
    // ack B's set
    cb(null, "dummy");
    assert.equal(local_B.calls.length, 0);
    assert.equal(broadcast_B.calls.length, 0);
    // reflect B's set
    local_B.onChangeCB(KV3);
    assert.equal(local_B.calls.length, 0);
    assert.equal(broadcast_B.calls.length, 0);

    done();
};


require("sdk/test").run(exports);
