
const L = require("logger");
const pcrypto = require("picl-crypto");
const Firebase = require("./firebase-jetpack").Firebase;
const timers = require("sdk/timers");
const client = require("./client");

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
    return {
        onChange: function(cb) {localdb.on("value",
                                           function(ss) {cb(ss.val());});},
        setAnyways: function(data, after) {localdb.set(data, after);},
        setIfStill: function(oldVersion, newVersion, data, after) {
            throw new Error("not implemented yet");
        }
    };
}

function createFirebaseBroadcast(name) {
    var broadcast = new Firebase(BASEURL+"broadcast");
    return {
        onChange: function(cb) {broadcast.on("value",
                                             function(ss) {cb(ss.val());});},
        set: function(data) {broadcast.set(data);}
    };
}

exports.setup = function(transport) {
    var client_A = {name: "A",
                    local: createFirebaseFrontedNativeDatastore("A"),
                    broadcast: createFirebaseBroadcast("A"),
                    transport: transport,
                    merge: merge};
    L.log("setting initial A");
    client_A.local.setAnyways({key: "value A"},
                              function(error, dummy) {
                                  L.log(" initial set done for A", error);
                                  });
    client.setup(client_A, enckey, signkey);
    var client_B = {name: "B",
                    local: createFirebaseFrontedNativeDatastore("B"),
                    broadcast: createFirebaseBroadcast("B"),
                    transport: transport,
                    merge: merge};
    // B will probably hear about the broadcast before it hears about this
    // setAnyways
    L.log("setting initial B");
    client_B.local.setAnyways({key: "value B"});
    timers.setTimeout(function() {
        L.log("calling client.setup on B");
        L.log(client_B);
        client.setup(client_B, enckey, signkey);
    }, 2000);
};
