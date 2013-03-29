const VersionStore = require("client-versions").VersionStore;
const L = require("logger");
const promise = require("sdk/core/promise");
const pcrypto = require("picl-crypto");

// TODO: "START" and "END" symbols must be distinctive

function Pusher(newVersion, oldVersion, transport) {
    this._newVersion = newVersion;
    this._oldVersion = oldVersion;
    this._transport = transport;

    // BTW I hate javascript
    this.reset = this.reset.bind(this);
    this.start = this.start.bind(this);
    this._cycle = this._cycle.bind(this);
    this._response = this._response.bind(this);
    this._error = this._error.bind(this);

    // TODO: we could create this incrementally, instead of holding the whole
    // thing in RAM all the time
    this._deltas = newVersion.createDeltaFrom(oldVersion);
    this.reset();
}

Pusher.prototype.reset = function() {
    this._next = 0;
};

Pusher.prototype.start = function() {
    this._done = promise.defer();
    this._cycle();
    return this._done.promise;
};

Pusher.prototype._cycle = function() {
    L.log("  cycle push", this._next);
    if (this._next == "DONE")
        throw new Error("precondition fail: don't cycle when we're DONE");
    // TODO: batch size can be adaptive, i.e. serialize records until the
    // message grows above a limit
    var BATCHSIZE = 2;
    var batch = this._deltas.slice(this._next, this._next+BATCHSIZE);
    var firstkey, uptokey;
    if (this._next === 0)
        firstkey = "START";
    else
        firstkey = batch[0][0];
    if (this._next+BATCHSIZE >= this._deltas.length) {
        uptokey = "END";
        this._next = "DONE";
    } else {
        uptokey = this._deltas[this._next+BATCHSIZE][0];
        this._next += BATCHSIZE;
    }
    var oldVerhash = this._oldVersion && this._oldVersion.getVerhash();
    var msg = { type: "push",
                from: oldVerhash,
                to: this._newVersion.getSignedVerhash(),
                first: firstkey,
                upto: uptokey,
                batch: batch
              };
    // TODO: add a timeout, or make the transport responsible for that
    this._transport.send(msg)
        .then(this._response, this._error);
};

Pusher.prototype._response = function(resp) {
    var ret;
    if (resp.type === "ok") {
        if (this._next === "DONE") {
            // that was everything, we're now on newVersion
            ret = { type: "success",
                    serverVersion: this._newVersion.getSignedVerhash()
                  };
            return this._done.resolve(ret);
        }
        // otherwise, send the next batch
        return this._cycle();
    }
    if (resp.type === "out-of-date") {
        ret = { type: "out-of-date",
                serverVersion: resp.serverVersion // signedVerhash
              };
        return this._done.resolve(ret);
    }
    if (resp.type === "missing-keys") {
        // server was interrupted, lost its mind
        this.reset();
        return this._cycle();
    }
    ret = new Error("unexpected server response: "+JSON.stringify(resp));
    return this._done.reject(ret);
};

Pusher.prototype._error = function(error) {
    var ret = new Error("server error: "+error);
    this._done.reject(ret);
};


function push(newVersion, oldVersion, transport) {
    var p = new Pusher(newVersion, oldVersion, transport);
    return p.start();
}

exports.push = push;


function Puller(newVersionSignedVerhash, oldVersion, store, transport) {
    this._newVersionSignedVerhash = newVersionSignedVerhash;
    this._newVersionVerhash = pcrypto.extractVerhash(newVersionSignedVerhash).verhash;
    this._store = store;
    this._transport = transport;

    if (oldVersion && (typeof(oldVersion) !== "object"))
        throw new Error("oldVersion must be a Version", oldVersion);
    if (oldVersion)
        this._newVersion = oldVersion.createNewVersion(newVersionSignedVerhash);
    else
        this._newVersion = store.createNewVersion(newVersionSignedVerhash);
    if (oldVersion)
        this._oldVersionVerhash = oldVersion.getVerhash();
    else
        this._oldVersionVerhash = null;

    this.start = this.start.bind(this);
    this._cycle = this._cycle.bind(this);
    this._response = this._response.bind(this);
    this._error = this._error.bind(this);

    this._next = "START";
}

Puller.prototype.start = function() {
    this._done = promise.defer();
    this._cycle();
    return this._done.promise;
};

Puller.prototype._cycle = function() {
    if (this._next === "DONE")
        throw new Error("precondition fail: don't cycle when we're DONE");
    L.log("  cycle pull", this._next);
    var msg = { type: "pull",
                from: this._oldVersionVerhash,
                to: this._newVersionSignedVerhash,
                first: this._next
              };
    // TODO: add a timeout, or make the transport responsible for that
    this._transport.send(msg)
        .then(this._response, this._error);
};

Puller.prototype._response = function(resp) {
    var ret;
    if (resp.type === "ok") {
        var nv = this._newVersion;
        resp.deltas.forEach(function(delta) {
            if (delta[1] === "del")
                nv.deleteKey(delta[0]);
            else if (delta[1] === "set")
                nv.setKEV(delta[0], delta[2]);
            else
                throw new Error("weird delta command: "+delta[1]);
        });
        if (resp.next === "DONE") {
            // that was everything
            try {
                ret = { type: "success",
                        newVersion: nv.close()
                      };
                return this._done.resolve(ret);
            } catch(e) {
                return this._done.reject(e);
            }
        } else {
            // otherwise, fetch the next
            this._next = resp.next;
            return this._cycle();
        }
    }
    if (resp.type === "unknown-delta") {
        if (this._oldVersionVerhash === null) {
            // we asked for a full version, not a delta, and they couldn't
            // help. The version we asked for must not be available.
            L.log("pull failed even with full version");
            ret = { type: "out-of-date",
                    serverVersion: resp.serverVersion // signedVerhash
                  };
            return this._done.resolve(ret);
        }
        // we asked for a delta, and they couldn't help. Either they don't
        // know about the target, or they do but they don't happen to have a
        // delta from the starting point we asked for. We try again, this
        // time asking to fetch the whole dataset, instead of a delta.
        // Slower, but more likely to work.
        L.log("pull falling back to full version");
        var full = pull(this._newVersionSignedVerhash, null,
                        this._store, this._transport);
        return this._done.resolve(full);
    }
    if (resp.type === "missing-keys") {
        // server was interrupted, lost its mind
        this.reset();
        return this._cycle();
    }
    ret = new Error("unexpected server response: "+JSON.stringify(resp));
    return this._done.reject(ret);
};

Puller.prototype._error = function(error) {
    L.log("pull got server error: "+error, error);
    var ret = new Error("server error: "+JSON.stringify(error));
    return this._done.reject(ret);
};


function pull(newVersionSignedVerhash, oldVersion, store, transport) {
    var p = new Puller(newVersionSignedVerhash, oldVersion, store, transport);
    return p.start();
}

exports.pull = pull;
