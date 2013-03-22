const L = require("logger");
const client = require("client");
const pcrypto = require("picl-crypto");
const VersionStore = require("client-versions").VersionStore;
const Server = require("server").Server;
const LoopbackTransport = require("transport-loopback").LoopbackTransport;
const Firebase = require("./firebase-jetpack").Firebase;
const timers = require("sdk/timers");

var server, transport;

function setup_server() {
    server = new Server();
    transport = new LoopbackTransport(server);
}

var broadcast;
const BASEURL = "https://myfx-tabthing.firebaseio.com/deltathing/";
function setup_broadcast() {
    broadcast = new Firebase(BASEURL+"broadcast");
}

var clients = {};

var signkey = pcrypto.hashKey("sign");
var enckey = pcrypto.hashKey("enc");

function setup_one(name) {
    L.log("setup", name);
    var store = new VersionStore(enckey, signkey, "db");
    var c = clients[name] = {data: {},
                             store: store,
                             currentVersion: null,
                             serverVersion: null
                            };
    var localdb = new Firebase(BASEURL+name);

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
        if (c.currentVersion)
            nv = c.currentVersion.createNextVersion();
        else
            nv = c.store.createFirstVersion();
        nv.setAllKVs(c.data);
        c.currentVersion = nv.close();
        client.push(c.currentVersion, c.serverVersion, transport)
            .then(function(ret) {
                // check for success
                L.log("client", name, "pushed", ret.type);
                if (ret.type === "success") {
                    c.serverVersion = c.currentVersion;
                    // notify other clients
                    broadcast.set(ret.serverVersion); // signedVerhash
                } else {
                    L.log("EEK, client push failed");
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
                catch (e) {L.err("error in local_changed", e, ""+e);}
            });
        }, 1000);
    });
    L.log(" set complete");

    function notify(ss) {
        L.log("notify", name);
        var newSignedVerhash = ss.val();
        L.log(" newSignedVerhash is", newSignedVerhash);
        if (c.currentVersion &&
            (newSignedVerhash === c.currentVersion.getSignedVerhash())) {
            L.log("notify "+name+" doesn't change anything");
            return;
        }
        if (!newSignedVerhash)
            return;
        // now pull
        L.log(" starting pull");
        client.pull(newSignedVerhash, c.currentVersion, c.store, transport)
            .then(function(ret) {
                L.log("client", name, "pulled", ret.type,
                      ret.newVersion.getSignedVerhash());
                if (ret.type == "success") {
                    c.currentVersion = ret.newVersion;
                    c.serverVersion = ret.newVersion;
                    c.data = c.currentVersion.getAllKVs();
                    localdb.set(c.data);
                } else {
                    L.log("EEK, client pull failed");
                }
            });
    }
    broadcast.on("value", notify);

}

exports.setup = function() {
    setup_server();
    setup_broadcast();
    setup_one("A");
    setup_one("B");
};
