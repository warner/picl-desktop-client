
const pcrypto = require("./picl-crypto");

/**
 * "Version"(on the server) is an immutable snapshot of key-encrypted-value
 * ("KEV") pairs. You get them from the VersionStore
 */

function Version(store, seqnum, signedVerhash, KEVs) {
    this._store = store;
    this._seqnum = seqnum;
    this._signedVerhash = signedVerhash;
    this._KEVs = KEVs;
    var out = pcrypto.extractVerhash(signedVerhash);
    this._verhash = out.verhash;
}

Version.prototype.getVerhash = function() {return this._verhash;};
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
    if (this._actualVerhash != this._expectedVerhash)
        throw new Error("corrupt Version, try resending");
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
    this._currentVersion = null;
};

CurrentVersion.prototype.setVersion = function(oldVerhash, newVersion) {
    if (oldVerhash === null) {
        if (this._currentVersion === null) {
            this._currentVersion = newVersion;
            return newVersion;
        } else {
            //throw new Error("out of date");
            return this._currentVersion;
        }
    } else {
        if (this._currentVersion.getVerhash() === oldVerhash) {
            // consider requiring new seqnum > old seqnum? ==old+1?
            // or just let clients set whatever they want
            var old = this._currentVersion;
            this._currentVersion = newVersion;
            old.free();
            return newVersion;
        } else {
            //throw new Error("out of date");
            return this._currentVersion;
        }
    }
};

exports.CurrentVersion = CurrentVersion;
