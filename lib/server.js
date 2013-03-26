
const pcrypto = require("./picl-crypto");
const sversions = require("server-versions");
const L = require("logger");
const resolve = require("sdk/core/promise").resolve;


function Server() {
    this.messageReceived = this.messageReceived.bind(this);
    this.applyDelta = this.applyDelta.bind(this);
    // simple one-user one-collection for now
    this._vs = new sversions.VersionStore();
    this._cv = new sversions.CurrentVersion(this._vs);
    this._incomingVersions = {}; // to_signedVerhash->{deltas:, next:}
    this._clients = {}; // maps client-id to verhash
}

Server.prototype.messageReceived = function(msg) {
    // msg is a de-JSONed object
    var resp;
    var cur = this._cv.getCurrentVersion();

    if (msg.type === "current") {
        var curVerhash = (cur && cur.getVerhash()) || null;
        var curSignedVerhash = (cur && cur.getSignedVerhash()) || null;
        resp = { type: "ok",
                 verhash: curVerhash,
                 signedVerhash: curSignedVerhash };
        return resolve(resp);
    }

    if (msg.type === "push") {
        var curVerhash = (cur && cur.getVerhash()) || null;
        var curSignedVerhash = (cur && cur.getSignedVerhash()) || null;
        if (msg.from != curVerhash) {
            L.log("OUTOFDATE", curSignedVerhash);
            resp = { type: "out-of-date",
                     serverVersion: curSignedVerhash };
            return resolve(resp);
        }
        if (msg.first === "START") {
            // create/replace an accumulator for incoming deltas
            this._incomingVersions[msg.to] = {deltas: [], next: "START"};
        }
        var r = this._incomingVersions[msg.to];
        if (!r) {
            resp = { type: "missing-keys" };
            return resolve(resp);
        }
        r.deltas = r.deltas.concat(msg.batch);
        if (msg.upto === "END") {
            var inboundDeltas = r.deltas;
            delete this._incomingVersions[msg.to];
            this.applyDelta(msg.from, msg.to, inboundDeltas);
            resp = { type: "ok" };
            return resolve(resp);
        }
        resp = { type: "ok" };
        return resolve(resp);
    }

    if (msg.type === "pull") {
        // {from, to, first}

        if (msg.to !== cur.getSignedVerhash()) {
            // they're asking for something that's out-of-date
            resp = { type: "unknown-delta",
                     serverVersion: cur.getSignedVerhash() };
            return resolve(resp);
        }

        var old;
        if (!msg.from) {
            // from==null means they want a full version, not a delta
            old = null;
        } else {
            old = this._vs.getVersion(msg.from);
            if (!old) {
                resp = { type: "unknown-delta",
                         serverVersion: cur.getSignedVerhash() };
                return resolve(resp);
            }
        }
        // NB: we're also allowed to return {type:"missing-keys"} if they ask
        // for a msg.first= that doesn't match what we have to give them.

        // for now, I'm lazy and re-generate the deltas for each request
        // NB: createDeltaFrom(null) means get whole version
        var outboundDeltas = cur.createDeltaFrom(old);
        resp = {type: "ok", deltas: []};
        const BATCHSIZE = 2;
        var i;
        for (i=0; i < outboundDeltas.length; i++) {
            var delta = outboundDeltas[i];
            L.log("DELTA", delta, i);
            if (delta[0] >= msg.first)
                resp.deltas.push(delta);
            if (resp.deltas.length > BATCHSIZE)
                break;
        }
        if (i == outboundDeltas.length)
            resp.next = "DONE";
        else
            resp.next = outboundDeltas[i][0];
        return resolve(resp);
    }
    L.log("unknown command "+msg.type);
    return reject("unknown command "+msg.type);
};

Server.prototype.applyDelta = function(from, to, deltas) {
    var current = this._cv.getCurrentVersion();
    var nv;
    if (current)
        nv = current.createNextVersion(to);
    else
        nv = this._vs.createNewVersion(to);
    deltas.forEach(function(delta) {
        if (delta[1] == "del")
            nv.deleteKey(delta[0]);
        else if (delta[1] == "set")
            nv.setKEV(delta[0], delta[2]);
        else
            throw new Error("weird delta command: "+delta[1]);
    });
    this._cv.updateVersion(from, nv.close());
};

exports.Server = Server;
