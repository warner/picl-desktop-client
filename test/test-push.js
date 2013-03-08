
const client = require("client");
const VersionStore = require("versions").VersionStore;
const server = require("server");
const L = require("logger");
const pcrypto = require("picl-crypto");
const LoopbackTransport = require("transport-loopback").LoopbackTransport;
const resolve = require("sdk/core/promise").resolve;


exports["test basics"] = function(assert, done) {
    // server
    var s = new server.Server();
    var transport = new LoopbackTransport(s);

    L.log("early");
    // client
    var c_vs = new VersionStore("key", "db");
    var nv1 = c_vs.createFirstVersion();
    nv1.setKV("key1", "value1");
    nv1.setKV("key2", "value2");
    nv1.setKV("key3", "value3");
    var v1 = nv1.close();
    L.log("less early");
    resolve(null)
        .then(function() {
            L.log("starting");
            return client.push(v1, null, transport);
        })
        .then(function() {
            L.log("push null->v1 done");
            var nv2 = v1.createNextVersion();
            nv2.setKV("key1", "value1a");
            nv2.deleteKey("key2");
            nv2.setKV("key4", "value4");
            var v2 = nv2.close();
            return client.push(v2, v1, transport);
        })
        .then(function() {
            L.log("push v1->v2 done");
            assert.ok("yay success");
        }, function(err) {
            L.log("err", err);
            throw err;
        })
        .then(function(){}, function(err) {assert.fail(err);})
        .then(done);
    L.log("late");
};

require("sdk/test").run(exports);
