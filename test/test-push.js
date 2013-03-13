
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
        nv.setKV(key, keys[key]);
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

exports["test push"] = function(assert, done) {
    assert.ok("skip"); return done();
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

exports["test pull"] = function(assert, done) {
    //assert.ok("skip"); return done();
    var s = new server.Server();
    var s_vs = new serverVersions.VersionStore("db");
    var c_vs = new VersionStore("key", "db");
    var c_vs_dummy = new VersionStore("key", "db");
    var transport = new LoopbackTransport(s);

    L.log("early");
    var vers1 = createVersionWith(s._vs, c_vs_dummy, 1,
                                  { key1: "value1",
                                    key2: "value2",
                                    key3: "value3" });
    assert.equal(vers1.client.getSignedVerhash(),
                 vers1.server.getSignedVerhash());
    var vers2 = createVersionWith(s._vs, c_vs_dummy, 2,
                                  { key1: "value1a",
                                    key3: "value3",
                                    key4: "value4" });
    L.log("less early");
    s._cv.replaceVersion(vers1.server);
    assert.equal(s._cv.getCurrentVersion().getSignedVerhash(),
                 vers1.server.getSignedVerhash());
    resolve(null)
        .then(function() {
            L.log("starting");
            L.log("starting pull", vers1.server.getSignedVerhash());
            return client.pull(vers1.server.getSignedVerhash(), null,
                               c_vs, transport);
        })
        .then(function(ret) {
            L.log("pull null->v1 done");
            L.log(ret);
            assert.equal(ret.type, "success");
            var v1 = ret.newVersion;
            assert.equal(v1.getSignedVerhash(),
                         vers1.server.getSignedVerhash());
            assert.deepEqual(v1.iterKEVs(), vers1.server.iterKEVs());
            assert.deepEqual(v1.iterKVs(), vers1.client.iterKVs());
            return client.pull(vers2.server.getSignedVerhash(), v1,
                               c_vs, transport);
        })
        .then(function(ret) {
            L.log("pull v1->v2 done");
            assert.equal(ret.type, "success");
            var v2 = ret.newVersion;
            assert.equal(v2.getSignedVerhash(),
                         vers1.server.getSignedVerhash());
            assert.deepEqual(v2.iterKEVs(), vers1.server.iterKEVs());
            assert.deepEqual(v2.iterKVs(), vers1.client.iterKVs());

            // now make sure we can fetch a full copy of v2
            return client.pull(vers2.server.getSignedVerhash(), null,
                               c_vs, transport);
        })
        .then(function(ret) {
            L.log("pull null->v2 done");
            assert.equal(ret.type, "success");
            var v2 = ret.newVersion;
            assert.equal(v2.getSignedVerhash(),
                         vers1.server.getSignedVerhash());
            assert.deepEqual(v2.iterKEVs(), vers1.server.iterKEVs());
            assert.deepEqual(v2.iterKVs(), vers1.client.iterKVs());

            // asking for a delta they don't have should.. do something
            // TODO
        })
        .then(function(){assert.ok("yay success");},
              function(err) {L.log("err", err); L.log(""+err); assert.fail(err);})
        .then(done);
    L.log("late");
};


require("sdk/test").run(exports);
