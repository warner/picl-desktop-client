const VersionStore = require("versions").VersionStore;
const L = require("logger");
const promise = require("sdk/core/promise");

function Pusher(newVersion, oldVersion, transport) {
    this._newVersion = newVersion;
    this._oldVersion = oldVersion;
    this._transport = transport;

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
    if (this._next == "DONE")
        throw new Error("precondition fail: don't cycle when we're DONE");
    // TODO: batch size can be adaptive, i.e. serialize records until the
    // message grows above a limit
    var BATCHSIZE = 2;
    var batch = self._deltas.slice(this._next, this._next+BATCHSIZE);
    var firstkey, uptokey;
    if (this._next == 0)
        firstkey = "START";
    else
        firstkey = batch[0][0];
    if (this._next+BATCHSIZE >= self._deltas.length) {
        uptokey = "END";
        this._next = "DONE";
    } else {
        uptokey = self._deltas[this._next+BATCHSIZE][0];
        this._next += BATCHSIZE;
    }
    var msg = { type: "update",
                from: this._oldVersion.getVerhash(),
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
    if (resp.type == "ok") {
        if (this._next == "DONE") {
            // that was everything, we're now on newVersion
            var ret = { type: "success",
                        serverVersion: this._newVersion.getSignedVerhash()
                      };
            return this._done.resolve(ret);
        }
        // otherwise, send the next batch
        return this._cycle();
    }
    if (resp.type == "out-of-date") {
        var ret = { type: "out-of-date",
                    serverVersion: resp.serverVersion // signedVerhash
                  };
        return this._done.resolve(ret);
    }
    if (resp.type == "missing-keys") {
        // server was interrupted, lost its mind
        this.reset();
        return this._cycle();
    }
    var ret = new Error("unexpected server response: "+JSON.stringify(resp));
    return this._done.reject(ret);
};

Pusher.prototype._error = function(error) {
    var ret = new Error("server error: "+JSON.stringify(error));
    return this._done.reject(ret);
};


function push(newVersion, oldVersion, transport) {
    var p = Pusher(newVersion, oldVersion, transport);
    return p.start();
}

exports.push = push;


function Puller(oldVersion, newVersion, transport) {
    this._oldVersion = oldVersion;
    this._newVersion = newVersion; // this is a NewVersion instance
    this._transport = transport;

    this._next = "START";
}

Puller.prototype.start = function() {
    this._done = promise.defer();
    this._cycle();
    return this._done.promise;
};

Puller.prototype._cycle = function() {
    if (this._next == "DONE")
        throw new Error("precondition fail: don't cycle when we're DONE");
    var msg = { type: "fetch",
                from: this._oldVersion.getVerhash(),
                to: this._newVersion.getVerhash(),
                first: this._next
              };
    // TODO: add a timeout, or make the transport responsible for that
    this._transport.send(msg)
        .then(this._response, this._error);
};

Puller.prototype._response = function(resp) {
    if (resp.type == "ok") {
        var nv = this._newVersion;
        resp.deltas.forEach(function(delta) {
            if (delta[1] == "del")
                nv.deleteKey(delta[0]);
            else if (delta[1] == "set")
                nv.setKEV(delta[0], delta[2]);
            else
                throw new Error("weird delta command: "+delta[1]);
        });
        if (resp.next == "DONE") {
            // that was everything
            try {
                var ret = { type: "success",
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
    if (resp.type == "unknown-delta") {
        // we try again, this time asking to fetch the whole dataset, instead
        // of a delta. Slower, but more likely to work.
        Puller(null, this._newVersion, this._transport)
        ...
        var ret = { type: "out-of-date",
                    serverVersion: resp.serverVersion // signedVerhash
                  };
        return this._done.resolve(ret);
    }
    if (resp.type == "missing-keys") {
        // server was interrupted, lost its mind
        this.reset();
        return this._cycle();
    }
    var ret = new Error("unexpected server response: "+JSON.stringify(resp));
    return this._done.reject(ret);
};

Puller.prototype._error = function(error) {
    var ret = new Error("server error: "+JSON.stringify(error));
    return this._done.reject(ret);
};


function pull(newVersion, oldVersion, transport) {
    var p = Puller(newVersion, oldVersion, transport);
    return p.start();
}

exports.pull = pull;
