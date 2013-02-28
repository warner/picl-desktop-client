
const pcrypto = require("./picl-crypto");

/**
 * "Version" is an immutable snapshot of key-value ("KV") pairs, with
 * associated key-encrypted-value ("KEV") pairs. You get them from the
 * VersionStore
 */

function Version(store, seqnum, verhash, KVs, KEVs) {
    this._store = store;
    this._seqnum = seqnum;
    this._verhash = verhash;
    this._signedVerhash = null;
    this._KVs = KVs;
    this._KEVs = KEVs;
}

Version.prototype.getVerhash = function() {return this._verhash;};
Version.prototype.getSeqnum = function() {return this._seqnum;};
Version.prototype.getSignedVerhash = function() {
    if (!this._signedVerhash)
        this._signedVerhash = pcrypto.signVerhash(this._store.key,
                                                  this._seqnum, this._verhash);
    return this._signedVerhash;
};
Version.prototype.iterKVs = function() {
    //return Iterator(this._KVs);
    var out = [];
    var KVs = this._KVs;
    Object.keys(KVs).forEach(function(key) {
        out.push([key, KVs[key]]);
    });
    return out;
};
Version.prototype.iterKEVs = function() {
    //return Iterator(this._KEVs);
    var out = [];
    var KEVs = this._KEVs;
    Object.keys(KEVs).forEach(function(key) {
        out.push([key, KEVs[key]]);
    });
    return out;
};
Version.prototype.createNextVersion = function() {
    return new NewVersion({store: this._store, seqnum: this._seqnum+1,
                          initialData: {KEs: this._KVs, KEVs: this._KEVs}});
};
Version.prototype.createNewVersion = function(signedVerhash) {
    // verifyVerhash may throw
    var out = pcrypto.verifyVerhash(this._store.key, signedVerhash);
    return new NewVersion({store: this._store, seqnum: out.seqnum,
                           expectedVerhash: out.verhash});
};
Version.prototype.createDeltaFrom = function(oldVersion) {
    var oldKEVs = oldVersion._KEVs;
    var newKEVs = this._KEVs;
    //console.log("IND", JSON.stringify(oldKEVs), JSON.stringify(newKEVs));
    var deltas = [];
    var allKeys = new Set();
    for (let key of Object.keys(oldKEVs))
        allKeys.add(key);
    for (let key of Object.keys(newKEVs))
        allKeys.add(key);
    for (let key of [i for (i of allKeys)].sort()) {
        if (!newKEVs[key])
            deltas.push(["del", key]);
        else if (!oldKEVs[key])
            deltas.push(["set", key, newKEVs[key]]);
        else if (oldKEVs[key] != newKEVs[key])
            deltas.push(["set", key, newKEVs[key]]);
    }
    return deltas;
};

/**
 * "NewVersion" is a mutable version-under-construction. There are four ways
 * to create one:
 *
 *** the very first one is made by asking the VersionStore to
 *   createFirstVersion(), then add the whole native store to it with
 *   addKV(), then call close() to get a complete Version.
 *** later, when new local changes are made to the native datastore, you ask
 *   the previous version to createNextVersion(), add new items with addKV(),
 *   delete removed items with deleteKey(), then call close() to get a
 *   complete Version.
 *** when the server announces a new version, it may provide deltas from the
 *   older version that it remembers your device holding. Ask the old Version
 *   to createNewVersion(key, signedVerhash), which may reject if the version
 *   hash is invalid or a rollback. Then apply the deltas provided by the
 *   server with setKEV() and deleteKey(). When all deltas have been applied,
 *   call close(), which will check+verify the version hash (possibly
 *   throwing an error if it does not match) and returns a complete Version
 *   object.
 *** if the server has no suitable deltas, it will give you a complete copy
 *   of the latest version instead. Ask the VersionStore to
 *   createNewVersion(key, signedVerhash), which may reject if the version
 *   hash is invalid or a rollback. Then apply the server-provided KEVs with
 *   setKEV(), then call close() (which checks the version hash) to get the
 *   final Version object.
 */

function NewVersion(args) {
    this._store = args.store;
    this._seqnum = args.seqnum;
    this._expectedVerhash = args.expectedVerhash; // optional
    this._actualVerhash = null;
    this._KVs = {};
    if (args.initialData && args.initialData.KVs)
        for (let key in args.initialData.KVs)
            this._KVs[key] = args.initialData.KVs[key];
    this._KEVs = {};
    if (args.initialData && args.initialData.KEVs)
        for (let key in args.initialData.KEVs)
            this._KEVs[key] = args.initialData.KEVs[key];
}

NewVersion.prototype.setKV = function(key, value) {
    this._KVs[key] = value;
    this._KEVs[key] = pcrypto.encryptKV(this.key, value);
    console.log("DID SET", JSON.stringify(this._KEVs));
};

NewVersion.prototype.deleteKey = function(key) {
    delete this._KVs[key];
    delete this._KEVs[key];
};

NewVersion.prototype.setKEV = function(key, encryptedValue) {
    this._KEVs[key] = encryptedValue;
    this._KVs[key] = pcrypto.decryptKVE(this._store.key, encryptedValue);
};

function computeVerhash(KEVs) {
    var h = new pcrypto.VerHash();
    var keys = Object.getOwnPropertyNames(KEVs).sort();
    keys.forEach(function(key) {
        // TODO: proper safe concatenation
        h.update(key);
        h.update(KEVs[key]);
    });
    return h.hexdigest();
};

NewVersion.prototype.close = function() {
    this._actualVerhash = computeVerhash(this._KEVs);
    if (this._expectedVerhash && this._actualVerhash != this._expectedVerhash)
        throw new Error("corrupt Version, try refetching");
    var nv = new Version(this._store, this._seqnum, this._actualVerhash,
                         this._KVs, this._KEVs);
    this._store._addVersion(nv);
    return nv;
};

// note we do not export a constructor for NewVersion: these are for internal
// construction only (although instances are exposed to callers)


/*
 * the VersionStore provides persistent storage for Version objects.
 */

function VersionStore(key, db) {
    this._key = key;
    this._db = db;
    this._allVersions = {}; // indexed by verhash
}

VersionStore.prototype.getVersion = function(verhash) {};
VersionStore.prototype.free = function(deadVersion) {
    delete this._allVersions[deadVersion.verhash];
};
VersionStore.prototype.createFirstVersion = function() {
    var nv = new NewVersion({store: this, seqnum: 1});
    return nv;
};
VersionStore.prototype.createNewVersion = function(key, signedVerhash) {
    var out = pcrypto.verifyVerhash(key, signedVerhash); // may throw
    var nv = new NewVersion({store: this, seqnum: out.seqnum,
                             expectedVerhash: out.verhash});
    return nv;
};
VersionStore.prototype._addVersion = function(version) {
    this._allVersions[version.verhash] = version;
};


exports.VersionStore = VersionStore;
