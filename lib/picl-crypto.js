
const sjcl = require("./sjcl-with-cbc");

// we check the integrity of the aggregate encrypted data (VerHash) before
// trying to decrypt any records.
sjcl.beware["CBC mode is dangerous because it doesn't protect message integrity."]();

const entropy = require("./entropy");
sjcl.random.addEntropy(entropy.generateRandomBytesHex(32), 32*8,
                       "nsIRandomGenerator");


function VerHash() {
    this._accumulator = new sjcl.hash.sha256();
}

VerHash.prototype.update = function(data) {
    // this accepts bits, or strings (which will be utf8-encoded first)
    this._accumulator.update(data);
};
VerHash.prototype.hexdigest = function() {
    return sjcl.codec.hex.fromBits(this._accumulator.finalize());
};
VerHash.prototype.bitsdigest = function() {
    return this._accumulator.finalize(); // need a codec after this
};

function encodeNetstring(data) {
    return data.length + ":" + data + ",";
}

// TODO: give this pre-generated EV hashes
function computeVerhash(KEVs) {
    var h = new VerHash();
    var keys = Object.getOwnPropertyNames(KEVs).sort();
    keys.forEach(function(key) {
        // safe concatenation
        h.update(encodeNetstring(key));
        h.update(sjcl.hash.sha256.hash(KEVs[key])); // bits
    });
    return h.hexdigest();
};
exports.computeVerhash = computeVerhash;

exports.signVerhash = function(key, seqnum, verhash) {
    if (!Array.isArray(key))
        throw new Error("key must be a bitArray");
    if (typeof(seqnum) !== "number")
        throw new Error("seqnum must be integer");
    if (typeof(verhash) !== "string")
        throw new Error("verhash must be string");
    if (verhash.indexOf(":") !== -1)
        throw new Error("verhash must be a hex string"); // TODO regexp
    var signable = seqnum + ":" + verhash;
    var hmac = new sjcl.misc.hmac(key);
    var sig = hmac.mac(sjcl.codec.utf8String.toBits(signable)); // bits
    return signable + ":" + sjcl.codec.base64.fromBits(sig);
};
exports.verifyVerhash = function(key, signed) {
    if (typeof(signed) !== "string")
        throw new Error("signed value should be a string");
    var pieces = signed.split(":");
    if (pieces.length !== 3)
        throw new Error("corrupt version");
    var signable = pieces[0]+":"+pieces[1];
    var sig = sjcl.codec.base64.toBits(pieces[2]);
    var hmac = new sjcl.misc.hmac(key);
    var gotsig = hmac.mac(sjcl.codec.utf8String.toBits(signable));
    if (sjcl.bitArray.equal(sig, gotsig)) {
        return {seqnum: Number(pieces[0]), // TODO: Integer?
                verhash: pieces[1]};
    }
    throw new Error("corrupt version");
};
exports.extractVerhash = function(signed) {
    // just extract the data, don't actually verify anything, since we don't
    // have the key here
    if (typeof(signed) !== "string")
        throw new Error("signed value should be a string");
    var pieces = signed.split(":");
    if (pieces.length !== 3)
        throw new Error("corrupt version");
    return {seqnum: Number(pieces[0]), // TODO: Integer?
            verhash: pieces[1]};
};

exports.encryptKV = function(key, value) {
    // key: requires bits
    // value: requires bits
    // AES256/CBC/PKCS#5
    if (!Array.isArray(value))
        throw new Error("value must be a bitArray");
    var IV = sjcl.random.randomWords(128/(8*4));
    var aes = new sjcl.cipher.aes(key); // could be cached
    var ct = sjcl.mode.cbc.encrypt(aes, value, IV);
    return sjcl.bitArray.concat(IV, ct); // returns bits
};

exports.decryptKEV = function(key, encrypted) {
    // you must check the integrity of the ciphertext before calling this

    // key: requires bits
    // encrypted: requires bits
    if (!Array.isArray(encrypted))
        throw new Error("encrypted value must be a bitArray");
    if (sjcl.bitArray.bitLength(encrypted) < 128)
        throw new Error("corrupt encrypted value: too short");
    var aes = new sjcl.cipher.aes(key); // could be cached
    var IV = sjcl.bitArray.bitSlice(encrypted, 0, 128);
    var ct = sjcl.bitArray.bitSlice(encrypted, 128);
    return sjcl.mode.cbc.decrypt(aes, ct, IV); // returns bits
};

exports.hashKey = function(keyString) {
    return sjcl.hash.sha256.hash(keyString);
};
