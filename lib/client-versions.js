
const pcrypto = require("./picl-crypto");
const sjcl = require("./sjcl-with-cbc.js");

/**
 * "Version" is an immutable snapshot of key-value ("KV") pairs, with
 * associated key-encrypted-value ("KEV") pairs. You get them from the
 * VersionStore. We accept/store/return the EVs as base64-encoded strings
 * (using sjcl's native +/ alphabet). We accept/store/return the
 * non-encrypted values as JSON objects, although that's just a choice of
 * this particular implementation: the protocol itself merely specifies that
 * the encryption function is given a bytestring, and the decryption function
 * returns a bytestring, and encoding beyond that is up to the application.
 */

function Version(store, key, seqnum, verhash, KVs, KEVs) {
    this.getVerhash = this.getVerhash.bind(this);
    this.getSeqnum = this.getSeqnum.bind(this);
    this.getSignedVerhash = this.getSignedVerhash.bind(this);
    this.getAllKVs = this.getAllKVs.bind(this);
    this.iterKVs = this.iterKVs.bind(this);
    this.iterKEVs = this.iterKEVs.bind(this);
    this.createNextVersion = this.createNextVersion.bind(this);
    this.createNewVersion = this.createNewVersion.bind(this);
    this.createDeltaFrom = this.createDeltaFrom.bind(this);

    this._store = store;
    this._key = key;
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

Version.prototype.getAllKVs = function() {
    var out = {};
    var KVs = this._KVs;
    Object.keys(KVs).forEach(function(key) {
        out[key] = KVs[key];
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
    return new NewVersion({store: this._store, key: this._key,
                           seqnum: this._seqnum+1,
                           initialData: {KVs: this._KVs, KEVs: this._KEVs}});
};
Version.prototype.createNewVersion = function(signedVerhash) {
    // this is for inbound versions from the server, which will be
    // build with deltas off of a version we already have. If we don't have
    // a common starting point, they'll use VersionStore.createNewVersion
    // instead.
    var out = pcrypto.verifyVerhash(this._store.key, signedVerhash);
    // verifyVerhash may throw
    return new NewVersion({store: this._store, key: this._key,
                           seqnum: out.seqnum,
                           expectedVerhash: out.verhash,
                           initialData: {KVs: this._KVs, KEVs: this._KEVs}});
};
Version.prototype.createDeltaFrom = function(oldVersion) {
    var oldKEVs = (oldVersion && oldVersion._KEVs) || {};
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
            deltas.push([key, "del"]);
        else if (!oldKEVs[key])
            deltas.push([key, "set", newKEVs[key]]);
        else if (oldKEVs[key] != newKEVs[key])
            deltas.push([key, "set", newKEVs[key]]);
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
    this.setKV = this.setKV.bind(this);
    this.deleteKey = this.deleteKey.bind(this);
    this.setKEV = this.setKEV.bind(this);
    this.setAllKVs = this.setAllKVs.bind(this);
    this.close = this.close.bind(this);

    this._key = args.key;
    this._store = args.store;
    this._seqnum = args.seqnum;
    this._expectedVerhash = args.expectedVerhash; // optional
    this._actualVerhash = null;
    this._KVs = {};
    if (args.initialData && args.initialData.KVs)
        Object.keys(args.initialData.KVs).forEach(function(key) {
            this._KVs[key] = args.initialData.KVs[key];
            }.bind(this));
    this._KEVs = {};
    if (args.initialData && args.initialData.KEVs)
        Object.keys(args.initialData.KEVs).forEach(function(key) {
            this._KEVs[key] = args.initialData.KEVs[key];
            }.bind(this));
}

NewVersion.prototype.setAllKVs = function(newKVs) {
    var allKeys = new Set();
    for (let key of Object.keys(this._KVs))
        allKeys.add(key);
    for (let key of Object.keys(newKVs))
        allKeys.add(key);

    for (let key of [i for (i of allKeys)].sort()) {
        if (!newKVs[key])
            this.deleteKey(key);
        else if (!this._KVs[key])
            this.setKV(key, newKVs[key]);
        else if (this._KVs[key] != newKVs[key])
            this.setKV(key, newKVs[key]);
    }
};

NewVersion.prototype.setKV = function(key, value) {
    // key: arbitrary string
    // value: arbitrary (JSON-serializable) object
    this._KVs[key] = value;
    var V_bits = sjcl.codec.utf8String.toBits(JSON.stringify(value));
    var EV_bits = pcrypto.encryptKV(this._key, V_bits);
    var EV_base64 = sjcl.codec.base64.fromBits(EV_bits);
    this._KEVs[key] = EV_base64;
};

NewVersion.prototype.deleteKey = function(key) {
    delete this._KVs[key];
    delete this._KEVs[key];
};

function decryptKEV(enckey, encryptedValue) {
    var EV_bits = sjcl.codec.base64.toBits(encryptedValue);
    var V_bits = pcrypto.decryptKEV(enckey, EV_bits);
    var V_obj = JSON.parse(sjcl.codec.utf8String.fromBits(V_bits));
    return V_obj;
}

NewVersion.prototype.setKEV = function(key, encryptedValue) {
    // encryptedValue: base64
    this._KEVs[key] = encryptedValue;
    this._KVs[key] = decryptKEV(this._key, encryptedValue);
};

NewVersion.prototype.close = function() {
    this._actualVerhash = pcrypto.computeVerhash(this._KEVs);
    if (this._expectedVerhash && this._actualVerhash != this._expectedVerhash)
        throw new Error("corrupt Version, try refetching");
    var nv = new Version(this._store, this._key,
                         this._seqnum, this._actualVerhash,
                         this._KVs, this._KEVs);
    this._store._addVersion(nv);
    return nv;
};

// we do not export a constructor for NewVersion: these are for internal
// construction only (although instances are exposed to callers)


/*
 * the VersionStore provides persistent storage for Version objects.
 */

function VersionStore(key, db) {
    this.getVersion = this.getVersion.bind(this);
    this.free = this.free.bind(this);
    this.createFirstVersion = this.createFirstVersion.bind(this);
    this.createNewVersion = this.createNewVersion.bind(this);
    this._addVersion = this._addVersion.bind(this);

    this._key = key;
    this._db = db;
    this._allVersions = {}; // indexed by verhash
}

VersionStore.prototype.getVersion = function(verhash) {
    return this._allVersions[verhash];
};
VersionStore.prototype.free = function(deadVersion) {
    delete this._allVersions[deadVersion.verhash];
};
VersionStore.prototype.createFirstVersion = function() {
    var nv = new NewVersion({store: this, key: this._key, seqnum: 1});
    return nv;
};
VersionStore.prototype.createNewVersion = function(signedVerhash) {
    var out = pcrypto.verifyVerhash(this._key, signedVerhash); // may throw
    var nv = new NewVersion({store: this, key: this._key,
                             seqnum: out.seqnum,
                             expectedVerhash: out.verhash});
    return nv;
};
VersionStore.prototype._addVersion = function(version) {
    this._allVersions[version.getVerhash()] = version;
};
VersionStore.prototype.toJSON = function() {
    return "STORE";
};


exports.VersionStore = VersionStore;

exports._for_tests = {NewVersion: NewVersion,
                      decryptKEV: decryptKEV};
