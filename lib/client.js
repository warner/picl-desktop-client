const L = require("logger");
const {push, pull} = require("transfer-client");
const VersionStore = require("client-versions").VersionStore;
const defer = require("sdk/core/promise").defer;

function triggerInitialSyncDone(c) {
    if (c.whenInitialSyncDone) {
        L.log("INITsync here"); // do we still need this case?
        c.whenInitialSyncDone.resolve();
        delete c.whenInitialSyncDone;
    }
}

function fetchNewServerVersion(serverSignedVerhash, c) {
    // update our view of the server
    L.log(c.name,"fetchNewServerVersion");
    pull(serverSignedVerhash, c.serverVersion_C, c.store, c.transport)
        .then(function(ret) {
            L.log(" fetched NewServerVersion");
            if (ret.type !== "success")
                throw new Error("error1432");
            return ret.newVersion;
        })
        .then(function(theirs) {
            c.serverVersion_C = theirs;
            // feed to merge(), which may or may not return a promise
            L.log(" merging");
            return c.merge(c.baseVersion_B, c.myVersion_A,
                           c.serverVersion_C);
        })
        .then(function(merged) {
            // update native dataset with merged, if it changed
            if (merged.getVerhash() === c.myVersion_A.getVerhash()) {
                L.log(" merging was nop");
                return;
            }
            // TODO: make this a transaction and handle failure
            L.log(" applying results of merge", merged.getAllKVs());
            var newKVs = merged.getAllKVs();
            c._applyingToNative = { KVs: newKVs,
                                    newA: merged,
                                    newB:c.serverVersion_C };
            c.local.setAnyways(newKVs);
            // that doesn't notify us if nothing changes
            L.log(" application sent");
        })
        .then(null, function(err) {L.log("err", err, err+"");});
}

var counter = 0;
function nextCounter() {
    counter += 1;
    return counter;
}

function local_changed(c, newval) {
    L.log("local_changed", c.name);
    if (c._applyingToNative) {
        if (JSON.stringify(newval) === JSON.stringify(c._applyingToNative.KVs)) {
            // we initiated this application. It's done now.
            L.log(" our inbound change has been applied, done");
            c.myVersion_A = c._applyingToNative.newA;
            c.baseVersion_B = c._applyingToNative.newB;
            delete c._applyingToNative;
            triggerInitialSyncDone(c);
            // if we're here from notify(), we're just hearing about our
            // local set, and we can stop. If we get here from
            // fetchNewServerVersion(), we set a merged version, so we must
            // keep going and push the merge results to the server.
            if (c.myVersion_A.getVerhash() === c.baseVersion_B.getVerhash())
                return;
        } else {
            L.log(" UHOH, we attempted to make a local change, and something else happened");
            // consider deleting c._applyingToNative now
        }
    }
    var old = c.myVersion_A && c.myVersion_A.getAllKVs();
    L.log(" from", old, "to", newval);
    // for the initial sync, old==null, and newval!=null
    if (old && JSON.stringify(newval) === JSON.stringify(old)) {
        // TODO: not necessarily stable comparison
        L.log(" inbound "+c.name+" doesn't change anything");
        return;
    }
    if (!newval) {
        L.log(" newval is null, ignoring");
        return;
    }

    // now trigger push
    var count = nextCounter();
    L.log(" client",c.name,"starting push", count);
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
            L.log("client", c.name, "pushed", count, ret.type);
            if (ret.type === "success") {
                L.log("assert", ret.serverVersion === c.myVersion_A.getSignedVerhash());
                c.serverVersion_C = c.baseVersion_B = c.myVersion_A;
                // notify other clients
                c.broadcast.set(ret.serverVersion); // signedVerhash
                triggerInitialSyncDone(c);
            } else {
                L.log("client push failed", ret);
                if (ret.type === "out-of-date") {
                    fetchNewServerVersion(ret.serverVersion, c);
                    // when that finishes updating our view of the
                    // server, it will merge, then update our native
                    // dataset, which will trigger another push attempt
                }
            }
        })
        .then(null, function(err) {L.log("err", err, err+"");});
}

function notify(c, newSignedVerhash) {
    L.log("notify", c.name);
    L.log(" newSignedVerhash is", newSignedVerhash);
    if (c.serverVersion_C &&
        (newSignedVerhash === c.serverVersion_C.getSignedVerhash())) {
        L.log(" notify "+c.name+" doesn't change anything");
        return;
    }
    if (!newSignedVerhash) {
        L.log(" notify is null, ignoring");
        return;
    }
    // now pull
    var count = nextCounter();
    L.log(" starting pull", count);
    pull(newSignedVerhash, c.serverVersion_C, c.store, c.transport)
        .then(function(ret) {
            L.log("client", c.name, "pulled", ret.type,
                  ret.newVersion.getSignedVerhash());
            if (ret.type == "success") {
                var newver = ret.newVersion;
                c.serverVersion_C = newver;
                var newKVs = newver.getAllKVs();
                // now try to apply to native. We signal local_changed() that
                // we're the one who initiated this change.
                c._applyingToNative = {KVs: newKVs, newA: newver, newB: newver};
                // TODO: use test-and-set, handle test-fails
                // adapter: local->native
                c.local.setAnyways(newKVs);
            } else {
                L.log("EEK, client pull failed");
            }
        })
        .then(null, function(err) {L.log("err", err, err+"");});
}

function setup(c, enckey, signkey) {
    L.log("setup", c.name);
    c.store = new VersionStore(enckey, signkey, "db");
    c.myVersion_A = null;
    c.baseVersion_B = null;
    c.serverVersion_C = null;
    c.whenInitialSyncDone = defer();

    // defer this until after the initial sync has finished
    c.whenInitialSyncDone.promise.then(function() {
        L.log(" initial sync done, ready for broadcast", c.name);
        c.broadcast.onChange(function(newSignedVerhash) {
            notify(c, newSignedVerhash);
        });
    });

    L.log("setting up localdb.on");
    // we require that this listener be fired at least once, with a non-null
    // value, soon
    c.local.onChange(function(val) {
        try{local_changed(c, val);}
        catch (e) {L.log("error in local_changed", e, ""+e);}
    });

}

exports.setup = setup;
