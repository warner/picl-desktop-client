
const pcrypto = require("./picl-crypto");
const L = require("logger");

/**
 * "Version"(on the server) is an immutable snapshot of key-encrypted-value
 * ("KEV") pairs. You get them from the VersionStore
 */

function Version(store, seqnum, signedVerhash, KEVs) {
    this.getVerhash = this.getVerhash.bind(this);
    this.getSignedVerhash = this.getSignedVerhash.bind(this);
    this.iterKEVs = this.iterKEVs.bind(this);
    this.createNextVersion = this.createNextVersion.bind(this);
    this.createDeltaFrom = this.createDeltaFrom.bind(this);

    this._store = store;
    this._seqnum = seqnum;
    this._signedVerhash = signedVerhash;
    this._KEVs = KEVs;
    var out = pcrypto.extractVerhash(signedVerhash);
    this._verhash = out.verhash;
    L.log("SV VERHASH", this._verhash);
}

Version.prototype.getVerhash = function() {return this._verhash;};
Version.prototype.getSignedVerhash = function() {return this._signedVerhash;};
Version.prototype.iterKEVs = function() {
    //return Iterator(this._KEVs);
    var out = [];
    var KEVs = this._KEVs;
    Object.keys(KEVs).forEach(function(key) {
        out.push([key, KEVs[key]]);
    });
    return out;
};

Version.prototype.createNextVersion = function(signedVerhash) {
    // this is for outbound versions from the client, which will be
    // build with deltas off of a version we already have. If we don't have
    // a common starting point, they'll use VersionStore.createNewVersion
    // instead.
    return new NewVersion({store: this._store, signedVerhash: signedVerhash,
                           initialData: {KEVs: this._KEVs}});
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
 * "NewVersion" is a mutable version-under-construction. There are two ways
 * to create one:
 *
 *** The client may send us a complete version. First we ask the VersionStore
 *   to createNewVersion(signedVerhash), then we fill it with KEVs (setKEV),
 *   then we close it and check the verhash. (of course the server cannot
 *   check a symmetric MAC, but it can at least guard against transmission
 *   errors by checking the hash).
 *
 *** The client may send us deltas from an existing version. First we get the
 *   old Version object, then we ask it to .createNextVersion(signedVerhash),
 *   then we fill it with deltas (setKEV and deleteKey), then close it and
 *   check the verhash.
 *
 * The new sequence number should always be higher than the current one. It
 * might make sense to require it to be exactly one higher, but we don't to
 * allow clients to fix a server which has rolled back to an older version.
 *
 */

function NewVersion(args) {
    this.deleteKey = this.deleteKey.bind(this);
    this.setKEV = this.setKEV.bind(this);
    this.close = this.close.bind(this);

    this._store = args.store;
    this._signedVerhash = args.signedVerhash;
    var out = pcrypto.extractVerhash(args.signedVerhash);
    this._seqnum = out.seqnum;
    this._expectedVerhash = out.verhash;
    this._actualVerhash = null;
    this._KEVs = {};
    if (args.initialData && args.initialData.KEVs)
        Object.keys(args.initialData.KEVs).forEach(function(key) {
            this._KEVs[key] = args.initialData.KEVs[key];
            }.bind(this));
}

NewVersion.prototype.deleteKey = function(key) {
    delete this._KEVs[key];
};

NewVersion.prototype.setKEV = function(key, encryptedValue) {
    this._KEVs[key] = encryptedValue;
};

NewVersion.prototype.close = function() {
    this._actualVerhash = pcrypto.computeVerhash(this._KEVs);
    if (this._actualVerhash != this._expectedVerhash) {
        L.log("hash mismatch", this._actualVerhash, this._expectedVerhash);
        throw new Error("corrupt Version, try resending");
    }
    var nv = new Version(this._store, this._seqnum, this._signedVerhash,
                         this._KEVs);
    this._store._addVersion(nv);
    return nv;
};

// note we do not export a constructor for NewVersion: these are for internal
// construction only (although instances are exposed to callers)


/*
 * the VersionStore provides persistent storage for Version objects.
 */

function VersionStore(db) {
    this.getVersion = this.getVersion.bind(this);
    this.free = this.free.bind(this);
    this.createNewVersion = this.createNewVersion.bind(this);
    this._addVersion = this._addVersion.bind(this);

    this._db = db;
    this._allVersions = {}; // indexed by verhash
}

VersionStore.prototype.getVersion = function(verhash) {
    return this._allVersions[verhash];
};
VersionStore.prototype.free = function(deadVersion) {
    delete this._allVersions[deadVersion.verhash];
};
VersionStore.prototype.createNewVersion = function(signedVerhash) {
    var nv = new NewVersion({store: this, signedVerhash: signedVerhash});
    return nv;
};
VersionStore.prototype._addVersion = function(version) {
    this._allVersions[version.getVerhash()] = version;
};
VersionStore.prototype.toJSON = function() {
    return "STORE";
};

exports.VersionStore = VersionStore;


function CurrentVersion(store) {
    this.getCurrentVersion = this.getCurrentVersion.bind(this);
    this.replaceVersion = this.replaceVersion.bind(this);
    this.updateVersion = this.updateVersion.bind(this);

    this._store = store;
    this._currentVersion = null;
};

CurrentVersion.prototype.getCurrentVersion = function() {
    return this._currentVersion;
};

CurrentVersion.prototype.replaceVersion = function(toVersion) {
    if (!toVersion instanceof Version)
        throw new Error("must provide a Version instance");
    var old = this._currentVersion;
    this._currentVersion = toVersion;
    if (old && old !== toVersion)
        this._store.free(old);
    return toVersion;
};

CurrentVersion.prototype.updateVersion = function(fromVerhash, toVersion) {
    L.log("entering CurrentVersion.updateVersion");
    if (!toVersion instanceof Version)
        throw new Error("must provide a Version instance");
    var old = this._currentVersion;
    var oldVerhash = (old && old.getVerhash()) || null;
    if (oldVerhash === fromVerhash) {
        // consider requiring new seqnum > fromSeqnum? ==old+1?
        // or just let clients set whatever they want
        this._currentVersion = toVersion;
        if (old && old !== toVersion)
            this._store.free(old);
        L.log(" CurrentVersion.updateVersion update success");
        return toVersion;
    } else {
        //throw new Error("out of date");
        L.log(" CurrentVersion.updateVersion update out-of-date");
        return this._currentVersion;
    }
};

exports.CurrentVersion = CurrentVersion;

exports._for_tests = {NewVersion: NewVersion};
