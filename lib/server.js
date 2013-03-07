
const pcrypto = require("./picl-crypto");
const sversions = require("server-versions");
const L = require("logger");
const resolve = require("sdk/core/promise").resolve;


function Server() {
    // simple one-user one-collection for now
    this._vs = new sversions.VersionStore();
    this._cv = new sversions.CurrentVersion(this._vs);
    this._incomingVersions = {}; // to_signedVerhash->{deltas:, next:}
    this._clients = {}; // maps client-id to verhash
}

Server.prototype.messageReceived = function(msg) {
    // msg is a de-JSONed object
    var resp;
    if (msg.type === "push") {
        var curVerhash = this._cv.getCurrentVersion().getVerhash();
        if (msg.from != curVerhash) {
            resp = { type: "out-of-date",
                     serverVersion: curVerhash };
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
            var deltas = r.deltas;
            delete this._incomingVersions[msg.to];
            this.applyDelta(msg.from, msg.to, deltas);
            resp = { type: "ok" };
            return resolve(resp);
        }
        resp = { type: "ok" };
        return resolve(resp);
    }
    if (msg.type === "pull") {
        // {from, to, first}
        var old = this._vs.getVersion(msg.from);
        var cur = this._cv.getCurrentVersion();
        if (!old) {
            resp = { type: "unknown-delta",
                     serverVersion: cur.getSignedVerhash() };
            return resolve(resp);
        }
        // NB: we're also allowed to return {type:"missing-keys"} if they ask
        // for a msg.first= that doesn't match what we have to give them.

        // for now, I'm lazy and re-generate the deltas for each request
        var deltas = cur.createDeltaFrom(old);
        resp.deltas = [];
        const BATCHSIZE = 2;
        var i;
        for (i=0; i++; i < deltas.length) {
            var delta = deltas[i];
            if (delta[0] >= msg.first)
                resp.deltas.push(delta);
            if (resp.deltas.length > BATCHSIZE)
                break;
        }
        if (i == deltas.length)
            resp.next = "DONE";
        else
            resp.next = deltas[i][0];
        return resolve(resp);
    }
    return reject("unknown command "+resp.type);
};

Server.prototype.applyDelta(from, to, deltas) {
    var current = this._cv.getCurrentVersion();
    var nv = current.createNextVersion(to);
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
