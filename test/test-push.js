
const client = require("client");
const clientVersions = require("versions");
const VersionStore = require("versions").VersionStore;
const server = require("server");
const serverVersions = require("server-versions");
const L = require("logger");
const pcrypto = require("picl-crypto");
const LoopbackTransport = require("transport-loopback").LoopbackTransport;
const resolve = require("sdk/core/promise").resolve;

function createVersionWith(clientVersionStore, serverVersionStore, seqnum, keys) {
    var clientVersion, serverVersion, nv;

    nv = new clientVersions._for_tests.NewVersion({store: clientVersionStore,
                                                   key: "AES key",
                                                   seqnum: seqnum,
                                                   expectedVerhash: null});
    Object.keys(keys).forEach(function(key) {
        nv.setKV(keys[key]);
    });
    clientVersion = nv.close();
    if (clientVersionStore)
        clientVersionStore._addVersion(clientVersion);

    nv = new serverVersions._for_tests.NewVersion(
        {store: serverVersionStore,
         seqnum: seqnum,
         signedVerhash: clientVersion.getSignedVerhash()});
    clientVersion.iterKEVs().forEach(function(key_and_EV) {
        nv.setKEV(key_and_EV[0], key_and_EV[1]);
    });
    serverVersion = nv.close();
    if (serverVersionStore) {
        serverVersionStore._addVersion(serverVersion);
    }
    return {client: clientVersion, server: serverVersion};
}

exports["test basics"] = function(assert, done) {
    // server
    var s = new server.Server();
    var transport = new LoopbackTransport(s);
    var s_vs = new serverVersions.VersionStore("db"); // dummy

    L.log("early");
    // client
    var c_vs = new VersionStore("key", "db");

    var vers1 = createVersionWith(s_vs, c_vs, 1,
                                  { key1: "value1",
                                    key2: "value2",
                                    key3: "value3" });
    var v1 = vers1.client;
    var vers2 = createVersionWith(s_vs, c_vs, 2,
                                  { key1: "value1a",
                                    key3: "value3",
                                    key4: "value4" });
    var v2 = vers2.client;
    var vers2b = createVersionWith(s_vs, c_vs, 2,
                                   { key1: "value1b",
                                     key2: "value2",
                                     key3: "value3" });
    var v2b = vers2b.client;
    L.log("less early");
    resolve(null)
        .then(function() {
            L.log("starting");
            return client.push(v1, null, transport);
        })
        .then(function(ret) {
            L.log("push null->v1 done");
            L.log(ret);
            assert.equal(ret.type, "success");
            assert.equal(ret.serverVersion, v1.getSignedVerhash());
            return client.push(v2, v1, transport);
        })
        .then(function(ret) {
            L.log("push v1->v2 done");
            assert.equal(ret.type, "success");
            assert.equal(ret.serverVersion, v2.getSignedVerhash());
            // now trying to push v1->v2b should fail: this represents the
            // loser of a race condition
            return client.push(v2b, v1, transport);
        })
        .then(function(ret) {
            L.log("push v1->v2b done (should fail)");
            L.log(ret);
            assert.equal(ret.type, "out-of-date");
            assert.equal(ret.serverVersion, v2.getSignedVerhash());
        })
        .then(function(){assert.ok("yay success");},
              function(err) {L.log("err", err); assert.fail(err);})
        .then(done);
    L.log("late");
};

require("sdk/test").run(exports);
