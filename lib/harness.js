const L = require("logger");
const client = require("transfer-client");
const pcrypto = require("picl-crypto");
const VersionStore = require("client-versions").VersionStore;
const Firebase = require("./firebase-jetpack").Firebase;
const timers = require("sdk/timers");
const resolve = require("sdk/core/promise").resolve;

var broadcast;
const BASEURL = "https://myfx-tabthing.firebaseio.com/deltathing/";
function setup_broadcast() {
    broadcast = new Firebase(BASEURL+"broadcast");
}

var clients = {};

var signkey = pcrypto.hashKey("sign");
var enckey = pcrypto.hashKey("enc");

function merge(base, mine, theirs) {
    // gets three Version objects. Is expected to return a Promise for a new
    // closed Version object, derived from 'theirs', with a meaningful
    // combination of both 'mine' and 'theirs'. It's also ok to just return
    // 'theirs'.

    return resolve(theirs);
}

function setup_one(name, transport) {
    L.log("setup", name);
    var store = new VersionStore(enckey, signkey, "db");
    var c = clients[name] = {data: {},
                             store: store,
                             myVersion_A: null,
                             baseVersion_B: null,
                             serverVersion_C: null
                            };
    var localdb = new Firebase(BASEURL+name);

    function fetchNewServerVersion(serverSignedVerhash) {
        // update our view of the server
        client.pull(serverSignedVerhash, c.serverVersion_C, c.store, transport)
            .then(function(ret) {
                if (ret.type !== "success")
                    throw new Error("error1432");
                return ret.newVersion;
            })
            .then(function(theirs) {
                c.serverVersion_C = theirs;
                // feed to merge()
                return merge(c.baseVersion_B, c.myVersion_A,
                             c.serverVersion_C);
            })
            .then(function(merged) {
                // update native dataset with merged, if it changed
                if (merged.getVerhash() === c.myVersion_A.getVerhash()) {
                    L.log("merging was nop");
                    return;
                }
                // TODO: make this a transaction and handle failure
                // TODO: build this with a Deferred instead
                localdb.set(merged.getAllKVs(),
                            function(error, dummy) {
                                if (error) {
                                    L.log("error setting A", error);
                                    return;
                                }
                                L.log("applied merged A");
                                c.myVersion_A = merged;
                                c.baseVersion_B = c.serverVersion_C;
                                // assume this will also trigger
                                // local_changed(), which will try to push
                                // again. TODO: it's important that we set A
                                // and B before local_changed() fires. Note
                                // sure how to get this guarantee out of the
                                // Firebase code.
                            });
            });
    }

    function local_changed(ss) {
        L.log("local_changed", name);
        var newval = ss.val();
        L.log("client", name, "local change to", newval);
        if (JSON.stringify(newval) === JSON.stringify(c.data)) {
            L.log("inbound "+name+" doesn't change anything");
            return;
        }
        c.data = newval || {};
        // now trigger push
        var nv;
        if (c.myVersion_A)
            nv = c.myVersion_A.createNextVersion();
        else
            nv = c.store.createFirstVersion();
        nv.setAllKVs(c.data); // adapter: native->local
        c.myVersion_A = nv.close();
        client.push(c.myVersion_A, c.serverVersion_C, transport)
            .then(function(ret) {
                // check for success
                L.log("client", name, "pushed", ret.type);
                if (ret.type === "success") {
                    L.log("assert", ret.serverVersion === c.myVersion_A.getSignedVerhash());
                    c.serverVersion_C = c.baseVersion_B = c.myVersion_A;
                    // notify other clients
                    broadcast.set(ret.serverVersion); // signedVerhash
                } else {
                    L.log("client push failed", ret);
                    if (ret.type === "out-of-date") {
                        fetchNewServerVersion(ret.serverVersion);
                        // when that finishes updating our view of the
                        // server, it will merge, then update our native
                        // dataset, which will trigger another push attempt
                    }
                }
            });
    }

    L.log("setting initial data");
    localdb.set({key: "data"}, function(error, dummy) {
        L.log(" initial set done for", name, error);
        timers.setTimeout(function() {
            L.log("setting up localdb.on");
            localdb.on("value", function(ss) {
                try{local_changed(ss);}
                catch (e) {L.log("error in local_changed", e, ""+e);}
            });
        }, 1000);
    });
    L.log(" set complete");

    function notify(ss) {
        L.log("notify", name);
        var newSignedVerhash = ss.val();
        L.log(" newSignedVerhash is", newSignedVerhash);
        if (c.serverVersion_C &&
            (newSignedVerhash === c.serverVersion_C.getSignedVerhash())) {
            L.log("notify "+name+" doesn't change anything");
            return;
        }
        if (!newSignedVerhash)
            return;
        // now pull
        L.log(" starting pull");
        client.pull(newSignedVerhash, c.serverVersion_C, c.store, transport)
            .then(function(ret) {
                L.log("client", name, "pulled", ret.type,
                      ret.newVersion.getSignedVerhash());
                if (ret.type == "success") {
                    c.serverVersion_C = ret.newVersion;
                    // now try to apply to native
                    localdb.set(c.data, function(err, dummy) {
                        if (err) {
                            L.log("err931", err);
                            return;
                        }
                        c.baseVersion_B = c.myVersion_A = ret.newVersion;
                        c.data = c.myVersion_A.getAllKVs();
                    }); // adapter: local->native
                } else {
                    L.log("EEK, client pull failed");
                }
            });
    }
    broadcast.on("value", notify);

}

exports.setup = function(transport) {
    setup_broadcast();
    setup_one("A", transport);
    timers.setTimeout(function() {setup_one("B", transport);}, 2000);
};
