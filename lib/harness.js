
const L = require("logger");
const pcrypto = require("picl-crypto");
const Firebase = require("./firebase-jetpack").Firebase;
const client = require("./client");
const defer = require("sdk/core/promise").defer;
const resolve = require("sdk/core/promise").resolve;

function merge(base, mine, theirs) {
    // gets three Version objects. Is expected to return a new closed Version
    // object (or a Promise for one), derived from 'theirs', with a
    // meaningful combination of both 'mine' and 'theirs'. It's also ok to
    // just return 'theirs'.
    return theirs;
}

const BASEURL = "https://myfx-tabthing.firebaseio.com/deltathing/";

var signkey = pcrypto.hashKey("sign");
var enckey = pcrypto.hashKey("enc");

function createFirebaseFrontedNativeDatastore(name) {
    var localdb = new Firebase(BASEURL+name);
    var onChangeCB;
    return {
        _db: localdb,
        onChange: function(cb) {
            onChangeCB = cb;
            localdb.on("value", function(ss) {cb(ss.val());});
        },
        setAnyways: function(data) {
            // we need some specific semantics: the onChange listener should
            // be fired at least once after *every* setAnyways() call.
            // Firebase doesn't seem to call it if you do a set() that
            // doesn't change the value. So fake it. This is hack.
            localdb.once("value", function(ss) {
                if (JSON.stringify(ss.val()) === JSON.stringify(data))
                    onChangeCB(data);
                else
                    localdb.set(data);
            });
        },
        setIfStill: function(oldVersion, newVersion, data, after) {
            throw new Error("not implemented yet");
        }
    };
}

function createFirebaseBroadcast() {
    var broadcast = new Firebase(BASEURL+"broadcast");
    return {
        onChange: function(cb) {broadcast.on("value",
                                             function(ss) {cb(ss.val());});},
        set: function(data) {broadcast.set(data);}
    };
}

// these three utility functions return promises
function getFB(db) {
    var d = defer();
    db.once("value", function(ss) {
        d.resolve(ss.val());
    });
    return d.promise;
}

function setFB(db, value) {
    var d = defer();
    db.set(value, function(err, dummy) {
        d.resolve(err);
    });
    return d.promise;
}

exports.setup = function(name, transport) {
    var client_data = {name: name,
                       local: createFirebaseFrontedNativeDatastore(name),
                       broadcast: createFirebaseBroadcast(),
                       transport: transport,
                       merge: merge};

    L.log("maybe setting initial data");
    resolve(null)
        .then(function() {return getFB(client_data.local._db);})
        .then(function(data) {
            if (!data) return setFB(client_data.local._db,
                                    {initialKey1: name,
                                     initialKey2: "value2",
                                     initialKey3: "value3"
                                    });
        })
        .then(function() {
            L.log("calling client.setup on A");
            client.setup(client_data, enckey, signkey);
        })
        .then(function(){L.log("SETUP SUCCESSFUL");},
              function(err) {L.log("SETUP ERROR", err, ""+err);});
};
