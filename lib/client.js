const L = require("logger");
const {push, pull} = require("transfer-client");
const VersionStore = require("client-versions").VersionStore;


function fetchNewServerVersion(serverSignedVerhash, c) {
    // update our view of the server
    pull(serverSignedVerhash, c.serverVersion_C, c.store, c.transport)
        .then(function(ret) {
            if (ret.type !== "success")
                throw new Error("error1432");
            return ret.newVersion;
        })
        .then(function(theirs) {
            c.serverVersion_C = theirs;
            // feed to merge(), which may or may not return a promise
            return c.merge(c.baseVersion_B, c.myVersion_A,
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
            L.log(c.name, "applying results of merge", merged.getAllKVs());
            c.local.setAnyways(merged.getAllKVs(),
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

function local_changed(c, newval) {
    L.log("local_changed", c.name);
    var old = c.myVersion_A && c.myVersion_A.getAllKVs();
    L.log("from", old, "to", newval);
    if (old && JSON.stringify(newval) === JSON.stringify(old)) {
        // TODO: not necessarily stable comparison
        L.log("inbound "+c.name+" doesn't change anything");
        return;
    }
    newval = newval || {};
    // now trigger push
    var nv;
    if (c.myVersion_A)
        nv = c.myVersion_A.createNextVersion();
    else
        nv = c.store.createFirstVersion();
    nv.setAllKVs(newval); // adapter: native->local
    // note: setAllKVs() avoids changing identical records
    c.myVersion_A = nv.close();
    push(c.myVersion_A, c.serverVersion_C, c.transport)
        .then(function(ret) {
            // check for success
            L.log("client", c.name, "pushed", ret.type);
            if (ret.type === "success") {
                L.log("assert", ret.serverVersion === c.myVersion_A.getSignedVerhash());
                c.serverVersion_C = c.baseVersion_B = c.myVersion_A;
                // notify other clients
                c.broadcast.set(ret.serverVersion); // signedVerhash
            } else {
                L.log("client push failed", ret);
                if (ret.type === "out-of-date") {
                    fetchNewServerVersion(ret.serverVersion, c);
                    // when that finishes updating our view of the
                    // server, it will merge, then update our native
                    // dataset, which will trigger another push attempt
                }
            }
        });
}


function notify(c, newSignedVerhash) {
    L.log("notify", c.name);
    L.log(" newSignedVerhash is", newSignedVerhash);
    if (c.serverVersion_C &&
        (newSignedVerhash === c.serverVersion_C.getSignedVerhash())) {
        L.log("notify "+c.name+" doesn't change anything");
        return;
    }
    if (!newSignedVerhash)
        return;
    // now pull
    L.log(" starting pull");
    pull(newSignedVerhash, c.serverVersion_C, c.store, c.transport)
        .then(function(ret) {
            L.log("client", c.name, "pulled", ret.type,
                  ret.newVersion.getSignedVerhash());
            if (ret.type == "success") {
                var newver = ret.newVersion;
                c.serverVersion_C = newver;
                // now try to apply to native
                function applied(err, dummy) {
                    if (err) {
                        L.log("err931", err);
                        return;
                    }
                    // TODO: use test-and-set, handle test-fails
                    c.baseVersion_B = c.myVersion_A = newver;
                }
                // adapter: local->native
                c.local.setAnyways(newver.getAllKVs(), applied);
            } else {
                L.log("EEK, client pull failed");
            }
        });
}

function setup(c, enckey, signkey) {
    L.log("setup", c.name);
    c.store = new VersionStore(enckey, signkey, "db");
    c.myVersion_A = null;
    c.baseVersion_B = null;
    c.serverVersion_C = null;

    L.log("setting up localdb.on");
    c.local.onChange(function(val) {
        try{local_changed(c, val);}
        catch (e) {L.log("error in local_changed", e, ""+e);}
    });

    c.broadcast.onChange(function(newSignedVerhash) {
        notify(c, newSignedVerhash);
    });

}

exports.setup = setup;
